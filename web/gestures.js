// Fingers on the road view, turned into the few moves the renderer understands: one finger
// drags, two pinch, twist and drag together. Pointer events, so the same code serves
// touch on the phone and a mouse at a desk.
export function attachGestures(el, { pan, twist, touch }) {
  const fingers = new Map();
  const local = (e) => {
    const r = el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  el.addEventListener('pointerdown', (e) => {
    try { el.setPointerCapture(e.pointerId); } catch {}
    fingers.set(e.pointerId, local(e));
    if (touch) touch();
  });
  el.addEventListener('pointermove', (e) => {
    if (!fingers.has(e.pointerId)) return;
    const before = [...fingers.values()];
    fingers.set(e.pointerId, local(e));
    const after = [...fingers.values()];
    if (after.length === 1) pan(before[0], after[0]);
    else twist(before[0], before[1], after[0], after[1]);
  });
  const lift = (e) => fingers.delete(e.pointerId);
  el.addEventListener('pointerup', lift);
  el.addEventListener('pointercancel', lift);
}
