// Test app: GPS in, spoken and displayed speed limit out, plus a trip log for review.
// Every decision about the number lives in the tested modules under src/; this file only
// wires the phone to them and draws the result.
import { tilesAround, matchLive, evaluate, makeStabiliser } from './src/live.js';
import { reachFor, makeLightWatcher, lightPhrase } from './src/lights.js';
import { walkAhead, snapped } from './src/path.js';
import { limitsAhead } from './src/ahead.js';
import { makeMotion } from './src/motion.js';
import { makeAutopilot } from './src/autopilot.js';
import { makeFixFiller } from './src/fix.js';
import { VEHICLES } from './src/limit.js';
import { metresPerDegree } from './src/geo.js';
import { makeHud } from './hud.js';
import { attachGestures } from './gestures.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// Storage can be unavailable (private browsing) or full; the app must keep working and
// just keep the log in memory.
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};

// Drives for checking the screen without a car: real roads, a pretend driver.
const DEMOS = {
  q7: { title: 'Nguyễn Văn Linh, Q.7', sub: 'Đường đôi · đèn giao thông · biển 50', start: [106.716936, 10.729791], heading: 249, kmh: 45, seed: 3 },
  q1: { title: 'Phạm Ngũ Lão → Trần Hưng Đạo, Q.1', sub: 'Phố trung tâm · nhiều đèn', start: [106.694793, 10.769263], heading: 68, kmh: 35, seed: 5 },
};

const WALK = 650;   // metres of road ahead the view and the shoulder signs look at
const SHOW_LIGHTS = 380;

const state = {
  vehicle: store.get('vehicle', 'oto_con'),
  index: null,
  tiles: new Map(),
  prev: null,
  last: null,
  heading: null,
  shown: null,
  current: null,
  stab: makeStabiliser(),
  lights: makeLightWatcher(),
  judged: new WeakMap(),
  walk: null,
  overSince: null,
  overSaid: false,
  log: store.get('log', []),
  sources: { gps: 0, derived: 0, none: 0 },
  lastTrace: 0,
  lastSave: 0,
  watch: null,
  timer: null,
  wake: null,
  audio: null,
  demo: null,
  hud: null,
  motion: null,
  fill: makeFixFiller(),
  raf: null,
  sceneAt: 0,
  speedTarget: null,
  speedShown: 0,
  lastRect: null,
  roadName: null,
};

// ---------- start screen ----------

for (const [k, v] of Object.entries(VEHICLES)) {
  const o = document.createElement('option');
  o.value = k; o.textContent = v.label;
  if (k === state.vehicle) o.selected = true;
  $('vehicle').appendChild(o);
}

for (const [key, d] of Object.entries(DEMOS)) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'demo';
  b.innerHTML = `<span><b></b><small></small></span><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`;
  b.querySelector('b').textContent = d.title;
  b.querySelector('small').textContent = d.sub;
  b.onclick = () => start(key);
  $('demos').appendChild(b);
}

function renderLogButton() {
  let b = $('clear');
  if (!b) {
    b = document.createElement('button');
    b.id = 'clear'; b.type = 'button'; b.className = 'link';
    b.onclick = () => {
      if (!state.log.length) return;
      if (confirm(`Xoá ${state.log.length} mục nhật ký cũ? Hãy xuất trước nếu cần.`)) {
        state.log = []; store.set('log', state.log); renderLogButton();
      }
    };
    document.querySelector('.start-inner').appendChild(b);
  }
  const reports = state.log.filter((e) => e.type === 'report').length;
  b.textContent = state.log.length ? `Nhật ký cũ: ${reports} lần báo sai, ${state.log.length} mục — xoá` : '';
  b.hidden = !state.log.length;
}
renderLogButton();

$('go').onclick = () => start(null);

