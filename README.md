# StreetAlert

A community web app where people report and view faults in their city: **ZESA electrical faults** (stolen cables, faulty transformers, fallen poles), **water problems** (burst pipes, leaks, sewer overflows), **large potholes and road damage**, and **road accidents**. Reports appear as category-coloured icons on a live street map.

It is a **Progressive Web App (PWA)**: it runs in any modern browser on Android, iPhone, Windows, Mac or Linux, and can be installed to the home screen in one tap, with no app store.

## Features

| Requirement | How it is met |
|---|---|
| Users create a profile with their details and city | Register form: name, email, phone (optional), city (24 Zimbabwean cities), password. The profile can be edited later. |
| Menu: log a fault or view faults | The home screen has two large buttons: **Report a fault** and **View reported faults**. A bottom tab bar is always available. |
| Menu of faults when logging | 3-step flow: choose a category, choose the exact fault from a list (e.g. *Cables stolen*, *Burst pipe*, *Large pothole*, *Road accident*), then place the pin. |
| Map with different icons per fault | Leaflet + OpenStreetMap. Each fault type has its own picture on a round map pin ringed in its category colour. Add real photos in `public/img/` (see `public/img/README.txt`); illustrated pictures are used until you do. Filter by city and category. |
| Date and time from an API | The server fetches Zimbabwe time from **worldtimeapi.org** (fallback **timeapi.io**, then the server clock) and stamps every report with it. The app header shows the same time. |
| Runs on any device, easy to install | Responsive PWA with manifest, icons and service worker. Android/Chrome shows an *Install app* button; iPhone uses Share > Add to Home Screen. |
| Responsive layout | Three tiers: phone (bottom tab bar, single column), tablet (two-column lists and grids), and laptop/desktop (bottom bar becomes a left sidebar, content centres with comfortable margins instead of stretching edge to edge, forms cap at a readable width). The map resizes correctly if the browser window itself is resized, not just on first load. |
| Aesthetic | Bold dark theme: near-black surfaces, violet brand accent, vivid category colours (amber electricity, cyan water, orange roads, pink-red accidents) and a dark map. |

Extras: confirm a fault ("I can see this too"), **any signed-in user can report a fault as repaired** (not just the original reporter — the reporter can still reopen it if the fix turns out to be wrong), an **Analytics** screen showing, per city and per category, how many faults were reported, how many were fixed, and how long repairs took on average (fastest/slowest too), "My reports" list, GPS location button, automatic street name lookup, directions link, secure password hashing.

## Quick start

Requires **Node.js 18 or newer** (https://nodejs.org).

```bash
npm install
npm run seed      # optional: demo data + demo login (demo@streetalert.co.zw / demo1234)
npm start         # http://localhost:3000
npm test          # automated API tests
```

To try it on a phone on the same Wi-Fi, open `http://<your-computer-IP>:3000`. Installing as an app and GPS need HTTPS, so use a deployed link for those.

## Deploying online (free options)

The app is one Node.js service, so it deploys to Render, Railway, Fly.io, Vercel or any VPS.

### Render (simplest — no extra setup)
Push this folder to GitHub, create a *Web Service* from the repo, build command `npm install`, start command `npm start`. HTTPS is automatic, which enables installation and GPS. Add a *persistent disk* mounted at `/var/data` and set `DATA_DIR=/var/data`, otherwise data resets on every deploy (Render wipes non-disk storage on redeploy, not on every request, so this only matters if you care about keeping data across deploys).

### Vercel (needs one extra free service for storage)
Vercel runs Node apps as **serverless functions** — the filesystem is not shared or kept between requests, so the local-file storage above does not work there. The app automatically switches to **Upstash Redis** (a free hosted key-value store reachable over HTTPS) whenever its two environment variables are set, with no code changes needed:

1. Create a free account at [upstash.com](https://upstash.com) → **Create Database** (Redis, any region).
2. Copy the **REST URL** and **REST TOKEN** shown on the database page.
3. Push this folder to GitHub, then on [vercel.com](https://vercel.com) → **Add New → Project** → import the repo → **Deploy** (Vercel auto-detects the Express app and serves the `public/` folder — no build settings needed).
4. In the Vercel project → **Settings → Environment Variables**, add:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
5. Redeploy (Settings → Deployments → ⋯ → Redeploy) so the new variables take effect.
6. Run `npm run seed` once **locally** with the same two variables set (e.g. `UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... npm run seed`) if you want the demo account and sample faults on the live site too.

Every feature (accounts, reporting, confirmations, marking fixed) works exactly the same either way — only where the data lives changes.

Environment variables: `PORT` (default 3000), `DATA_DIR` (local-file storage location), `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (switches to Redis storage, required on Vercel).

## Installing on a device

- **Android (Chrome/Edge):** open the site, tap **Install app** in the top bar (or menu > Install app).
- **iPhone/iPad (Safari):** tap Share > **Add to Home Screen**.
- **Windows/Mac/Linux (Chrome/Edge):** click the install icon in the address bar.

## Project structure

```
streetalert/
├── server.js              Express API, auth, time API, static hosting
├── catalog.js             Fault categories/types and city coordinates (shared)
├── seed.js                Demo data
├── test.js                Automated API tests
├── package.json
├── data/db.json           Created on first run (users and faults)
├── public/
│   ├── index.html         App shell (all screens)
│   ├── css/style.css      Design system and layout
│   ├── js/app.js          App logic (navigation, map, report flow, auth)
│   ├── sw.js              Service worker (offline shell, installability)
│   ├── manifest.webmanifest
│   ├── img/               Fault pictures (.svg fallbacks + your .jpg photos)
│   └── icons/             App icons
└── docs/DOCUMENTATION.md  Full project documentation
```

See `docs/DOCUMENTATION.md` for requirements, design, API reference, test plan and user guide.
