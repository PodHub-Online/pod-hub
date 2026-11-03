import { readStorage, SOUNDS_KEY } from "~/lib/clientStorage";

/**
 * Soft sounds made on the fly (no audio files): a click on − / + and a gentle chime when a side
 * reaches its temperature. Off in Settings → Preferences → Sounds.
 */
let ctx: AudioContext | null = null;

function audio() {
  if (readStorage(SOUNDS_KEY) === "off" || typeof window === "undefined") return null;
  try {
    ctx ??= new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, length: number, volume: number, type: OscillatorType = "sine") {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(gain).connect(a.destination);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

/** − / + : a tiny click, a little higher for warmer. */
export const tick = (warmer = false) => tone(warmer ? 1500 : 1100, 0, 0.05, 0.05, "triangle");

/** A side reached its temperature: two soft notes. */
export function chime() {
  tone(880, 0, 0.6, 0.06);
  tone(1320, 0.18, 0.8, 0.05);
}
