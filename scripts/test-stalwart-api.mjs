// scripts/test-stalwart-api.mjs
import https from 'https';

const auth = Buffer.from('toowix-service@toowix.test:ToowixServiceSecret2026!Secure').toString('base64');

function request(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request('http://localhost:8090/jmap/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Authorization': `Basic ${auth}`
      }
    }, (res) => {
      let chunks = '';
      res.on('data', d => chunks += d);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(chunks) });
        } catch(e) {
          resolve({ status: res.statusCode, text: chunks });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function run() {
  console.log('Testing duplicate account with valid password length...');
  const res = await request({
    using: ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap'],
    methodCalls: [
      ['x:Account/set', {
        accountId: 'b',
        create: {
          'dupAcc': {
            '@type': 'User',
            name: 'admin',
            domainId: 'b',
            credentials: {
              '0': { '@type': 'Password', secret: 'ValidPassword123!' }
            }
          }
        }
      }, 'c_dup_acc']
    ]
  });
  console.log('Duplicate account response:', JSON.stringify(res, null, 2));
}

run().catch(console.error);
