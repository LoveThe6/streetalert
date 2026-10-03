/* StreetAlert – front-end (vanilla JavaScript, Leaflet for maps) */
(() => {
  'use strict';

  /* ------------------------------------------------------------ helpers */
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fa = (icon, size) => `<i class="fa-solid fa-${icon}" aria-hidden="true"${size ? ` style="font-size:${size}px"` : ''}></i>`;
  const TZ = 'Africa/Harare';

  const state = {
    token: localStorage.getItem('sa_token') || '',
    user: null,
    catalog: null,
    timeOffset: 0,          // difference between the time API and the phone clock
    timeSource: 'device',
    faults: [],
    filterCategory: 'all',
    filterCity: 'Harare',
    view: 'home',
    afterLogin: null,
    report: { category: null, type: null, lat: null, lng: null, streetDirty: false }
  };

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch('/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }
    if (res.status === 401 && state.token && path !== '/login') { setSession('', null); }
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Check your connection and try again.');
    return data;
  }

  let toastTimer;
  function toast(msg, isError = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = 'toast'), 3200);
  }

  const now = () => new Date(Date.now() + state.timeOffset);
  const fmtDateTime = iso => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }).format(new Date(iso));
  function ago(iso) {
    const s = Math.max(0, (now() - new Date(iso)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return Math.floor(s / 86400) + ' d ago';
  }
  const cat = f => state.catalog.categories[f.category];
  // Picture for a fault type or category. A real photo (e.g. /img/faults/pothole.jpg) is painted on top;
  // if that file does not exist the illustrated /img/faults/pothole.svg underneath shows instead.
  const IMG = (key, kind = 'faults') => `background-image:url(/img/${kind}/${key}.jpg),url(/img/${kind}/${key}.svg)`;
  const typ = f => cat(f).types[f.type] || { label: 'Fault', icon: 'triangle-exclamation' };

  /* --------------------------------------------------------------- time API */
  async function syncTime() {
    try {
      const t = await api('/time');
      state.timeOffset = new Date(t.iso).getTime() - Date.now();
      state.timeSource = t.source;
    } catch { /* keep device clock */ }
    tickClock();
  }
  function tickClock() {
    const d = now();
    $('#clockTime').textContent = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }).format(d);
    $('#clockDate').textContent = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ }).format(d);
  }

  /* ------------------------------------------------------------- navigation */
  const mapState = { map: null, layer: null, me: null };
  const pickState = { map: null, marker: null, geoTimer: null };

  function show(view) {
    state.view = view;
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.go === view));
    window.scrollTo(0, 0);
    if (view === 'home') renderHome();
    if (view === 'map') openMap();
    if (view === 'report') startReport();
    if (view === 'mine') renderMine();
    if (view === 'profile') renderProfile();
    if (view === 'analytics') renderAnalytics();
  }
  document.addEventListener('click', e => {
    const go = e.target.closest('[data-go]');
    if (go) show(go.dataset.go);
  });

  /* ------------------------------------------------------------------- home */
  async function renderHome() {
    const first = state.user ? state.user.name.split(' ')[0] : '';
    $('#homeGreeting').textContent = first ? `Hello ${first}, what would you like to do?` : 'What would you like to do?';
    $('#homeSub').textContent = state.user ? `Faults reported in ${state.user.city} and elsewhere appear on the map.` : 'Help your neighbours and motorists avoid trouble on the road.';
    try {
      const [{ faults }, stats] = await Promise.all([api('/faults?status=open'), api('/stats')]);
      state.faults = faults;
      $('#stats').innerHTML = `
        <div class="stat"><b>${stats.open}</b><span>Open faults</span></div>
        <div class="stat"><b>${stats.resolved}</b><span>Fixed</span></div>
        <div class="stat"><b>${stats.users}</b><span>Members</span></div>`;
      renderFaultList($('#latestList'), faults.slice(0, 5), 'No faults reported yet. Be the first to report one.');
    } catch (err) {
      $('#latestList').innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  }

  function renderFaultList(el, faults, emptyText, emptyAction = true) {
    if (!faults.length) {
      el.innerHTML = `<div class="empty">${esc(emptyText)}${emptyAction ? '<br><button class="btn btn-primary" data-go="report">Report a fault</button>' : ''}</div>`;
      return;
    }
    el.innerHTML = faults.map(f => `
      <button class="fault-item" data-id="${esc(f.id)}" style="--c:${cat(f).color}">
        <span class="ic pic" style="${IMG(f.type)}" role="img" aria-label="${esc(typ(f).label)}"></span>
        <span class="tx"><b>${esc(typ(f).label)}</b><small>${esc(f.street || f.city)} · ${esc(f.city)} · ${ago(f.createdAt)}</small></span>
        <span class="badge ${f.status}">${f.status === 'open' ? 'Open' : 'Fixed'}</span>
      </button>`).join('');
    $$('.fault-item', el).forEach(b => b.addEventListener('click', () => openSheet(faults.find(f => f.id === b.dataset.id))));
  }

  /* -------------------------------------------------------------------- map */
  function pinIcon(f) {
    return L.divIcon({
      className: 'pin-wrap',
      html: `<div class="pin ${f.status}" style="--c:${cat(f).color}"><span class="disc" style="${IMG(f.type)}"></span></div>`,
      iconSize: [46, 56], iconAnchor: [23, 56]
    });
  }

  function buildFilters() {
    const cities = Object.keys(state.catalog.cities);
    $('#filterCity').innerHTML = '<option value="all">All cities</option>' + cities.map(c => `<option>${esc(c)}</option>`).join('');
    $('#filterCity').value = state.filterCity;
    const chips = [['all', '', 'All']].concat(Object.entries(state.catalog.categories).map(([k, c]) => [k, IMG(k, 'cats'), c.label.replace(' (ZESA)', '')]));
    $('#filterChips').innerHTML = chips.map(([k, img, l]) => `<button class="chip" data-cat="${k}" aria-pressed="${k === state.filterCategory}">${img ? `<span class="pic chip-pic" style="${img}"></span>` : fa('layer-group')} ${esc(l)}</button>`).join('');
    $$('#filterChips .chip').forEach(b => b.addEventListener('click', () => {
      state.filterCategory = b.dataset.cat;
      $$('#filterChips .chip').forEach(x => x.setAttribute('aria-pressed', x === b));
      drawMarkers();
    }));
    $('#filterCity').addEventListener('change', e => { state.filterCity = e.target.value; loadMap(true); });
    $('#legend').innerHTML = Object.entries(state.catalog.categories).map(([k, c]) => `<span><i class="dot" style="--c:${c.color}"></i>${esc(c.label)}</span>`).join('');
  }

  function openMap() {
    if (!mapState.map) {
      mapState.map = L.map('map', { zoomControl: false }).setView(cityCenter(state.filterCity), 13);
      L.control.zoom({ position: 'bottomleft' }).addTo(mapState.map);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(mapState.map);
      mapState.layer = L.layerGroup().addTo(mapState.map);
    }
    setTimeout(() => mapState.map.invalidateSize(), 50);
    loadMap(true);
  }
  const cityCenter = c => state.catalog.cities[c] || [-19.0, 29.8];

  // Leaflet sizes its canvas to its container once, on creation. If the browser window is then
  // resized (e.g. a laptop window dragged wider, or rotating a tablet) the map doesn't redraw by
  // itself and tiles end up cut off or grey, so nudge both maps whenever the window size changes.
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (mapState.map) mapState.map.invalidateSize();
      if (pickState.map) pickState.map.invalidateSize();
    }, 150);
  });

  async function loadMap(recentre = false) {
    if (recentre) {
      if (state.filterCity === 'all') mapState.map.setView([-19.0, 29.8], 6);
      else mapState.map.setView(cityCenter(state.filterCity), 13);
    }
    try {
      const { faults } = await api(`/faults?status=open&city=${encodeURIComponent(state.filterCity)}`);
      state.faults = faults;
      drawMarkers();
    } catch (err) { toast(err.message, true); }
  }

  function drawMarkers() {
    mapState.layer.clearLayers();
    const list = state.faults.filter(f => state.filterCategory === 'all' || f.category === state.filterCategory);
    list.forEach(f => L.marker([f.lat, f.lng], { icon: pinIcon(f), title: typ(f).label }).addTo(mapState.layer).on('click', () => openSheet(f)));
    $('#mapCount').textContent = list.length === 1 ? '1 fault' : `${list.length} faults`;
  }

  $('#locateBtn').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Location is not available on this device.', true);
    navigator.geolocation.getCurrentPosition(p => {
      const ll = [p.coords.latitude, p.coords.longitude];
      if (mapState.me) mapState.me.remove();
      mapState.me = L.marker(ll, { icon: L.divIcon({ className: 'pin-wrap', html: '<div class="me-dot"></div>', iconSize: [16, 16] }) }).addTo(mapState.map);
      mapState.map.setView(ll, 16);
    }, () => toast('Allow location access to see where you are.', true), { enableHighAccuracy: true, timeout: 10000 });
  });

  /* ------------------------------------------------------------- report flow */
  function setStep(step) {
    ['category', 'type', 'details', 'done'].forEach(s => $('#step' + s[0].toUpperCase() + s.slice(1)).hidden = s !== step);
    const idx = ['category', 'type', 'details', 'done'].indexOf(step);
    $('#steps').innerHTML = [0, 1, 2].map(i => `<i class="${i <= idx ? 'on' : ''}"></i>`).join('');
    window.scrollTo(0, 0);
  }

  function startReport() {
    if (!state.user) {
      state.afterLogin = 'report';
      show('profile');
      toast('Log in or create an account to report a fault.');
      return;
    }
    Object.assign(state.report, { category: null, type: null, lat: null, lng: null, streetDirty: false });
    $('#desc').value = ''; $('#street').value = '';
    $('#categoryGrid').innerHTML = Object.entries(state.catalog.categories).map(([k, c]) => `
      <button class="cat-card" data-cat="${k}" style="--c:${c.color}">
        <span class="big pic" style="${IMG(k, 'cats')}"></span>${esc(c.label)}
      </button>`).join('');
    $$('#categoryGrid .cat-card').forEach(b => b.addEventListener('click', () => chooseCategory(b.dataset.cat)));
    setStep('category');
  }

  function chooseCategory(key) {
    const c = state.catalog.categories[key];
    state.report.category = key;
    $('#typeTitle').textContent = `${c.label}: what is wrong?`;
    $('#typeGrid').innerHTML = Object.entries(c.types).map(([k, t]) => `
      <button class="type-btn" data-type="${k}" style="--c:${c.color}"><span class="ic pic" style="${IMG(k)}"></span><span>${esc(t.label)}</span></button>`).join('');
    $$('#typeGrid .type-btn').forEach(b => b.addEventListener('click', () => chooseType(b.dataset.type)));
    setStep('type');
  }

  function chooseType(key) {
    const c = state.catalog.categories[state.report.category];
    state.report.type = key;
    $('#pickedBanner').style.setProperty('--c', c.color);
    $('#pickedBanner').innerHTML = `<span class="ic pic" style="${IMG(key)}"></span>${esc(c.types[key].label)}`;
    $('#reportCity').innerHTML = Object.keys(state.catalog.cities).map(x => `<option>${esc(x)}</option>`).join('');
    $('#reportCity').value = state.user.city;
    $('#reportTime').textContent = `The date and time will be recorded automatically (now: ${fmtDateTime(now())}).`;
    setStep('details');
    initPicker();
  }

  function initPicker() {
    const center = cityCenter($('#reportCity').value);
    if (!pickState.map) {
      pickState.map = L.map('pickMap').setView(center, 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(pickState.map);
      pickState.marker = L.marker(center, { draggable: true }).addTo(pickState.map);
      pickState.marker.on('dragend', () => setPick(pickState.marker.getLatLng()));
      pickState.map.on('click', e => { pickState.marker.setLatLng(e.latlng); setPick(e.latlng); });
    } else {
      pickState.map.setView(center, 15);
      pickState.marker.setLatLng(center);
    }
    setTimeout(() => pickState.map.invalidateSize(), 60);
    setPick({ lat: center[0], lng: center[1] }, false);
  }

  function setPick(ll, geocode = true) {
    state.report.lat = ll.lat; state.report.lng = ll.lng;
    if (!geocode) return;
    clearTimeout(pickState.geoTimer);
    pickState.geoTimer = setTimeout(async () => {
      try { // OpenStreetMap Nominatim: turn the pin position into a street name
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${ll.lat}&lon=${ll.lng}`);
        const d = await r.json();
        const a = d.address || {};
        const name = [a.road, a.suburb || a.neighbourhood].filter(Boolean).join(', ');
        if (name && !state.report.streetDirty) $('#street').value = name;
      } catch { /* offline: user can type the street */ }
    }, 700);
  }

  $('#street').addEventListener('input', () => (state.report.streetDirty = true));
  $('#reportCity').addEventListener('change', e => {
    const c = cityCenter(e.target.value);
    pickState.map.setView(c, 15); pickState.marker.setLatLng(c); setPick({ lat: c[0], lng: c[1] }, false);
  });
  $('#useGps').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Location is not available on this device.', true);
    const btn = $('#useGps'); btn.disabled = true; btn.textContent = 'Finding you…';
    navigator.geolocation.getCurrentPosition(p => {
      const ll = { lat: p.coords.latitude, lng: p.coords.longitude };
      pickState.marker.setLatLng(ll); pickState.map.setView(ll, 18); setPick(ll);
      btn.disabled = false; btn.textContent = 'Use my current location';
    }, () => {
      toast('Could not get your location. Tap the map to place the pin.', true);
      btn.disabled = false; btn.textContent = 'Use my current location';
    }, { enableHighAccuracy: true, timeout: 12000 });
  });

  document.addEventListener('click', e => {
    const back = e.target.closest('[data-back]');
    if (back) setStep(back.dataset.back);
  });

  $('#submitFault').addEventListener('click', async () => {
    const r = state.report;
    const btn = $('#submitFault');
    btn.disabled = true; btn.textContent = 'Submitting…';
    try {
      const { fault } = await api('/faults', { method: 'POST', body: {
        category: r.category, type: r.type, lat: r.lat, lng: r.lng,
        street: $('#street').value, city: $('#reportCity').value, description: $('#desc').value
      } });
      state.lastFault = fault;
      $('#doneText').textContent = `${typ(fault).label} on ${fault.street || fault.city} was logged on ${fmtDateTime(fault.createdAt)}. Thank you for helping your community.`;
      setStep('done');
    } catch (err) { toast(err.message, true); }
    btn.disabled = false; btn.textContent = 'Submit report';
  });
  $('#doneAnother').addEventListener('click', startReport);
  $('#doneView').addEventListener('click', () => {
    state.filterCity = state.lastFault.city;
    show('map');
    $('#filterCity').value = state.filterCity;
    setTimeout(() => { mapState.map.setView([state.lastFault.lat, state.lastFault.lng], 17); }, 400);
  });

  /* ------------------------------------------------------------- my reports */
  async function renderMine() {
    const el = $('#mineList');
    if (!state.user) {
      el.innerHTML = '<div class="empty">Log in to see the faults you have reported.<br><button class="btn btn-primary" data-go="profile">Log in</button></div>';
      return;
    }
    try {
      const { faults } = await api('/faults?mine=1&status=all');
      renderFaultList(el, faults, 'You have not reported any faults yet.');
    } catch (err) { el.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  }

  /* ------------------------------------------------------------------ analytics */
  let analyticsCityInit = false;

  async function renderAnalytics() {
    const sel = $('#analyticsCity');
    if (!analyticsCityInit) {
      sel.innerHTML = '<option value="all">All cities</option>' + Object.keys(state.catalog.cities).map(c => `<option>${esc(c)}</option>`).join('');
      sel.value = state.user ? state.user.city : (state.filterCity || 'all');
      sel.addEventListener('change', renderAnalytics);
      analyticsCityInit = true;
    }
    $('#analyticsTotals').innerHTML = '';
    $('#analyticsCats').innerHTML = '<div class="empty">Loading analytics…</div>';
    try {
      const data = await api(`/analytics?city=${encodeURIComponent(sel.value)}`);
      const t = data.totals;
      $('#analyticsTotals').innerHTML = `
        <div class="stat"><b>${t.reported}</b><span>Reported</span></div>
        <div class="stat"><b>${t.fixed}</b><span>Fixed</span></div>
        <div class="stat"><b>${t.avgHoursToFix !== null ? fmtDuration(t.avgHoursToFix) : '—'}</b><span>Avg time to fix</span></div>`;

      const rows = Object.entries(data.categories).filter(([, c]) => c.reported > 0);
      if (!rows.length) { $('#analyticsCats').innerHTML = '<div class="empty">No faults reported here yet.</div>'; return; }

      $('#analyticsCats').innerHTML = rows.map(([key, c]) => {
        const cat = state.catalog.categories[key];
        const pct = c.reported ? Math.round((c.fixed / c.reported) * 100) : 0;
        return `
        <div class="analytics-card" style="--c:${cat.color}">
          <div class="analytics-card-head">
            <span class="ic pic" style="${IMG(key, 'cats')}"></span>
            <div class="analytics-card-title"><b>${esc(cat.label)}</b><small>${c.reported} reported · ${c.fixed} fixed · ${c.open} open</small></div>
            <div class="analytics-pct">${pct}%</div>
          </div>
          <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
          <div class="analytics-card-foot">
            ${c.avgHoursToFix !== null
              ? `<span><i class="fa-solid fa-stopwatch" aria-hidden="true"></i> Avg ${fmtDuration(c.avgHoursToFix)} to fix (fastest ${fmtDuration(c.fastestHoursToFix)}, slowest ${fmtDuration(c.slowestHoursToFix)})</span>`
              : '<span>No fixes recorded yet</span>'}
          </div>
        </div>`;
      }).join('');
    } catch (err) {
      $('#analyticsCats').innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  }

  /* ------------------------------------------------------------ detail sheet */
  // Formats a repair time in hours as "3 h" or "2 d 5 h" for display.
  function fmtDuration(hours) {
    if (hours < 1) return Math.round(hours * 60) + ' min';
    if (hours < 24) return Math.round(hours) + ' h';
    const d = Math.floor(hours / 24), h = Math.round(hours % 24);
    return h ? `${d} d ${h} h` : `${d} d`;
  }

  function openSheet(f) {
    const c = cat(f), t = typ(f);
    const loggedIn = !!state.user;
    const resolveAction = f.status === 'open'
      ? (loggedIn ? `<button class="btn btn-soft" id="resolveBtn">${f.mine ? 'Mark as fixed' : 'Report this as repaired'}</button>`
                  : `<button class="btn btn-soft" data-go="profile" data-close>Log in to report a repair</button>`)
      : (f.mine ? `<button class="btn btn-ghost" id="resolveBtn">This isn't actually fixed — reopen</button>` : '');
    const confirmAction = f.status === 'open'
      ? (f.mine ? '' : loggedIn
          ? `<button class="btn ${f.confirmedByMe ? 'btn-ghost' : 'btn-soft'}" id="confirmBtn">${f.confirmedByMe ? 'You confirmed this (tap to undo)' : 'I can see this too'}</button>`
          : `<button class="btn btn-soft" data-go="profile" data-close>Log in to confirm</button>`)
      : '';

    $('#sheetBody').innerHTML = `
      <div class="sheet-head" style="--c:${c.color}">
        <span class="ic pic" style="${IMG(f.type)}" role="img" aria-label="${esc(t.label)}"></span>
        <div><h2 id="sheetTitle">${esc(t.label)}</h2><small>${esc(c.label)} · <span class="badge ${f.status}">${f.status === 'open' ? 'Open' : 'Fixed'}</span></small></div>
      </div>
      ${f.description ? `<p>${esc(f.description)}</p>` : ''}
      <div class="detail-rows">
        <div><i class="fa-solid fa-location-dot" aria-hidden="true"></i><span>${esc(f.street || 'Street not given')}, ${esc(f.city)}</span></div>
        <div><i class="fa-solid fa-clock" aria-hidden="true"></i><span>Reported ${esc(fmtDateTime(f.createdAt))} (${ago(f.createdAt)})</span></div>
        ${f.resolvedAt ? `<div><i class="fa-solid fa-circle-check" aria-hidden="true"></i><span>Fixed ${esc(fmtDateTime(f.resolvedAt))}${f.resolvedByName ? ` · reported repaired by ${esc(f.resolvedByName)}` : ''}${f.hoursToFix !== null ? ` · took ${fmtDuration(f.hoursToFix)} to fix` : ''}</span></div>` : ''}
        <div><i class="fa-solid fa-user" aria-hidden="true"></i><span>Reported by ${esc(f.reporter)}</span></div>
        <div><i class="fa-solid fa-users" aria-hidden="true"></i><span id="confCount">${f.confirmations} other ${f.confirmations === 1 ? 'person has' : 'people have'} confirmed this</span></div>
      </div>
      <div class="sheet-actions">
        <a class="btn btn-primary" style="text-align:center;text-decoration:none" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${f.lat},${f.lng}">Get directions</a>
        ${resolveAction}${confirmAction}
      </div>`;
    $('#sheet').hidden = false;

    const act = (id, path, msgFn) => { const b = $(id); if (b) b.addEventListener('click', async () => {
      try {
        const { fault } = await api(path, { method: 'POST' });
        toast(msgFn(fault));
        closeSheet();
        refreshCurrent();
      } catch (err) { toast(err.message, true); }
    }); };
    act('#resolveBtn', `/faults/${f.id}/resolve`, fault => fault.status === 'resolved' ? 'Thanks — marked as repaired' : 'Report reopened');
    act('#confirmBtn', `/faults/${f.id}/confirm`, fault => fault.confirmedByMe ? 'Thanks for confirming' : 'Confirmation removed');
  }
  function closeSheet() { $('#sheet').hidden = true; }
  $('#sheet').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
  function refreshCurrent() {
    if (state.view === 'map') loadMap(); else if (state.view === 'mine') renderMine(); else if (state.view === 'home') renderHome();
  }

  /* ------------------------------------------------------- accounts / profile */
  function setSession(token, user) {
    state.token = token; state.user = user;
    if (token) localStorage.setItem('sa_token', token); else localStorage.removeItem('sa_token');
  }

  function cityOptions() {
    return Object.keys(state.catalog.cities).map(c => `<option>${esc(c)}</option>`).join('');
  }

  function renderProfile() {
    const loggedIn = !!state.user;
    $('#authBox').hidden = loggedIn;
    $('#profileBox').hidden = !loggedIn;
    if (loggedIn) {
      const u = state.user;
      $('#avatar').textContent = u.name.charAt(0).toUpperCase();
      $('#pfName').textContent = u.name;
      $('#pfMeta').textContent = `${u.email} · ${u.city}`;
      $('#pfNameIn').value = u.name; $('#pfPhone').value = u.phone; $('#pfCity').value = u.city;
      $('#pfCur').value = ''; $('#pfNew').value = '';
    }
    updateInstallHelp();
  }

  function switchAuthTab(login) {
    $('#tabLogin').classList.toggle('active', login);
    $('#tabRegister').classList.toggle('active', !login);
    $('#loginForm').hidden = !login; $('#registerForm').hidden = login;
  }
  $('#tabLogin').addEventListener('click', () => switchAuthTab(true));
  $('#tabRegister').addEventListener('click', () => switchAuthTab(false));

  function afterAuth() {
    const next = state.afterLogin || 'home';
    state.afterLogin = null;
    show(next);
  }

  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('#loginError').textContent = '';
    try {
      const d = await api('/login', { method: 'POST', body: { email: $('#liEmail').value, password: $('#liPass').value } });
      setSession(d.token, d.user); $('#liPass').value = '';
      toast('Welcome back, ' + d.user.name.split(' ')[0]);
      afterAuth();
    } catch (err) { $('#loginError').textContent = err.message; }
  });

  $('#registerForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('#registerError').textContent = '';
    try {
      const d = await api('/register', { method: 'POST', body: {
        name: $('#rgName').value, email: $('#rgEmail').value, phone: $('#rgPhone').value, city: $('#rgCity').value, password: $('#rgPass').value } });
      setSession(d.token, d.user); $('#rgPass').value = '';
      state.filterCity = d.user.city;
      toast('Account created. Welcome to StreetAlert!');
      afterAuth();
    } catch (err) { $('#registerError').textContent = err.message; }
  });

  $('#profileForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('#profileError').textContent = '';
    try {
      const d = await api('/me', { method: 'PUT', body: {
        name: $('#pfNameIn').value, phone: $('#pfPhone').value, city: $('#pfCity').value,
        currentPassword: $('#pfCur').value, newPassword: $('#pfNew').value } });
      state.user = d.user;
      toast('Profile saved');
      renderProfile();
    } catch (err) { $('#profileError').textContent = err.message; }
  });

  $('#logoutBtn').addEventListener('click', () => { setSession('', null); toast('You have been logged out'); show('home'); });

  /* ------------------------------------------------------------------ install */
  let deferredPrompt = null;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); deferredPrompt = e;
    if (!standalone) $('#installBtn').hidden = false;
  });
  $('#installBtn').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null; $('#installBtn').hidden = true;
  });
  window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; toast('StreetAlert installed'); });

  function updateInstallHelp() {
    if (standalone) return;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    $('#installHelp').hidden = false;
    $('#installHelpText').textContent = ios
      ? 'In Safari, tap the Share button, then “Add to Home Screen”.'
      : 'Tap “Install app” at the top of the screen, or open your browser menu and choose “Install app” or “Add to Home screen”. On a computer, use the install icon in the address bar.';
  }

  /* --------------------------------------------------------------------- boot */
  async function boot() {
    try {
      state.catalog = await api('/catalog');
    } catch {
      document.body.insertAdjacentHTML('beforeend', '<p style="padding:90px 20px;text-align:center">Cannot reach the server. Check your internet connection and reload.</p>');
      return;
    }
    const opts = cityOptions();
    ['rgCity', 'pfCity'].forEach(id => ($('#' + id).innerHTML = opts));
    $('#rgCity').value = 'Harare';

    if (state.token) {
      try { state.user = (await api('/me')).user; state.filterCity = state.user.city; } catch { setSession('', null); }
    }
    buildFilters();
    await syncTime();
    setInterval(tickClock, 1000);
    setInterval(syncTime, 5 * 60 * 1000);

    const action = new URLSearchParams(location.search).get('action');
    show(action === 'report' || action === 'map' ? action : 'home');

    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  boot();
})();
