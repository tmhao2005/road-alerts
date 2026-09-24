// Renders every line the app can say to an audio file.
//
//   node tools/render-voice.js --audition                 # a few lines across many voices
//   node tools/render-voice.js --voice coral              # the real set, OpenAI
//   node tools/render-voice.js --provider google --voice Kore
//
// Each sentence is rendered whole - see src/phrases.js for why that matters more than
// which model does it. Existing files are left alone, so adding a phrase costs one
// request rather than fifty-four.
//
// Providers are kept behind one interface because the choice is genuinely open: neither
// model here is Vietnamese-first, and a vendor that is (FPT.AI, Zalo, Viettel) would slot
// in as another entry below without touching the app.
import { writeFile, readFile, copyFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { allLines } from '../src/phrases.js';

const run = promisify(execFile);

// Gemini's PCM wrapped as wav is 95 KB a line - five megabytes for the set, which is not
// something to ship beside a 4.4 MB road network. At 32 kbps mono AAC the same line is
// 13 KB and still clean over road noise, so the whole voice lands under a megabyte.
// afconvert is macOS-only; it is not needed in CI, which only ever uses committed clips.
const AAC_BITRATE = 32000;

async function compress(dir, ids) {
  let saved = 0;
  for (const id of ids) {
    const from = `${dir}/${id}.wav`, to = `${dir}/${id}.m4a`;
    if (!existsSync(from)) continue;
    try {
      await run('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', String(AAC_BITRATE), from, to]);
    } catch (e) {
      // afconvert ships with macOS and nothing else here needs a Mac, so its absence is
      // a warning. Any other failure is real and must not pass as one.
      if (e.code !== 'ENOENT') throw e;
      console.log('afconvert not found - leaving wav in place (do not commit as is)');
      return 'wav';
    }
    saved++;
    await unlink(from);
  }
  return saved;
}

const AUDITION_LINES = ['start', 'light', 'over', 'logged', 'sign-60', 'law-60'];

// Whether asking for a region does anything at all. Neither model has Vietnamese accent
// control - Vietnamese is a small slice of a multilingual model's training - so the honest
// expectation is that all three come back alike. Worth proving by ear, because if it holds
// then a Bac/Nam choice means changing vendor, not changing the prompt.
const ACCENTS = [
  ['neutral', ''],
  ['bac', ' Speak with a northern Vietnamese accent, as in Hanoi.'],
  ['nam', ' Speak with a southern Vietnamese accent, as in Ho Chi Minh City.'],
];

// How each delivery label from src/phrases.js is put to a model. This prose is the only
// part of the pipeline that is model-facing, which is why it lives here and not beside
// the phrases themselves.
const DIRECTION = {
  plain: 'A brief, neutral acknowledgement. Even and unhurried.',
  calm: 'Informational, unhurried, a little warm. You are pointing something out, not warning.',
  urgent: 'Firmer and slightly quicker, with more weight on the first syllable. Serious but never alarmed - a startled driver is a worse driver.',
  sure: 'Definite and matter-of-fact, with a clear settled fall on the final number. This was read off a sign; you are not guessing.',
  __plain: 'Say it plainly and naturally, at an ordinary conversational pace.',
  hedged: 'Softer and a touch lower, slightly slower, easing off the final number rather than landing hard on it. This was worked out from the rules, not seen, and it should sound like it.',
};

const COMMON = [
  'Speak Vietnamese as a native speaker, in a natural conversational register.',
  'You are the voice of a driving companion, heard once, over road noise, by someone whose eyes are on the road.',
  'Keep the tones accurate and the pace moderate. Statement intonation - never let the ending rise as if asking a question.',
].join(' ');

