/**
 * StreetAlert - backend
 * Node.js + Express. Passwords are hashed with scrypt (built into Node) and
 * sessions use HMAC-signed tokens, so the only npm dependency is Express.
 *
 * Storage has two modes, chosen automatically:
 *  - Local file (data/db.json) - used when running on your own computer or on a
 *    host with a persistent disk (e.g. Render). Simple, no setup required.
 *  - Upstash Redis (REST API) - used automatically when UPSTASH_REDIS_REST_URL
 *    and UPSTASH_REDIS_REST_TOKEN are set. Vercel's filesystem is wiped between
 *    requests, so this is what keeps accounts and faults saved when deployed there.
 *    Everything is stored as one JSON document under the key below.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CATEGORIES, CITIES } = require('./catalog');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const TIMEZONE = 'Africa/Harare';
const REDIS_KEY = 'streetalert:db';

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const USE_REDIS = !!(REDIS_URL && REDIS_TOKEN);

/* ------------------------------------------------------------------ storage */
const emptyDb = () => ({ secret: crypto.randomBytes(32).toString('hex'), users: [], faults: [] });

async function redisCall(...cmd) {
  // Sent as a POST with the command in the body (Upstash's "pipeline" style), not as a GET
  // with the command embedded in the URL path. The value we store is the whole database as
  // JSON and grows every time someone registers or reports a fault, so putting it in the URL
  // eventually exceeds URL length limits and the request hangs/fails with no useful error.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000); // fail fast instead of hanging forever
  const label = cmd[0] + ' ' + (cmd[1] || '');
  try {
    const r = await fetch(REDIS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
      signal: ctrl.signal
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      console.error('[redis]', label, 'HTTP', r.status, text.slice(0, 300));
      throw new Error('Storage service error (HTTP ' + r.status + ')');
    }
    const data = await r.json();
    if (data.error) {
      console.error('[redis]', label, 'error:', data.error);
      throw new Error('Storage service error: ' + data.error);
    }
    return data.result;
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('[redis]', label, 'timed out after 8s — check UPSTASH_REDIS_REST_URL/TOKEN are correct and the database is active');
      throw new Error('Storage service timed out. Please try again.');
    }
    console.error('[redis]', label, 'failed:', err.message);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

if (!USE_REDIS) fs.mkdirSync(DATA_DIR, { recursive: true });

/** Loads the whole database. Call this at the start of every request handler. */
async function loadDb() {
  if (USE_REDIS) {
    try {
      const raw = await redisCall('GET', REDIS_KEY);
      return raw ? JSON.parse(raw) : emptyDb();
    } catch (err) {
      console.error('[loadDb] falling back to an empty database because Redis failed:', err.message);
      return emptyDb(); // storage unreachable: fail soft rather than crash the request
    }
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return emptyDb();
  }
}

/** Saves the whole database. Call this after any change. */
async function saveDb(db) {
  if (USE_REDIS) {
    await redisCall('SET', REDIS_KEY, JSON.stringify(db));
    return;
  }
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE); // atomic replace so the file is never half-written
}

// Make sure a database (with its signing secret) exists before the app starts taking requests.
async function ensureDb() {
  const db = await loadDb();
  if (!db.secret) db.secret = crypto.randomBytes(32).toString('hex');
  await saveDb(db);
}

/* ----------------------------------------------------------------- security */
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return check.length === expected.length && crypto.timingSafeEqual(check, expected);
}
function makeToken(userId, secret) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function readToken(token, secret) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}
function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, phone: u.phone || '', city: u.city, createdAt: u.createdAt };
}

// Very small in-memory rate limiter (per IP) for login/register
const attempts = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip + req.path;
    const now = Date.now();
    const entry = (attempts.get(key) || []).filter(t => now - t < windowMs);
    if (entry.length >= max) return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    entry.push(now);
    attempts.set(key, entry);
    next();
  };
}

function auth(required = true) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const data = readToken(header.startsWith('Bearer ') ? header.slice(7) : '', req.db.secret);
    const user = data && req.db.users.find(u => u.id === data.uid);
    if (!user && required) return res.status(401).json({ error: 'Please log in to continue.' });
    req.user = user || null;
    next();
  };
}

