const test=require('node:test');
const assert=require('node:assert/strict');
const {httpsRedirect}=require('../.test-build/src/https-redirect.js');
const worker=require('../.test-build/src/index.js').default;

test('plain HTTP admin requests go to the same address on https (GET/HEAD only)',async()=>{
  for(const method of ['GET','HEAD']){
    const r=httpsRedirect(new Request('http://admin.example.workers.dev/admin?view=pages',{method}));
    assert.equal(r.status,301);
    assert.equal(r.headers.get('Location'),'https://admin.example.workers.dev/admin?view=pages');
    assert.equal(r.headers.get('Strict-Transport-Security'),null,'no HSTS');
  }
  assert.equal(httpsRedirect(new Request('http://admin.example.workers.dev/admin',{method:'POST',body:'x'})),null,'POST is not redirected');
  assert.equal(httpsRedirect(new Request('https://admin.example.workers.dev/admin')),null,'HTTPS stays');
  for(const host of ['localhost:8787','127.0.0.1:8787','[::1]:8787','site.localhost'])
    assert.equal(httpsRedirect(new Request(`http://${host}/admin`)),null,'local development stays on http: '+host);
  const viaWorker=await worker.fetch(new Request('http://admin.example.workers.dev/admin'),{});
  assert.equal(viaWorker.status,301);
  assert.equal(viaWorker.headers.get('Location'),'https://admin.example.workers.dev/admin');
});