async function start(demo) {
  state.vehicle = $('vehicle').value;
  store.set('vehicle', state.vehicle);
  // iOS only lets a page speak or play sound after a tap, so both are unlocked here.
  unlockAudio();
  say(demo ? 'Bắt đầu mô phỏng' : 'Bắt đầu');
  await keepAwake();
  $('start').hidden = true;
  $('drive').hidden = false;
  $('demoTag').hidden = !demo;
  Object.assign(state, {
    demo, stab: makeStabiliser(), lights: makeLightWatcher(), shown: null, prev: null, last: null, heading: null,
    walk: null, current: null, speedTarget: null, speedShown: 0, lastRect: null, roadName: null, hudLimit: null, stillScene: false,
    sources: { gps: 0, derived: 0, none: 0 }, motion: makeMotion(), fill: makeFixFiller(),
  });
  state.hud = makeHud($('scene'), { theme: theme() });
  state.canLook = true;
  $('recenter').hidden = true;
  setBadge(null, null);
  $('roadName').textContent = 'Đang tìm đường…';
  $('roadMeta').textContent = '';
  if (!demo) state.log.push({ type: 'start', t: new Date().toISOString(), vehicle: state.vehicle, ua: navigator.userAgent });
  renderCount();
  try {
    state.index = await (await fetch('tiles/index.json')).json();
    $('tier').textContent = demo ? 'Đang tải' : 'Đang chờ GPS';
    $('built').textContent = `OSM, ${state.index.built}`;
  } catch {
    $('tier').textContent = 'Không tải được dữ liệu';
  }
  startLoop();
  if (demo) startDemo(DEMOS[demo]); else startPositions();
}

$('stop').onclick = () => {
  if (state.watch != null) navigator.geolocation.clearWatch(state.watch);
  if (state.timer) clearInterval(state.timer);
  if (state.raf) cancelAnimationFrame(state.raf);
  state.watch = null; state.timer = null; state.raf = null;
  try { state.wake && state.wake.release(); } catch {}
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  save(true);
  openSheet(false);
  $('drive').hidden = true;
  $('start').hidden = false;
  renderLogButton();
};

// ---------- position ----------

function startPositions() {
  // ?at=lat,lon[,heading] pins the position, so the screen can be checked at a desk.
  const at = params.get('at');
  if (at) {
    const [lat, lon, heading = null] = at.split(',').map(Number);
    const tick = () => onFix({ lon, lat, acc: 5, heading, speed: 0, t: Date.now() });
    tick();
    state.timer = setInterval(tick, 1000);
    return;
  }
  if (!('geolocation' in navigator)) { gpsStatus('Máy không có GPS'); return; }
  state.watch = navigator.geolocation.watchPosition(
    (p) => onFix({
      lon: p.coords.longitude,
      lat: p.coords.latitude,
      acc: p.coords.accuracy,
      heading: Number.isFinite(p.coords.heading) ? p.coords.heading : null,
      speed: Number.isFinite(p.coords.speed) && p.coords.speed >= 0 ? p.coords.speed : null,
      t: p.timestamp,
    }),
    (e) => gpsStatus(e.code === 1 ? 'Chưa cho phép vị trí' : 'GPS lỗi, đang thử lại', e.code === 1 ? 'Cài đặt → Quyền riêng tư → Dịch vụ định vị' : ''),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
  );
}

// Without a fix there is no road to name, so the road card carries the GPS problem.
function gpsStatus(text, hint = '') {
  $('gps').textContent = text;
  if (!state.current) { $('roadName').textContent = text; $('roadMeta').textContent = hint; }
}

async function startDemo(d) {
  await loadTiles(d.start[0], d.start[1]);
  const getPieces = (lon, lat) => { ensureTiles(lon, lat); return piecesAround(lon, lat); };
  const step = makeAutopilot({ getPieces, start: d.start, heading: d.heading, kmh: d.kmh, seed: d.seed });
  if (!step) { $('roadName').textContent = 'Không tìm thấy đường mô phỏng'; return; }
  // One fix a second, like the phone's GPS, so the smoothing is seen doing real work.
  const tick = () => onFix({ ...step(1), t: Date.now() });
  tick();
  state.timer = setInterval(tick, 1000);
}

