// Prozedurale Soundeffekte und Ambient-Musik mit der Web Audio API (keine Audiodateien nötig)
let ctx = null, master = null, sfxGain = null, musicGain = null, noiseBuf = null;
let musicTimer = null, musicMood = 'geo';
const settings = { sfx: 0.7, music: 0.4 };

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch { return; }
  master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
  const comp = ctx.createDynamicsCompressor(); comp.connect(master);
  sfxGain = ctx.createGain(); sfxGain.gain.value = settings.sfx; sfxGain.connect(comp);
  musicGain = ctx.createGain(); musicGain.gain.value = settings.music; musicGain.connect(comp);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  startMusic();
}

export function setVolumes(sfx, music) {
  settings.sfx = sfx; settings.music = music;
  if (sfxGain) sfxGain.gain.value = sfx;
  if (musicGain) musicGain.gain.value = music;
}

function env(g, t, a, peak, dcy) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy);
}
function noise(t, dur, freq, q, peak, type = 'bandpass', dest = sfxGain) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); env(g, t, 0.005, peak, dur);
  s.connect(f); f.connect(g); g.connect(dest);
  s.start(t, Math.random() * 0.5, dur + 0.1);
  return f;
}
function tone(t, type, f0, f1, dur, peak, dest = sfxGain) {
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain(); env(g, t, 0.005, peak, dur);
  o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
}

export function sfx(name) {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  switch (name) {
    case 'bullet': noise(t, 0.12, 1800, 0.7, 0.9); tone(t, 'square', 180, 50, 0.08, 0.25); break;
    case 'laser': tone(t, 'sawtooth', 2400, 300, 0.18, 0.25); tone(t, 'sine', 1200, 200, 0.2, 0.3); break;
    case 'plasma': tone(t, 'sawtooth', 600, 90, 0.35, 0.3); noise(t, 0.25, 500, 2, 0.4, 'lowpass'); break;
    case 'beam': tone(t, 'triangle', 900, 1600, 0.3, 0.3); tone(t, 'sine', 450, 800, 0.3, 0.2); break;
    case 'melee': noise(t, 0.18, 900, 1.5, 0.7); tone(t, 'square', 140, 60, 0.15, 0.3); break;
    case 'explosion': noise(t, 1.2, 300, 0.5, 1.0, 'lowpass'); tone(t, 'sine', 90, 30, 0.9, 0.8); break;
    case 'hit': noise(t, 0.08, 3000, 1, 0.4); break;
    case 'death': tone(t, 'sawtooth', 300, 60, 0.6, 0.2); break;
    case 'alienDeath': tone(t, 'sine', 900, 120, 0.7, 0.25); tone(t, 'triangle', 1300, 200, 0.6, 0.15); break;
    case 'step': noise(t, 0.04, 400 + Math.random() * 200, 1, 0.12, 'lowpass'); break;
    case 'click': tone(t, 'sine', 1400, 900, 0.05, 0.12); break;
    case 'select': tone(t, 'sine', 700, 1100, 0.08, 0.15); break;
    case 'deny': tone(t, 'square', 200, 140, 0.15, 0.12); break;
    case 'alert': [0, 0.18, 0.36].forEach((d) => tone(t + d, 'square', 880, 860, 0.12, 0.12)); break;
    case 'turn': tone(t, 'sine', 330, 330, 0.4, 0.2); tone(t + 0.15, 'sine', 495, 495, 0.5, 0.2); break;
    case 'alienTurn': tone(t, 'sawtooth', 110, 80, 0.8, 0.18); tone(t + 0.1, 'sine', 165, 120, 0.8, 0.15); break;
    case 'research': [0, 0.12, 0.24].forEach((d, i) => tone(t + d, 'sine', 520 * (1 + i * 0.25), 520 * (1 + i * 0.25), 0.25, 0.15)); break;
    case 'launch': noise(t, 1.5, 200, 0.3, 0.5, 'lowpass'); tone(t, 'sawtooth', 60, 140, 1.4, 0.15); break;
    case 'victory': [0, 0.2, 0.4, 0.7].forEach((d, i) => tone(t + d, 'triangle', [392, 523, 659, 784][i], [392, 523, 659, 784][i], 0.5, 0.2)); break;
    case 'defeat': [0, 0.3, 0.6].forEach((d, i) => tone(t + d, 'triangle', [330, 262, 196][i], [320, 250, 180][i], 0.6, 0.2)); break;
  }
}

// Generative Ambient-Musik: langsame Akkordflächen + Bass-Puls
const MOODS = {
  geo: { chords: [[48, 55, 60, 63], [44, 51, 56, 60], [46, 53, 58, 62], [43, 50, 55, 58]], len: 6, pulse: false },
  tac: { chords: [[45, 52, 57, 60], [41, 48, 53, 56], [43, 50, 55, 58], [40, 47, 52, 55]], len: 4, pulse: true },
  menu: { chords: [[50, 57, 62, 65], [46, 53, 58, 62], [48, 55, 60, 64], [45, 52, 57, 60]], len: 7, pulse: false },
};
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
let chordIdx = 0;
function playChord() {
  if (!ctx) return;
  const mood = MOODS[musicMood];
  const t = ctx.currentTime;
  const chord = mood.chords[chordIdx++ % mood.chords.length];
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.5;
  lp.connect(musicGain);
  chord.forEach((m, i) => {
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator(); o.type = i === 0 ? 'triangle' : 'sawtooth';
      o.frequency.value = mtof(m + (i === 0 ? -12 : 0)); o.detune.value = det;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(i === 0 ? 0.07 : 0.025, t + mood.len * 0.4);
      g.gain.linearRampToValueAtTime(0.0001, t + mood.len * 1.05);
      o.connect(g); g.connect(lp); o.start(t); o.stop(t + mood.len * 1.1);
    }
  });
  if (mood.pulse) {
    for (let k = 0; k < mood.len * 2; k++) {
      const tt = t + k * 0.5;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = mtof(chord[0] - 12);
      const g = ctx.createGain(); env(g, tt, 0.01, 0.12, 0.3);
      o.connect(g); g.connect(musicGain); o.start(tt); o.stop(tt + 0.4);
    }
  }
  // gelegentliche hohe Glockentöne
  if (Math.random() < 0.6) {
    const m = chord[1 + Math.floor(Math.random() * 3)] + 24;
    const tt = t + Math.random() * mood.len * 0.6;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = mtof(m);
    const g = ctx.createGain(); env(g, tt, 0.02, 0.03, 2.5);
    o.connect(g); g.connect(musicGain); o.start(tt); o.stop(tt + 3);
  }
  musicTimer = setTimeout(playChord, mood.len * 1000);
}
function startMusic() { clearTimeout(musicTimer); chordIdx = 0; playChord(); }
export function setMusicMood(m) {
  if (musicMood === m) return;
  musicMood = m;
  if (ctx) startMusic();
}
