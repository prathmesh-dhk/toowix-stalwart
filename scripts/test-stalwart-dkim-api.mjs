// scripts/test-stalwart-dkim-api.mjs
// Phase 0 spike: discover the real x:DkimSignature/get JSON shape by creating a
// throwaway test domain against the live dev Stalwart container and dumping the
// raw JMAP response for its auto-generated DkimSignature object(s).
import http from 'http';

const auth = Buffer.from('toowix-service@toowix.test:ToowixServiceSecret2026!Secure').toString('base64');
const testDomain = `dkim-spike-${Date.now()}.test`;

function request(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request('http://localhost:8085/jmap/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Authorization': `Basic ${auth}`,
      },
    }, (res) => {
      let chunks = '';
      res.on('data', (d) => (chunks += d));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(chunks) });
        } catch (e) {
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
  console.log(`\n=== 1. Creating test domain: ${testDomain} ===`);
  const createRes = await request({
    using: ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap'],
    methodCalls: [
      ['x:Domain/set', {
        accountId: 'b',
        create: {
          tempDomain: { name: testDomain, description: 'DKIM spike test domain', isEnabled: true },
        },
      }, 'c1'],
    ],
  });
  console.log(JSON.stringify(createRes, null, 2));

  const created = createRes?.data?.methodResponses?.[0]?.[1]?.created?.tempDomain;
  if (!created?.id) {
    console.error('\nDomain creation failed or shape differs from expectation. Inspect the response above manually.');
    return;
  }
  const domainId = created.id;
  console.log(`\nCreated domain id: ${domainId}`);

  console.log(`\n=== 2. Querying x:DkimSignature/get (all, unfiltered) ===`);
  const dkimGetAll = await request({
    using: ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap'],
    methodCalls: [
      ['x:DkimSignature/get', { accountId: 'b', ids: null }, 'c2'],
    ],
  });
  console.log(JSON.stringify(dkimGetAll, null, 2));

  console.log(`\n=== 3. Querying x:DkimSignature/query filtered by domainId=${domainId} ===`);
  const dkimQuery = await request({
    using: ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap'],
    methodCalls: [
      ['x:DkimSignature/query', { accountId: 'b', filter: { domainId } }, 'c3'],
    ],
  });
  console.log(JSON.stringify(dkimQuery, null, 2));

  console.log(`\n=== 4. Cleanup: destroying test domain ${domainId} ===`);
  const destroyRes = await request({
    using: ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap'],
    methodCalls: [
      ['x:Domain/set', { accountId: 'b', destroy: [domainId] }, 'c4'],
    ],
  });
  console.log(JSON.stringify(destroyRes, null, 2));
}

run().catch(console.error);
