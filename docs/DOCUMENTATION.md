# StreetAlert – Project Documentation

Final Year Project – Software Engineering

---

## 1. Introduction

### 1.1 Problem statement
Faults such as stolen ZESA cables, burst water pipes, large potholes and road accidents are often noticed by residents long before the responsible authority hears about them. There is no single place where citizens can log these faults, see what others have reported, or warn motorists. This causes long repair delays, road accidents and wasted water and electricity.

### 1.2 Aim
To build a web-based system where residents report infrastructure faults and hazards in their city and everyone can view them on a map.

### 1.3 Objectives
1. Let users register and keep a profile containing their details and city.
2. Let users log a fault by choosing from a menu of predefined faults and marking its location.
3. Automatically record the date and time of each report from an online time API.
4. Display all reported faults on a map using a different icon for each type of fault.
5. Run on any device and be installable without an app store.

### 1.4 Scope
Covers electricity (ZESA), water, road and accident reports for 24 Zimbabwean cities and towns. Out of scope for this version: forwarding reports directly to ZESA or councils, photo uploads, push notifications.

---

## 2. Requirements

### 2.1 Functional requirements
| ID | Requirement |
|---|---|
| FR1 | A visitor can register with name, email, optional phone, city and password. |
| FR2 | A user can log in and log out. |
| FR3 | A user can view and edit their profile (name, phone, city, password). |
| FR4 | The home screen offers two choices: report a fault or view faults. |
| FR5 | When reporting, the user chooses a category, then a fault type from a menu. |
| FR6 | The user sets the location by tapping the map, dragging the pin, or using GPS; the street name is suggested automatically. |
| FR7 | The date and time of the report are recorded from a time API, not typed by the user. |
| FR8 | Faults are shown on a map with an icon per fault type and a colour per category. |
| FR9 | Users can filter the map by city and category. |
| FR10 | Tapping a pin shows the details, time reported, reporter and confirmations. |
| FR11 | Logged-in users can confirm a fault reported by someone else. |
| FR12 | Any signed-in user can report that a fault has been repaired, not only the original reporter; the reporter can reopen a fix that turns out to be wrong. |
| FR13 | A user can see a list of their own reports. |
| FR14 | Guests can view the map but must log in to report, confirm or mark a repair. |
| FR15 | A user can view analytics for a chosen city (or all cities) showing, per category: how many faults were reported, how many were fixed, and the average, fastest and slowest time taken to fix them. |

### 2.2 Non-functional requirements
| ID | Requirement | How it is met |
|---|---|---|
| NFR1 Portability | Works on any device with a modern browser | Responsive PWA, no native code |
| NFR2 Installability | Easy to install | Web app manifest and service worker |
| NFR3 Usability | Simple on small screens | Large tap targets, 3-step reporting, bottom navigation |
| NFR4 Security | Protect accounts | scrypt password hashing, signed tokens, input validation, rate limiting, HTML escaping |
| NFR5 Performance | Loads quickly on mobile data | No framework, one small JS file, cached app shell |
| NFR6 Reliability | A time stamp must always exist | Two time providers plus server-clock fallback |
| NFR7 Maintainability | Easy to extend | Fault categories live in one file (`catalog.js`) |

### 2.3 User stories
- As a resident, I want to report a burst pipe so that the council can see it and neighbours know about it.
- As a motorist, I want to see potholes and accidents on a map so that I can avoid them.
- As a resident, I want to confirm a fault I can also see so that authorities know it is serious.
- As a reporter, I want to mark my report as fixed so that the map stays accurate.

---

## 3. System design

### 3.1 Architecture
```
 Phone / PC browser (PWA)                   Server (Node.js + Express)              External services
┌──────────────────────────┐  HTTPS/JSON  ┌───────────────────────────┐        ┌───────────────────────┐
│ HTML + CSS + JavaScript  │ ───────────► │ REST API  /api/*          │ ─────► │ worldtimeapi.org      │
│ Leaflet map              │ ◄─────────── │ Auth (scrypt + tokens)    │        │ timeapi.io (fallback) │
│ Service worker, manifest │              │ Validation, rate limiting │        └───────────────────────┘
│                          │              │ JSON file storage         │
└────────────┬─────────────┘              └───────────────────────────┘        ┌───────────────────────┐
             └────────────── map tiles and street names ─────────────────────► │ OpenStreetMap,        │
                                                                                │ Nominatim             │
                                                                                └───────────────────────┘
```
A three-tier client–server design: presentation (PWA), application logic (Express API) and data (JSON file). Storage is confined to two small functions (`loadDb`, `saveDb`), so it can be replaced with PostgreSQL or MongoDB later.

