// The app: GPS in, spoken and displayed speed limit out, and a review of every Sai once the
// trip is over.
//
// There is one screen. It opens parked: a map of where the car is, seen from above, the
// limit where it stands, and anything waiting for review. A tap on the vehicle, or simply
// driving off, turns it into the drive screen; standing still long enough turns it back.
// Every decision about the number lives in the tested modules under src/; this file only
// wires the phone to them and draws the result.
import { tilesAround, matchLive, evaluate, makeStabiliser, TILE } from './src/live.js';
import { reachFor, makeLightWatcher } from './src/lights.js';
import { walkAhead, snapped, junctions, holdAt } from './src/path.js';
import { limitsAhead } from './src/ahead.js';
import { makeMotion } from './src/motion.js';
import { makeAutopilot } from './src/autopilot.js';
import { makeFixFiller } from './src/fix.js';
import { VEHICLES } from './src/limit.js';
import { metresPerDegree } from './src/geo.js';
import { makeStillness, lastChange, pending, retain, whenLabel, STILL, GAP_MS, MOVING_KMH } from './src/trip.js';
import { makeHud } from './hud.js';
import { makeReview } from './review.js';
import { attachGestures } from './gestures.js';
import { makeVoice } from './voice.js';
import { signLine, lawLine, lightLine, FIXED } from './src/phrases.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
// ?mock: a made-up trip waiting for review, as if it had just been driven.
const mock = params.has('mock');

// Storage can be unavailable (private browsing) or full; the app must keep working and
// just keep the log in memory.
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};