// Gemini hands back headerless PCM, so it needs a RIFF header to be a file anything will
// play. Uncompressed, which is three times the size of the mp3 OpenAI returns: fine for an
// audition, and worth running through afconvert before any of it ships.
function wav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const PROVIDERS = {
  openai: {
    env: 'OPENAI_API_KEY',
    model: 'gpt-4o-mini-tts',
    format: 'mp3',
    // OpenAI publishes no gender labels, so these notes are only how each tends to read.
    voices: [
      ['coral', 'reads female, warm'], ['nova', 'reads female, brighter'],
      ['shimmer', 'reads female, softer'], ['sage', 'reads female, even'],
      ['ballad', 'reads male, low'], ['onyx', 'reads male, deep'],
      ['ash', 'reads male, clipped'], ['alloy', 'ambiguous, flat'],
    ],
    accentVoices: ['coral', 'onyx'],
    async speak(line, voice, key, extra) {
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: this.model, voice, input: line.text,
          instructions: `${COMMON} ${DIRECTION[line.voice]}${extra}`,
          response_format: this.format,
        }),
      });
      if (!res.ok) throw Object.assign(new Error(`${res.status} ${(await res.text()).slice(0, 200)}`), { status: res.status });
      return Buffer.from(await res.arrayBuffer());
    },
  },

  google: {
    env: 'GOOGLE_GENERATIVE_AI_API_KEY',
    model: 'gemini-2.5-flash-preview-tts',
    format: 'wav',
    // Gemini does not label gender either; same caveat as above.
    voices: [
      ['Kore', 'reads female, firm'], ['Leda', 'reads female, youthful'],
      ['Aoede', 'reads female, breezy'], ['Achernar', 'reads female, soft'],
      ['Sulafat', 'reads female, warm'], ['Charon', 'reads male, informative'],
      ['Iapetus', 'reads male, clear'], ['Algieba', 'reads male, smooth'],
    ],
    accentVoices: ['Kore', 'Charon'],
    async speak(line, voice, key, extra) {
      // No separate instructions field here - the direction goes in the prompt, and the
      // colon is what keeps the model from reading it out loud.
      const text = `${COMMON} ${DIRECTION[line.voice]}${extra}\n\nSay exactly this and nothing else: ${line.text}`;
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
        }),
      });
      if (!res.ok) throw Object.assign(new Error(`${res.status} ${(await res.text()).slice(0, 200)}`), { status: res.status });
      const cand = (await res.json()).candidates?.[0];
      const part = cand?.content?.parts?.[0]?.inlineData;
      // Gemini occasionally returns a candidate with no parts at all and finishReason
      // OTHER. It is not a refusal - the same prompt on another voice succeeds, and a
      // retry of the same one succeeds too - so it is worth another go rather than a
      // failed run.
      if (!part?.data) throw Object.assign(new Error(`empty response (${cand?.finishReason})`), { retry: true });
      return wav(Buffer.from(part.data, 'base64'), Number(/rate=(\d+)/.exec(part.mimeType)?.[1] || 24000));
    },
  },
};

async function speak(p, line, voice, key, extra = '') {
  for (let attempt = 0; ; attempt++) {
    try {
      return await p.speak(line, voice, key, extra);
    } catch (e) {
      // Rate limits and upstream hiccups are worth waiting out; a bad request never is.
      if ((e.retry || e.status === 429 || e.status >= 500) && attempt < 6) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      throw new Error(`${line.id} (${voice}) -> ${e.message}`);
    }
  }
}

// Four at a time: enough to render everything in under a minute, gentle enough not to
// spend the run backing off a per-minute limit.
async function pool(items, width, fn) {
  const queue = [...items];
  let done = 0;
  await Promise.all(Array.from({ length: Math.min(width, queue.length) }, async () => {
    while (queue.length) {
      await fn(queue.shift());
      process.stdout.write(`\r  ${++done}/${items.length}`);
    }
  }));
  process.stdout.write('\n');
}