function onFix(raw) {
  // Safari leaves out speed and heading when iOS has none; fillMotion works them out,
  // without mistaking a parked phone's GPS wobble for driving. Where each came from goes in
  // the trip log.
  const fix = state.fill(raw);
  const step = fix.moved;
  state.last = fix;
  state.lastFixAt = performance.now();
  lookAround(fix);
  state.sources[fix.speedSrc || 'none']++;
  if (fix.heading != null && (fix.speed == null || fix.speed > 1.5 || state.heading == null)) state.heading = fix.heading;

  $('gps').textContent = `±${Math.round(fix.acc)} m`;
  renderSources();
  const kmh = fix.speed != null ? Math.round(fix.speed * 3.6) : null;
  state.speedTarget = kmh;

  if (state.index) {
    ensureTiles(fix.lon, fix.lat);
    place(fix, step);
  }

  checkOver(kmh);
  trace(fix, kmh);
}

// Match the fix to a road and show what follows from it. Also run again, with no distance
// travelled, when map tiles arrive: a phone's first fix usually beats its tiles, and a
// parked phone may not send another for a while.
function place(fix, step) {
  {
    const pieces = piecesAround(fix.lon, fix.lat);
    const m = matchLive(pieces, fix, state.prev);
    if (m) {
      state.prev = m.piece;
      const r = evaluate(m.piece, state.index, state.vehicle);
      state.current = r;
      const s = state.stab({ key: `${r.limit.max ?? '—'}|${r.limit.tier}`, max: r.limit.max }, step);
      if (s.changed) {
        const first = !state.shown;
        state.shown = r;
        announce(r);
        if (first) setBadge(r.limit.max, r.limit.tier); else arrive(r.limit.max, r.limit.tier);
      }
      render(r);
      ahead(pieces, m, fix, s.shown);
    } else if (tilesLoading(fix)) {
      state.current = null;
      $('roadName').textContent = 'Đang tải bản đồ…';
      $('roadMeta').textContent = '';
    } else {
      state.current = null;
      $('roadName').textContent = 'Không khớp con đường nào gần';
      $('roadMeta').textContent = 'Có thể đang ở ngoài vùng dữ liệu, hoặc GPS chưa chính xác';
    }
  }
}

function tilesLoading(fix) {
  return tilesAround(fix.lon, fix.lat).some((k) => { const t = state.tiles.get(k); return t && t.then; });
}

// The road ahead: one walk feeds the drawn road, the lights and the shoulder signs, so
// they always agree about which road the car is about to be on.
function ahead(pieces, m, fix, shownValue) {
  // Standing still, the scene is left alone after the first stopped fix, so the frame
  // loop can go idle instead of redrawing GPS wobble.
  const stopped = !(fix.speed > 0.8);
  if (stopped && state.stillScene) return;
  state.stillScene = stopped;
  const now = performance.now() / 1000;
  const from = snapped(m);
  // A phone that has not moved yet has no direction, so nothing is "ahead": the map is
  // drawn north-up around the car, with no road picked out and no shoulder signs, until
  // the first real movement turns it.
  if (state.heading == null) {
    state.walk = null;
    state.motion.fix(now, [from], 0);
    state.hud.setScene({ pieces, at: from, walk: null, piece: m.piece }, now);
    state.sceneAt = now;
    return;
  }
  const walk = walkAhead(pieces, m, state.heading, WALK, from);
  state.walk = walk;
  const moving = fix.speed != null && fix.speed >= 2;
  if (moving) {
    const reach = reachFor(fix.speed);
    const { speak } = state.lights(walk.lights.filter((l) => l.dist <= reach));
    if (speak) {
      announceLight(speak);
      if (!state.demo) state.log.push({ ...snapshot('light', fix, Math.round(fix.speed * 3.6)), light: speak.id, dist: Math.round(speak.dist) });
    }
  }
  const judge = (piece) => {
    let j = state.judged.get(piece);
    if (!j) {
      const r = evaluate(piece, state.index, state.vehicle);
      j = { key: `${r.limit.max ?? '—'}|${r.limit.tier}`, max: r.limit.max };
      state.judged.set(piece, j);
    }
    return j;
  };
  const limits = limitsAhead(walk, judge, shownValue);
  state.hudLimit = (limits.find((l) => l.dist > 15) || {}).value?.max ?? null;
  const bearingAt = (d) => {
    for (let i = 1; i < walk.pts.length; i++) if (walk.dist[i] >= d) return bearingOf(walk.pts[i - 1], walk.pts[i]);
    return state.heading;
  };
  const lights = walk.lights.filter((l) => l.dist <= SHOW_LIGHTS).map((l) => ({ ...l, bearing: bearingAt(l.dist) }));
  state.motion.fix(now, walk.pts, fix.speed);
  state.hud.setScene({ pieces, at: from, walk, piece: m.piece, lights, limits }, now);
  state.sceneAt = now;
}