### 3.2 Technology choices
| Choice | Reason |
|---|---|
| Node.js + Express | One language for client and server; quick to build in two weeks |
| Vanilla JS PWA | Runs everywhere, no build step, installable |
| Leaflet + OpenStreetMap | Free map with no API key or billing |
| JSON storage (local file, or Upstash Redis on serverless hosts) | No database to install for local use; automatically switches to a hosted key-value store when deployed to a serverless platform such as Vercel, where the filesystem is not persistent |
| Built-in `crypto` | scrypt hashing and HMAC tokens without extra dependencies |

### 3.3 Data model
**User:** `id, name, email (unique), phone, city, password (salt:scrypt hash), createdAt`

**Fault:** `id, userId, category, type, description, lat, lng, street, city, status (open | resolved), createdAt (from time API), timeSource, resolvedAt (from time API), resolvedBy (id of whoever reported the repair, may differ from userId), confirmations[userIds]`

Time to fix is not stored directly — it is calculated on every read as `resolvedAt − createdAt`, so it is always consistent with the two timestamps.

One user has many faults; a fault has many confirmations (users).

### 3.4 Fault catalogue
| Category | Fault types |
|---|---|
| Electricity (ZESA) | Cables stolen, pole or line down, transformer faulty, exposed live wires, power outage, street light not working |
| Water | Burst pipe, water leakage, no water supply, sewer overflow, open or missing manhole |
| Roads | Large pothole, damaged or washed-out road, traffic light not working, flooded road, fallen tree or debris |
| Accidents | Road accident, broken-down vehicle blocking road, pedestrian involved, road blocked |
| Other | Other hazard |

### 3.5 Screens
Home menu · Map (filters, legend, pins) · Report (category, fault, location and details, confirmation) · My reports · Profile / Log in / Register · Fault details sheet.

### 3.6 Time API flow
1. A user submits a report.
2. The server asks `worldtimeapi.org/api/timezone/Africa/Harare` for the time (cached for 5 minutes as an offset).
3. If that fails it tries `timeapi.io`; if that fails it uses the server clock.
4. The timestamp and its source are stored with the fault.

---

## 4. API reference

Base path `/api`. Protected routes need `Authorization: Bearer <token>`.

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | /catalog | – | Categories, fault types, cities |
| GET | /time | – | Current Zimbabwe time from the time API |
| POST | /register | – | Create account, returns token |
| POST | /login | – | Log in, returns token |
| GET | /me | yes | Current user |
| PUT | /me | yes | Update name, phone, city, password |
| GET | /faults?city=&category=&status=&mine=1 | optional | List faults |
| GET | /faults/:id | optional | One fault |
| POST | /faults | yes | Report a fault |
| POST | /faults/:id/confirm | yes | Toggle "I can see this too" |
| POST | /faults/:id/resolve | yes | Mark repaired (any signed-in user) or reopen (owner only) |
| GET | /stats | – | Counts for the home screen |
| GET | /analytics?city= | – | Per-category reported/fixed/open counts and average, fastest, slowest repair time, optionally scoped to one city |

Example – report a fault:
```json
POST /api/faults
{ "category": "water", "type": "burst_pipe", "lat": -17.8319, "lng": 31.0497,
  "street": "Julius Nyerere Way", "city": "Harare", "description": "Water across the road" }
```

---

## 5. Security
- Passwords are hashed with scrypt and a per-user salt; never stored in plain text.
- Login tokens are HMAC-SHA256 signed and expire after 30 days.
- All input is validated on the server (the type must belong to its category, coordinates must be inside Zimbabwe, lengths are limited).
- All user text is HTML-escaped before display (prevents XSS).
- Login, registration and report creation are rate limited per IP.
- Only the reporter can mark a fault fixed. Reporter names show first name only.
- Use HTTPS in production (automatic on Render and Railway).

---

## 6. Testing

