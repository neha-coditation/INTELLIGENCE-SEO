import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
test('worker refuses to serve static assets if credentials are not provisioned',async()=>{
  const r=await worker.fetch(new Request('https://seo.example.com/'),{ADMIN_USER:'admin',ADMIN_PASSWORD:''});
  assert.equal(r.status,401);
  assert.match(r.headers.get('www-authenticate'),/Basic/);
});
test('worker rejects unauthenticated API requests even when a database is configured',async()=>{
  const r=await worker.fetch(new Request('https://seo.example.com/api/summary'),{ADMIN_USER:'admin',ADMIN_PASSWORD:'some-long-unpredictable-secret',DB:{}});
  assert.equal(r.status,401);
});