function bearingOf(a, b) {
  const m = metresPerDegree(a[1]);
  return ((Math.atan2((b[0] - a[0]) * m.x, (b[1] - a[1]) * m.y) * 180) / Math.PI + 360) % 360;
}

// ---------- tiles ----------

function ensureTiles(lon, lat) {
  const want = tilesAround(lon, lat);
  const loads = [];
  for (const k of want) {
    if (state.tiles.has(k)) { const t = state.tiles.get(k); if (t && t.then) loads.push(t); continue; }
    const p = fetch(`tiles/${k}.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((j) => {
        state.tiles.set(k, j);
        if (state.last && !state.current && state.index && !state.demo) place(state.last, 0);
      })
      .catch(() => { state.tiles.delete(k); });
    state.tiles.set(k, p);
    loads.push(p);
  }
  // Keep memory bounded on a long drive: drop tiles well behind the car.
  if (state.tiles.size > 60) {
    const keep = new Set(want);
    for (const k of state.tiles.keys()) if (!keep.has(k)) state.tiles.delete(k);
  }
  return Promise.all(loads);
}

const loadTiles = (lon, lat) => ensureTiles(lon, lat);

function piecesAround(lon, lat) {
  const out = [];
  for (const k of tilesAround(lon, lat)) {
    const t = state.tiles.get(k);
    if (Array.isArray(t)) for (const p of t) out.push(p);
  }
  return out;
}

// ---------- screen ----------

const CONF = { cao: 'chắc', trung_binh: 'khá chắc', thap: 'không chắc' };

function render(current) {
  // The road name follows the car immediately; the limit follows the stabiliser, so the
  // number on screen is always the one that was spoken.
  const road = current.road;
  const name = current.name || current.label;
  if (name !== state.roadName) {
    state.roadName = name;
    $('roadName').textContent = name;
    for (const id of ['roadName', 'roadMeta']) { const el = $(id); el.classList.remove('swap-in'); void el.offsetWidth; el.classList.add('swap-in'); }
  }
  const lanes = road.lanes ? `${road.lanes} làn` : 'chưa rõ số làn';
  const dir = road.divided ? 'đường đôi' : road.oneway ? 'một chiều' : 'hai chiều';
  $('roadMeta').textContent = `${current.label} · ${lanes} · ${dir}`;

  const s = state.shown;
  if (!s) return;
  $('zone').textContent = s.road.expressway
    ? 'Cao tốc'
    : `${s.zone.inside ? 'Trong' : 'Ngoài'} khu đông dân cư · ${CONF[s.zone.confidence]}`;
  $('reason').textContent = [s.limit.rule, s.zone.reason, s.wardName].filter(Boolean).join(' · ');
}

function setTier(tier) {
  const el = $('tier');
  el.className = 'tier';
  if (tier === 'bien_bao') { el.textContent = 'Biển báo'; el.classList.add('sign-tier'); }
  else if (tier === 'theo_luat') { el.textContent = 'Theo luật'; el.classList.add('law'); }
  else if (tier == null) el.textContent = 'Đang tải';
  else el.textContent = state.shown && state.shown.road.expressway ? 'Xem biển cao tốc' : 'Chưa rõ';
}

function setBadge(max, tier) {
  const sign = $('sign');
  sign.querySelectorAll('.num').forEach((n) => n.remove());
  const num = document.createElement('span');
  num.className = 'num';
  num.textContent = max ?? '—';
  sign.appendChild(num);
  sign.classList.toggle('unknown', max == null);
  setTier(tier);
}

// A spring as a CSS linear() curve, where Safari supports it.
function springCurve(damping = 0.62) {
  const w = 12, wd = w * Math.sqrt(1 - damping * damping), pts = [];
  for (let i = 0; i <= 40; i++) {
    const t = (i / 40) * 0.9;
    pts.push(+(1 - Math.exp(-damping * w * t) * (Math.cos(wd * t) + ((damping * w) / wd) * Math.sin(wd * t))).toFixed(4));
  }
  pts[40] = 1;
  return `linear(${pts.join(', ')})`;
}
const SPRING = CSS.supports('animation-timing-function', 'linear(0, 1)') ? springCurve() : 'cubic-bezier(0.2, 0.9, 0.25, 1.15)';

// The new limit arrives rather than being swapped in: if its sign was just passed on the
// shoulder, that sign flies into the badge; the old number drops away and the new one
// springs in.
function arrive(max, tier) {
  const sign = $('sign');
  const old = sign.querySelector('.num');
  const land = () => {
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = max ?? '—';
    sign.classList.toggle('unknown', max == null);
    sign.appendChild(num);
    if (old) old.animate([{ transform: 'none', opacity: 1, filter: 'blur(0)' }, { transform: 'translateY(-55%) scale(0.7)', opacity: 0, filter: 'blur(4px)' }], { duration: 240, easing: 'ease-in', fill: 'forwards' }).onfinish = () => old.remove();
    num.animate([{ transform: 'translateY(55%) scale(0.6)', opacity: 0, filter: 'blur(4px)' }, { transform: 'none', opacity: 1, filter: 'blur(0)' }], { duration: 700, delay: 60, easing: SPRING, fill: 'backwards' });
    sign.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.09)' }, { transform: 'scale(1)' }], { duration: 600, easing: SPRING });
    setTier(tier);
    $('tier').animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 400, delay: 120, easing: 'ease-out', fill: 'backwards' });
  };
  const now = performance.now() / 1000;
  const from = state.lastRect && state.lastRect.max === max && now - state.lastRect.t < 5 ? state.lastRect : null;
  if (!from || document.hidden) { land(); return; }
  const to = sign.getBoundingClientRect();
  const c = $('scene').getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.className = 'ghost-sign';
  Object.assign(ghost.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, borderWidth: '13px', fontSize: '40px' });
  ghost.textContent = max;
  document.body.appendChild(ghost);
  const dx = c.left + from.x + from.size / 2 - (to.left + to.width / 2);
  const dy = c.top + from.y + from.size / 2 - (to.top + to.height / 2);
  ghost.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${from.size / to.width})` }, { transform: 'none' }], { duration: 650, easing: SPRING })
    .onfinish = () => { ghost.remove(); land(); };
}

