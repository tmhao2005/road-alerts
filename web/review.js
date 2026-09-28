// Reviewing reports with the car parked: one card per tap of Sai, then a summary.
//
// The driver answers the one question they can answer - what the sign said - and the card
// works out the rest: which fact the app had wrong, where else on the trip that same fact
// was in play, and, if they drag the sign to where it stood, where the boundary is.
import { explain, suggestions } from './src/explain.js';
import { statutoryLimit } from './src/limit.js';
import { similarStretches, distance, whenLabel } from './src/trip.js';
import { metresPerDegree } from './src/geo.js';
import { roadFacts } from './src/lookup.js';
import { lessonFrom } from './src/learn.js';

const $ = (id) => document.getElementById(id);
const CONF = { cao: 'chắc', trung_binh: 'khá chắc', thap: 'không chắc' };
const W = 360, H = 210;
const MAJOR = new Set(['motorway', 'trunk', 'primary', 'motorway_link', 'trunk_link', 'primary_link']);
const MID = new Set(['secondary', 'tertiary', 'secondary_link', 'tertiary_link', 'unclassified']);

const CHECK = '<svg class="check" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const REPLAY = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';
const ARROW = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
const PERSON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2.5"/><path d="M9.5 21v-6l-2-1 1-5h7l1 5-2 1v6z"/></svg>';
const FORK = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.3 11l7.4-3.8M8.3 13l7.4 3.8"/></svg>';
const PIN = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
const BIN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
const UP = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pct = (v, of) => `${(v / of) * 100}%`;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const poly = (pts) => pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
const hhmm = (iso) => new Date(Date.parse(iso) + 7 * 3600e3).toISOString().slice(11, 16);
const limitFor = (vehicle, road) => statutoryLimit(vehicle, road);

// What explain.js reasons over.
const asked = (r) => ({
  vehicle: r.vehicle, road: r.facts, zoneConfidence: r.zone && r.zone.confidence,
  now: r.now || { max: null }, shown: r.shown || { max: null },
  taught: r.taught || null, left: r.left || null, law: r.law || { max: null },
});

// ---------- drawing ----------

// Local metres around the middle of some points, scaled to fit a w x h box with room around.
function projector(points, w = W, h = H, pad = 70, min = 260) {
  const lons = points.map((p) => p[0]), lats = points.map((p) => p[1]);
  const c = [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
  const m = metresPerDegree(c[1]);
  const spanX = Math.max(min, (Math.max(...lons) - Math.min(...lons)) * m.x + 2 * pad);
  const spanY = Math.max(min * (h / w), (Math.max(...lats) - Math.min(...lats)) * m.y + 2 * pad);
  const s = Math.min(w / spanX, h / spanY);
  const halfLon = (w / 2 / s) / m.x, halfLat = (h / 2 / s) / m.y;
  return {
    s, c, m,
    to: (p) => [w / 2 + (p[0] - c[0]) * m.x * s, h / 2 - (p[1] - c[1]) * m.y * s],
    from: (x, y) => [c[0] + (x - w / 2) / s / m.x, c[1] - (y - h / 2) / s / m.y],
    has: (p) => Math.abs(p[0] - c[0]) < halfLon * 1.2 && Math.abs(p[1] - c[1]) < halfLat * 1.2,
  };
}

function measure(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, len: cum[cum.length - 1] };
}

function pointAt(g, f) {
  if (g.pts.length < 2) return { x: g.pts[0][0], y: g.pts[0][1], dx: 1, dy: 0 };
  const d = Math.max(0, Math.min(1, f)) * g.len;
  let i = 0;
  while (i < g.pts.length - 2 && g.cum[i + 1] < d) i++;
  const [ax, ay] = g.pts[i], [bx, by] = g.pts[i + 1];
  const seg = g.cum[i + 1] - g.cum[i] || 1;
  const t = (d - g.cum[i]) / seg;
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, dx: (bx - ax) / seg, dy: (by - ay) / seg };
}

function slice(g, f0, f1) {
  if (f1 <= f0 || g.pts.length < 2) return '';
  const a = pointAt(g, f0), b = pointAt(g, f1);
  const out = [[a.x, a.y]];
  for (let i = 1; i < g.pts.length - 1; i++) {
    const f = g.cum[i] / g.len;
    if (f > f0 && f < f1) out.push(g.pts[i]);
  }
  out.push([b.x, b.y]);
  return poly(out);
}

function nearest(g, x, y) {
  let best = { d: Infinity, f: 0 };
  for (let i = 0; i < g.pts.length - 1; i++) {
    const [ax, ay] = g.pts[i], [bx, by] = g.pts[i + 1];
    const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2));
    const d = Math.hypot(x - (ax + vx * t), y - (ay + vy * t));
    if (d < best.d) best = { d, f: (g.cum[i] + t * Math.sqrt(l2)) / g.len };
  }
  return best.f;
}