/* --------------------------------------------------------------- time (API) */
let timeCache = { offset: 0, source: 'server-clock', fetchedAt: 0 };

async function fetchJson(url, ms = 3500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns the current date/time for Zimbabwe from an external time API.
 * 1st choice: worldtimeapi.org, 2nd choice: timeapi.io, last resort: server clock.
 * The API result is cached for 5 minutes as an offset from the local clock.
 */
async function getTime() {
  const now = Date.now();
  if (now - timeCache.fetchedAt > 5 * 60 * 1000) {
    try {
      const d = await fetchJson(`https://worldtimeapi.org/api/timezone/${TIMEZONE}`);
      timeCache = { offset: new Date(d.datetime).getTime() - Date.now(), source: 'worldtimeapi.org', fetchedAt: Date.now() };
    } catch {
      try {
        const d = await fetchJson(`https://timeapi.io/api/Time/current/zone?timeZone=${TIMEZONE}`);
        // timeapi.io returns local wall-clock time; Zimbabwe is UTC+2 all year (no DST)
        const utc = new Date(d.dateTime.split('.')[0] + '+02:00').getTime();
        timeCache = { offset: utc - Date.now(), source: 'timeapi.io', fetchedAt: Date.now() };
      } catch {
        timeCache = { offset: 0, source: 'server-clock', fetchedAt: Date.now() };
      }
    }
  }
  return { iso: new Date(Date.now() + timeCache.offset).toISOString(), timezone: TIMEZONE, source: timeCache.source };
}

/* ---------------------------------------------------------------------- app */
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '50kb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Express 4 does not catch a rejected promise thrown inside an async route handler — without
// this, an error (such as Upstash rejecting bad credentials) leaves the request hanging forever
// with no response sent, until the hosting platform's own timeout kills it. Wrapping every async
// handler in this forwards the error to the app.use((err, req, res, next) => ...) handler below.
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

// Loads the database fresh for every /api request (required for serverless hosts like
// Vercel, where different requests can land on different instances with no shared memory).
app.use('/api', async (req, res, next) => {
  try { req.db = await loadDb(); next(); }
  catch { res.status(503).json({ error: 'Storage is temporarily unavailable. Try again shortly.' }); }
});

app.get('/api/catalog', (req, res) => res.json({ categories: CATEGORIES, cities: CITIES }));

app.get('/api/time', ah(async (req, res) => res.json(await getTime())));

/* ---- accounts */
app.post('/api/register', rateLimit(10, 10 * 60 * 1000), ah(async (req, res) => {
  const db = req.db;
  const name = clean(req.body.name, 60);
  const email = clean(req.body.email, 100).toLowerCase();
  const phone = clean(req.body.phone, 20);
  const city = clean(req.body.city, 40);
  const password = String(req.body.password || '');

  if (name.length < 2) return res.status(400).json({ error: 'Enter your full name.' });
  if (!isEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (phone && !/^[+\d][\d\s-]{6,18}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid phone number.' });
  if (!CITIES[city]) return res.status(400).json({ error: 'Choose the city you live in.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (db.users.some(u => u.email === email)) return res.status(409).json({ error: 'An account with this email already exists. Try logging in.' });

  const user = { id: crypto.randomUUID(), name, email, phone, city, password: hashPassword(password), createdAt: new Date().toISOString() };
  db.users.push(user);
  await saveDb(db);
  res.status(201).json({ token: makeToken(user.id, db.secret), user: publicUser(user) });
}));

app.post('/api/login', rateLimit(20, 10 * 60 * 1000), (req, res) => {
  const db = req.db;
  const email = clean(req.body.email, 100).toLowerCase();
  const user = db.users.find(u => u.email === email);
  if (!user || !verifyPassword(String(req.body.password || ''), user.password)) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  res.json({ token: makeToken(user.id, db.secret), user: publicUser(user) });
});

app.get('/api/me', auth(), (req, res) => res.json({ user: publicUser(req.user) }));

app.put('/api/me', auth(), ah(async (req, res) => {
  const name = clean(req.body.name, 60);
  const phone = clean(req.body.phone, 20);
  const city = clean(req.body.city, 40);
  if (name.length < 2) return res.status(400).json({ error: 'Enter your full name.' });
  if (phone && !/^[+\d][\d\s-]{6,18}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid phone number.' });
  if (!CITIES[city]) return res.status(400).json({ error: 'Choose the city you live in.' });
  Object.assign(req.user, { name, phone, city });
  if (req.body.newPassword) {
    if (!verifyPassword(String(req.body.currentPassword || ''), req.user.password)) return res.status(400).json({ error: 'Current password is incorrect.' });
    if (String(req.body.newPassword).length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    req.user.password = hashPassword(String(req.body.newPassword));
  }
  await saveDb(req.db);
  res.json({ user: publicUser(req.user) });
}));

/* ---- faults */
function viewFault(db, f, viewer) {
  const reporter = db.users.find(u => u.id === f.userId);
  const resolver = f.resolvedBy ? db.users.find(u => u.id === f.resolvedBy) : null;
  const hoursToFix = f.resolvedAt ? (new Date(f.resolvedAt) - new Date(f.createdAt)) / 36e5 : null;
  return {
    id: f.id, category: f.category, type: f.type, description: f.description,
    lat: f.lat, lng: f.lng, street: f.street, city: f.city,
    status: f.status, createdAt: f.createdAt, timeSource: f.timeSource, resolvedAt: f.resolvedAt || null,
    hoursToFix: hoursToFix !== null ? +hoursToFix.toFixed(1) : null,
    reporter: reporter ? reporter.name.split(' ')[0] : 'Community member',
    resolvedByName: resolver ? resolver.name.split(' ')[0] : null,
    resolvedByMe: !!viewer && !!f.resolvedBy && f.resolvedBy === viewer.id,
    confirmations: f.confirmations.length,
    confirmedByMe: !!viewer && f.confirmations.includes(viewer.id),
    mine: !!viewer && f.userId === viewer.id
  };
}

app.get('/api/faults', auth(false), (req, res) => {
  const db = req.db;
  const { city, category, status, mine } = req.query;
  let list = db.faults;
  if (city && city !== 'all') list = list.filter(f => f.city === city);
  if (category && category !== 'all') list = list.filter(f => f.category === category);
  if (status && status !== 'all') list = list.filter(f => f.status === status);
  if (mine === '1') list = req.user ? list.filter(f => f.userId === req.user.id) : [];
  list = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 500);
  res.json({ faults: list.map(f => viewFault(db, f, req.user)) });
});

app.get('/api/faults/:id', auth(false), (req, res) => {
  const f = req.db.faults.find(x => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'Fault not found.' });
  res.json({ fault: viewFault(req.db, f, req.user) });
});

app.post('/api/faults', auth(), rateLimit(30, 60 * 60 * 1000), ah(async (req, res) => {
  const db = req.db;
  const { category, type } = req.body;
  const lat = Number(req.body.lat), lng = Number(req.body.lng);
  const cat = CATEGORIES[category];
  if (!cat || !cat.types[type]) return res.status(400).json({ error: 'Choose a fault type.' });
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -23 || lat > -15 || lng < 25 || lng > 34) {
    return res.status(400).json({ error: 'Pick a location inside Zimbabwe on the map.' });
  }
  const city = CITIES[req.body.city] ? req.body.city : req.user.city;
  const description = clean(req.body.description, 400);
  const t = await getTime(); // date and time come from the time API

  const fault = {
    id: crypto.randomUUID(), userId: req.user.id, category, type, description,
    lat: +lat.toFixed(6), lng: +lng.toFixed(6),
    street: clean(req.body.street, 120), city,
    status: 'open', createdAt: t.iso, timeSource: t.source, resolvedAt: null, resolvedBy: null, confirmations: []
  };
  db.faults.push(fault);
  await saveDb(db);
  res.status(201).json({ fault: viewFault(db, fault, req.user) });
}));

app.post('/api/faults/:id/confirm', auth(), ah(async (req, res) => {
  const db = req.db;
  const f = db.faults.find(x => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'Fault not found.' });
  if (f.userId === req.user.id) return res.status(400).json({ error: 'You reported this fault, so it is already counted.' });
  const i = f.confirmations.indexOf(req.user.id);
  if (i === -1) f.confirmations.push(req.user.id); else f.confirmations.splice(i, 1); // toggle
  await saveDb(db);
  res.json({ fault: viewFault(db, f, req.user) });
}));

// Any signed-in resident can report that a fault has been repaired - not just the original
// reporter - since the person who notices a fix is often not the person who logged it.
// Only the original reporter can reopen a fix that turns out to be wrong (a dispute), so
// the record cannot be flipped back and forth by anyone passing by.
app.post('/api/faults/:id/resolve', auth(), ah(async (req, res) => {
  const db = req.db;
  const f = db.faults.find(x => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'Fault not found.' });

  if (f.status === 'open') {
    const t = await getTime();
    f.status = 'resolved';
    f.resolvedAt = t.iso;
    f.resolvedBy = req.user.id;
  } else {
    if (f.userId !== req.user.id) return res.status(403).json({ error: 'Only the person who reported this fault can reopen it.' });
    f.status = 'open';
    f.resolvedAt = null;
    f.resolvedBy = null;
  }
  await saveDb(db);
  res.json({ fault: viewFault(db, f, req.user) });
}));

app.get('/api/stats', (req, res) => {
  const db = req.db;
  const open = db.faults.filter(f => f.status === 'open');
  const byCategory = {};
  for (const f of open) byCategory[f.category] = (byCategory[f.category] || 0) + 1;
  res.json({ open: open.length, resolved: db.faults.length - open.length, users: db.users.length, byCategory });
});

/**
 * Analytics: for each fault category, how many were reported, how many were fixed,
 * and how long the fixed ones took (from the time-API timestamp on report to the
 * time-API timestamp on repair). Optionally scoped to one city.
 */
app.get('/api/analytics', (req, res) => {
  const db = req.db;
  const city = req.query.city && req.query.city !== 'all' ? req.query.city : null;
  const list = city ? db.faults.filter(f => f.city === city) : db.faults;

  const summarise = faults => {
    const fixed = faults.filter(f => f.status === 'resolved' && f.resolvedAt);
    const hours = fixed.map(f => (new Date(f.resolvedAt) - new Date(f.createdAt)) / 36e5);
    const avg = hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : null;
    return {
      reported: faults.length,
      fixed: fixed.length,
      open: faults.length - fixed.length,
      avgHoursToFix: avg !== null ? +avg.toFixed(1) : null,
      fastestHoursToFix: hours.length ? +Math.min(...hours).toFixed(1) : null,
      slowestHoursToFix: hours.length ? +Math.max(...hours).toFixed(1) : null
    };
  };

  const categories = {};
  for (const key of Object.keys(CATEGORIES)) categories[key] = summarise(list.filter(f => f.category === key));

  res.json({ city: city || 'all', totals: summarise(list), categories });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

/* ------------------------------------------------------------ static front-end */
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, file) {
    if (file.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
  }
}));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => {
  console.error(err);
  const message = err.status === 400 ? 'Invalid request.'
    : String(err.message || '').startsWith('Storage service') ? err.message
    : 'Something went wrong on the server.';
  res.status(err.status || 500).json({ error: message });
});

if (require.main === module) {
  ensureDb().then(() => {
    app.listen(PORT, () => console.log(
      `StreetAlert running on http://localhost:${PORT} (storage: ${USE_REDIS ? 'Upstash Redis' : 'local file'})`
    ));
  });
}
// Vercel's Node builder requires the module's default export to be the request-handling
// function itself (the Express app), not an object wrapping it — so export `app` directly,
// and attach the storage helpers to it as properties for seed.js and test.js to use.
module.exports = app;
module.exports.ensureDb = ensureDb;
module.exports.loadDb = loadDb;
module.exports.saveDb = saveDb;
module.exports.USE_REDIS = USE_REDIS;