function renderCount() {
  const n = state.log.filter((e) => e.type === 'report').length;
  $('count').textContent = `${n} lần`;
}

function renderSources() {
  const { gps, derived, none } = state.sources;
  const all = gps + derived + none;
  $('speedSrc').textContent = !all ? '–' : derived || none
    ? `GPS ${Math.round((gps / all) * 100)}% · tự tính ${Math.round((derived / all) * 100)}%`
    : 'GPS của máy';
}

function openSheet(open) {
  $('sheet').classList.toggle('open', open);
  $('scrim').classList.toggle('open', open);
  $('sheet').setAttribute('aria-hidden', String(!open));
}
$('more').onclick = () => openSheet(!$('sheet').classList.contains('open'));
$('scrim').onclick = () => openSheet(false);

function theme() {
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => state.hud && state.hud.setTheme(theme()));

// ---------- looking around while stopped ----------

// The map can be moved by hand only while the car stands still. The moment it drives off,
// fingers stop working and the view springs back to the road: a map left turned or panned
// while driving shows the driver something other than the windscreen.
function lookAround(fix) {
  if (fix.speed > 1.5) state.canLook = false;
  else if (fix.speed != null && fix.speed < 0.8) state.canLook = true;
  if (!state.canLook && state.hud.moved()) {
    state.hud.recenter();
    $('recenter').hidden = true;
  }
}