### 6.1 Automated API tests (`npm test`)
Covers registration, duplicate email, invalid input, wrong password, login, login required to report, location outside Zimbabwe, type/category mismatch, fault creation with timestamp, listing, the reporter marking a fault fixed and reopening it, a different signed-in user reporting the same fault as repaired, confirming that only the original reporter can reopen someone else's fix, and the analytics endpoint returning correct per-category counts and average repair time. All 15 checks pass.

### 6.2 Manual test plan
| # | Test | Steps | Expected result |
|---|---|---|---|
| 1 | Register | Profile > Create account, fill the form | Account created, welcome message, home screen |
| 2 | Register with used email | Repeat with the same email | Error: account already exists |
| 3 | Login with wrong password | Enter a wrong password | "Email or password is incorrect." |
| 4 | Report as guest | Tap Report while logged out | Sent to log in, with a message |
| 5 | Report a fault | Report > Water > Burst pipe > tap map > Submit | Confirmation showing date and time |
| 6 | Icon on map | Map > select the city | Pin with the water icon at the location |
| 7 | Filter | Tap the Roads chip | Only road faults shown |
| 8 | Time from API | Compare header clock and fault time | Matches Zimbabwe time |
| 9 | Confirm | Log in as another user, open a fault, tap "I can see this too" | Count increases by 1 |
| 10 | Mark fixed | Reporter opens the fault and taps Mark as fixed | Fault leaves the map, shows Fixed in My reports, repair time recorded |
| 10b | Community repair | A different logged-in user opens someone else's fault and taps Report this as repaired | Fault is marked fixed; only the original reporter can reopen it |
| 10c | Analytics | Home > See analytics for your area, choose a city | Per-category reported/fixed counts and average time to fix are shown |
| 11 | GPS | Tap Use my current location | Pin moves to the device position |
| 12 | Install | Chrome on Android | Install app button works, app opens full screen |
| 13 | Offline | Turn off data, reopen the installed app | App shell opens; message if the server is unreachable |
| 14 | Small screen | 360 px wide phone | No sideways scrolling, buttons usable |

---

## 7. User guide
1. **Create an account.** Open the app, tap *Profile* > *Create account*. Enter your details and choose your city.
2. **Report a fault.** Tap *Report a fault*. Choose the category, then the exact fault. Tap the map where the fault is (or press *Use my current location*), check the street name, add details if you like, and tap *Submit report*.
3. **View faults.** Tap *View reported faults*. Choose your city and category. Tap any pin to see details and directions.
4. **Confirm or close.** Tap *I can see this too* on someone else's report. If it has actually been repaired, tap *Mark as fixed* (on your own report) or *Report this as repaired* (on someone else's) — anyone can flag a repair, but only the original reporter can reopen it if that turns out to be wrong.
5. **Check analytics.** From the home screen, tap *See analytics for your area* to see, per fault category, how many were reported, how many were fixed, and how long repairs took on average. Switch the city dropdown to check other areas.
6. **Install.** Tap *Install app* (Android or computer) or Share > Add to Home Screen (iPhone).

---

## 8. Two-week project plan
| Days | Work | Output |
|---|---|---|
| 1–2 | Requirements, research, fault catalogue, wireframes | Sections 1–3 of this document |
| 3–4 | Backend: accounts, storage, fault API, time API | Working API and tests |
| 5–7 | Front-end: design system, menu, register/login, map | Navigable app |
| 8–9 | Report flow, location picker, filters, details sheet | Core features complete |
| 10 | PWA: manifest, service worker, icons, install prompt | Installable app |
| 11–12 | Testing, bug fixing, security review, deployment | Live URL |
| 13–14 | Documentation, demo data, presentation | Final submission |

---

## 9. Limitations and future work
- JSON file storage suits a prototype; move to PostgreSQL or MongoDB for many users.
- Reports are not yet forwarded to ZESA, ZINWA or councils; an email/WhatsApp integration or an authority dashboard is the next step.
- Add photo upload, push notifications for faults near you, an admin/moderation role, duplicate-report detection and Shona/Ndebele language options.
- Map tiles need internet; the app shell opens offline, but reports need a connection.

## 10. References
Leaflet (leafletjs.com) · OpenStreetMap and Nominatim (openstreetmap.org) · World Time API (worldtimeapi.org) · Time API (timeapi.io) · Express (expressjs.com) · MDN Web Docs: Progressive Web Apps.
