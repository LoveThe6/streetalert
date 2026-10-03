// Adds a demo account and sample faults so the map is not empty during a demo.
// Usage: npm run seed
// Works against whichever storage server.js is configured for (local file, or
// Upstash Redis if UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are set).
const crypto = require('crypto');
const { loadDb, saveDb, USE_REDIS } = require('./server');

(async () => {
  const db = await loadDb();
  if (!db.secret) db.secret = crypto.randomBytes(32).toString('hex');

  const salt = crypto.randomBytes(16).toString('hex');
  let demo = db.users.find(u => u.email === 'demo@streetalert.co.zw');
  if (!demo) {
    demo = { id: crypto.randomUUID(), name: 'Demo Citizen', email: 'demo@streetalert.co.zw', phone: '', city: 'Harare',
             password: `${salt}:${crypto.scryptSync('demo1234', salt, 64).toString('hex')}`, createdAt: new Date().toISOString() };
    db.users.push(demo);
  }
  const ago = h => new Date(Date.now() - h * 3600e3).toISOString();
  // [category, type, description, lat, lng, street, city, hoursAgoReported, hoursAgoFixed-or-null]
  const sample = [
    ['electricity','cable_stolen','Copper cables stolen from the pole, street is dark.',-17.8252,31.0335,'Samora Machel Avenue','Harare',3,null],
    ['water','burst_pipe','Water flowing across the road for two days.',-17.8319,31.0497,'Julius Nyerere Way','Harare',20,null],
    ['roads','pothole','Deep pothole in the left lane. Motorists slow down.',-17.7935,31.0468,'Borrowdale Road','Harare',6,null],
    ['accident','collision','Two vehicles collided, one lane blocked.',-17.8103,31.0916,'Chiremba Road','Harare',1,null],
    ['electricity','transformer','Transformer sparking since morning.',-20.1500,28.5833,'Fife Street','Bulawayo',9,null],
    ['water','sewer','Sewer overflowing onto the pavement.',-20.1602,28.5871,'12th Avenue','Bulawayo',30,null],
    ['roads','pothole','Large pothole near the intersection.',-18.9757,32.6700,'Herbert Chitepo Street','Mutare',12,null],
    // already-fixed examples, so the analytics screen has repair times to show
    ['electricity','outage','Power outage across three streets.',-17.8390,31.0450,'Robert Mugabe Road','Harare',96,90],
    ['electricity','streetlight','Street light out at the crossing.',-17.8200,31.0600,'Second Street','Harare',150,120],
    ['water','leakage','Leaking pipe by the shops.',-17.8280,31.0410,'Enterprise Road','Harare',72,60],
    ['roads','pothole','Pothole outside the clinic, now patched.',-17.8010,31.0700,'Josiah Tongogara Ave','Harare',200,180],
    ['roads','traffic_light','Traffic light was stuck on red.',-20.1450,28.5800,'Main Street','Bulawayo',48,40],
    ['water','burst_pipe','Burst pipe near the market, now repaired.',-20.1550,28.5900,'8th Avenue','Bulawayo',120,96]
  ];
  for (const [category,type,description,lat,lng,street,city,hReported,hFixed] of sample) {
    if (db.faults.some(f => f.street === street && f.type === type)) continue;
    const resolved = hFixed !== null;
    db.faults.push({ id: crypto.randomUUID(), userId: demo.id, category, type, description, lat, lng, street, city,
                     status: resolved ? 'resolved' : 'open', createdAt: ago(hReported), timeSource: 'seed',
                     resolvedAt: resolved ? ago(hFixed) : null, resolvedBy: resolved ? demo.id : null,
                     confirmations: [] });
  }
  await saveDb(db);
  console.log(`Seeded demo data via ${USE_REDIS ? 'Upstash Redis' : 'the local file'}.`);
  console.log('Login: demo@streetalert.co.zw / demo1234');
})();