let hintTimer = null;
function hint() {
  const el = $('hint');
  el.hidden = false;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { el.hidden = true; }, 1800);
}

attachGestures($('scene'), {
  touch() { if (!state.canLook) hint(); },
  pan(a, b) {
    if (!state.canLook) return;
    state.hud.pan(a, b);
    $('recenter').hidden = !state.hud.moved();
  },
  twist(a0, b0, a1, b1) {
    if (!state.canLook) return;
    state.hud.twist(a0, b0, a1, b1);
    $('recenter').hidden = !state.hud.moved();
  },
});
$('recenter').onclick = () => { state.hud.recenter(); $('recenter').hidden = true; };

// ---------- frame loop ----------

// Drawn at up to 30 frames a second while there is something to move, and not at all
// once the car has stood still for a moment: the phone is on for the whole drive and
// sits in a hot car, so idle frames cost battery and heat for nothing.
function startLoop() {
  let last = performance.now(), drawn = 0, lastPose = null;
  const loop = (ts) => {
    state.raf = requestAnimationFrame(loop);
    const now = ts / 1000;
    const dt = Math.min(0.1, (ts - last) / 1000);
    if (ts - drawn < 32) return;
    last = ts;
    const pose = state.motion.at(now);
    const still = lastPose && pose && Math.abs(pose.lon - lastPose.lon) < 1e-8 && Math.abs(pose.lat - lastPose.lat) < 1e-8 && pose.bearing === lastPose.bearing;
    const settling = now - state.sceneAt < 1.2 || state.hud.busy();
    if (!still || settling || !lastPose) {
      state.hud.draw(pose, now, (ts - drawn) / 1000);
      drawn = ts;
      lastPose = pose;
      if (state.walk) {
        const next = state.hudLimit;
        if (next != null) { const r = state.hud.signRect(next); if (r) state.lastRect = { ...r, max: next, t: now }; }
      }
    }
    speedTick(dt);
  };
  state.raf = requestAnimationFrame(loop);
}

// The speed counts toward each new reading instead of jumping once a second.
function speedTick(dt) {
  // A tunnel, or GPS gone quiet: the last speed is no longer a reading, so it is not shown
  // as one.
  if (state.speedTarget != null && performance.now() - (state.lastFixAt || 0) > 4000) state.speedTarget = null;
  // No reading yet is shown as a quiet dash, not as a number.
  $('speed').classList.toggle('none', state.speedTarget == null);
  if (state.speedTarget == null) { $('speed').textContent = '–'; return; }
  state.speedShown += (state.speedTarget - state.speedShown) * (1 - Math.exp(-dt / 0.35));
  const v = String(Math.round(state.speedShown));
  if ($('speed').textContent !== v) $('speed').textContent = v;
}

// ---------- voice ----------

function unlockAudio() {
  try {
    state.audio = state.audio || new (window.AudioContext || window.webkitAudioContext)();
    state.audio.resume();
  } catch {}
}

function tone(freqs, dur = 0.13) {
  const ac = state.audio;
  if (!ac) return;
  let t = ac.currentTime;
  for (const f of freqs) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t); o.stop(t + dur + 0.02);
    t += dur + 0.04;
  }
}

// queue: wait for whatever is being said instead of cutting it off. A limit change may
// interrupt anything; a light never interrupts a limit.
function say(text, queue = false) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'vi-VN';
  const voice = speechSynthesis.getVoices().find((v) => /^vi/i.test(v.lang));
  if (voice) u.voice = voice;
  if (!queue) speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

// A posted sign and a number reasoned from the law must not sound equally sure: the sign
// gets a bright chime and a plain statement, the statute a softer tone and "theo luật".
// No number, no voice.
function announce(r) {
  const max = r.limit.max;
  if (max == null) return;
  if (r.limit.tier === 'bien_bao') { tone([988, 1319]); setTimeout(() => say(`Tốc độ tối đa ${max}`), 320); }
  else { tone([660]); setTimeout(() => say(`Theo luật, ${max}`), 220); }
}