// A page for picking by ear: every voice each provider offers against every delivery, then
// the accent probe. Only providers actually rendered appear, so it is useful after the
// first run rather than only after all of them.
function auditionPage(lines, present) {
  const btn = (src, top, sub) => `<button data-src="${src}"><b>${top}</b><span>${sub}</span></button>`;
  const voices = (name, line) => {
    const p = PROVIDERS[name];
    return `<h4>${name} <em>${p.model}</em></h4><div class=row>${
      p.voices.map(([v, note]) => btn(`${name}/${v}/${line.id}.${p.format}`, v, note)).join('')}</div>`;
  };
  const lineBlock = (line) => `
    <section>
      <h2>${line.text}</h2>
      <p>${line.voice} — ${DIRECTION[line.voice]}</p>
      ${present.map((n) => voices(n, line)).join('')}
    </section>`;
  const accentBlock = (id) => {
    const line = lines.find((l) => l.id === id);
    const forProvider = (name) => {
      const p = PROVIDERS[name];
      return `<h4>${name}</h4><div class=row>${p.accentVoices.flatMap((v) => ACCENTS.map(([a]) =>
        btn(`${name}/accent/${v}-${a}-${id}.${p.format}`, `${v} · ${a}`,
            a === 'neutral' ? 'nothing asked' : `asked for giọng ${a === 'bac' ? 'miền Bắc' : 'miền Nam'}`))).join('')}</div>`;
    };
    return `<section><h2>${line.text}</h2>${present.map(forProvider).join('')}</section>`;
  };
  return `<!doctype html>
<meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Voice audition</title>
<style>
  :root { color-scheme: dark; --bg:#111318; --fg:#e8eaf0; --dim:#8b93a7; --line:#262a33; --hit:#2f6df6; }
  body { background:var(--bg); color:var(--fg); font:16px/1.5 -apple-system,system-ui,sans-serif; margin:0; padding:24px 16px 64px; }
  h1 { font-size:20px; margin:0 0 4px; }
  h3 { font-size:13px; letter-spacing:.08em; text-transform:uppercase; color:var(--dim); margin:36px 0 0; }
  h4 { font-size:12px; letter-spacing:.06em; text-transform:uppercase; color:var(--dim); margin:14px 0 8px; font-weight:600; }
  h4 em { text-transform:none; letter-spacing:0; font-style:normal; opacity:.6; }
  header p, .lede { color:var(--dim); margin:0 0 20px; max-width:48em; }
  section { border-top:1px solid var(--line); padding:18px 0; }
  h2 { font-size:17px; margin:0; }
  section p { color:var(--dim); font-size:13px; margin:4px 0 0; max-width:48em; }
  .row { display:flex; flex-wrap:wrap; gap:8px; }
  button { background:#191c23; color:var(--fg); border:1px solid var(--line); border-radius:10px;
           padding:10px 14px; font:inherit; text-align:left; cursor:pointer; min-width:152px; }
  button:hover { border-color:#3a4050; }
  button.on { background:var(--hit); border-color:var(--hit); }
  button b { display:block; font-size:14px; }
  button span { display:block; color:var(--dim); font-size:12px; }
  button.on span { color:#cfe0ff; }
  code { background:#191c23; padding:2px 6px; border-radius:5px; font-size:13px; }
</style>
<header>
  <h1>Voice audition</h1>
  <p>Listen for whether the Vietnamese tones survive — <b>Tốc độ tối đa</b> is four in a row and is where a
  non-native model comes apart — and whether <b>Theo luật</b> lands less certain than <b>Tốc độ tối đa</b>.
  Then: <code>node tools/render-voice.js --provider &lt;p&gt; --voice &lt;name&gt;</code></p>
</header>
${lines.map(lineBlock).join('')}
<h3>Accent</h3>
<p class=lede>Same voice and line, asked for nothing, then a northern accent, then a southern one. If the three are
indistinguishable, a Bắc/Nam choice is not available from these models at any prompt, and getting one means a
Vietnamese-first vendor instead.</p>
${['sign-60', 'light'].map(accentBlock).join('')}
<script>
  let playing = null;
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (playing) { playing.audio.pause(); playing.button.classList.remove('on'); }
    const audio = new Audio(b.dataset.src);
    b.classList.add('on');
    audio.onended = () => b.classList.remove('on');
    audio.play();
    playing = { audio, button: b };
  });
</script>
`;
}

// A line that comes out wrong is not always the prompt's fault - these models vary run to
// run, and the empty responses seen elsewhere show how much. So a re-render offers several
// takes to choose between, and half of them drop most of the direction: an over-instructed
// delivery is its own way of sounding unnatural.
const PLAIN = DIRECTION.__plain;

