const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('loading the admin script does not reload or move the page', () => {
  let reloads = 0, scrolls = 0;
  const location = { reload() { reloads++; } };
  const window = { location, addEventListener() {}, scrollTo() { scrolls++; } };
  const document = {
    documentElement: { lang: 'en' },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  const sessionStorage = { getItem() { return null; }, removeItem() {}, setItem() {} };
  vm.runInNewContext(fs.readFileSync('public/mikanbox/cloud-admin.js', 'utf8'), {
    window, document, location, sessionStorage, requestAnimationFrame(fn) { fn(); },
  });
  assert.equal(reloads, 0);
  assert.equal(scrolls, 0);
});