// Its own two-note cue, so a light is recognisable before the words start and never
// mistaken for a limit change or a speeding warning.
function announceLight(light) {
  tone([740, 587], 0.11);
  setTimeout(() => say(lightPhrase(light), true), 280);
}

function checkOver(kmh) {
  const max = state.shown ? state.shown.limit.max : null;
  const over = kmh != null && max != null && kmh > max + 2;
  $('speed').classList.toggle('over', over);
  $('panel').classList.toggle('over', over);
  if (!over) {
    state.overSince = null;
    if (kmh != null && max != null && kmh <= max) state.overSaid = false;
    return;
  }
  // Warn once per excursion, after it has lasted a few seconds - not on every GPS blip.
  if (!state.overSince) state.overSince = Date.now();
  if (!state.overSaid && Date.now() - state.overSince > 3000) {
    tone([880, 880]);
    setTimeout(() => say('Quá tốc độ'), 350);
    state.overSaid = true;
  }
}

async function keepAwake() {
  try { state.wake = await navigator.wakeLock.request('screen'); } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('drive').hidden) keepAwake();
  if (document.visibilityState === 'hidden') save(true);
});

// ---------- log ----------

// Everything needed to decide afterwards whether the app was right: where the car was,
// what it matched, what it showed, and why.
function snapshot(type, fix = state.last, kmh = null) {
  const r = state.current, s = state.shown;
  return {
    type,
    t: new Date().toISOString(),
    lat: fix ? +fix.lat.toFixed(6) : null,
    lon: fix ? +fix.lon.toFixed(6) : null,
    acc: fix ? Math.round(fix.acc) : null,
    heading: fix && fix.heading != null ? Math.round(fix.heading) : null,
    speedSrc: fix ? fix.speedSrc : null,
    headingSrc: fix ? fix.headingSrc : null,
    kmh,
    way: state.prev ? state.prev.id : null,
    road: r ? (r.name || r.label) : null,
    highway: r ? r.road.highway : null,
    ward: r ? r.wardName : null,
    quarter: r ? r.quarterName : null,
    zone: r ? { inside: r.zone.inside, confidence: r.zone.confidence, reason: r.zone.reason } : null,
    now: r ? { max: r.limit.max, tier: r.limit.tier, rule: r.limit.rule } : null,
    shown: s ? { max: s.limit.max, tier: s.limit.tier, rule: s.limit.rule } : null,
  };
}

function trace(fix, kmh) {
  if (state.demo) return;
  const now = Date.now();
  if (now - state.lastTrace < 5000) return;
  state.lastTrace = now;
  state.log.push(snapshot('trace', fix, kmh));
  save(false);
}

function save(force) {
  const now = Date.now();
  if (!force && now - state.lastSave < 30000) return;
  state.lastSave = now;
  store.set('log', state.log);
}

$('wrong').onclick = () => {
  const kmh = state.last && state.last.speed != null ? Math.round(state.last.speed * 3.6) : null;
  if (!state.demo) {
    state.log.push(snapshot('report', state.last, kmh));
    save(true);
    renderCount();
  }
  say('Đã ghi nhận');
  $('wrong').animate([{ transform: 'scale(1)' }, { transform: 'scale(0.95)' }, { transform: 'scale(1)' }], { duration: 380, easing: SPRING });
};

$('export').onclick = async () => {
  save(true);
  const stamp = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const name = `chuyen-di-${stamp}.json`;
  const body = JSON.stringify({ app: 'road-alerts test', exported: new Date().toISOString(), data: state.index && state.index.built, entries: state.log });
  const file = new File([body], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch {}
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
};

// Offline page and tiles. Browsers only allow a service worker on https or localhost, so
// the phone on the LAN address simply runs without one.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ?auto skips the start screen - for checking a pinned ?at= position at a desk, or
// ?demo=q7 to run a demo drive straight away. Voice stays silent this way, since phones
// only allow sound after a real tap.
if (params.has('demo')) start(DEMOS[params.get('demo')] ? params.get('demo') : 'q7');
else if (params.has('auto')) start(null);
