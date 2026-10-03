// Minimal end-to-end API test. Run with: npm test   (uses a temporary data folder)
const os = require('os'), path = require('path'), fs = require('fs'), assert = require('assert');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'streetalert-'));
const app = require('./server');

(async () => {
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}/api`;
  const call = async (method, url, body, token) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json() };
  };
  let n = 0; const ok = (name) => console.log(`  ok ${++n} - ${name}`);

  let r = await call('POST', '/register', { name: 'Tendai Moyo', email: 'tendai@example.com', password: 'secret1', city: 'Harare' });
  assert.equal(r.status, 201); const token = r.data.token; ok('register');

  r = await call('POST', '/register', { name: 'Tendai Moyo', email: 'tendai@example.com', password: 'secret1', city: 'Harare' });
  assert.equal(r.status, 409); ok('duplicate email rejected');

  r = await call('POST', '/register', { name: 'A', email: 'bad', password: '1', city: 'Nowhere' });
  assert.equal(r.status, 400); ok('invalid registration rejected');

  r = await call('POST', '/login', { email: 'tendai@example.com', password: 'wrong' });
  assert.equal(r.status, 401); ok('wrong password rejected');

  r = await call('POST', '/login', { email: 'tendai@example.com', password: 'secret1' });
  assert.equal(r.status, 200); ok('login');

  r = await call('POST', '/faults', { category: 'roads', type: 'pothole', lat: -17.8, lng: 31.05 });
  assert.equal(r.status, 401); ok('reporting requires login');

  r = await call('POST', '/faults', { category: 'roads', type: 'pothole', lat: 51.5, lng: 0 }, token);
  assert.equal(r.status, 400); ok('location outside Zimbabwe rejected');

  r = await call('POST', '/faults', { category: 'roads', type: 'burst_pipe', lat: -17.8, lng: 31.05 }, token);
  assert.equal(r.status, 400); ok('type must match category');

  r = await call('POST', '/faults', { category: 'water', type: 'burst_pipe', lat: -17.8292, lng: 31.0522, street: 'Test Rd', city: 'Harare', description: 'Big leak' }, token);
  assert.equal(r.status, 201); assert.ok(r.data.fault.createdAt); const id = r.data.fault.id; ok('fault created with timestamp (' + r.data.fault.timeSource + ')');

  r = await call('GET', '/faults?city=Harare');
  assert.equal(r.data.faults.length, 1); ok('faults listed');

  r = await call('POST', `/faults/${id}/resolve`, null, token);
  assert.equal(r.data.fault.status, 'resolved'); assert.ok(r.data.fault.hoursToFix !== null); ok('reporter can mark fixed, with repair time recorded');

  r = await call('POST', `/faults/${id}/resolve`, null, token);
  assert.equal(r.data.fault.status, 'open'); ok('reporter can reopen a disputed fix');

  r = await call('POST', '/register', { name: 'Rudo Banda', email: 'rudo@example.com', password: 'secret1', city: 'Harare' });
  const token2 = r.data.token;
  r = await call('POST', `/faults/${id}/resolve`, null, token2);
  assert.equal(r.status, 200); assert.equal(r.data.fault.status, 'resolved'); assert.equal(r.data.fault.resolvedByName, 'Rudo'); ok('any signed-in user can report a fault as repaired');

  r = await call('POST', `/faults/${id}/resolve`, null, token2);
  assert.equal(r.status, 403); ok('only the original reporter can reopen a fix someone else made');

  r = await call('GET', '/analytics?city=Harare');
  assert.equal(r.status, 200);
  assert.equal(r.data.categories.water.reported, 1);
  assert.equal(r.data.categories.water.fixed, 1);
  assert.ok(r.data.categories.water.avgHoursToFix >= 0);
  ok('analytics reports counts and average repair time per category');

  server.close(); console.log(`\n${n} checks passed`); process.exit(0);
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