function takesPage(id, text, takes, format, voice) {
  const btn = (src, top, sub) => `<button data-src="${src}" disabled><b>${top}</b><span>${sub}</span></button>`;
  return `<!doctype html>
<meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Takes — ${id}</title>
<style>
  :root { color-scheme: dark; --bg:#111318; --fg:#e8eaf0; --dim:#8b93a7; --line:#262a33; --hit:#2f6df6; }
  body { background:var(--bg); color:var(--fg); font:16px/1.5 -apple-system,system-ui,sans-serif; margin:0; padding:20px 16px 64px; }
  h1 { font-size:21px; margin:0 0 6px; }
  h3 { font-size:12px; letter-spacing:.07em; text-transform:uppercase; color:var(--dim); margin:26px 0 8px; }
  p { color:var(--dim); max-width:46em; margin:0 0 10px; }
  .row { display:flex; flex-wrap:wrap; gap:8px; }
  button { background:#191c23; color:var(--fg); border:1px solid var(--line); border-radius:10px;
           padding:13px 16px; font:inherit; text-align:left; cursor:pointer; min-width:150px; }
  button.on { background:var(--hit); border-color:var(--hit); }
  button:disabled { opacity:.4; }
  button b { display:block; font-size:15px; }
  button span { display:block; color:var(--dim); font-size:12px; }
  button.on span { color:#cfe0ff; }
  #unlock { background:var(--hit); border-color:var(--hit); width:100%; text-align:center; font-size:17px; padding:17px; }
  #unlock.done { background:#1d3a1f; border-color:#2f6d35; }
  #info { font-family:ui-monospace,monospace; font-size:12px; color:var(--dim); white-space:pre-wrap;
          border:1px solid var(--line); border-radius:10px; padding:12px; margin-top:22px; }
  code { background:#191c23; padding:2px 6px; border-radius:5px; font-size:13px; }
</style>
<h1>${text}</h1>
<p>Takes of <code>${id}</code> in ${voice}. Plays through Web Audio, the same as the app — an
&lt;audio&gt; element would be silenced by the iOS ring switch.</p>

<button id=unlock><b>Tap to enable audio</b></button>

<h3>Currently shipping</h3>
<div class=row>${btn(`../${voice}/${id}.${format}`, 'current', 'what the app says now')}</div>

<h3>Full direction</h3>
<div class=row>${takes.filter((t) => !t.plain).map((t) => btn(`${id}/${t.n}.${format}`, `take ${t.n}`, 'as rendered')).join('')}</div>

<h3>Plain direction</h3>
<p>Most of the delivery prose removed — just: ${PLAIN}</p>
<div class=row>${takes.filter((t) => t.plain).map((t) => btn(`${id}/${t.n}.${format}`, `take ${t.n}`, 'minimal direction')).join('')}</div>

<p style="margin-top:26px">Then install the one you want:<br><code>node tools/render-voice.js --install ${id} &lt;take&gt;</code></p>
<div id=info>not started</div>
<script>
var ac = null, cache = {}, playing = null, log = [];
var info = document.getElementById('info'), unlock = document.getElementById('unlock');
function say(m) { log.unshift(m); info.textContent = log.slice(0, 8).join('\\n'); }
unlock.addEventListener('click', function () {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    ac.resume().then(function () {
      var s = ac.createBufferSource();
      s.buffer = ac.createBuffer(1, 1, 22050);
      s.connect(ac.destination); s.start(0);
      unlock.className = 'done';
      unlock.innerHTML = '<b>Audio enabled \\u2014 now tap a take</b>';
      var bs = document.querySelectorAll('button[data-src]');
      for (var i = 0; i < bs.length; i++) bs[i].disabled = false;
      say('ready: ' + ac.sampleRate + ' Hz, state ' + ac.state);
    })['catch'](function (e) { say('resume failed: ' + e); });
  } catch (e) { say('no AudioContext: ' + e); }
});
document.addEventListener('click', function (e) {
  var b = e.target.closest ? e.target.closest('button[data-src]') : null;
  if (!b || !ac) return;
  var src = b.getAttribute('data-src');
  if (playing) { try { playing.stop(); } catch (_) {} playing = null; }
  var all = document.querySelectorAll('button[data-src]');
  for (var i = 0; i < all.length; i++) all[i].className = '';
  b.className = 'on';
  var go = function (buf) {
    var s = ac.createBufferSource();
    s.buffer = buf; s.connect(ac.destination);
    s.onended = function () { b.className = ''; };
    s.start(); playing = s;
    say('playing ' + src + '  (' + buf.duration.toFixed(2) + 's)');
  };
  if (cache[src]) { go(cache[src]); return; }
  say('loading ' + src + '\\u2026');
  fetch(src).then(function (r) {
    if (!r.ok) throw new Error('http ' + r.status);
    return r.arrayBuffer();
  }).then(function (a) {
    return new Promise(function (res, rej) { ac.decodeAudioData(a, res, rej); });
  }).then(function (buf) { cache[src] = buf; go(buf); })
    ['catch'](function (err) { b.className = ''; say('FAILED ' + src + ': ' + (err.message || err)); });
});
</script>
`;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const force = args.includes('--force');
  const name = flag('--provider', 'openai');
  const p = PROVIDERS[name];
  if (!p) { console.error(`unknown provider "${name}" - try ${Object.keys(PROVIDERS).join(' or ')}`); process.exit(1); }
  const key = process.env[p.env];
  if (!key) { console.error(`${p.env} is not set.\n\n  set -a; . ./.env; set +a\n`); process.exit(1); }

  // Re-render one line without disturbing the other fifty-three, and without overwriting
  // what ships until a take has actually been listened to.
  if (args.includes('--line') || args.includes('--install')) {
    const out = flag('--out', 'web/voice');
    let m = {};
    try { m = JSON.parse(await readFile(`${out}/manifest.json`, 'utf8')); } catch {}
    const format = m.format || 'm4a';
    const voice = flag('--voice', m.default || p.voices[0][0]);

    if (args.includes('--install')) {
      const i = args.indexOf('--install');
      const [id, take] = [args[i + 1], String(args[i + 2] || '').padStart(2, '0')];
      const from = `${out}/takes/${id}/${take}.${format}`;
      if (!existsSync(from)) { console.error(`no take ${take} of ${id} - render some first`); process.exit(1); }
      await copyFile(from, `${out}/${voice}/${id}.${format}`);
      // The service worker keeps clips until "built" changes, so a swapped file that left
      // the manifest alone would deploy and then never reach anyone: every browser would
      // go on serving the clip it already had.
      m.built = new Date().toISOString();
      await writeFile(`${out}/manifest.json`, JSON.stringify(m, null, 2) + '\n');
      console.log(`installed take ${take} as ${voice}/${id}.${format}`);
      console.log(`manifest built ${m.built} - caches will drop the old clips`);
      return;
    }

    const id = flag('--line');
    const line = allLines().find((l) => l.id === id);
    if (!line) { console.error(`unknown line "${id}"`); process.exit(1); }
    const n = Number(flag('--takes', 8));
    const accent = flag('--accent', m.accent || 'neutral');
    const extra = Object.fromEntries(ACCENTS)[accent] ?? '';
    const dir = `${out}/takes/${id}`;
    await mkdir(dir, { recursive: true });
    // Half with the direction as written, half with almost none, so the comparison says
    // whether the prose or the model is at fault.
    const takes = Array.from({ length: n }, (_, i) => ({ n: String(i + 1).padStart(2, '0'), plain: i >= Math.ceil(n / 2) }));
    console.log(`${n} takes of "${line.text}" in ${voice}${accent === 'neutral' ? '' : ` (${accent})`}`);
    await pool(takes, 4, async (t) => {
      const spoken = t.plain ? { ...line, voice: '__plain' } : line;
      await writeFile(`${dir}/${t.n}.${p.format}`, await speak(p, spoken, voice, key, extra));
    });
    if (format === 'm4a' && p.format === 'wav') await compress(dir, takes.map((t) => t.n));
    await writeFile(`${out}/takes/index.html`, takesPage(id, line.text, takes, format, voice));
    console.log(`\nnpm run site && npm run serve, then open /voice/takes/`);
    return;
  }

  if (args.includes('--audition')) {
    const lines = allLines().filter((l) => AUDITION_LINES.includes(l.id));
    const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
    const jobs = [
      ...p.voices.flatMap(([voice]) => lines.map((line) => ({ line, voice, path: `${voice}/${line.id}` }))),
      ...p.accentVoices.flatMap((voice) => ['sign-60', 'light'].flatMap((id) =>
        ACCENTS.map(([a, extra]) => ({ line: byId[id], voice, extra, path: `accent/${voice}-${a}-${id}` })))),
    ];
    const root = `web/voice/audition/${name}`;
    console.log(`${name}: ${jobs.length} clips (${p.voices.length} voices x ${lines.length} lines, plus an accent probe)`);
    for (const [voice] of p.voices) await mkdir(`${root}/${voice}`, { recursive: true });
    await mkdir(`${root}/accent`, { recursive: true });
    await pool(jobs, 4, async ({ line, voice, extra, path }) => {
      const file = `${root}/${path}.${p.format}`;
      if (existsSync(file) && !force) return;
      await writeFile(file, await speak(p, line, voice, key, extra || ''));
    });
    // Whichever providers have been rendered so far, so the page is useful before they all have.
    const present = Object.keys(PROVIDERS).filter((n) => existsSync(`web/voice/audition/${n}`));
    await writeFile('web/voice/audition/index.html', auditionPage(lines, present));
    console.log(`\nnpm run site && npm run serve, then open /voice/audition/  (${present.join(', ')})`);
    return;
  }

  const only = flag('--voice', null);
  const accent = flag('--accent', 'neutral');
  const extra = Object.fromEntries(ACCENTS)[accent];
  if (extra === undefined) { console.error(`unknown accent "${accent}" - try ${ACCENTS.map(([a]) => a).join(', ')}`); process.exit(1); }
  const voices = only ? p.voices.filter(([v]) => v === only) : p.voices;
  if (!voices.length) { console.error(`unknown voice "${only}" for ${name}`); process.exit(1); }

  const out = flag('--out', 'web/voice');
  const lines = allLines();
  const ids = lines.map((l) => l.id);
  // What the clips end up as on disk, which is not what the provider returned if they were
  // compressed on the way out - so this is what decides whether a line still needs rendering.
  const shipped = p.format === 'wav' && !args.includes('--no-compress') ? 'm4a' : p.format;

  // A filename says which line it holds, not which accent said it, so changing accent or
  // provider has to invalidate what is on disk - otherwise a re-run skips everything and
  // quietly leaves the old set in place. Voice does not, since each has its own folder.
  let stale = false;
  try {
    const prev = JSON.parse(await readFile(`${out}/manifest.json`, 'utf8'));
    stale = prev.provider !== name || (prev.accent || 'neutral') !== accent;
    if (stale) console.log(`accent or provider changed from ${prev.provider}/${prev.accent || 'neutral'} - re-rendering`);
  } catch {}

  // Every voice is kept rather than just the chosen one, so the app can offer the choice
  // later without a re-render. Each lives in its own folder; only the selected one is ever
  // fetched, so the extra voices cost repository size and nothing at runtime.
  const jobs = voices.flatMap(([voice]) => lines.map((line) => ({ voice, line })))
    .filter(({ voice, line }) => force || stale || !existsSync(`${out}/${voice}/${line.id}.${shipped}`));
  console.log(`${voices.length} voice(s) x ${lines.length} lines = ${voices.length * lines.length}, ${jobs.length} to render (${name}${accent === 'neutral' ? '' : `, ${accent}`})`);
  for (const [voice] of voices) await mkdir(`${out}/${voice}`, { recursive: true });
  await pool(jobs, 6, async ({ voice, line }) => {
    await writeFile(`${out}/${voice}/${line.id}.${p.format}`, await speak(p, line, voice, key, extra));
  });

  let format = p.format;
  if (shipped === 'm4a') {
    let total = 0;
    for (const [voice] of voices) {
      const r = await compress(`${out}/${voice}`, ids);
      if (r === 'wav') { format = 'wav'; break; }
      total += r;
      format = 'm4a';
    }
    if (format === 'm4a') console.log(`compressed ${total} clips to aac`);
  }

  // The app reads this to know which voices exist, which one to use when nobody has
  // chosen, and what container they are in.
  await writeFile(`${out}/manifest.json`, JSON.stringify({
    provider: name, model: p.model, accent, format,
    default: only || p.voices[0][0],
    voices: p.voices.filter(([v]) => existsSync(`${out}/${v}`)).map(([name, note]) => ({ name, note })),
    built: new Date().toISOString(), ids,
  }, null, 2) + '\n');
  console.log(`${out}/ holds ${voices.length} voice(s)`);
}

main().catch((e) => { console.error('\n' + e.message); process.exit(1); });
