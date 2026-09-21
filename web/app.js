// Test app: GPS in, spoken and displayed speed limit out, plus a trip log for review.
// Every decision about the number lives in the tested modules under src/; this file only
// wires the phone to them.
import { tilesAround, matchLive, evaluate, makeStabiliser } from './src/live.js';
import { VEHICLES } from './src/limit.js';
import { metresPerDegree } from './src/geo.js';

const $ = (id) => document.getElementById(id);

// Storage can be unavailable (private browsing) or full; the app must keep working and
// just keep the log in memory.
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};

const state = {
  vehicle: store.get('vehicle', 'oto_con'),
  index: null,
  tiles: new Map(),
  prev: null,
  last: null,
  shown: null,
  current: null,
  stab: makeStabiliser(),
  overSince: null,
  overSaid: false,
  log: store.get('log', []),
  lastTrace: 0,
  lastSave: 0,
  watch: null,
  timer: null,
  wake: null,
  audio: null,
};

// ---------- start screen ----------

for (const [k, v] of Object.entries(VEHICLES)) {
  const o = document.createElement('option');
  o.value = k; o.textContent = v.label;
  if (k === state.vehicle) o.selected = true;
  $('vehicle').appendChild(o);
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

$('go').onclick = async () => {
  state.vehicle = $('vehicle').value;
  store.set('vehicle', state.vehicle);
  // iOS only lets a page speak or play sound after a tap, so both are unlocked here.
  unlockAudio();
  say('Bắt đầu');
  await keepAwake();
  $('start').hidden = true;
  $('drive').hidden = false;
  state.stab = makeStabiliser();
  state.shown = null; state.prev = null; state.last = null;
  state.log.push({ type: 'start', t: new Date().toISOString(), vehicle: state.vehicle, ua: navigator.userAgent });
  renderCount();
  try {
    state.index = await (await fetch('tiles/index.json')).json();
    $('tier').textContent = 'Đang chờ GPS';
  } catch {
    $('tier').textContent = 'Không tải được dữ liệu';
  }
  startPositions();
};

$('stop').onclick = () => {
  if (state.watch != null) navigator.geolocation.clearWatch(state.watch);
  if (state.timer) clearInterval(state.timer);
  state.watch = null; state.timer = null;
  try { state.wake && state.wake.release(); } catch {}
  save(true);
  $('drive').hidden = true;
  $('start').hidden = false;
  renderLogButton();
};

// ---------- position ----------

function startPositions() {
  // ?at=lat,lon pins the position, so the screen can be checked at a desk.
  const at = new URLSearchParams(location.search).get('at');
  if (at) {
    const [lat, lon] = at.split(',').map(Number);
    const tick = () => onFix({ lon, lat, acc: 5, heading: null, speed: 0, t: Date.now() });
    tick();
    state.timer = setInterval(tick, 1000);
    return;
  }
  if (!('geolocation' in navigator)) { $('gps').textContent = 'Máy không có GPS'; return; }
  state.watch = navigator.geolocation.watchPosition(
    (p) => onFix({
      lon: p.coords.longitude,
      lat: p.coords.latitude,
      acc: p.coords.accuracy,
      heading: Number.isFinite(p.coords.heading) ? p.coords.heading : null,
      speed: Number.isFinite(p.coords.speed) && p.coords.speed >= 0 ? p.coords.speed : null,
      t: p.timestamp,
    }),
    (e) => { $('gps').textContent = e.code === 1 ? 'Chưa cho phép vị trí' : 'GPS lỗi, đang thử lại'; },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
  );
}

function metres(a, b) {
  const m = metresPerDegree(a.lat);
  return Math.hypot((a.lon - b.lon) * m.x, (a.lat - b.lat) * m.y);
}

function onFix(fix) {
  let step = 0;
  if (state.last) {
    step = metres(fix, state.last);
    const dt = (fix.t - state.last.t) / 1000;
    // Safari often omits speed and heading; derive them from movement when it does.
    if (fix.speed == null && dt > 0.5) fix.speed = step / dt;
    if (fix.heading == null && step > 4) {
      const m = metresPerDegree(fix.lat);
      fix.heading = ((Math.atan2((fix.lon - state.last.lon) * m.x, (fix.lat - state.last.lat) * m.y) * 180) / Math.PI + 360) % 360;
    }
  }
  state.last = fix;

  $('gps').textContent = `GPS ±${Math.round(fix.acc)} m`;
  const kmh = fix.speed != null ? Math.round(fix.speed * 3.6) : null;
  $('speed').textContent = kmh ?? '–';

  if (state.index) {
    ensureTiles(fix.lon, fix.lat);
    const m = matchLive(piecesAround(fix.lon, fix.lat), fix, state.prev);
    if (m) {
      state.prev = m.piece;
      const r = evaluate(m.piece, state.index, state.vehicle);
      state.current = r;
      const s = state.stab({ key: `${r.limit.max ?? '—'}|${r.limit.tier}`, max: r.limit.max }, step);
      if (s.changed) {
        state.shown = r;
        announce(r);
        pop();
      }
      render(r);
    } else {
      state.current = null;
      $('roadName').textContent = 'Không khớp con đường nào gần';
      $('roadMeta').textContent = 'Có thể đang ở ngoài vùng dữ liệu, hoặc GPS chưa chính xác';
    }
  }

  checkOver(kmh);
  trace(fix, kmh);
}

// ---------- tiles ----------

function ensureTiles(lon, lat) {
  const want = tilesAround(lon, lat);
  for (const k of want) {
    if (state.tiles.has(k)) continue;
    state.tiles.set(k, null);
    fetch(`tiles/${k}.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((j) => state.tiles.set(k, j))
      .catch(() => state.tiles.delete(k));
  }
  // Keep memory bounded on a long drive: drop tiles well behind the car.
  if (state.tiles.size > 60) {
    const keep = new Set(want);
    for (const k of state.tiles.keys()) if (!keep.has(k)) state.tiles.delete(k);
  }
}

function piecesAround(lon, lat) {
  const out = [];
  for (const k of tilesAround(lon, lat)) {
    const t = state.tiles.get(k);
    if (t) for (const p of t) out.push(p);
  }
  return out;
}

// ---------- screen ----------

const CONF = { cao: 'chắc', trung_binh: 'khá chắc', thap: 'không chắc' };

function render(current) {
  // The road line follows the car immediately; the limit follows the stabiliser, so the
  // number on screen is always the one that was spoken.
  const road = current.road;
  $('roadName').textContent = current.name || current.label;
  const lanes = road.lanes ? `${road.lanes} làn` : 'chưa rõ số làn';
  const dir = road.divided ? 'đường đôi' : road.oneway ? 'một chiều' : 'hai chiều';
  $('roadMeta').textContent = `${current.label} · ${lanes} · ${dir}`;

  const s = state.shown;
  if (!s) return;
  const max = s.limit.max;
  $('limit').textContent = max ?? '—';
  $('sign').classList.toggle('unknown', max == null);

  const tier = $('tier');
  tier.className = 'tier';
  if (s.limit.tier === 'bien_bao') { tier.textContent = 'Biển báo'; tier.classList.add('sign-tier'); }
  else if (s.limit.tier === 'theo_luat') { tier.textContent = 'Theo luật'; tier.classList.add('law'); }
  else { tier.textContent = s.road.expressway ? 'Xem biển cao tốc' : 'Chưa rõ'; }

  $('zone').textContent = s.road.expressway
    ? 'Cao tốc'
    : `${s.zone.inside ? 'Trong' : 'Ngoài'} khu đông dân cư · ${CONF[s.zone.confidence]}`;
  $('reason').textContent = [s.zone.reason, s.wardName].filter(Boolean).join(' · ');
}

function pop() {
  const el = $('sign');
  el.classList.remove('pop');
  void el.offsetWidth; // restart the animation
  el.classList.add('pop');
}

function renderCount() {
  const n = state.log.filter((e) => e.type === 'report').length;
  $('count').textContent = `${n} lần báo sai`;
}

// ---------- voice ----------

function unlockAudio() {
  try {
    state.audio = new (window.AudioContext || window.webkitAudioContext)();
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

function say(text) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'vi-VN';
  const voice = speechSynthesis.getVoices().find((v) => /^vi/i.test(v.lang));
  if (voice) u.voice = voice;
  speechSynthesis.cancel();
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

function checkOver(kmh) {
  const max = state.shown ? state.shown.limit.max : null;
  const over = kmh != null && max != null && kmh > max + 2;
  $('speed').classList.toggle('over', over);
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
  state.log.push(snapshot('report', state.last, kmh));
  save(true);
  renderCount();
  say('Đã ghi nhận');
  const b = $('wrong');
  b.classList.add('flash');
  setTimeout(() => b.classList.remove('flash'), 250);
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

// ?auto skips the start screen - for checking a pinned ?at= position at a desk. Voice
// stays silent this way, since phones only allow sound after a real tap.
if (new URLSearchParams(location.search).has('auto')) $('go').click();
