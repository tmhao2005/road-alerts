// Everything the app can say, as one closed set.
//
// It is closed on purpose. Six templates over two dozen numbers is about fifty sentences,
// few enough to record each one whole rather than splice a number onto a stock phrase.
// The splice is what gives a navigation voice away: Vietnamese puts a falling tone on the
// last syllable of a statement, and that tone only exists if the sentence was spoken as
// one. A value outside this set is still said by the phone's own voice - worse, but never
// silence.

// Multiples of five to 120. Statute stops at 90 (BANG_1 and BANG_2 in limit.js), but a
// sign on the map can carry anything and cao toc runs to 120.
export const LIMIT_STEPS = Array.from({ length: 24 }, (_, i) => (i + 1) * 5);

// Which delivery each line is rendered with. The label is the seam: what "sure" means in
// words is a property of whichever voice model renders it, so that prose lives in the
// render script, not here.
//
// This is priority 2 made audible instead of merely annotated. A limit read off a sign and
// a limit reasoned from the law must not arrive in the same confident cadence - prefixing
// "theo luat" does nothing if both are spoken identically.
export const FIXED = [
  { id: 'start',          text: 'Bắt đầu',                     voice: 'plain' },
  { id: 'start-demo',     text: 'Bắt đầu mô phỏng',            voice: 'plain' },
  { id: 'light',          text: 'Đèn giao thông phía trước',   voice: 'calm' },
  { id: 'light-crossing', text: 'Đèn qua đường phía trước',    voice: 'calm' },
  { id: 'over',           text: 'Quá tốc độ',                  voice: 'urgent' },
  // Over a limit worked out from the law rather than read off a sign: the same warning,
  // less sure of itself, because where the law is wrong about a road it is wrong on every
  // drive down it.
  { id: 'over-law',       text: 'Theo luật, quá tốc độ',       voice: 'caution' },
  // Well over, or still over after being told. Followed by the limit itself, since a
  // driver this far over has most likely missed it.
  { id: 'slow',           text: 'Giảm tốc độ',                 voice: 'urgent' },
  { id: 'logged',         text: 'Đã ghi nhận',                 voice: 'plain' },
];

// A signposted number. Stated flat, because it is not an inference - someone put a sign there.
export function signLine(max) {
  return { id: LIMIT_STEPS.includes(max) ? `sign-${max}` : null, text: `Tốc độ tối đa ${max}`, voice: 'sure' };
}

// A number derived from the circular with no sign to back it. "Theo luat" carries the
// hedge in the words; the delivery has to carry it too.
export function lawLine(max) {
  return { id: LIMIT_STEPS.includes(max) ? `law-${max}` : null, text: `Theo luật, ${max}`, voice: 'hedged' };
}

export function lightLine(crossing) {
  return FIXED.find((f) => f.id === (crossing ? 'light-crossing' : 'light'));
}

// The render script's worklist, and the app's preload list. Same order every run so a
// re-render only rewrites what changed.
export function allLines() {
  return [
    ...FIXED,
    ...LIMIT_STEPS.map(signLine),
    ...LIMIT_STEPS.map(lawLine),
  ];
}