// The mapped roads around the report, minor ones first so the big ones sit on top.
function roadsSvg(pieces, proj) {
  const near = pieces.filter((p) => p.c.some((q) => proj.has(q)));
  const rank = (p) => (MAJOR.has(p.highway) ? 2 : MID.has(p.highway) ? 1 : 0);
  near.sort((a, b) => rank(a) - rank(b));
  const width = [[6, 4], [9, 7], [12, 10]];
  const lines = near.map((p) => ({ pts: poly(p.c.map(proj.to)), w: width[rank(p)] }));
  return lines.map((l) => `<polyline points="${l.pts}" fill="none" stroke="var(--map-edge)" stroke-width="${l.w[0]}" stroke-linecap="round" stroke-linejoin="round"/>`).join('')
    + lines.map((l) => `<polyline points="${l.pts}" fill="none" stroke="var(--map-street)" stroke-width="${l.w[1]}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
}

// The walk of a learn.js reach, from its start to where the sign stops applying, as [lon, lat].
function reachPts(reach) {
  const { pts, dist } = reach.walk, out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (dist[i] < reach.end) { out.push(pts[i]); continue; }
    const f = (reach.end - dist[i - 1]) / (dist[i] - dist[i - 1] || 1);
    out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]);
    break;
  }
  return out;
}

// Where a taught sign will hold, drawn along the road in the reported colour, capped where
// it stops. One the app saw no end to fades out instead: a cap there would promise an end
// nobody knows.
function reachSvg(xy, open) {
  if (xy.length < 2) return '';
  const g = measure(xy);
  const line = (f0, f1, o) => `<polyline class="reach" points="${slice(g, f0, f1)}" opacity="${o}" pathLength="1"/>`;
  if (open) return line(0, 0.7, 1) + [0.7, 0.78, 0.86, 0.94].map((f, k) => line(f, f + 0.08, (0.8 - k * 0.2).toFixed(2))).join('');
  const end = xy[xy.length - 1];
  return line(0, 1, 1) + `<circle class="reach-end" cx="${end[0].toFixed(1)}" cy="${end[1].toFixed(1)}" r="5.5"/>`;
}

// A taught sign's stretch on its own little map, for the list of them: the roads around, the
// stretch, and the sign standing at its start.
export function reachMap(pieces, reach, sign, w = W, h = 150) {
  const pts = reachPts(reach);
  const proj = projector(pts, w, h, 45, 200);
  const xy = pts.map(proj.to);
  const [sx, sy] = xy[0];
  return `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <rect width="${w}" height="${h}" fill="var(--map-bg)"/>
    ${roadsSvg(pieces, proj)}
    ${reachSvg(xy, reach.open)}
    <g transform="translate(${sx.toFixed(1)} ${sy.toFixed(1)})"><circle r="13" fill="#fff" stroke="var(--red)" stroke-width="4"/>
      <text text-anchor="middle" dy="4.5" font-size="11.5" font-weight="800" fill="#15161A">${sign.max}</text></g>
  </svg>`;
}

// How far a reach runs and what ends it, in the driver's words.
export function reachWords(reach) {
  const m = reach.end >= 950 ? `${(reach.end / 1000).toFixed(1).replace('.', ',')} km` : `${Math.max(10, Math.round(reach.end / 10) * 10)} m`;
  if (reach.open) return { m: `ít nhất ${m}`, to: 'chưa thấy giao lộ nào phía trước' };
  if (reach.why === 'sign') return { m, to: 'đến biển bạn báo kế tiếp' };
  if (reach.why === 'mark') return { m, to: 'đến chỗ bạn báo đã hết biển' };
  const name = reach.cross && reach.cross.name;
  return { m, to: name ? `đến giao lộ ${esc(name)}` : 'đến giao lộ kế tiếp' };
}

function tierOf(limit) {
  if (!limit || limit.max == null) return { text: 'Chưa rõ', cls: '' };
  if (limit.tier === 'nguoi_bao') return { text: 'Bạn báo', cls: 'rep' };
  return limit.tier === 'bien_bao' ? { text: 'Biển báo', cls: 'sign-tier' } : { text: 'Theo luật', cls: 'law' };
}

function reasonLine(r) {
  if (r.taught) return 'Biển bạn đã báo ở đây lần trước';
  if (r.shown && r.shown.tier === 'bien_bao') return 'Biển này có trên bản đồ OpenStreetMap';
  const f = r.facts || {};
  const zone = r.zone ? `${r.zone.inside ? 'trong' : 'ngoài'} khu đông dân cư (${CONF[r.zone.confidence] || 'chưa rõ'})` : 'chưa rõ khu dân cư';
  const shape = f.expressway ? 'cao tốc' : f.divided === true ? 'đường đôi' : f.oneway ? 'một chiều' : 'hai chiều';
  return `Đoán ${zone} · ${shape}`;
}

const wide = (f) => f.divided === true || (f.oneway === true && f.lanes >= 2);

function caption(r, cause) {
  if (cause === 'lag') return 'app đã tính ra';
  if (cause === 'ended') return 'nếu đã hết biển';
  if (cause === 'still') return 'nếu biển vẫn còn';
  if (cause === 'mapsign') return 'nếu biển đã bị gỡ';
  if (cause === 'zone') return r.facts.inside ? 'nếu ngoài khu dân cư' : 'nếu trong khu dân cư';
  return wide(r.facts) ? 'nếu không phải đường đôi' : 'nếu là đường đôi';
}

function fact(label, value, n, ok, strike = !ok) {
  return `<div class="fact ${ok ? 'ok' : 'no'} ${strike ? 'strike' : ''}"><span class="f-l">${label}</span><span class="f-v">${esc(value)}</span><span class="f-n">${n != null ? `<span class="mini-sign">${n}</span>` : ''}${ok ? CHECK : ''}</span></div>`;
}

// What the app will do differently from the next drive, when the answer taught it a sign:
// the stretch drawn on the map, in words. Until the sign is dragged to where it stood, the
// phone takes it to stand where Sai was tapped, a little past the real one.
function learnedHtml(r, ex, reach) {
  if (typeof ex.max !== 'number' || ['lag', 'same', 'ended', 'still'].includes(ex.cause)) return '';
  const w = reach ? reachWords(reach) : null;
  const where = w ? `trên đoạn tô tím: <b>${w.m}</b>, ${w.to}` : 'từ chỗ biển đứng đến giao lộ kế tiếp';
  const late = reach && !r.signAt ? '<small>Tính từ chỗ bạn bấm. Kéo biển về đúng chỗ nó đứng để app báo sớm hơn.</small>' : '';
  return `<div class="learned"><span class="mini-sign">${ex.max}</span><span>Lần sau qua đây, app sẽ báo <b>${ex.max}</b> ${where}.${late}</span></div>`;
}

// The explanation, in the driver's terms: which fact was wrong, what the answer taught,
// and what, if anything, the driver can still add.
function whyHtml(r, ex, stretches, reach) {
  return whyBody(r, ex, stretches) + learnedHtml(r, ex, reach);
}

function whyBody(r, ex, stretches) {
  const s = r.shown && r.shown.max, a = ex.max, inside = r.facts.inside;
  const similar = stretches.length
    ? `<button type="button" class="similar">${FORK}<span>Quy tắc này còn dùng ở <b>${stretches.length} chỗ khác</b> trong chuyến</span><span class="go">Xem</span></button>`
    : '';
  const boundary = `<div class="boundary" ${r.placed ? '' : 'hidden'}>${CHECK.replace('class="check"', '')}Đã đánh dấu chỗ biển đứng</div>`;
  switch (ex.cause) {
    case 'zone':
      return `<h4>Có vẻ đoạn này nằm ${inside ? 'ngoài' : 'trong'} khu đông dân cư</h4>
        <div class="facts">${fact('App đoán', `${inside ? 'Trong' : 'Ngoài'} khu dân cư`, s, false)}${fact('Nếu', `${inside ? 'Ngoài' : 'Trong'} khu dân cư`, a, true)}</div>
        <p>Bản đồ không có ranh giới khu dân cư. Kéo biển trên bản đồ đến đúng chỗ nó đứng — đó chính là ranh giới.</p>${boundary}${similar}`;
    case 'column':
      return `<h4>${wide(r.facts) ? 'Có vẻ đây không phải đường đôi' : 'Có vẻ đây là đường đôi — bản đồ thiếu dải phân cách'}</h4>
        <div class="facts">${fact('Bản đồ', wide(r.facts) ? 'Đường đôi' : 'Hai chiều, không dải phân cách', s, false)}${fact('Nếu', wide(r.facts) ? 'Hai chiều' : 'Là đường đôi', a, true)}</div>
        <p>Lỗi nằm ở dữ liệu bản đồ, không phải ở luật. Sửa thẳng trên OpenStreetMap được, và mọi ứng dụng dùng bản đồ đó đều được lợi.</p>${similar}`;
    case 'lag':
      return `<h4>App đã tính đúng — chỉ đổi số chậm</h4>
        <div class="facts">${fact('App tính', 'Ngay khi vào đoạn này', a, true)}${fact('Vẫn hiện', 'Chờ thêm cho chắc rồi mới tăng', s, false, false)}</div>
        <p>Không phải lỗi bản đồ. Số giảm hiện ngay, số tăng phải chờ một đoạn để khỏi đọc sai rồi rút lại — ở đây có lẽ chờ hơi lâu.</p>`;
    case 'mapsign':
      return `<h4>Biển trên bản đồ có vẻ đã cũ</h4>
        <div class="facts">${fact('Bản đồ', 'Có biển ở đây', s, false)}${fact('Luật', 'Khi không có biển', a, true)}</div>
        <p>Biển ${s} trên bản đồ có lẽ đã bị gỡ hoặc thay. Sửa được trên OpenStreetMap.</p>`;
    case 'sign':
      return `<h4>Có biển ${a} ở đây mà bản đồ chưa có</h4>
        <p>Không quy tắc nào của luật ra ${a}, nên đây là biển riêng ghi đè luật. Kéo biển trên bản đồ đến đúng chỗ nó đứng.</p>${boundary}`;
    case 'gone':
      return `<h4>Biển ${s} bạn báo có vẻ không còn ở đây</h4>
        <p>App sẽ thôi báo ${s} ở chỗ này và dùng lại số theo luật.</p>`;
    case 'ended':
      return `<h4>Biển ${s} đã hết hiệu lực trước chỗ này</h4>
        <div class="facts">${fact('App giữ', 'Biển bạn báo', s, false)}${fact('Ở đây', a != null ? 'Theo luật' : 'Không có biển', a ?? null, true)}</div>
        <p>Lần sau app sẽ thôi báo ${s} trước chỗ này. Nếu nhớ chỗ có biển hết hạn chế, kéo biển trên bản đồ đến đó.</p>${boundary}`;
    case 'still':
      return `<h4>Biển ${a} còn hiệu lực xa hơn app nghĩ</h4>
        <div class="facts">${fact('App', 'Thôi báo ở giao lộ trước', s, false)}${fact('Ở đây', 'Vẫn là biển bạn báo', a, true)}</div>
        <p>Lần sau app sẽ giữ ${a} qua chỗ này, đến giao lộ kế tiếp.</p>`;
    case 'same':
      return `<h4>Biển ghi đúng số app nói</h4>
        <p>Có thể bấm nhầm — hoặc app đổi số sai chỗ. Nếu nhớ biển đứng đâu, kéo biển trên bản đồ đến đó.</p>`;
    case 'none':
      return `<h4>Không có biển — app dùng luật</h4>
        <p>Không có biển thì số theo luật là số đúng, miễn app đoán đúng loại đường. Đã ghi để kiểm tra lại cách đoán ở đây.</p>`;
    default:
      return `<h4>Không sao</h4>
        <p>Xem Street View ở đúng chỗ này, nhìn theo hướng xe đang đi — biển thường đứng bên phải.</p>`;
  }
}

// ---------- the review ----------

// pieces(lon, lat) -> Promise of the mapped roads around a point
// trace(tripId)    -> that trip's trace, or null once it has been let go
// save(report)     -> persist one report
// discard(report)  -> forget a report tapped by mistake, and anything its answer taught
// reach(sign, pieces, vehicle) -> learn.js reachOf for a sign the answer would teach
// share(reports)   -> send the answers; resolves true once they have gone
// close()          -> the review is finished with
export function makeReview({ spring, pieces, trace, save, discard, reach, share, close, remember }) {
  const root = $('review'), track = $('rvTrack'), deck = $('rvDeck'), dots = $('rvDots'), done = $('rvDone');
  let list = [], idx = 0, cards = [];

  $('rvClose').onclick = () => finish();

  async function open(reports) {
    list = reports;
    idx = 0;
    root.hidden = false;
    root.scrollTop = 0;
    done.hidden = true;
    deck.hidden = false;
    dots.hidden = list.length < 2;
    $('rvClose').textContent = 'Để sau';
    $('rvTitle').textContent = 'Xem lại chuyến đi';
    subtitle();
    track.innerHTML = '';
    // Reports from before this version carry no road facts; the tiles still have them.
    await Promise.all(list.map(async (r) => {
      if (r.facts) return;
      const around = await pieces(r.lon, r.lat);
      const piece = around.find((p) => p.id === r.way);
      const f = piece ? roadFacts(piece) : { expressway: false, divided: null, oneway: false, lanes: null };
      r.facts = { expressway: f.expressway, divided: f.divided, oneway: f.oneway, lanes: f.lanes, inside: r.zone ? r.zone.inside : true };
    }));
    cards = list.map((r, i) => card(r, i));
    track.replaceChildren(...cards.map((c) => c.el));
    go(0, false);
  }

  function subtitle() {
    const newest = list.reduce((a, r) => (Date.parse(r.t) > Date.parse(a.t) ? r : a), list[0]);
    $('rvSub').textContent = `${list.length} chỗ bạn bấm Sai · ${whenLabel(newest.t, Date.now())}`;
  }

  // A Sai tapped by mistake: its card falls away and the next one takes its place.
  function drop(k) {
    const c = cards[k];
    c.stop();
    discard(list[k]);
    c.el.style.pointerEvents = 'none';
    c.el.animate([
      { transform: 'scale(1)', opacity: 1 },
      { transform: 'scale(0.9) translateY(28px)', opacity: 0 },
    ], { duration: 300, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' }).onfinish = () => {
      const w = step();
      c.el.remove();
      cards.splice(k, 1);
      list.splice(k, 1);
      if (!cards.length) { finish(); return; }
      subtitle();
      dots.hidden = list.length < 2;
      cards.forEach((x) => x.label());
      // The card behind slides over from where it stood, rather than appearing in place.
      if (k < cards.length) { track.style.transition = 'none'; track.style.transform = `translateX(${-k * w + w}px)`; void track.offsetWidth; }
      go(Math.min(k, cards.length - 1));
    };
  }

  function finish() {
    for (const c of cards) c.stop();
    closeSheet();
    root.hidden = true;
    close();
  }

  // ---------- moving between cards ----------

  const step = () => (cards[0] ? cards[0].el.offsetWidth + parseFloat(getComputedStyle(deck).getPropertyValue('--gap')) : 0);
  const place = (dx = 0, animate = true) => {
    track.style.transition = animate ? `transform 0.55s ${spring}` : 'none';
    track.style.transform = `translateX(${-idx * step() + dx}px)`;
  };

  function go(i, animate = true) {
    idx = Math.max(0, Math.min(cards.length - 1, i));
    cards.forEach((c, k) => {
      c.el.classList.toggle('on', k === idx);
      if (Math.abs(k - idx) <= 1) c.draw();
    });
    place(0, animate);
    renderDots();
    cards[idx].enter();
  }

  function renderDots() {
    dots.innerHTML = list.map((r, i) => `<button type="button" aria-label="Chỗ ${i + 1}" class="${i === idx ? 'on' : ''} ${r.answer != null && r.answer !== 'unsure' ? 'answered' : ''}"><i></i></button>`).join('');
  }
  dots.onclick = (e) => {
    const b = e.target.closest('button');
    if (b) go([...dots.children].indexOf(b));
  };

  // A swipe that starts on the map's sign, or on a control, belongs to that instead.
  let sx = 0, sy = 0, dx = 0, id = null, sliding = false;
  deck.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, a, .map-sign')) return;
    id = e.pointerId; sx = e.clientX; sy = e.clientY; dx = 0; sliding = false;
  });
  deck.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const mx = e.clientX - sx, my = e.clientY - sy;
    if (!sliding) {
      if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.3) { sliding = true; deck.setPointerCapture(id); }
      else if (Math.abs(my) > 10) { id = null; return; }
      else return;
    }
    // Past the first or last card the deck resists, the way iOS lists do.
    const edge = (idx === 0 && mx > 0) || (idx === cards.length - 1 && mx < 0);
    dx = edge ? mx / 3 : mx;
    place(dx, false);
  });
  const release = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    if (!sliding) return;
    if (Math.abs(dx) > 60) go(idx + (dx < 0 ? 1 : -1));
    else place(0);
  };
  deck.addEventListener('pointerup', release);
  deck.addEventListener('pointercancel', release);
  // A tap on the edge of a neighbouring card brings it forward.
  deck.addEventListener('click', (e) => {
    const el = e.target.closest('.rcard');
    const k = cards.findIndex((c) => c.el === el);
    if (k >= 0 && k !== idx) { e.preventDefault(); e.stopPropagation(); go(k); }
  }, true);

  // Shown once, ever: the first card slides aside to show there is another behind it.
  function nudge() {
    if (cards.length < 2 || remember.get('swipeHint')) return;
    remember.set('swipeHint', true);
    const base = -idx * step();
    track.style.transition = 'none';
    track.animate([
      { transform: `translateX(${base}px)` },
      { transform: `translateX(${base - 56}px)`, offset: 0.35 },
      { transform: `translateX(${base}px)` },
    ], { duration: 1100, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)' });
  }

  // After an answer, the next card leans in: that is where to go now.
  function beckon() {
    const next = cards[idx + 1];
    if (!next) return;
    next.el.animate([
      { transform: 'scale(0.96)' },
      { transform: 'scale(0.96) translateX(-14px)', offset: 0.4 },
      { transform: 'scale(0.96)' },
    ], { duration: 800, delay: 450, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)' });
  }

  // ---------- one card ----------

  function card(r, i) {
    const shown = r.shown || { max: null };
    const sugg = suggestions(asked(r), limitFor).slice(0, 2);
    const base = r.facts.expressway ? [60, 80, 90, 100, 110, 120] : [30, 40, 50, 60, 70, 80, 90];
    const rest = base.filter((n) => n !== shown.max && !sugg.some((s) => s.max === n));
    const tier = tierOf(shown);
    const today = whenLabel(r.t, Date.now());
    const sv = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${r.lat},${r.lon}${r.heading != null ? `&heading=${r.heading}` : ''}`;
    const el = document.createElement('article');
    el.className = 'rcard';
    el.innerHTML = `
      <div class="rc-map"><div class="loading">Đang tải bản đồ…</div></div>
      <div class="rc-body">
        <div class="rc-road"><b>${esc(r.road || 'Đường không tên')}</b><span>${esc([r.ward, `${today} · ${hhmm(r.t)}`, r.kmh != null ? `${r.kmh} km/h` : null].filter(Boolean).join(' · '))}</span></div>
        <div class="rc-rows">
          <div class="rc-row"><span class="mini-sign ${shown.max == null ? 'unknown' : ''}">${shown.max ?? '–'}</span><div><b>${shown.max == null ? 'App chưa có số' : `App nói ${shown.max}`}</b><small>${esc(reasonLine(r))}</small></div><span class="tier ${tier.cls}">${tier.text}</span></div>
          <div class="rc-row rc-yours" hidden><span class="mini-sign"></span><div><b></b><small>Chờ chuyến khác xác nhận</small></div><span class="tier rep">Bạn báo</span></div>
        </div>
        <h3 class="rc-q">Biển ghi bao nhiêu?</h3>
        <div class="picker">
          <div class="pk-top">${sugg.map((s) => `<button type="button" class="pick" data-a="${s.max}"><span class="mini-sign">${s.max}</span><small>${caption(r, s.cause)}</small></button>`).join('')}</div>
          <div class="pk-rest">${rest.map((n) => `<button type="button" class="pick" data-a="${n}"><span class="mini-sign">${n}</span></button>`).join('')}</div>
          <div class="pk-text"><button type="button" data-a="none">Không có biển</button><button type="button" data-a="unsure">Không nhớ</button></div>
          <button type="button" class="mistap">${BIN}Bấm nhầm, bỏ chỗ này</button>
        </div>
        <div class="why" hidden></div>
        <div class="rc-actions">
          <a class="ghost" href="${sv}" target="_blank" rel="noopener">${PERSON}Street View</a>
          <button type="button" class="primary next">Bỏ qua</button>
        </div>
      </div>`;

    const map = el.querySelector('.rc-map'), picker = el.querySelector('.picker'), why = el.querySelector('.why');
    const yours = el.querySelector('.rc-yours'), next = el.querySelector('.next'), ghost = el.querySelector('.ghost');
    let m = null, raf = 0, replaying = false, drawn = false, played = false;
    const last = () => list.indexOf(r) === list.length - 1;

    function label() {
      const answered = r.answer != null;
      next.innerHTML = last() ? (answered ? 'Xong' : 'Bỏ qua') : `${answered ? 'Tiếp' : 'Bỏ qua'}${ARROW}`;
    }
    label();

    // The map needs the tiles, so it is drawn when the card is about to be seen.
    async function draw() {
      if (drawn) return;
      drawn = true;
      const around = await pieces(r.lon, r.lat);
      const route = (r.window && r.window.length ? r.window : []).map((w) => [w.lon, w.lat]);
      route.push([r.lon, r.lat]);
      const clean = route.filter((p, k) => k === 0 || p[0] !== route[k - 1][0] || p[1] !== route[k - 1][1]);
      const proj = projector(clean);
      const g = measure(clean.map(proj.to));
      const moving = g.len > 6;
      // The svg and what stands on it share a frame, so the map can pull back to take in a
      // taught stretch without the sign and the tap marker coming adrift of their roads.
      map.innerHTML = `
        <div class="rc-frame">
          <svg viewBox="0 0 ${W} ${H}" aria-hidden="true">
            <rect x="-${W}" y="-${H}" width="${3 * W}" height="${3 * H}" fill="var(--map-bg)"/>
            <g class="roads">${roadsSvg(around, proj)}</g>
            <polyline class="trail" fill="none" stroke="var(--map-trail)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
            <polyline class="stretch ${tier.cls === 'sign-tier' ? 'sign' : tier.cls === 'rep' ? 'rep' : 'law'}" fill="none" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
            <g class="reaches"></g>
            <g class="car"><circle r="9" fill="rgba(0,0,0,0.12)" cy="1.5"/><circle r="7.5" fill="#fff"/><circle r="5.2" fill="var(--blue)"/></g>
          </svg>
          <div class="rc-tap"><i></i><span>Bạn bấm</span></div>
          <div class="map-sign" hidden><div class="stand"><span class="base"></span><span class="pole"></span>
            <div class="flip"><div class="face front ${shown.max == null ? 'unknown' : ''}">${shown.max ?? '–'}</div><div class="face back"></div></div><span class="hit"></span></div></div>
        </div>
        <button type="button" class="map-pill rc-time"></button>
        <div class="map-pill rc-dist" hidden></div>`;
      const svg = map.querySelector('svg');
      m = {
        g, proj, moving, svg, route: clean, around, carF: moving ? 0 : 1, reach: null,
        frame: map.querySelector('.rc-frame'), roads: svg.querySelector('.roads'), reaches: svg.querySelector('.reaches'),
        trail: svg.querySelector('.trail'), stretch: svg.querySelector('.stretch'), car: svg.querySelector('.car'),
        sign: map.querySelector('.map-sign'), flip: map.querySelector('.flip'), tap: map.querySelector('.rc-tap'),
        front: map.querySelector('.front'), back: map.querySelector('.back'),
        time: map.querySelector('.rc-time'), dist: map.querySelector('.rc-dist'),
        change: moving && r.window && r.window.length ? Math.min(0.98, (g.cum[r.changeAt || 0] || 0) / g.len) : 1,
        secs: r.window && r.window.length ? Math.round((Date.parse(r.t) - r.window[0].t) / 1000) : 0,
      };
      if (r.signFrac == null) r.signFrac = m.change;
      placeTap();
      m.time.onclick = replay;
      wireDrag();
      setCar(moving ? 0 : 1);
      if (el.classList.contains('on')) enter();
    }

    // Signs stand on the right shoulder, the side a Vietnamese driver looks to.
    function placeSign(f) {
      const p = pointAt(m.g, f);
      Object.assign(m.sign.style, { left: pct(p.x - p.dy * 10, W), top: pct(p.y + p.dx * 10, H) });
    }
    function setStretch(f0, f1) { m.stretch.setAttribute('points', m.reach ? '' : slice(m.g, f0, f1)); }
    function placeTap() {
      const tap = pointAt(m.g, 1);
      Object.assign(m.tap.style, { left: pct(tap.x, W), top: pct(tap.y, H) });
    }
    function setCar(f) {
      m.carF = f;
      const p = pointAt(m.g, f);
      m.car.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
      m.trail.setAttribute('points', slice(m.g, 0, f));
    }
    const metresBack = (f) => ((1 - f) * m.g.len) / m.proj.s;
    function showDist() {
      const d = Math.round(metresBack(r.signFrac) / 10) * 10;
      m.dist.hidden = false;
      m.dist.textContent = d < 15 ? 'Ngay chỗ bạn bấm' : `Biển trước chỗ bấm ${d} m`;
    }
    function settle() {
      placeSign(r.signFrac);
      m.sign.hidden = false;
      setStretch(r.signFrac, 1);
      m.time.innerHTML = m.moving ? `${REPLAY} Lúc bấm${r.kmh != null ? ` · ${r.kmh} km/h` : ''}` : `Lúc bấm${r.kmh != null ? ` · ${r.kmh} km/h` : ''}`;
      if (r.placed) showDist();
      if (r.answer != null) apply(r.answer, false);
    }

    // ---------- the taught stretch ----------

    // The sign the answer teaches, as the phone will keep it, and where it will hold.
    function reachNow() {
      if (!m || typeof r.answer !== 'number') return null;
      const l = lessonFrom(r);
      if (!l || l.kind !== 'sign') return null;
      return reach({ id: r.id, at: l.at, heading: l.heading, max: l.max, marks: [] }, m.around, r.vehicle);
    }

    // Frame the map on the trail and the stretch together. Animated, the new framing starts
    // out drawn as the old one and eases back, so the map pulls back rather than jumping.
    function frame(x, animate) {
      const pts = x ? reachPts(x) : [];
      const proj = projector([...m.route, ...pts]);
      const was = m.proj;
      const k = was.s / proj.s;
      const tx = ((proj.c[0] - was.c[0]) * was.m.x * was.s) / W * 100;
      const ty = (-(proj.c[1] - was.c[1]) * was.m.y * was.s) / H * 100;
      const moved = Math.abs(k - 1) > 0.02 || Math.hypot(tx, ty) > 1;
      if (moved) {
        m.proj = proj;
        m.g = measure(m.route.map(proj.to));
        m.roads.innerHTML = roadsSvg(m.around, proj);
        placeTap();
        setCar(m.carF);
        placeSign(r.signFrac);
        if (animate) {
          // Eased out, not sprung: a map that zooms past where it stops and back reads as a
          // bounce. What stands on the map keeps its size, as pins do in the map apps.
          const how = { duration: 800, easing: 'cubic-bezier(0.25, 0.8, 0.25, 1)' };
          m.frame.animate([{ transform: `translate(${tx}%, ${ty}%) scale(${k})` }, { transform: 'none' }], how);
          m.tap.animate([{ transform: `translate(-50%, -50%) scale(${1 / k})` }, { transform: 'translate(-50%, -50%)' }], how);
          m.sign.animate([{ transform: `scale(${1 / k})` }, { transform: 'none' }], how);
        }
      }
      m.reach = x;
      m.reaches.innerHTML = x ? reachSvg(pts.map(m.proj.to), x.open) : '';
      m.reaches.classList.toggle('draw', !!(x && animate));
      setStretch(r.signFrac, 1);
    }

    // The seconds before the tap, replayed: the car drives up to where the button was
    // pressed, and the app's number stands up where the app switched to it.
    function replay() {
      if (!m || !m.moving) return;
      cancelAnimationFrame(raf);
      replaying = true;
      m.sign.hidden = true;
      setStretch(0, 0);
      const t0 = performance.now(), D = 2600;
      const tick = (now) => {
        const u = Math.min(1, (now - t0) / D), f = ease(u);
        setCar(f);
        if (f >= m.change) {
          if (m.sign.hidden) {
            placeSign(m.change);
            m.sign.hidden = false;
            m.sign.classList.remove('pop'); void m.sign.offsetWidth; m.sign.classList.add('pop');
          }
          setStretch(m.change, f);
        }
        m.time.textContent = `−${Math.round(m.secs * (1 - f))} s${r.kmh != null ? ` · ${r.kmh} km/h` : ''}`;
        if (u < 1) { raf = requestAnimationFrame(tick); return; }
        replaying = false;
        settle();
        if (i === 0) nudge();
      };
      raf = requestAnimationFrame(tick);
    }

    function enter() {
      if (!m) return;
      if (!played && m.moving) { played = true; replay(); } else settle();
    }

    function apply(a, animate = true) {
      r.answer = a;
      const ex = explain(asked(r), a, limitFor);
      r.cause = ex.cause;
      picker.classList.add('chosen');
      picker.querySelectorAll('[data-a]').forEach((b) => b.classList.toggle('on', b.dataset.a === String(a)));

      // The sign on the map turns over to the driver's number, or back to the app's.
      if (m) {
        const text = a === 'none' ? '–' : String(a === 'unsure' ? (shown.max ?? '–') : a);
        const face = m.flip.classList.contains('over') ? m.back : m.front;
        if (face.textContent !== text) {
          const other = face === m.back ? m.front : m.back;
          other.textContent = text;
          other.classList.toggle('unknown', a === 'none' || (a === 'unsure' && shown.max == null));
          m.flip.classList.toggle('over', other === m.back);
        }
        m.stretch.classList.toggle('rep', typeof a === 'number');
        m.stretch.classList.toggle('none', a === 'none');
      }
      const x = reachNow();
      if (m && !replaying && (x || m.reach)) frame(x, animate);
      if (typeof a === 'number') {
        yours.hidden = false;
        yours.querySelector('.mini-sign').textContent = a;
        yours.querySelector('b').textContent = `Biển ghi ${a}`;
      } else yours.hidden = true;

      const tr = trace(r.trip);
      const stretches = tr ? similarStretches(tr, r, ex.cause) : [];
      why.innerHTML = whyHtml(r, ex, stretches, x);
      why.hidden = false;
      if (animate) { why.style.animation = 'none'; void why.offsetWidth; why.style.animation = ''; }
      const sim = why.querySelector('.similar');
      if (sim) sim.onclick = () => openSheet(r, a, stretches);
      ghost.classList.toggle('hint', a === 'unsure');
      label();
      renderDots();
      if (animate) {
        r.reviewedAt = new Date().toISOString();
        save(r);
        beckon();
      }
    }

    picker.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b || replaying) return;
      apply(b.dataset.a === 'none' || b.dataset.a === 'unsure' ? b.dataset.a : +b.dataset.a);
    });

    // Dragging the sign along the road: where it really stands is the one fact the map
    // can never supply, and for a zone answer it is the boundary itself.
    function wireDrag() {
      if (!m.moving) return;
      let drag = null;
      m.sign.addEventListener('pointerdown', (e) => {
        if (replaying) return;
        drag = e.pointerId;
        m.sign.setPointerCapture(drag);
        m.sign.classList.add('lift');
        e.preventDefault();
      });
      m.sign.addEventListener('pointermove', (e) => {
        if (e.pointerId !== drag) return;
        const b = m.svg.getBoundingClientRect();
        // The finger holds the sign, which stands above the road; aim at its foot.
        const x = ((e.clientX - b.left) / b.width) * W, y = ((e.clientY - b.top) / b.height) * H + 34 * (H / b.height);
        r.signFrac = Math.max(0.02, Math.min(1, nearest(m.g, x, y)));
        r.placed = true;
        placeSign(r.signFrac);
        setStretch(r.signFrac, 1);
        showDist();
        // The taught stretch follows the sign as it is dragged: where it stands is where
        // the phone will start saying its number.
        if (m.reach) {
          const p = pointAt(m.g, r.signFrac), [lon, lat] = m.proj.from(p.x, p.y);
          const kept = r.signAt;
          r.signAt = { lon, lat };
          const nx = reachNow();
          r.signAt = kept;
          if (nx) { m.reach = nx; m.reaches.classList.remove('draw'); m.reaches.innerHTML = reachSvg(reachPts(nx).map(m.proj.to), nx.open); }
        }
      });
      const drop = (e) => {
        if (e.pointerId !== drag) return;
        drag = null;
        m.sign.classList.remove('lift');
        const p = pointAt(m.g, r.signFrac);
        const [lon, lat] = m.proj.from(p.x, p.y);
        r.signAt = { lon: +lon.toFixed(6), lat: +lat.toFixed(6), behindTapM: Math.round(metresBack(r.signFrac)) };
        save(r);
        const mark = why.querySelector('.boundary');
        if (mark) mark.hidden = false;
        if (m.reach) {
          const x = reachNow();
          frame(x, true);
          const old = why.querySelector('.learned');
          if (old && x) old.outerHTML = learnedHtml(r, explain(asked(r), r.answer, limitFor), x);
        }
      };
      m.sign.addEventListener('pointerup', drop);
      m.sign.addEventListener('pointercancel', drop);
    }

    next.onclick = () => (last() ? summary() : go(idx + 1));
    el.querySelector('.mistap').onclick = () => { if (!replaying) drop(list.indexOf(r)); };

    return { el, draw, label, enter: () => (drawn ? enter() : draw()), stop: () => cancelAnimationFrame(raf) };
  }

  // ---------- same rule, same trip ----------

  function openSheet(r, n, stretches) {
    const rows = $('qsRows');
    const said = (s) => ((r.similar || []).find((x) => x.t === s.t) || {}).answer;
    $('qsLede').textContent = typeof n === 'number'
      ? `App cũng dùng quy tắc này ở những chỗ dưới đây, và cũng nói ${r.shown.max}. Biển ở đó có ghi ${n} không?`
      : `App cũng dùng quy tắc này ở những chỗ dưới đây, và cũng nói ${r.shown.max}. Ở đó có biển không?`;
    rows.innerHTML = stretches.map((s, k) => {
      const v = said(s);
      const yes = typeof n === 'number' ? `<span class="mini-sign">${n}</span>` : 'Có';
      return `<div class="qs-row" data-k="${k}"><div><b>${esc(s.road || 'Đường không tên')}</b><small>${esc([s.ward, hhmm(s.t)].filter(Boolean).join(' · '))}</small></div>
        <div class="qs-seg"><button type="button" data-v="yes" class="${v === 'yes' ? 'on' : ''}">${yes}</button><button type="button" data-v="no" class="${v === 'no' ? 'on' : ''}">Không</button><button type="button" data-v="unsure" class="${v === 'unsure' ? 'on' : ''}">?</button></div></div>`;
    }).join('');
    rows.onclick = (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      const row = b.closest('.qs-row');
      row.querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('on', x === b));
      const s = stretches[+row.dataset.k];
      r.similar = (r.similar || []).filter((x) => x.t !== s.t);
      r.similar.push({ t: s.t, lat: s.lat, lon: s.lon, road: s.road, ward: s.ward, answer: b.dataset.v, as: n });
      save(r);
    };
    $('qs').classList.add('open');
    $('qsScrim').classList.add('open');
  }
  function closeSheet() { $('qs').classList.remove('open'); $('qsScrim').classList.remove('open'); }
  $('qsDone').onclick = closeSheet;
  $('qsScrim').onclick = closeSheet;

  // ---------- summary ----------

  function summary() {
    for (const c of cards) c.stop();
    deck.hidden = true;
    dots.hidden = true;
    $('rvTitle').textContent = '';
    $('rvSub').textContent = '';
    $('rvClose').textContent = 'Xong';
    const answered = list.filter((r) => r.answer != null && r.answer !== 'unsure').length;
    const similar = list.reduce((n, r) => n + (r.similar || []).filter((s) => s.answer !== 'unsure').length, 0);
    const bounds = list.filter((r) => r.placed && (r.cause === 'zone' || r.cause === 'sign')).length;
    const first = list[list.length - 1];
    const tr = trace(first.trip);
    const pts = tr ? tr.filter((e) => e.type === 'trace' && e.lat != null).map((e) => [e.lon, e.lat]) : [];
    const km = tr ? distance(tr) / 1000 : null;
    const total = answered + similar;
    let map = '';
    if (pts.length > 1) {
      const proj = projector([...pts, ...list.map((r) => [r.lon, r.lat])], W, 190, 30, 400);
      const line = poly(pts.map(proj.to));
      const marks = list.map((r, k) => {
        const [x, y] = proj.to([r.lon, r.lat]);
        const inner = typeof r.answer === 'number' ? `<span class="mini-sign">${r.answer}</span>`
          : r.answer === 'none' ? '<span class="mini-sign unknown">–</span>' : '<span class="q">?</span>';
        return `<div class="trip-mark" style="left:${pct(x, W)};top:${pct(y, 190)};animation-delay:${0.4 + k * 0.15}s">${inner}</div>`;
      }).join('');
      map = `<div class="trip"><div class="rc-map"><svg viewBox="0 0 ${W} 190" aria-hidden="true">
        <rect width="${W}" height="190" fill="var(--map-bg)"/>
        <polyline points="${line}" fill="none" stroke="var(--map-edge)" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
        <polyline points="${line}" fill="none" stroke="var(--blue)" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" style="animation: draw 1.1s cubic-bezier(0.4,0,0.2,1) 0.1s forwards"/>
      </svg>${marks}</div></div>`;
    }
    done.innerHTML = `
      <div class="done-hero">
        <div class="done-check"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="26"/><path d="M15 27l7.5 7.5L38 19"/></svg></div>
        <h2>Xem xong</h2>
        <p>${esc(whenLabel(first.t, Date.now()))} · ${hhmm(first.t)}</p>
        ${total ? `<p class="thanks">Cảm ơn! ${total} chỗ đã có câu trả lời.</p>` : ''}
      </div>
      ${map}
      <div class="stats">
        ${km != null ? `<div class="stat" style="animation-delay:.05s"><b data-n="${km.toFixed(1)}" data-d="1">0<small>km</small></b><span>Quãng đường</span></div>` : ''}
        <div class="stat" style="animation-delay:.1s"><b data-n="${list.length}">0</b><span>Lần bấm Sai</span></div>
        <div class="stat rep" style="animation-delay:.15s"><b data-n="${answered}">0</b><span>Chỗ bạn đã trả lời</span></div>
        ${similar ? `<div class="stat rep" style="animation-delay:.2s"><b data-n="${similar}">0</b><span>Chỗ tương tự đã kiểm</span></div>` : ''}
      </div>
      ${bounds ? `<div class="found"><span class="found-icon">${PIN}</span><div><b>${bounds} chỗ biển đứng đã đánh dấu</b><small>Thứ bản đồ không có — giờ đã có vị trí thật của biển.</small></div></div>` : ''}
      <div class="honest"><span class="tier rep">Bạn báo</span><p>Câu trả lời được lưu ở mức <b>Bạn báo</b>. App chỉ đọc chúng như biển thật khi có chuyến khác đi qua và thấy cùng một số.</p></div>
      <button type="button" class="primary" id="rvShare">${UP}Gửi câu trả lời</button>
      <button type="button" class="link-btn" id="rvAgain">Xem lại từ đầu</button>`;
    done.hidden = false;
    root.scrollTo({ top: 0 });
    countUp();
    $('rvShare').onclick = async () => {
      if (await share(list)) $('rvShare').innerHTML = `${CHECK}Đã gửi`;
    };
    $('rvAgain').onclick = () => {
      done.hidden = true; deck.hidden = false; dots.hidden = list.length < 2;
      $('rvClose').textContent = 'Để sau';
      $('rvTitle').textContent = 'Xem lại chuyến đi';
      go(0);
    };
  }

  function countUp() {
    const t0 = performance.now(), D = 900;
    const nums = [...done.querySelectorAll('.stat b[data-n]')];
    const tick = (now) => {
      const u = Math.min(1, (now - t0 - 250) / D), e = u <= 0 ? 0 : 1 - Math.pow(1 - u, 3);
      for (const b of nums) b.firstChild.nodeValue = (+b.dataset.n * e).toFixed(+(b.dataset.d || 0)).replace('.', ',');
      if (u < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  return { open, close: finish, isOpen: () => !root.hidden };
}
