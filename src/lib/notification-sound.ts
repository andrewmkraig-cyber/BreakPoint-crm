// Ace 28.0 — notification sound library. Five options synthesized via
// the Web Audio API at play time so we don't ship audio files (no
// licensing maintenance, no bundle bloat, identical playback across
// browsers). Each sound is a short envelope-shaped oscillator/noise
// burst designed to feel distinct without being obnoxious.
//
// Preferences live in localStorage (one key per channel: mail vs sms).
// The play function is a no-op when "off" is selected, when the page
// is in a non-browser environment (SSR), or when the AudioContext
// can't be created (e.g. iOS before user interaction — modern Chrome/
// Safari resume contexts on the first user gesture, which has
// effectively always happened by the time a notification fires).

export type SoundId = "off" | "ding" | "chime" | "pop" | "tennis";

export const SOUND_OPTIONS: ReadonlyArray<{ id: SoundId; label: string; description: string }> = [
  { id: "off", label: "Off", description: "No sound." },
  { id: "ding", label: "Ding", description: "Single high bell tone." },
  { id: "chime", label: "Chime", description: "Two-note rising chime." },
  { id: "pop", label: "Pop", description: "Soft pop, like a bubble." },
  { id: "tennis", label: "Tennis", description: "Tennis ball bouncing." },
];

export const MAIL_SOUND_KEY = "ace-sound-mail";
export const SMS_SOUND_KEY = "ace-sound-sms";

// Default to a quiet but distinct sound for each channel. Recruiters
// who want silence flip to "Off" explicitly.
export const DEFAULT_MAIL_SOUND: SoundId = "ding";
export const DEFAULT_SMS_SOUND: SoundId = "tennis";

export function readSoundPref(key: string, fallback: SoundId): SoundId {
  if (typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(key);
    if (v && SOUND_OPTIONS.some((o) => o.id === v)) return v as SoundId;
  } catch {
    // Locked-down browsers throw on localStorage access — fall through.
  }
  return fallback;
}

export function writeSoundPref(key: string, value: SoundId) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Quota / private mode — best-effort only.
  }
}

// Lazy-init a single AudioContext; reusing it avoids the per-call
// allocation cost and keeps under the per-tab context cap browsers
// enforce. Using `any` for the webkit fallback keeps Safari support
// without dragging in a polyfill.
let ctx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

// Resume the context if it's been suspended by autoplay policies.
// Modern browsers suspend the context until a user gesture; by the
// time a notification fires the user has almost certainly clicked
// somewhere, but this resume call is cheap insurance.
function resumeIfNeeded(c: AudioContext) {
  if (c.state === "suspended") {
    void c.resume().catch(() => {
      // If resume fails (no user gesture yet), the play call below
      // will silently produce nothing — same as if the sound were
      // off. Acceptable since the sound is a notification cue, not
      // load-bearing UI.
    });
  }
}

// Apply a fast attack + decay envelope so each tone has a percussive
// shape rather than the click-on / click-off you get from a plain
// oscillator gate.
function envelope(
  c: AudioContext,
  gain: GainNode,
  startAt: number,
  attack: number,
  decay: number,
  peak: number,
) {
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peak, startAt + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + attack + decay);
}

function playDing(c: AudioContext) {
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(880, t);
  const gain = c.createGain();
  envelope(c, gain, t, 0.005, 0.35, 0.25);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.4);
}

function playChime(c: AudioContext) {
  const t = c.currentTime;
  // C5 → E5 — short rising arpeggio, triangle wave for a softer body.
  const notes = [
    { freq: 523.25, offset: 0 },
    { freq: 659.25, offset: 0.08 },
  ];
  for (const n of notes) {
    const osc = c.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(n.freq, t + n.offset);
    const gain = c.createGain();
    envelope(c, gain, t + n.offset, 0.005, 0.25, 0.18);
    osc.connect(gain).connect(c.destination);
    osc.start(t + n.offset);
    osc.stop(t + n.offset + 0.3);
  }
}

function playPop(c: AudioContext) {
  const t = c.currentTime;
  // Sine glide from 600 → 200Hz over 80ms — the classic "soft pop"
  // shape. Short envelope keeps it punchy.
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(600, t);
  osc.frequency.exponentialRampToValueAtTime(200, t + 0.08);
  const gain = c.createGain();
  envelope(c, gain, t, 0.002, 0.09, 0.3);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.12);
}

function playTennis(c: AudioContext) {
  const t = c.currentTime;
  // Tennis ball bouncing on a hard surface — a low-frequency thump
  // with a quick pitched body. Each bounce is a sine-pitch glide
  // (~210Hz down to ~150Hz over ~70ms) layered with a band-passed
  // noise burst around 1kHz to add the "skin contact" rasp. We fire
  // two bounces ~150ms apart, the second softer, to evoke the natural
  // "thump … thump" of a ball settling on a court.
  function oneBounce(start: number, peak: number, freqStart: number, freqEnd: number) {
    // Pitched body — sine glide with snappy envelope.
    const body = c.createOscillator();
    body.type = "sine";
    body.frequency.setValueAtTime(freqStart, start);
    body.frequency.exponentialRampToValueAtTime(freqEnd, start + 0.07);
    const bodyGain = c.createGain();
    envelope(c, bodyGain, start, 0.003, 0.09, peak);
    body.connect(bodyGain).connect(c.destination);
    body.start(start);
    body.stop(start + 0.12);

    // Contact rasp — short band-passed noise so the thump has bite.
    const bufferSize = Math.floor(c.sampleRate * 0.04);
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = c.createBufferSource();
    noise.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1000, start);
    filter.Q.setValueAtTime(4, start);
    const noiseGain = c.createGain();
    envelope(c, noiseGain, start, 0.001, 0.04, peak * 0.35);
    noise.connect(filter).connect(noiseGain).connect(c.destination);
    noise.start(start);
    noise.stop(start + 0.05);
  }
  oneBounce(t, 0.5, 220, 150);
  oneBounce(t + 0.16, 0.32, 200, 140);
}

export function playSound(id: SoundId) {
  if (id === "off") return;
  const c = getCtx();
  if (!c) return;
  resumeIfNeeded(c);
  switch (id) {
    case "ding":
      playDing(c);
      break;
    case "chime":
      playChime(c);
      break;
    case "pop":
      playPop(c);
      break;
    case "tennis":
      playTennis(c);
      break;
  }
}

// Convenience for the contexts: play whatever the user picked for
// each channel without duplicating the read/dispatch logic at every
// call site.
export function playMailSound() {
  playSound(readSoundPref(MAIL_SOUND_KEY, DEFAULT_MAIL_SOUND));
}
export function playSmsSound() {
  playSound(readSoundPref(SMS_SOUND_KEY, DEFAULT_SMS_SOUND));
}
