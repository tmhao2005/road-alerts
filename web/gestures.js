// Fingers on the road view, turned into the moves a map app makes. One finger drags, and a
// flick leaves the map gliding. Two pinch, turn and drag together, or tilt when they slide
// up or down side by side. A double tap zooms in, a two-finger tap zooms out, and a double
// tap held and dragged zooms with one finger: down to zoom in, as in Maps. Pointer events,
// so the same code serves touch on the phone and a mouse at a desk, where the wheel zooms.
//
// The fingers are read once a frame, not once per event: the browser reports each finger's
// move separately, and read in between, a quick two-finger slide looks like one finger
// moving and one standing still, which is a pinch, not a tilt.
import { readTwoFingers, twistOf, flick, TWIST } from './src/gesture.js';

const TAP_MS = 250, TAP_PX = 10;        // a touch this short and still is a tap
const DOUBLE_MS = 300, DOUBLE_PX = 40;  // a second tap this soon and this near is a double tap

export function attachGestures(el, h) {
  const fingers = new Map();
  // 'drag', 'double' (second tap down, not yet moved), 'zoom' (one-finger zoom), 'pinch',
  // 'tilt', or null while two fingers have not yet shown which they mean.
  let mode = null;
  let landed = null;   // this touch: when and where it began, and what happened to it
  let pair0 = null;    // the two fingers when the second one landed
  let twisting = false;
  let trail = [];
  let lastTap = null;
  let pinchOut = null; // a pinch's flick, kept while its second finger lifts
  const read = new Map(); // where each finger was when last read
  let frame = null;

  const local = (e) => {
    const r = el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const two = () => [...fingers.values()].slice(0, 2);
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const gap = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

  el.addEventListener('pointerdown', (e) => {
    try { el.setPointerCapture(e.pointerId); } catch {}
    readNow();
    const p = local(e), t = e.timeStamp;
    fingers.set(e.pointerId, p);
    read.set(e.pointerId, p);
    h.touch();
    if (fingers.size === 1) {
      const again = lastTap && t - lastTap.t < DOUBLE_MS && gap(p, lastTap.p) < DOUBLE_PX;
      mode = again ? 'double' : 'drag';
      landed = { t, p, moved: false, two: false };
      trail = [[t, ...p]];
      pinchOut = null;
    } else if (fingers.size === 2) {
      landed.two = true;
      pair0 = two();
      mode = null; twisting = false; trail = [];
    }
  });

  el.addEventListener('pointermove', (e) => {
    if (!fingers.has(e.pointerId)) return;
    const p = local(e);
    fingers.set(e.pointerId, p);
    if (fingers.size === 1) trail.push([e.timeStamp, ...p]);
    else if (fingers.size === 2) { const [a, b] = two(); trail.push([e.timeStamp, ...mid(a, b), gap(a, b)]); }
    if (frame == null) frame = requestAnimationFrame(readNow);
  });

  // Everything the fingers did since they were last read, as one move.
  function readNow() {
    if (frame != null) { cancelAnimationFrame(frame); frame = null; }
    const ids = [...fingers.keys()].slice(0, 2);
    const was = ids.map((id) => read.get(id)), now = ids.map((id) => fingers.get(id));
    for (const id of ids) read.set(id, fingers.get(id));
    if (!ids.length || now.every((p, i) => p[0] === was[i][0] && p[1] === was[i][1])) return;
    if (ids.length === 1) {
      const [a0] = was, [a] = now;
      if (!landed.moved && gap(a, landed.p) > TAP_PX) {
        landed.moved = true;
        if (mode === 'double') mode = 'zoom';
      }
      if (mode === 'zoom') h.pinch(landed.p, landed.p, Math.exp((a[1] - a0[1]) * 0.012), 0);
      else if (mode === 'drag') h.pan(a0, a);
      return;
    }
    const [a0, b0] = was, [a, b] = now;
    // Undecided, the fingers' first few pixels are held back; once decided, the whole
    // move since they landed is applied, so the map does not lag the fingers.
    let from = [a0, b0];
    if (mode === null) {
      mode = readTwoFingers(pair0[0], pair0[1], a, b);
      if (!mode) return;
      from = pair0;
    }
    if (mode === 'tilt') {
      h.tilt(-((a[1] - from[0][1]) + (b[1] - from[1][1])) * 0.15);
      return;
    }
    if (!twisting && Math.abs(twistOf(pair0[0], pair0[1], a, b)) > TWIST) twisting = true;
    const turn = twisting ? -twistOf(from[0], from[1], a, b) : 0;
    h.pinch(mid(...from), mid(a, b), gap(a, b) / gap(...from), turn);
  }

  el.addEventListener('pointerup', (e) => {
    if (!fingers.has(e.pointerId)) return;
    fingers.set(e.pointerId, local(e));
    readNow();
    const t = e.timeStamp;
    const pair = two();
    fingers.delete(e.pointerId);
    read.delete(e.pointerId);
    if (fingers.size === 1) {
      // One of two fingers lifted: the other drags on, unless it follows straight away,
      // which ends a pinch (with its flick) or a two-finger tap.
      landed.still = mode === null;
      if (mode === 'pinch') pinchOut = { t, at: mid(...pair), ...flick(trail, t) };
      mode = 'drag';
      landed.rest = two()[0];
      trail = [[t, ...landed.rest]];
      return;
    }
    if (fingers.size) return;
    const p = pair[0];
    if (landed.two) {
      if (landed.still && t - landed.t < TAP_MS * 1.5 && gap(p, landed.rest) < TAP_PX) h.zoomAt(mid(...pair0), 0.5);
      else if (pinchOut && t - pinchOut.t < 120) h.fling(pinchOut.v, pinchOut.zoom, pinchOut.at);
      else h.fling(flick(trail, t).v, 0, p);
      lastTap = null;
    } else if (mode === 'double') {
      if (!landed.moved) h.zoomAt(landed.p, 2);
      lastTap = null;
    } else if (mode === 'drag' && !landed.moved && t - landed.t < TAP_MS) {
      lastTap = { t, p: landed.p };
    } else if (mode === 'drag') {
      h.fling(flick(trail, t).v, 0, p);
      lastTap = null;
    }
    mode = null;
    h.end();
  });

  el.addEventListener('pointercancel', (e) => {
    fingers.delete(e.pointerId);
    read.delete(e.pointerId);
    if (fingers.size) return;
    mode = null;
    h.end();
  });

  // At a desk: the wheel, or a trackpad pinch, zooms about the pointer.
  let wheelDone = null;
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    h.touch();
    const p = local(e);
    h.pinch(p, p, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), 0);
    clearTimeout(wheelDone);
    wheelDone = setTimeout(() => h.end(), 150);
  }, { passive: false });
}