// Everything a trip leaves behind: its outline in 'trips', its trace under 'trace:<id>' and
// its reports in 'reports'. Demo drives and ?mock keep theirs in memory instead, so looking
// around never touches a real trip.
const disk = {
  get: (k, d) => store.get(k, d),
  // A full store must not quietly swallow a report: room is made by letting the oldest
  // traces go, the least valuable thing kept.
  set(k, v) {
    for (let i = 0; i < 6; i++) {
      if (store.set(k, v)) return true;
      const old = store.get('trips', []).sort((a, b) => a.id - b.id)
        .find((t) => (!state.trip || t.id !== state.trip.id) && has(`trace:${t.id}`));
      if (!old) return false;
      disk.del(`trace:${old.id}`);
    }
    return false;
  },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
function has(k) { try { return localStorage.getItem(k) != null; } catch { return false; } }
const memory = new Map();
const scratch = {
  get: (k, d) => (memory.has(k) ? memory.get(k) : d),
  set: (k, v) => { memory.set(k, v); return true; },
  del: (k) => memory.delete(k),
};
const home = (x) => (x && x.scratch ? scratch : disk);

// Drives for checking the screen without a car: real roads, a pretend driver.
const DEMOS = {
  q7: { title: 'Nguyễn Văn Linh, Q.7', sub: 'Đường đôi · đèn giao thông · biển 50', start: [106.716936, 10.729791], heading: 249, kmh: 45, seed: 3 },
  q1: { title: 'Phạm Ngũ Lão → Trần Hưng Đạo, Q.1', sub: 'Phố trung tâm · nhiều đèn', start: [106.694793, 10.769263], heading: 68, kmh: 35, seed: 5 },
};

const WALK = 650;   // metres of road ahead the view and the shoulder signs look at
const SHOW_LIGHTS = 380;
// Parked, the car sits in the middle of the map the road card and the panel leave uncovered.
const PARK_Y = 0.42;

// The two vehicles on the home screen, for now: what the household drives. The law module
// knows the other seven. "Xe máy" in speech also covers a 50 cc bike, which Điều 7 caps at
// 40, so the button says which one it means.
const SLOTS = ['oto_con', 'xe_mo_to'];
const SHORT = {
  oto_con: { name: 'Ô tô', sub: '≤ 28 chỗ', glyph: 'car' },
  xe_mo_to: { name: 'Xe máy', sub: 'trên 50 cc', glyph: 'scooter' },
};
const GLYPH = {
  car: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M6.3 5.3C6.6 4.5 7.3 4 8.2 4h7.6c.9 0 1.6.5 1.9 1.3L19.5 10h.5a1 1 0 0 1 1 1v6.5a1.5 1.5 0 0 1-1.5 1.5H19v1.2a.8.8 0 0 1-.8.8h-1.4a.8.8 0 0 1-.8-.8V19H8v1.2a.8.8 0 0 1-.8.8H5.8a.8.8 0 0 1-.8-.8V19h-.5A1.5 1.5 0 0 1 3 17.5V11a1 1 0 0 1 1-1h.5zM8 6.3h8l1.2 3.4H6.8zM5.4 14a1.35 1.35 0 1 0 2.7 0 1.35 1.35 0 1 0-2.7 0zm10.5 0a1.35 1.35 0 1 0 2.7 0 1.35 1.35 0 1 0-2.7 0zM9.8 15h4.4v1.4H9.8z"/></svg>',
  scooter: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2.6 15.8C2.4 12.6 4.6 10.8 7.6 10.8H10.6C11.4 10.8 11.9 11.3 12 12.1L12.3 13.9H15.1L16 6.6H18.1L18.3 13.2C19.9 13.4 21.3 14.4 21.7 15.8H9.4C9 14.5 7.7 13.9 6 13.9C4.3 13.9 3 14.5 2.6 15.8Z"/><rect x="4.4" y="9" width="6.6" height="2.4" rx="1.2"/><rect x="15.2" y="5.1" width="5.2" height="1.8" rx=".9"/><path fill-rule="evenodd" d="M3.5 17.8a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0zm1.65 0a.85.85 0 1 0 1.7 0 .85.85 0 1 0-1.7 0zM15.7 17.8a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0zm1.65 0a.85.85 0 1 0 1.7 0 .85.85 0 1 0-1.7 0z"/></svg>',
};
const CHEV = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
const SPEAKER = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

// A xe máy may ride both ways on some streets that are one-way for cars.
const bike = () => !!(VEHICLES[state.vehicle] && VEHICLES[state.vehicle].twoWheeler);
const keyOf = (r) => `${r.limit.max ?? '—'}|${r.limit.tier}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const saved = store.get('vehicle', 'oto_con');
const state = {
  mode: 'home',      // 'home': parked, a map of where the car is; 'drive': the drive screen
  vehicle: SLOTS.includes(saved) ? saved : 'oto_con',
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
  trip: null,        // the trip being driven: { id, start, end, vehicle, built, scratch }
  trace: [],         // its snapshots, every 5 s and at every event
  window: [],        // the last 30 s of fixes, once a second: what a report carries
  tripEnded: false,
  still: null,
  hiddenAt: null,
  reviewFrom: null,
  sources: { gps: 0, derived: 0, none: 0 },
  lastTrace: 0,
  lastSave: 0,
  watch: null,
  timer: null,
  wake: null,
  rested: false,     // parked after a trip: the screen may sleep until the next touch
  holdAuto: false,   // Dừng while moving: do not start driving again until the car stops
  audio: null,
  pill: false,
  greetPending: false, // the drive has begun, the voice waits for the car to move
  travelled: 0,        // metres since then, for a car crawling out slower than 2 m/s
  demo: null,
  hud: null,
  motion: makeMotion(),
  fill: makeFixFiller(),
  raf: null,
  redraw: true,
  sceneAt: 0,
  speedTarget: null,
  speedShown: 0,
  lastRect: null,
  roadName: null,
  metaKey: null,
  said: null,
  canLook: true,
  handMoved: false,
};

// ---------- home ----------

function renderGreet() {
  const h = new Date(Date.now() + 7 * 3600e3).getUTCHours();
  const part = h < 4 ? 'Đêm nay' : h < 11 ? 'Sáng nay' : h < 13 ? 'Trưa nay' : h < 18 ? 'Chiều nay' : h < 22 ? 'Tối nay' : 'Đêm nay';
  $('greet').textContent = `${part} đi xe gì?`;
}

function renderTiles() {
  SLOTS.forEach((v, i) => {
    const sh = SHORT[v], t = $(`tile${i}`), last = v === state.vehicle;
    t.classList.toggle('last', last);
    t.setAttribute('aria-label', `Bắt đầu với ${sh.name}`);
    t.innerHTML = `<span class="tg">${GLYPH[sh.glyph]}</span>${last ? '<span class="was">Lần trước</span>' : ''}<span class="tl"><b>${esc(sh.name)}</b><small>${esc(sh.sub)}</small></span>`;
  });
}

// Reports waiting for an answer lead the home panel: this is where a driver who parked
// finds them again. fresh: how many at the front arrived with the trip just ended.
const allPending = () => pending([...disk.get('reports', []), ...scratch.get('reports', [])], Date.now());
function renderPending(fresh = 0) {
  const list = allPending(), row = $('pending');
  row.hidden = !list.length;
  if (!list.length) return;
  const trips = new Set(list.map((r) => r.trip)).size;
  const when = whenLabel(list[0].t, Date.now());
  const shown = list.slice(0, 3).reverse();
  const signs = shown.map((r, i) => {
    const m = r.shown && r.shown.max;
    return `<span class="mini-sign ${m == null ? 'unknown' : ''} ${i >= shown.length - fresh ? 'fresh' : ''}">${m ?? '–'}</span>`;
  }).join('');
  row.innerHTML = `<span class="sign-stack">${signs}</span>
    <div><b>${list.length} chỗ chờ bạn xem lại</b><small>${trips > 1 ? `${trips} chuyến · mới nhất ${when}` : `Chuyến ${when}`}</small></div>${CHEV}`;
}
$('pending').onclick = () => openReview(allPending(), 'home');

function renderLogCount() {
  const trips = disk.get('trips', []).length, reports = disk.get('reports', []).length;
  $('logCount').textContent = `${trips} chuyến, ${reports} lần báo sai`;
}

// The way to install is only worth saying in Safari, and only until it has been read.
function syncInstall() {
  $('install').hidden = !(navigator.standalone === false && state.mode === 'home' && !store.get('installSeen', false));
}
$('installX').onclick = () => { store.set('installSeen', true); syncInstall(); };

// Picking the vehicle is starting the drive. It is also the tap iOS needs before a page
// can make a sound, so the one question the law needs answered costs nothing extra.
function tapTile(i) {
  if (state.mode !== 'home') return;
  unlockAudio();
  // Heard, with nothing said yet: below every other cue, so it is never taken for one.
  if (state.voice) state.voice.tone([523], 0.12);
  keepAwake();
  const v = SLOTS[i];
  if (v !== state.vehicle) { state.vehicle = v; store.set('vehicle', v); renderTiles(); }
  toDrive();
}
$('tile0').onclick = () => tapTile(0);
$('tile1').onclick = () => tapTile(1);

for (const [key, d] of Object.entries(DEMOS)) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'cell';
  b.innerHTML = `<span class="grow"><b></b><small></small></span>${CHEV}`;
  b.querySelector('b').textContent = d.title;
  b.querySelector('small').textContent = d.sub;
  b.onclick = () => { closeSheets(); startDemo(key); };
  $('demos').appendChild(b);
}

$('clear').onclick = () => {
  const trips = disk.get('trips', []), reports = disk.get('reports', []);
  if (!trips.length && !reports.length) return;
  if (confirm(`Xoá ${trips.length} chuyến và ${reports.length} lần báo sai đã lưu? Hãy xuất trước nếu cần.`)) {
    for (const t of trips) disk.del(`trace:${t.id}`);
    disk.del('trips'); disk.del('reports');
    renderLogCount();
    morph(() => renderPending());
  }
};

// ---------- parked and driving ----------

const bodyFor = (mode) => $(mode === 'drive' ? 'driveBody' : 'homeBody');
const landscape = () => matchMedia('(orientation: landscape) and (max-height: 520px)').matches;

// The old side of the panel drops away, the panel springs to the new side's height, and
// the new side rises in a row at a time. measured() runs once the new layout is known and
// before anything moves, so a sign can be sent to where the badge will end up.
function swapPanel(to, { before, measured } = {}) {
  const panel = $('panel'), next = bodyFor(to), prev = bodyFor(to === 'drive' ? 'home' : 'drive');
  const h0 = panel.offsetHeight;
  for (const el of [panel, prev, next, ...prev.children, ...next.children]) el.getAnimations().forEach((a) => a.cancel());
  prev.classList.add('leaving');
  next.classList.remove('leaving');
  next.hidden = false;
  if (before) before();
  const h1 = panel.offsetHeight;
  if (measured) measured();
  if (!landscape()) panel.animate([{ height: `${h0}px` }, { height: `${h1}px` }], { duration: 640, easing: SPRING });
  const out = prev.animate([{ opacity: 1, transform: 'none', filter: 'blur(0px)' }, { opacity: 0, transform: 'translateY(14px) scale(0.97)', filter: 'blur(6px)' }], { duration: 220, easing: 'ease-in', fill: 'forwards' });
  const gone = () => { if (bodyFor(state.mode) !== prev && !prev.hidden) { prev.hidden = true; prev.classList.remove('leaving'); out.cancel(); } };
  out.onfinish = gone;
  setTimeout(gone, 500);
  [...next.children].filter((el) => !el.hidden).forEach((el, i) => el.animate(
    [{ opacity: 0, transform: 'translateY(18px)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }],
    { duration: 650, delay: 60 + i * 70, easing: SPRING, fill: 'backwards' },
  ));
}

// Something in the panel changes size while it stays on the same side.
function morph(change) {
  const panel = $('panel');
  const h0 = panel.offsetHeight;
  panel.getAnimations().forEach((a) => a.cancel());
  change();
  const h1 = panel.offsetHeight;
  if (Math.abs(h1 - h0) > 1 && !landscape()) panel.animate([{ height: `${h0}px` }, { height: `${h1}px` }], { duration: 560, easing: SPRING });
}

// Where an element sits on the screen in layout pixels, whatever it is animating through.
function boxOf(el) {
  let x = 0, y = 0;
  for (let e = el; e; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

// A sign travelling across the screen, between a badge-sized end and a small one.
function fly(big, small, toBig, max, done) {
  const g = document.createElement('div');
  g.className = `ghost-sign${max == null ? ' unknown' : ''}`;
  Object.assign(g.style, { left: `${big.x}px`, top: `${big.y}px`, width: `${big.w}px`, height: `${big.h}px` });
  g.textContent = max ?? '–';
  $('app').appendChild(g);
  const dx = small.x + small.w / 2 - (big.x + big.w / 2), dy = small.y + small.h / 2 - (big.y + big.h / 2);
  const at = `translate(${dx}px, ${dy}px) scale(${small.w / big.w})`;
  const frames = toBig ? [{ transform: at }, { transform: 'none' }] : [{ transform: 'none' }, { transform: at }];
  // It lands even if the animation never finishes (a page hidden mid-flight): the sign it
  // stands in for is hidden until then, and that sign is the badge.
  let landed = false;
  const land = () => { if (landed) return; landed = true; g.remove(); if (done) done(); };
  g.animate(frames, { duration: 720, easing: SPRING }).onfinish = land;
  setTimeout(land, 1000);
}

// Into the drive screen: the small sign on the card grows into the badge while the camera
// comes down from overhead into the driver's seat. auto: the car drove off by itself, so
// nobody has necessarily tapped yet.
function toDrive({ auto = false } = {}) {
  if (state.mode === 'drive') return;
  state.mode = 'drive';
  // Reviewing is for a parked car.
  if (review && review.isOpen()) review.close();
  closeSheets();
  hideRecenter();
  state.hud.setBike(bike());
  Object.assign(state, {
    stab: makeStabiliser(), lights: makeLightWatcher(), judged: new WeakMap(), shown: null, stillScene: false,
    hudLimit: null, lastRect: null, speedShown: 0, overSince: null, overSaid: false, metaKey: null, said: null,
    greetPending: false, travelled: 0,
  });
  $('install').hidden = true;
  $('demoTag').hidden = !state.demo;
  let r = null;
  if (state.prev && state.index) {
    r = evaluate(state.prev, state.index, state.vehicle);
    state.stab({ key: keyOf(r), max: r.limit.max }, 0);
    state.shown = r; state.current = r;
  }
  const max = r ? r.limit.max : null;
  const here = $('here'), from = boxOf(here);
  here.style.visibility = 'hidden';
  $('card').classList.add('driving');
  setBadge(max, r ? r.limit.tier : null);
  $('unit').textContent = `km/h · ${SHORT[state.vehicle].name.toLowerCase()}`;
  $('vehicleRow').textContent = VEHICLES[state.vehicle].label;
  $('speed').textContent = '–';
  $('wrongSmall').textContent = 'Ghi lại chỗ này';
  swapPanel('drive', {
    measured() {
      const sign = $('sign');
      sign.style.visibility = 'hidden';
      fly(boxOf(sign), from, true, max, () => {
        sign.style.visibility = '';
        sign.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.07)' }, { transform: 'scale(1)' }], { duration: 520, easing: SPRING });
      });
    },
  });
  if (r) { state.metaKey = driveMeta(r); $('roadMeta').innerHTML = state.metaKey; swapIn('roadMeta'); }
  state.hud.park(false);
  beginTrip();
  if (state.last) place(state.last, 0);
  if (!auto || voiceLive()) speakWhenMoving(); else showPill();
  keepAwake();
}

// Back home: the trip is over, the badge goes back up into the card as the camera rises,
// and whatever was tapped on the way arrives in the panel.
function toHome() {
  if (state.mode === 'home') return;
  const badge = boxOf($('sign'));
  const fresh = state.trip ? waitingFor(state.trip).length : 0;
  endTrip();
  state.trip = null;
  state.mode = 'home';
  state.greetPending = false;
  if (state.demo) endDemo();
  state.hud.setBike(bike());
  Object.assign(state, { stab: makeStabiliser(), shown: null, stillScene: false, judged: new WeakMap(), metaKey: null, walk: null, speedTarget: null });
  if (state.voice) state.voice.cut();
  closeSheets();
  hidePill();
  hideRecenter();
  $('panel').classList.remove('over');
  $('speed').classList.remove('over');
  $('demoTag').hidden = true;
  $('card').classList.remove('driving');
  const here = $('here');
  here.style.visibility = 'hidden';
  if (state.last) place(state.last, 0);
  swapIn('roadMeta');
  swapPanel('home', { before() { renderTiles(); renderGreet(); renderPending(fresh); } });
  fly(badge, boxOf(here), false, state.shown ? state.shown.limit.max : null, () => {
    here.style.visibility = '';
    here.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 480, easing: SPRING });
  });
  state.hud.park(true);
  syncInstall();
  renderLogCount();
  rest();
}

// Dừng: the trip is over now. Still moving, it stays over until the car has stopped, or it
// would start again with the next fix.
$('stop').onclick = () => {
  const kmh = state.last && state.last.speed != null ? state.last.speed * 3.6 : 0;
  if (kmh >= 3) state.holdAuto = true;
  toHome();
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

function stopPositions() {
  if (state.watch != null) navigator.geolocation.clearWatch(state.watch);
  if (state.timer) clearInterval(state.timer);
  state.watch = null; state.timer = null;
}

// Without a fix there is no road to name, so the road card carries the GPS problem.
function gpsStatus(text, hint = '') {
  $('gps').textContent = text;
  if (!state.current) { $('roadName').textContent = text; $('roadMeta').textContent = hint; }
}

// A demo borrows the screen from the real GPS: the pretend car is placed at its start and
// drives off, and when the trip ends the real position takes over again.
async function startDemo(key) {
  if (state.mode !== 'home') return;
  const d = DEMOS[key];
  unlockAudio();
  keepAwake();
  stopPositions();
  forget();
  state.demo = key;
  await loadTiles(d.start[0], d.start[1]);
  const getPieces = (lon, lat) => { ensureTiles(lon, lat); return piecesAround(lon, lat); };
  const step = makeAutopilot({ getPieces, start: d.start, heading: d.heading, kmh: d.kmh, seed: d.seed });
  if (!step) { toast('Không tìm thấy đường mô phỏng'); endDemo(); return; }
  // One fix a second, like the phone's GPS, so the smoothing is seen doing real work.
  // ?park=60 stops the car after a minute, to see a trip end without waiting at a desk.
  const park = Number(params.get('park')) || 0, t0 = Date.now();
  let parked = null;
  const tick = () => {
    if (park && Date.now() - t0 > park * 1000) {
      parked = parked || state.last;
      onFix({ lon: parked.lon, lat: parked.lat, acc: 5, heading: null, speed: 0, t: Date.now() });
      return;
    }
    onFix({ ...step(1), t: Date.now() });
  };
  onFix({ lon: d.start[0], lat: d.start[1], acc: 5, heading: null, speed: 0, t: Date.now() });
  toDrive({ auto: true });
  state.timer = setInterval(tick, 1000);
}

function endDemo() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.demo = null;
  forget();
  $('roadName').textContent = 'Đang tìm vị trí…';
  $('roadMeta').textContent = '';
  startPositions();
}

// A jump to somewhere else entirely: nothing about where the car was carries over.
function forget() {
  Object.assign(state, {
    fill: makeFixFiller(), motion: makeMotion(), prev: null, heading: null, headingBefore: null, current: null, last: null,
    stillScene: false, roadName: null, metaKey: null, stab: makeStabiliser(), shown: null, walk: null,
  });
  setHere(null);
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

  if (state.mode === 'drive') checkOver(kmh);
  trace(fix, kmh);
  follow(fix, kmh);
  if (state.greetPending) {
    state.travelled += fix.moved || 0;
    if (underway(fix)) { state.greetPending = false; greet(); }
  }
  // Moving is driving, whether or not anyone tapped.
  if (kmh != null && kmh < 3) state.holdAuto = false;
  if (state.mode === 'home' && !state.holdAuto && kmh != null && kmh >= MOVING_KMH) toDrive({ auto: true });
}

// Match the fix to a road and show what follows from it. Also run again, with no distance
// travelled, when map tiles arrive: a phone's first fix usually beats its tiles, and a
// parked phone may not send another for a while.
function place(fix, step) {
  const pieces = piecesAround(fix.lon, fix.lat);
  const m = matchLive(pieces, fix, state.prev, bike());
  if (m) {
    state.prev = m.piece;
    const r = evaluate(m.piece, state.index, state.vehicle);
    state.current = r;
    const s = state.stab({ key: keyOf(r), max: r.limit.max }, step);
    if (s.changed) {
      const first = !state.shown;
      state.shown = r;
      if (state.mode === 'drive') {
        // Still waiting to set off, the greeting will say whatever is shown by then.
        if (!state.greetPending) announce(r);
        if (first) setBadge(r.limit.max, r.limit.tier); else arrive(r.limit.max, r.limit.tier);
      } else setHere(r);
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
  const walk = walkAhead(pieces, m, state.heading, WALK, from, bike());
  const stop = holdAt(walk, isJunction, state.heading, state.headingBefore);
  state.headingBefore = state.heading;
  state.motion.fix(now, walk.pts, fix.speed, stop, fix.heading);
  // Parked, nothing is ahead either: the car is on a map, not on its way somewhere.
  if (state.mode === 'home') {
    state.walk = null;
    state.hud.setScene({ pieces, at: from, walk: null, piece: m.piece }, now);
    state.sceneAt = now;
    return;
  }
  state.walk = walk;
  const moving = fix.speed != null && fix.speed >= 2;
  if (moving) {
    const reach = reachFor(fix.speed);
    const { speak } = state.lights(walk.lights.filter((l) => l.dist <= reach));
    if (speak) {
      announceLight(speak);
      if (state.trip) state.trace.push({ ...snapshot('light', fix, Math.round(fix.speed * 3.6)), light: speak.id, dist: Math.round(speak.dist) });
    }
  }
  const judge = (piece) => {
    let j = state.judged.get(piece);
    if (!j) {
      const r = evaluate(piece, state.index, state.vehicle);
      j = { key: keyOf(r), max: r.limit.max };
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
    // The tile format in the URL: tiles cached earlier the same day, of an older kind,
    // are not mixed in with new ones.
    const f = state.index && state.index.format;
    const p = fetch(`tiles/${k}.json${f ? `?f=${f}` : ''}`)
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

// Where a car can leave the road it is on, worked out once per tile from its own pieces.
const junctionsOf = new WeakMap();
function isJunction([lon, lat]) {
  const t = state.tiles.get(`${Math.floor(lon / TILE)}_${Math.floor(lat / TILE)}`);
  if (!Array.isArray(t)) return false;
  let j = junctionsOf.get(t);
  if (!j) junctionsOf.set(t, (j = junctions(t)));
  return j.has(`${lon},${lat}`);
}

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
const TIER = { bien_bao: ['Biển báo', 'sign'], theo_luat: ['Theo luật', 'law'] };

// Parked, the card says how sure the limit is and where; driving, what kind of road it is.
function homeMeta(r) {
  const [t, c] = TIER[r.limit.tier] || [r.road.expressway ? 'Xem biển cao tốc' : 'Chưa rõ', 'unk'];
  return `<span class="t ${c}">${t}</span> · ${esc(r.wardName || r.quarterName || r.label)}`;
}
function driveMeta(r) {
  const road = r.road;
  const lanes = road.lanes ? `${road.lanes} làn` : 'chưa rõ số làn';
  const dir = road.divided ? 'đường đôi' : road.oneway ? 'một chiều' : 'hai chiều';
  return esc(`${r.label} · ${lanes} · ${dir}`);
}
function swapIn(id) { const el = $(id); el.classList.remove('swap-in'); void el.offsetWidth; el.classList.add('swap-in'); }

function render(current) {
  // The road name follows the car immediately; the limit follows the stabiliser, so the
  // number on screen is always the one that was spoken.
  const name = current.name || current.label;
  if (name !== state.roadName) {
    state.roadName = name;
    $('roadName').textContent = name;
    for (const id of ['roadName', 'roadMeta']) swapIn(id);
  }
  const meta = state.mode === 'home' ? homeMeta(state.shown || current) : driveMeta(current);
  if (meta !== state.metaKey) { state.metaKey = meta; $('roadMeta').innerHTML = meta; }

  const s = state.shown;
  if (!s) return;
  $('zone').textContent = s.road.expressway
    ? 'Cao tốc'
    : `${s.zone.inside ? 'Trong' : 'Ngoài'} khu đông dân cư · ${CONF[s.zone.confidence]}`;
  $('reason').textContent = [s.limit.rule, s.zone.reason, s.wardName].filter(Boolean).join(' · ');
}

function setHere(r) {
  const max = r ? r.limit.max : null, el = $('here');
  el.textContent = max ?? '–';
  el.classList.toggle('unknown', max == null);
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
  fly(boxOf(sign), { x: from.x, y: from.y, w: from.size, h: from.size }, true, max, land);
}

function renderCount() {
  const n = state.trip ? home(state.trip).get('reports', []).filter((r) => r.trip === state.trip.id).length : 0;
  $('count').textContent = `${n} lần`;
}

function renderSources() {
  const { gps, derived, none } = state.sources;
  const all = gps + derived + none;
  $('speedSrc').textContent = !all ? '–' : derived || none
    ? `GPS ${Math.round((gps / all) * 100)}% · tự tính ${Math.round((derived / all) * 100)}%`
    : 'GPS của máy';
}

function openSheet(id, open) {
  $(id).classList.toggle('open', open);
  $(id).setAttribute('aria-hidden', String(!open));
  $('scrim').classList.toggle('open', open);
}
function closeSheets() { openSheet('sheet', false); openSheet('settings', false); }
$('more').onclick = () => openSheet('sheet', !$('sheet').classList.contains('open'));
$('homeMore').onclick = () => { renderLogCount(); openSheet('settings', true); };
$('scrim').onclick = closeSheets;

function theme() {
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (state.hud) { state.hud.setTheme(theme()); state.redraw = true; } });

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
}

// ---------- looking around while stopped ----------

// The map can be moved by hand only while the car stands still. The moment it drives off,
// fingers stop working and the view springs back to the road: a map left turned or panned
// while driving shows the driver something other than the windscreen.
function lookAround(fix) {
  if (fix.speed > 1.5) state.canLook = false;
  else if (fix.speed != null && fix.speed < 0.8) state.canLook = true;
  if (!state.canLook && state.handMoved) { state.hud.recenter(); hideRecenter(); }
}
function hideRecenter() { state.handMoved = false; $('recenter').hidden = true; }

let hintTimer = null;
function hint() {
  const el = $('hint');
  el.hidden = false;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { el.hidden = true; }, 1800);
}

// Every move goes to the road view only while stopped, and each one may show or hide the
// way back.
const look = (move) => (...args) => {
  if (!state.canLook || !state.hud) return;
  state.hud[move](...args);
  state.handMoved = true;
  $('recenter').hidden = !state.hud.moved();
};
attachGestures($('scene'), {
  touch() {
    if (!state.hud) return;
    if (state.canLook) state.hud.hold(); else hint();
  },
  pan: look('pan'),
  pinch: look('pinch'),
  tilt: look('tilt'),
  zoomAt: look('zoomAt'),
  fling: look('fling'),
  end: look('end'),
});
$('recenter').onclick = () => { state.hud.recenter(); hideRecenter(); };

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
    const settling = now - state.sceneAt < 1.2 || state.hud.busy() || state.redraw;
    if (!still || settling || !lastPose) {
      state.hud.draw(pose, now, (ts - drawn) / 1000);
      drawn = ts;
      lastPose = pose;
      state.redraw = false;
      if (state.walk && state.mode === 'drive') {
        const next = state.hudLimit;
        if (next != null) { const r = state.hud.signRect(next); if (r) state.lastRect = { ...r, max: next, t: now }; }
      }
    }
    if (state.mode === 'drive') speedTick(dt);
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

// iOS only lets a page make sound after a tap, so the context is built on the first one
// and the clips are fetched behind it. Any touch counts - a finger on the map at home is
// enough for the drive that follows to speak.
function unlockAudio() {
  try {
    state.audio = state.audio || new (window.AudioContext || window.webkitAudioContext)();
    state.audio.resume();
    if (!state.voice) {
      state.voice = makeVoice(state.audio);
      state.voiceReady = state.voice.preload();
    }
  } catch {}
}
document.addEventListener('pointerdown', unlockAudio, { once: true });
// Coming back from the background, iOS may have suspended the context again.
const voiceLive = () => !!(state.audio && state.audio.state === 'running');

// Takes a rendered line, or the id of one of the fixed ones.
function say(line, opts) {
  if (!state.voice) return;
  state.voice.cue(typeof line === 'string' ? FIXED.find((f) => f.id === line) : line, opts);
}

// The first thing said on a trip waits for the car to move. Parked, the road under it was
// matched with no direction to go on - maybe the street beside the garage rather than the
// one it will leave by. The screen can show that guess; the voice should not say it. Past
// the speed at which matching checks direction (2 m/s), or 60 m on at a crawl, the
// greeting and the limit come together.
const underway = (fix) => !!fix && (fix.speed > 2 || state.travelled > 60);
function speakWhenMoving() {
  if (underway(state.last)) greet();
  else state.greetPending = true;
}

// The opening line, then the limit the badge already shows. Both wait for the clips a
// moment, since the first thing said on a drive is the one most likely to be asked for
// before its recording has arrived.
function greet() {
  Promise.race([state.voiceReady, new Promise((r) => setTimeout(r, 1500))]).then(() => {
    if (state.mode !== 'drive') return;
    say(state.demo ? 'start-demo' : 'start');
    setTimeout(() => { if (state.mode === 'drive' && state.shown && state.said !== keyOf(state.shown)) announce(state.shown, true); }, 300);
  });
}

// Driving off without a tap: the screen works, the voice cannot until someone touches it,
// so it asks - once, where it is seen.
function showPill() {
  const p = $('voicePill');
  p.classList.remove('done');
  p.innerHTML = `${SPEAKER}Chạm để bật giọng nói`;
  p.hidden = false;
  state.pill = true;
}
function hidePill() { $('voicePill').hidden = true; state.pill = false; }
// The tap it asked for, anywhere on the screen: the voice comes on and says where things
// stand, so the driver hears that it worked.
$('app').addEventListener('pointerdown', () => {
  if (!state.pill) return;
  state.pill = false;
  unlockAudio();
  const p = $('voicePill');
  p.classList.add('done');
  p.innerHTML = `${SPEAKER}Đã bật giọng nói`;
  setTimeout(hidePill, 1300);
  Promise.race([state.voiceReady, new Promise((r) => setTimeout(r, 1500))]).then(() => {
    if (state.mode !== 'drive') return;
    if (!underway(state.last)) speakWhenMoving();
    else if (state.shown) announce(state.shown);
  });
}, true);

// A posted sign and a number reasoned from the law must not sound equally sure: the sign
// gets a bright chime and a flat statement, the statute a softer tone and "theo luật" -
// and, now the lines are recorded rather than synthesised, an unhurried delivery that
// eases off the number instead of landing on it.
// No number, no voice.
function announce(r, queue = false) {
  const max = r.limit.max;
  if (max == null) return;
  state.said = keyOf(r);
  if (r.limit.tier === 'bien_bao') say(signLine(max), { chime: [988, 1319], queue });
  else say(lawLine(max), { chime: [660], queue });
}

// Its own falling two-note cue, so a light is recognisable before the words start and
// never mistaken for a limit change or a speeding warning.
function announceLight(light) {
  say(lightLine(light.crossing), { chime: [740, 587], queue: true });
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
    say('over', { chime: [880, 880] });
    state.overSaid = true;
  }
}

// The screen stays on while the app is open, except once a trip has ended: a phone left in
// a parked car should be allowed to sleep. The next touch keeps it awake again.
async function keepAwake() {
  state.rested = false;
  if (state.wake && !state.wake.released) return;
  try { state.wake = await navigator.wakeLock.request('screen'); } catch {}
}
function rest() {
  state.rested = true;
  try { if (state.wake) state.wake.release(); } catch {}
  state.wake = null;
}
document.addEventListener('pointerdown', () => { if (state.rested || !state.wake) keepAwake(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { state.hiddenAt = Date.now(); saveTrip(true); return; }
  if (!state.rested) keepAwake();
  // Away this long, the trip that was running is over; the next movement starts another.
  if (state.mode === 'drive' && state.hiddenAt && Date.now() - state.hiddenAt > GAP_MS) toHome();
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
  if (!state.trip) return;
  const now = Date.now();
  if (now - state.lastTrace < 5000) return;
  state.lastTrace = now;
  state.trace.push(snapshot('trace', fix, kmh));
  saveTrip(false);
}

// ---------- trips ----------

// A trip is the drive screen: it starts when the screen turns to driving and ends when the
// car has stood still for a while, when the app has been away for a while, or at Dừng.
// Getting that wrong is cheap: the car moving again starts another.
function beginTrip() {
  const trip = { id: Date.now(), start: new Date().toISOString(), vehicle: state.vehicle, built: state.index ? state.index.built : null };
  if (state.demo || mock) trip.scratch = true;
  Object.assign(state, {
    trip, tripEnded: false, window: [], still: makeStillness(stillFor()), lastTrace: 0, lastSave: 0,
    trace: [{ type: 'start', t: trip.start, vehicle: state.vehicle, ua: navigator.userAgent }],
  });
  const d = home(trip);
  const kept = retain([], [...d.get('trips', []), { ...trip }], Date.now());
  d.set('trips', kept.trips);
  for (const id of kept.dropped) d.del(`trace:${id}`);
  renderCount();
}

// ?still=20 shortens the wait, for trying the end of a trip at a desk.
function stillFor() {
  const s = Number(params.get('still'));
  if (s > 0) return { ...STILL, ms: s * 1000 };
  // A demo car waits 8 s at a light; standing 20 s means the demo has parked.
  return state.demo ? { ...STILL, ms: 20e3 } : STILL;
}

function saveTrip(force) {
  if (!state.trip) return;
  const now = Date.now();
  if (!force && now - state.lastSave < 30000) return;
  state.lastSave = now;
  const d = home(state.trip);
  d.set(`trace:${state.trip.id}`, state.trace);
  d.set('trips', d.get('trips', []).map((t) => (t.id === state.trip.id ? { ...state.trip } : t)));
}

function endTrip() {
  if (!state.trip || state.tripEnded) return;
  state.tripEnded = true;
  state.trip.end = new Date().toISOString();
  saveTrip(true);
}

// Every fix: the seconds a report would carry, and whether the trip is over.
function follow(fix, kmh) {
  if (!state.trip || state.tripEnded) return;
  const now = Date.now();
  state.window.push({ t: now, lon: +fix.lon.toFixed(6), lat: +fix.lat.toFixed(6), kmh, shown: state.shown ? state.shown.limit.max : null });
  while (state.window.length && now - state.window[0].t > 30e3) state.window.shift();
  if (state.still({ t: now, lon: fix.lon, lat: fix.lat, kmh }).ended) toHome();
}

const waitingFor = (trip) => pending(home(trip).get('reports', []), Date.now()).filter((r) => r.trip === trip.id);

// ---------- reports ----------

$('wrong').onclick = () => {
  const kmh = state.last && state.last.speed != null ? Math.round(state.last.speed * 3.6) : null;
  if (state.trip) {
    const snap = snapshot('report', state.last, kmh);
    state.trace.push(snap);
    const r = state.current;
    const window = state.window.map((w) => ({ ...w }));
    saveReport({
      ...snap, id: Date.now(), trip: state.trip.id, vehicle: state.vehicle, scratch: state.trip.scratch,
      // The facts the limit came from, so the review can reason about which one was wrong.
      facts: r ? { expressway: r.road.expressway, divided: r.road.divided, oneway: r.road.oneway, lanes: r.road.lanes, inside: r.zone.inside } : null,
      window, changeAt: lastChange(window),
    });
    saveTrip(true);
    renderCount();
    // Seen as well as heard, for a drive with the sound off.
    $('wrongSmall').textContent = `Đã ghi · ${waitingFor(state.trip).length}`;
    clearTimeout(state.wrongTimer);
    state.wrongTimer = setTimeout(() => { $('wrongSmall').textContent = 'Ghi lại chỗ này'; }, 1800);
  }
  say('logged');
  $('wrong').animate([{ transform: 'scale(1)' }, { transform: 'scale(0.95)' }, { transform: 'scale(1)' }], { duration: 380, easing: SPRING });
};

function saveReport(r) {
  const d = home(r);
  const list = d.get('reports', []);
  const i = list.findIndex((x) => x.id === r.id);
  // Changed since it was sent: the new answer has not reached anyone yet.
  const next = { ...r, sentAt: null };
  if (i >= 0) list[i] = next; else list.push(next);
  d.set('reports', list);
}

// Before trips there was one flat log. It becomes a trip of its own, and any Sai in it
// joins the queue - without the seconds before each tap, which were never kept.
function migrate() {
  const log = store.get('log', null);
  if (!Array.isArray(log) || !log.length) { disk.del('log'); return; }
  const id = Date.parse(log[0].t) || Date.now();
  const vehicle = (log.find((e) => e.type === 'start') || {}).vehicle || state.vehicle;
  const reports = disk.get('reports', []);
  for (const e of log) {
    if (e.type === 'report' && !reports.some((r) => r.t === e.t)) reports.push({ ...e, id: Date.parse(e.t), trip: id, vehicle, window: [], changeAt: 0 });
  }
  if (!disk.set(`trace:${id}`, log) || !disk.set('reports', reports)) return;
  disk.set('trips', [...disk.get('trips', []).filter((t) => t.id !== id), { id, start: log[0].t, end: log[log.length - 1].t, vehicle }]);
  disk.del('log');
}

function tidy() {
  const reports = disk.get('reports', []), trips = disk.get('trips', []);
  const kept = retain(reports, trips, Date.now());
  if (kept.reports.length !== reports.length) disk.set('reports', kept.reports);
  if (kept.trips.length !== trips.length) disk.set('trips', kept.trips);
  for (const id of kept.dropped) disk.del(`trace:${id}`);
}

// ?mock: a made-up trip on real roads (tools/mock-trip.js), ended twelve minutes ago and
// waiting for review. Memory only.
async function loadMock() {
  try {
    const { trip, trace: tr, reports } = await (await fetch('mock/trip.json')).json();
    const shift = Date.now() - 12 * 60e3 - Date.parse(trip.end);
    const iso = (t) => new Date(Date.parse(t) + shift).toISOString();
    const id = trip.id + shift;
    scratch.set('trips', [{ ...trip, id, start: iso(trip.start), end: iso(trip.end), scratch: true }]);
    scratch.set(`trace:${id}`, tr.map((e) => ({ ...e, t: iso(e.t) })));
    scratch.set('reports', reports.map((r) => ({
      ...r, id: r.id + shift, trip: id, t: iso(r.t), scratch: true, window: r.window.map((w) => ({ ...w, t: w.t + shift })),
    })));
    if (state.mode === 'home') morph(() => renderPending());
  } catch {}
}

// ---------- review ----------

let review = null;
function openReview(list, from) {
  if (!list.length) return;
  state.reviewFrom = from;
  review = review || makeReview({
    spring: SPRING,
    pieces: async (lon, lat) => {
      if (!state.index) { try { state.index = await (await fetch('tiles/index.json')).json(); } catch { return []; } }
      await ensureTiles(lon, lat);
      return piecesAround(lon, lat);
    },
    trace: (id) => (state.trip && state.trip.id === id ? state.trace : scratch.get(`trace:${id}`, null) || disk.get(`trace:${id}`, null)),
    save: saveReport,
    share: exportAll,
    close: () => {
      if (state.mode === 'home') morph(() => renderPending());
      renderLogCount();
    },
    remember: store,
  });
  // In the order they were driven.
  review.open([...list].sort((a, b) => Date.parse(a.t) - Date.parse(b.t)));
}

// ---------- export ----------

// Everything kept, as one file: each trip with its trace, and every report with its answers.
async function exportAll() {
  saveTrip(true);
  const pick = (d) => ({
    trips: d.get('trips', []).map((t) => ({ ...t, trace: d.get(`trace:${t.id}`, null) })),
    reports: d.get('reports', []),
  });
  const real = pick(disk), play = pick(scratch);
  const stamp = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const name = `chuyen-di-${stamp}.json`;
  const body = JSON.stringify({
    app: 'road-alerts test', exported: new Date().toISOString(), data: state.index && state.index.built,
    trips: [...real.trips, ...play.trips], reports: [...real.reports, ...play.reports],
  });
  const file = new File([body], name, { type: 'application/json' });
  let sent = false;
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); sent = true; } catch (e) { if (e && e.name === 'AbortError') return false; }
  }
  if (!sent) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    a.click();
  }
  const at = new Date().toISOString();
  disk.set('reports', real.reports.map((r) => ({ ...r, sentAt: at })));
  return true;
}

$('export').onclick = exportAll;
$('exportAll').onclick = exportAll;

// Offline page and tiles. Browsers only allow a service worker on https or localhost, so
// the phone on the LAN address simply runs without one.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---------- start ----------

// Straight onto the map, parked. ?demo=q7 runs a demo drive at once, and ?auto turns to
// the drive screen without waiting for movement - with a pinned ?at= position, for checking
// the drive screen at a desk. Neither can speak until the screen is touched.
async function boot() {
  migrate();
  tidy();
  renderTiles();
  renderGreet();
  renderPending();
  renderLogCount();
  syncInstall();
  setInterval(() => { if (state.mode === 'home') renderGreet(); }, 60e3);
  state.hud = makeHud($('scene'), { theme: theme(), bike: bike(), parkY: PARK_Y });
  state.hud.park(true, true);
  startLoop();
  keepAwake();
  if (mock) loadMock();
  try {
    state.index = await (await fetch('tiles/index.json')).json();
    $('built').textContent = `OSM, ${state.index.built}`;
    $('builtNote').textContent = `Dữ liệu bản đồ © OpenStreetMap contributors (ODbL) · ${state.index.built}`;
  } catch {
    $('roadName').textContent = 'Không tải được dữ liệu bản đồ';
  }
  if (params.has('demo')) { startDemo(DEMOS[params.get('demo')] ? params.get('demo') : 'q7'); return; }
  startPositions();
  if (params.has('auto')) toDrive({ auto: true });
}
boot();
