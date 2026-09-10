const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

const PROXY_PORT = parseInt(process.env.PORT || '3000', 10);
const NEXT_PORT = 3001;
const STALWART_TARGET = process.env.STALWART_INTERNAL_URL || 'http://stalwart:8080';

console.log('[Toowix Webmail Proxy] Starting Next.js background server on port', NEXT_PORT);

// 1. Spawn the original Bulwark Next.js server on internal port 3001
const nextEnv = {
  ...process.env,
  PORT: String(NEXT_PORT),
  HOSTNAME: '127.0.0.1'
};

const nextProc = spawn('node', ['server.js'], {
  env: nextEnv,
  stdio: 'inherit',
  cwd: '/app'
});

nextProc.on('exit', (code) => {
  console.log(`[Toowix Webmail Proxy] Next.js process exited with code ${code}`);
  process.exit(code || 0);
});

// 2. Create the reverse proxy server on port 3000
const stalwartUrl = new URL(STALWART_TARGET);
const isStalwartHttps = stalwartUrl.protocol === 'https:';

const proxy = http.createServer((req, res) => {
  const isJmap = req.url.startsWith('/.well-known/jmap') || req.url.startsWith('/jmap');

  // If OPTIONS preflight for JMAP, respond immediately with permissive CORS
  if (isJmap && req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'access-control-allow-headers': 'Authorization, Content-Type, Accept, X-Requested-With',
      'access-control-max-age': '86400',
      'content-length': '0'
    });
    return res.end();
  }

  const transport = (isJmap && isStalwartHttps) ? https : http;
  const targetHost = isJmap ? stalwartUrl.hostname : '127.0.0.1';
  const defaultPort = isStalwartHttps ? '443' : '80';
  const targetPort = isJmap ? parseInt(stalwartUrl.port || defaultPort, 10) : NEXT_PORT;

  const isSession = isJmap && req.method === 'GET' && (req.url.startsWith('/.well-known/jmap') || req.url.startsWith('/jmap/session'));

  const headers = { ...req.headers };
  if (isJmap) {
    headers.host = `${targetHost}:${targetPort}`;
    if (isSession) {
      delete headers['accept-encoding']; // Request uncompressed JSON for session rewriting
    }
  }

  const proxyReq = transport.request({
    host: targetHost,
    port: targetPort,
    path: req.url,
    method: req.method,
    headers: headers,
    rejectUnauthorized: false,
  }, (proxyRes) => {
    const resHeaders = { ...proxyRes.headers };
    if (isJmap) {
      resHeaders['access-control-allow-origin'] = '*';
      resHeaders['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
      resHeaders['access-control-allow-headers'] = 'Authorization, Content-Type, Accept, X-Requested-With';
    }

    if (isSession && proxyRes.statusCode === 200) {
      const chunks = [];
      proxyRes.on('data', (chunk) => chunks.push(chunk));
      proxyRes.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf-8');
          const data = JSON.parse(body);

          const clientHost = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:8888';
          const isHttps = req.headers['x-forwarded-proto'] === 'https';
          const proto = isHttps ? 'https' : 'http';
          const wsProto = isHttps ? 'wss' : 'ws';
          const baseHttp = `${proto}://${clientHost}`;
          const baseWs = `${wsProto}://${clientHost}`;

          data.apiUrl = `${baseHttp}/jmap/`;
          data.downloadUrl = `${baseHttp}/jmap/download/{accountId}/{blobId}/{name}?accept={type}`;
          data.uploadUrl = `${baseHttp}/jmap/upload/{accountId}/`;
          data.eventSourceUrl = `${baseHttp}/jmap/eventsource/?types={types}&closeafter={closeafter}&ping={ping}`;
          if (data.capabilities && data.capabilities['urn:ietf:params:jmap:websocket']) {
            data.capabilities['urn:ietf:params:jmap:websocket'].url = `${baseWs}/jmap/ws`;
          }

          const modifiedBody = Buffer.from(JSON.stringify(data));
          resHeaders['content-length'] = modifiedBody.length;
          resHeaders['content-type'] = 'application/json; charset=utf-8';
          delete resHeaders['content-encoding'];
          res.writeHead(proxyRes.statusCode, resHeaders);
          res.end(modifiedBody);
        } catch (e) {
          res.writeHead(proxyRes.statusCode, resHeaders);
          res.end(Buffer.concat(chunks));
        }
      });
      return;
    }

    res.writeHead(proxyRes.statusCode, resHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('[Toowix Webmail Proxy Error]', req.url, err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad Gateway');
    }
  });

  req.pipe(proxyReq);
});

// Handle WebSocket upgrade for JMAP push notifications (/jmap/ws)
proxy.on('upgrade', (req, socket, head) => {
  const isJmap = req.url.startsWith('/jmap');
  const transport = (isJmap && isStalwartHttps) ? https : http;
  const targetHost = isJmap ? stalwartUrl.hostname : '127.0.0.1';
  const defaultPort = isStalwartHttps ? '443' : '80';
  const targetPort = isJmap ? parseInt(stalwartUrl.port || defaultPort, 10) : NEXT_PORT;

  const proxyReq = transport.request({
    host: targetHost,
    port: targetPort,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `${targetHost}:${targetPort}` },
    rejectUnauthorized: false,
  });

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
      Object.keys(proxyRes.headers)
        .map(h => `${h}: ${proxyRes.headers[h]}`)
        .join('\r\n') +
      '\r\n\r\n'
    );
    if (proxyHead && proxyHead.length) {
      socket.write(proxyHead);
    }
    if (head && head.length) {
      proxySocket.write(head);
    }
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });

  proxyReq.on('error', (err) => {
    console.error('[Toowix Webmail WebSocket Error]', err.message);
    socket.destroy();
  });

  proxyReq.end();
});

proxy.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log(`[Toowix Webmail Proxy] Running on port ${PROXY_PORT}`);
  console.log(`[Toowix Webmail Proxy]  -> Proxying JMAP calls to ${STALWART_TARGET}`);
  console.log(`[Toowix Webmail Proxy]  -> Proxying Webmail UI to Next.js on port ${NEXT_PORT}`);
});
