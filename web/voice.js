// Plays the rendered lines, and falls back to the phone's own voice for anything not
// rendered. Kept apart from app.js because the timing here is the whole point.
//
// What made the old voice sound stitched together was not only the synthesiser. The chime
// ran on the AudioContext clock and the speech ran on the platform's TTS engine, joined by
// a setTimeout holding a guessed number of milliseconds - so the seam moved every time and
// was usually audible. Here both ends sit on the same clock, the voice starts just before
// the chime has finished decaying, and an interrupted line fades instead of being chopped
// off mid-syllable.
import { allLines } from './src/phrases.js';

const NOTE = 0.13;     // a chime note
const GAP = 0.04;      // between chime notes
const OVERLAP = 0.06;  // the voice starts this far into the chime's decay, so there is no dead air
const FADE = 0.08;     // an interrupted line rides down over this rather than clicking off

export function makeVoice(ac, base = 'voice') {
  const clips = new Map();
  let playing = null; // { gain, source, endsAt } on the AudioContext clock
  let phoneVoice = null;
  let manifest = null;
  let voice = null;

  // getVoices() is usually empty on the first call - the list arrives asynchronously. The
  // old code read it at speaking time and, finding nothing, let the utterance go to the
  // system default: an English voice reading Vietnamese, which is most of why the fallback
  // sounded wrong.
  if ('speechSynthesis' in window) {
    const pick = () => { phoneVoice = speechSynthesis.getVoices().find((v) => /^vi/i.test(v.lang)) || null; };
    pick();
    speechSynthesis.addEventListener('voiceschanged', pick);
  }

  // Fetched and decoded up front: the first announcement of a drive is the one a driver
  // notices, and it should not be the one that waits on a network request. Fetching here
  // is also what gets the set into the service worker's cache before the car leaves signal.
  //
  // Every rendered voice ships, but only the chosen one is ever fetched, so the others cost
  // repository size and nothing on a drive.
  async function preload(pick) {
    try {
      const res = await fetch(`${base}/manifest.json`);
      if (res.ok) manifest = await res.json();
    } catch {}
    if (!manifest) return 0;
    const format = manifest.format || 'm4a';
    let stored = null;
    try { stored = localStorage.getItem('voice'); } catch {}
    const names = (manifest.voices || []).map((v) => v.name);
    // A voice remembered from a render that no longer includes it would fetch nothing at
    // all and leave the drive on the phone's own voice.
    voice = pick || (names.includes(stored) ? stored : null) || manifest.default;
    clips.clear();
    const queue = allLines().map((l) => l.id);
    const failed = [];
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const id = queue.shift();
        try {
          const res = await fetch(`${base}/${voice}/${id}.${format}`);
          if (!res.ok) { failed.push(`${id}: http ${res.status}`); continue; }
          clips.set(id, await ac.decodeAudioData(await res.arrayBuffer()));
        } catch (e) { failed.push(`${id}: ${e.message || e}`); }
      }
    }));
    // A clip that does not load falls back to the phone's own voice, which sounds exactly
    // like the app never having had recordings at all - so a silent failure here is
    // indistinguishable from the bug it causes. Say so.
    console.log(`voice: ${clips.size}/${allLines().length} clips loaded (${voice}, ${format})`);
    if (failed.length) console.warn('voice: falling back to speechSynthesis for', failed.length, 'lines', failed.slice(0, 3));
    return clips.size;
  }

  async function setVoice(name) {
    try { localStorage.setItem('voice', name); } catch {}
    return preload(name);
  }

  function cut() {
    if (!playing) return;
    const now = ac.currentTime;
    playing.gain.gain.cancelScheduledValues(now);
    playing.gain.gain.setValueAtTime(playing.gain.gain.value, now);
    playing.gain.gain.linearRampToValueAtTime(0.0001, now + FADE);
    try { playing.source.stop(now + FADE + 0.02); } catch {}
    playing = null;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  function chime(freqs, t) {
    for (const f of freqs) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + NOTE);
      o.connect(g).connect(ac.destination);
      o.start(t);
      o.stop(t + NOTE + 0.02);
      t += NOTE + GAP;
    }
    return t - GAP;
  }

  function play(line, t) {
    const buf = line.id && clips.get(line.id);
    if (!buf) {
      // Not rendered, or the fetch failed. Worse, but a number the driver needs is worth
      // saying badly.
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(line.text);
      u.lang = 'vi-VN';
      if (phoneVoice) u.voice = phoneVoice;
      setTimeout(() => speechSynthesis.speak(u), Math.max(0, (t - ac.currentTime) * 1000));
      playing = null;
      return;
    }
    const source = ac.createBufferSource(), gain = ac.createGain();
    source.buffer = buf;
    source.connect(gain).connect(ac.destination);
    source.start(t);
    playing = { source, gain, endsAt: t + buf.duration };
  }

  // queue: wait for whatever is being said instead of cutting it off. A limit change may
  // interrupt anything; a light never interrupts a limit.
  function cue(line, { chime: freqs = null, queue = false } = {}) {
    if (!line) return;
    const now = ac.currentTime;
    if (queue) {
      if (playing && playing.endsAt > now) {
        const t = playing.endsAt + 0.12;
        play(line, freqs ? chime(freqs, t) - OVERLAP : t);
        return;
      }
    } else cut();
    const start = now + 0.03;
    play(line, freqs ? chime(freqs, start) - OVERLAP : start);
  }

  return {
    preload, setVoice, cue, cut,
    has: (id) => clips.has(id),
    count: () => clips.size,
    // For a voice picker, whenever there is one to build.
    voices: () => (manifest ? manifest.voices || [] : []),
    using: () => voice,
  };
}
