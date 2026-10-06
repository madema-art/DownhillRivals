// Procedural audio: dynamic SFX + reactive breakbeat/big-beat soundtrack, all synthesized with Web Audio.
export interface AudioState {
  speed01: number; grounded: boolean; carve01: number; grinding: boolean; boosting: boolean; air: boolean; tuck: number;
  pack01: number; finalSection: boolean; crashed: boolean; racing: boolean; finished: boolean;
}
type OscT = OscillatorType;
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const NOTE: Record<string, number> = { A4: 440, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, 'G#5': 830.61, B5: 987.77, 'G#4': 415.3 };
const BPM = 134, STEP = 60 / BPM / 4;
const ROOTS = [110, 110, 87.31, 98, 110, 110, 87.31, 82.41];
const CHORDS: number[][] = [[220, 261.63, 329.63], [220, 261.63, 329.63], [174.61, 220, 261.63], [196, 246.94, 293.66], [220, 261.63, 329.63], [220, 261.63, 329.63], [174.61, 220, 261.63], [164.81, 207.65, 246.94]];
const HOOK: Record<number, [number, number, number][]> = {
  0: [[0, NOTE.A4, 2], [3, NOTE.C5, 1], [6, NOTE.E5, 2], [10, NOTE.D5, 1], [11, NOTE.C5, 1], [12, NOTE.A4, 3]],
  2: [[0, NOTE.C5, 2], [3, NOTE.A4, 1], [6, NOTE.F5, 2], [10, NOTE.E5, 1], [11, NOTE.C5, 1], [12, NOTE.A4, 3]],
  3: [[0, NOTE.D5, 2], [3, NOTE.B4, 1], [6, NOTE.G5, 2], [10, NOTE.F5, 1], [11, NOTE.D5, 1], [12, NOTE.B4, 3]],
  7: [[0, NOTE.E5, 2], [3, NOTE['G#5'], 1], [6, NOTE.B5, 2], [10, NOTE.A5, 1], [11, NOTE['G#5'], 1], [12, NOTE.E5, 3]],
};
const BASS_A: [number, number, number][] = [[0, 0, 2], [3, 0, 1], [6, 12, 1], [8, 0, 2], [11, 7, 1], [12, 0, 1], [14, 10, 1]];
const BASS_B: [number, number, number][] = [[0, 0, 2], [2, 12, 1], [4, 0, 1], [6, 7, 1], [8, 0, 2], [10, 0, 1], [12, 12, 1], [14, 7, 1]];
const KICK_A = [0, 7, 10], KICK_B = [0, 6, 10, 13];
const ARP = [0, 7, 12, 7, 10, 7, 12, 15];

export class AudioEngine {
  ctx!: AudioContext; ready = false;
  master!: GainNode; musicGain!: GainNode; sfxGain!: GainNode; comp!: DynamicsCompressorNode; musicFilter!: BiquadFilterNode; musicDuck!: GainNode;
  noise!: AudioBuffer;
  vol = { master: 0.8, music: 0.65, sfx: 0.9 };
  layer: Record<string, GainNode> = {};
  loops: Record<string, { g: GainNode; f?: BiquadFilterNode; o?: OscillatorNode }> = {};
  nextTime = 0; stepIdx = 0; timer = 0;
  mix = { drums: 0, bass: 0, perc: 0, hook: 0, pad: 0.5, rock: 0, final: false, finished: false };
  mstate = { air: false, crash: 0, boost: false, speed01: 0, pack01: 0, racing: false };
  stats = { sfx: 0, steps: 0, events: {} as Record<string, number> };
  private dist!: WaveShaperNode; private lastFilterTarget = 18000;

  constructor() {
    try { const v = JSON.parse(localStorage.getItem('dr_vol') || 'null'); if (v) this.vol = { ...this.vol, ...v }; } catch { /* ignore */ }
  }

  async unlock() {
    if (this.ready) { if (this.ctx.state !== 'running') await this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const c = this.ctx;
    this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 5; this.comp.attack.value = 0.004; this.comp.release.value = 0.2; this.comp.knee.value = 12;
    this.master = c.createGain(); this.master.gain.value = this.vol.master;
    this.comp.connect(this.master); this.master.connect(c.destination);
    this.musicGain = c.createGain(); this.musicGain.gain.value = this.vol.music;
    this.musicDuck = c.createGain(); this.musicDuck.gain.value = 1;
    this.musicFilter = c.createBiquadFilter(); this.musicFilter.type = 'lowpass'; this.musicFilter.frequency.value = 18000; this.musicFilter.Q.value = 0.9;
    this.musicFilter.connect(this.musicDuck); this.musicDuck.connect(this.musicGain); this.musicGain.connect(this.comp);
    this.sfxGain = c.createGain(); this.sfxGain.gain.value = this.vol.sfx; this.sfxGain.connect(this.comp);
    // noise buffer (2s)
    this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.dist = c.createWaveShaper(); this.dist.curve = this.curve(30); this.dist.oversample = '2x';
    for (const k of ['drums', 'bass', 'perc', 'hook', 'pad', 'rock']) { const g = c.createGain(); g.gain.value = 0; g.connect(this.musicFilter); this.layer[k] = g; }
    this.buildLoops();
    this.ready = true;
    await c.resume();
    this.nextTime = c.currentTime + 0.1; this.stepIdx = 0;
    this.timer = window.setInterval(() => this.tick(), 25);
  }

  setVolume(k: 'master' | 'music' | 'sfx', v: number) {
    this.vol[k] = v; try { localStorage.setItem('dr_vol', JSON.stringify(this.vol)); } catch { /* ignore */ }
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    (k === 'master' ? this.master : k === 'music' ? this.musicGain : this.sfxGain).gain.setTargetAtTime(v, t, 0.02);
  }

  private curve(k: number) { const n = 512, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; c[i] = (3 + k) * x * 20 * (Math.PI / 180) / (Math.PI + k * Math.abs(x)); } return c; }

  // ---------- continuous loops ----------
  private noiseLoop(): AudioBufferSourceNode { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.loopStart = Math.random(); s.start(0, Math.random()); return s; }
  private buildLoops() {
    const c = this.ctx, mk = (name: string, f: BiquadFilterNode | undefined, g: GainNode) => { this.loops[name] = { g, f }; };
    // wind (band + rumble)
    { const s = this.noiseLoop(), f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.7; f.frequency.value = 600; const g = c.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(this.sfxGain); mk('wind', f, g);
      const lfo = c.createOscillator(); lfo.frequency.value = 0.27; const lg = c.createGain(); lg.gain.value = 0.05; lfo.connect(lg); lg.connect(g.gain); lfo.start(); }
    { const s = this.noiseLoop(), f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220; const g = c.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(this.sfxGain); mk('rumble', f, g); }
    { const s = this.noiseLoop(), f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.5; f.frequency.value = 1500; const g = c.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(this.sfxGain); mk('slide', f, g); }
    { const s = this.noiseLoop(), f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 4200; const g = c.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(this.sfxGain); mk('carve', f, g); }
    { // grind: saw screech + metallic noise
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 180; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 4;
      const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.value = 1530; const og = c.createGain(); og.gain.value = 0.25;
      const n = this.noiseLoop(), nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 5200; nf.Q.value = 2;
      const g = c.createGain(); g.gain.value = 0; o.connect(f); o2.connect(og); og.connect(f); f.connect(g); n.connect(nf); nf.connect(g); g.connect(this.sfxGain); o.start(); o2.start(); mk('grind', f, g); this.loops.grind.o = o; this.loops['grind2'] = { g: og, o: o2 }; }
    { // boost: detuned saws + riser noise
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 62; const o2 = c.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 62.7;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 3; const g = c.createGain(); g.gain.value = 0;
      const n = this.noiseLoop(), nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1200; nf.Q.value = 0.8; const ng = c.createGain(); ng.gain.value = 0.7;
      o.connect(f); o2.connect(f); f.connect(g); n.connect(nf); nf.connect(ng); ng.connect(g); g.connect(this.sfxGain); o.start(); o2.start(); mk('boost', f, g); this.loops.boost.o = o; this.loops['boostN'] = { g: ng, f: nf }; }
  }

  update(dt: number, s: AudioState) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, L = this.loops, sp = Math.min(1, s.speed01);
    const tc = 0.06;
    const windAmt = Math.pow(sp, 1.4);
    L.wind.g.gain.setTargetAtTime(0.06 + windAmt * 0.55 + (s.boosting ? 0.18 : 0), t, 0.12);
    L.wind.f!.frequency.setTargetAtTime(450 + sp * 2600 + (s.air ? 700 : 0) + (s.boosting ? 900 : 0), t, 0.1);
    L.rumble.g.gain.setTargetAtTime(windAmt * 0.45 * (s.air ? 0.5 : 1), t, 0.12);
    const gr = s.grounded && !s.grinding && !s.crashed ? 1 : 0;
    L.slide.g.gain.setTargetAtTime(gr * (0.03 + sp * 0.2 + s.carve01 * 0.12), t, tc);
    L.slide.f!.frequency.setTargetAtTime(900 + sp * 2200 + s.carve01 * 1200, t, tc);
    L.carve.g.gain.setTargetAtTime(gr * s.carve01 * (0.1 + sp * 0.3), t, tc);
    L.carve.f!.frequency.setTargetAtTime(3500 + sp * 1500, t, tc);
    L.grind.g.gain.setTargetAtTime(s.grinding ? 0.2 + sp * 0.12 : 0, t, 0.03);
    if (L.grind.o) L.grind.o.frequency.setTargetAtTime(150 + sp * 260 + Math.sin(t * 17) * 25, t, 0.05);
    L.grind.f!.frequency.setTargetAtTime(1800 + sp * 1800, t, 0.08);
    const bs = s.boosting ? 1 : 0;
    L.boost.g.gain.setTargetAtTime(bs * 0.2, t, bs ? 0.05 : 0.18);
    L.boost.f!.frequency.setTargetAtTime(bs ? 900 + sp * 1800 : 300, t, 0.3);
    if (L.boost.o) L.boost.o.frequency.setTargetAtTime(58 + sp * 40, t, 0.2);
    L.boostN.f!.frequency.setTargetAtTime(900 + sp * 2800, t, 0.2);
    // ---- music state ----
    const m = this.mstate; m.air = s.air; m.boost = s.boosting; m.speed01 = sp; m.pack01 = s.pack01; m.racing = s.racing;
    if (s.crashed && m.crash <= 0) m.crash = 0.9;
    if (m.crash > 0) m.crash -= dt;
    this.mix.final = s.finalSection; this.mix.finished = s.finished;
    const mx = this.mix, ss = (a: number, b: number, x: number) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
    const rac = s.racing && !s.finished ? 1 : 0;
    const airK = m.air ? 1 : 0;
    const tgt = {
      drums: s.racing ? (s.finished ? 0.35 : 1) : 0,
      bass: s.racing ? (s.finished ? 0.4 : 1) * (airK ? 0.7 : 1) : 0,
      perc: rac * (0.45 + 0.55 * s.pack01 + (m.boost ? 0.2 : 0)),
      hook: s.racing ? (s.finished ? 0.5 : Math.max(0.35, ss(0.28, 0.55, sp)) * (airK ? 0.55 : 1)) : 0,
      pad: s.racing ? (airK ? 1.0 : 0.5) : 0.7,
      rock: rac * Math.max(m.boost ? 1 : 0, s.finalSection ? 0.9 : 0, ss(0.85, 1.0, sp) * 0.7, s.pack01 > 0.75 ? 0.5 : 0),
    } as Record<string, number>;
    for (const k of Object.keys(tgt)) { mx[k as 'drums'] = tgt[k]; this.layer[k].gain.setTargetAtTime(tgt[k] * ({ drums: 0.95, bass: 0.9, perc: 0.5, hook: 0.5, pad: 0.32, rock: 0.55 } as any)[k], t, 0.1); }
    // filter: closes in air / crash, snaps open on landing
    let f = 18000;
    if (m.crash > 0) f = 420; else if (m.air) f = 1500 + Math.min(1500, 0);
    if (f !== this.lastFilterTarget) { this.musicFilter.frequency.cancelScheduledValues(t); this.musicFilter.frequency.setTargetAtTime(f, t, f > this.lastFilterTarget ? 0.05 : 0.22); this.lastFilterTarget = f; }
    this.musicDuck.gain.setTargetAtTime(m.crash > 0 ? 0.55 : 1, t, 0.08);
  }

  // ---------- sequencer ----------
  private tick() {
    if (!this.ready) return;
    const c = this.ctx;
    while (this.nextTime < c.currentTime + 0.14) { this.step(this.stepIdx, this.nextTime); this.nextTime += STEP; this.stepIdx = (this.stepIdx + 1) % 128; this.stats.steps++; }
  }
  private step(i: number, t: number) {
    const bar = (i >> 4) & 7, st = i & 15, mx = this.mix;
    const L = this.layer;
    if (!this.mstate.racing && st === 0) { if (mx.pad > 0.05) this.padChord(bar, t, STEP * 16, L.pad); }
    if (this.mstate.racing && st === 0) this.padChord(bar, t, STEP * 16, L.pad);
    if (!this.mstate.racing) { // countdown: ticking hat + building riser feel
      if (st % 4 === 0) this.hat(t, 0.25, 0.03, L.drums); return;
    }
    const intense = Math.max(mx.rock, this.mstate.boost ? 1 : 0);
    // drums
    const kicks = bar % 2 ? KICK_B : KICK_A;
    if (kicks.includes(st)) this.kick(t, st === 0 ? 1 : 0.85);
    if (st === 4 || st === 12) { this.snare(t, 1); this.clap(t, 0.5); }
    if ((st === 7 || st === 9 || st === 15) && bar % 2 === 0) this.snare(t, 0.22);
    if (st === 14 && bar % 2) this.snare(t, 0.3);
    if (st % 2 === 0) this.hat(t, st % 4 === 2 ? 0.55 : 0.4, 0.04, L.drums);
    else if (intense > 0.3 || mx.perc > 0.8) this.hat(t, 0.2, 0.025, L.drums);
    if (st === 6 || st === 14) this.hat(t, 0.45, 0.16, L.drums);
    if (bar === 7 && st >= 12) this.snare(t, 0.4 + (st - 12) * 0.2);
    if (st === 0 && (bar === 0 || bar === 4)) this.crash(t, 0.5);
    // percussion
    if (mx.perc > 0.05) {
      this.shaker(t, st % 4 === 2 ? 0.5 : 0.28);
      if (st === 3 || st === 7 || st === 11 || st === 15) this.cowbell(t, st === 15 ? 0.5 : 0.3);
      if (st === 5 || st === 9 || st === 14) this.conga(t, st === 9 ? 480 : 360);
    }
    // bass
    if (mx.bass > 0.05) {
      const pat = bar % 2 ? BASS_B : BASS_A;
      for (const [s0, semi, len] of pat) if (s0 === st) this.bass(ROOTS[bar] * Math.pow(2, semi / 12), t, STEP * len * 0.95);
    }
    // hook
    if (mx.hook > 0.05) {
      const h = HOOK[bar] || HOOK[bar === 1 ? 0 : bar === 4 ? 0 : bar === 5 ? 0 : bar === 6 ? 2 : 0];
      for (const [s0, f, len] of h) if (s0 === st) this.lead(f, t, STEP * len * 0.9);
    }
    // rock layer: power-chord hits + acid arp
    if (mx.rock > 0.05) {
      if ([0, 3, 6, 10].includes(st)) this.powerChord(ROOTS[bar] * 2, t, STEP * 1.6);
      this.acid(ROOTS[bar] * 2 * Math.pow(2, ARP[st & 7] / 12), t, STEP * 0.8, st);
      if (st === 8 || st === 0) this.kick(t, 0.5);
    }
    if (mx.rock > 0.05 && [2, 7, 13].includes(st)) this.stab(CHORDS[bar], t);
  }

  // ---------- music voices ----------
  private env(g: GainNode, t: number, a: number, peak: number, d: number) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  private osc(type: OscT, f: number, t: number, dur: number, dest: AudioNode, peak: number, a = 0.004, f1?: number) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    this.env(g, t, a, peak, dur); o.connect(g); g.connect(dest); o.start(t); o.stop(t + a + dur + 0.05); return g;
  }
  private nz(t: number, dur: number, ft: BiquadFilterType, f0: number, f1: number, q: number, peak: number, dest: AudioNode, a = 0.002) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise; const f = c.createBiquadFilter(); f.type = ft; f.Q.value = q; f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); this.env(g, t, a, peak, dur); s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random() * 1.5); s.stop(t + a + dur + 0.05);
  }
  private kick(t: number, v: number) {
    const d = this.layer.drums; this.osc('sine', 165, t, 0.22, d, 1.0 * v, 0.002, 44);
    this.osc('triangle', 95, t, 0.06, d, 0.5 * v, 0.001, 55); this.nz(t, 0.02, 'highpass', 3000, 3000, 0.7, 0.35 * v, d);
  }
  private snare(t: number, v: number) { const d = this.layer.drums; this.nz(t, 0.17, 'bandpass', 2400, 1800, 0.7, 0.8 * v, d); this.osc('triangle', 210, t, 0.1, d, 0.55 * v, 0.001, 150); this.nz(t, 0.06, 'highpass', 6000, 6000, 0.7, 0.3 * v, d); }
  private clap(t: number, v: number) { const d = this.layer.drums; for (let k = 0; k < 3; k++) this.nz(t + k * 0.011, 0.07, 'bandpass', 1400, 1200, 1.2, 0.5 * v, d); }
  private hat(t: number, v: number, dur: number, dest: AudioNode) { this.nz(t, dur, 'highpass', 8000, 8000, 0.7, 0.38 * v, dest); }
  private crash(t: number, v: number) { this.nz(t, 1.4, 'highpass', 5500, 4000, 0.6, 0.5 * v, this.layer.drums); }
  private shaker(t: number, v: number) { this.nz(t, 0.05, 'bandpass', 7000, 7000, 1.5, 0.35 * v, this.layer.perc); }
  private cowbell(t: number, v: number) { const d = this.layer.perc; this.osc('square', 587, t, 0.12, d, 0.18 * v); this.osc('square', 845, t, 0.12, d, 0.18 * v); }
  private conga(t: number, f: number) { this.osc('sine', f, t, 0.14, this.layer.perc, 0.5, 0.002, f * 0.7); this.nz(t, 0.02, 'bandpass', 1500, 1500, 1, 0.2, this.layer.perc); }
  private bass(f: number, t: number, dur: number) {
    const c = this.ctx, d = this.layer.bass;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.value = f * 1.006;
    const sub = c.createOscillator(); sub.type = 'sine'; sub.frequency.value = f / 2;
    const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = 6; fl.frequency.setValueAtTime(260, t); fl.frequency.exponentialRampToValueAtTime(2100, t + 0.025); fl.frequency.exponentialRampToValueAtTime(320, t + dur);
    const g = c.createGain(); this.env(g, t, 0.004, 0.55, dur + 0.05); const sg = c.createGain(); sg.gain.value = 0.9;
    const ws = c.createWaveShaper(); ws.curve = this.curve(8);
    o.connect(fl); o2.connect(fl); fl.connect(ws); ws.connect(g); sub.connect(sg); sg.connect(g); g.connect(d);
    for (const x of [o, o2, sub]) { x.start(t); x.stop(t + dur + 0.1); }
  }
  private lead(f: number, t: number, dur: number) {
    const c = this.ctx, d = this.layer.hook;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.value = f * 1.004;
    const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = 5; fl.frequency.setValueAtTime(900, t); fl.frequency.exponentialRampToValueAtTime(4200, t + 0.04); fl.frequency.exponentialRampToValueAtTime(1500, t + dur);
    const g = c.createGain(); this.env(g, t, 0.006, 0.34, dur + 0.08);
    const lfo = c.createOscillator(); lfo.frequency.value = 6; const lg = c.createGain(); lg.gain.value = f * 0.008; lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
    o.connect(fl); o2.connect(fl); fl.connect(g); g.connect(d); for (const x of [o, o2, lfo]) { x.start(t); x.stop(t + dur + 0.15); }
  }
  private powerChord(f: number, t: number, dur: number) {
    const c = this.ctx, d = this.layer.rock; const g = c.createGain(); this.env(g, t, 0.003, 0.5, dur);
    const ws = c.createWaveShaper(); ws.curve = this.curve(60); const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 3200;
    for (const m of [1, 1.4983, 2, 2.9966]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * m; o.detune.value = (Math.random() - .5) * 12; o.connect(ws); o.start(t); o.stop(t + dur + 0.1); }
    ws.connect(fl); fl.connect(g); g.connect(d);
  }
  private acid(f: number, t: number, dur: number, st: number) {
    const c = this.ctx, d = this.layer.rock; const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f;
    const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = 12; const base = 500 + ((st * 97) % 700);
    fl.frequency.setValueAtTime(base, t); fl.frequency.exponentialRampToValueAtTime(base * 5, t + 0.02); fl.frequency.exponentialRampToValueAtTime(base, t + dur);
    const g = c.createGain(); this.env(g, t, 0.002, 0.16, dur); o.connect(fl); fl.connect(g); g.connect(d); o.start(t); o.stop(t + dur + 0.05);
  }
  private stab(chord: number[], t: number) {
    const c = this.ctx, d = this.layer.rock; const g = c.createGain(); this.env(g, t, 0.003, 0.28, 0.13);
    const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(5200, t); fl.frequency.exponentialRampToValueAtTime(900, t + 0.14);
    for (const f of chord) for (const dt of [-6, 6]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * 2; o.detune.value = dt; o.connect(fl); o.start(t); o.stop(t + 0.2); }
    fl.connect(g); g.connect(d);
  }
  private padChord(bar: number, t: number, dur: number, dest: AudioNode) {
    const c = this.ctx; const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.4); g.gain.setValueAtTime(0.5, t + dur - 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.2);
    const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(700, t); fl.frequency.linearRampToValueAtTime(2400, t + dur * 0.6); fl.Q.value = 1.5;
    for (const f of CHORDS[bar]) for (const dt of [-9, 0, 9]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = dt; o.connect(fl); o.start(t); o.stop(t + dur + 0.3); }
    fl.connect(g); g.connect(dest);
  }

  // ---------- one-shot SFX ----------
  private out(pan: number, vol: number) {
    const c = this.ctx, g = c.createGain(); g.gain.value = vol; let last: AudioNode = g;
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); last = p; }
    last.connect(this.sfxGain); this.stats.sfx++; return g;
  }
  private count(n: string) { this.stats.events[n] = (this.stats.events[n] || 0) + 1; }

  thump(i: number, pan = 0, vol = 1) {
    if (!this.ready) return; this.count('thump'); const t = this.ctx.currentTime, o = this.out(pan, vol), k = Math.min(1.3, 0.3 + i);
    this.osc('sine', 130, t, 0.5, o, 1.1 * k, 0.002, 34); this.osc('triangle', 85, t, 0.18, o, 0.7 * k, 0.001, 45);
    this.nz(t, 0.28, 'lowpass', 900, 160, 0.7, 0.8 * k, o); this.nz(t, 0.09, 'bandpass', 2400, 900, 0.8, 0.35 * k, o);
    if (i > 0.7) { this.osc('sine', 52, t + 0.02, 0.9, o, 0.8, 0.01, 28); this.nz(t + 0.03, 0.5, 'lowpass', 500, 90, 0.5, 0.5, o); }
  }
  jump(pan = 0, vol = 1) { if (!this.ready) return; this.count('jump'); const t = this.ctx.currentTime, o = this.out(pan, vol); this.nz(t, 0.28, 'bandpass', 500, 2800, 1.2, 0.35, o, 0.04); this.osc('sine', 220, t, 0.12, o, 0.4, 0.002, 90); }
  takeoffBig(i: number) { if (!this.ready) return; this.count('takeoff'); const t = this.ctx.currentTime, o = this.out(0, 1); this.nz(t, 0.5, 'bandpass', 300, 3200, 1, 0.45 * i, o, 0.1); this.osc('sine', 90, t, 0.25, o, 0.7 * i, 0.002, 160); }
  landing(i: number, q: string, pan = 0, vol = 1) {
    if (!this.ready) return; this.count('land_' + q);
    this.thump(Math.min(1.2, i / 28), pan, vol);
    if (i > 14) { // big landing: music snaps back with weight
      const t = this.ctx.currentTime; this.musicFilter.frequency.cancelScheduledValues(t); this.musicFilter.frequency.setValueAtTime(18000, t); this.lastFilterTarget = 18000;
      this.mstate.crash = 0; const o = this.out(0, vol * Math.min(1, i / 30));
      this.nz(t, 1.0, 'highpass', 4500, 3000, 0.6, 0.5, o); this.osc('sine', 70, t, 0.6, o, 0.8, 0.002, 30);
      this.kick(t + 0.001, 1); // slam the beat back
    }
    if (q === 'perfect') this.chime(5, 1.2); else if (q === 'clean') this.chime(2, 1);
  }
  crashSfx(sev: number, pan = 0, vol = 1) {
    if (!this.ready) return; this.count('crash'); const t = this.ctx.currentTime, o = this.out(pan, vol);
    this.thump(1.1, pan, vol);
    this.nz(t, 0.7, 'lowpass', 3500, 250, 0.8, 0.9, o); this.nz(t + 0.02, 0.18, 'bandpass', 1800, 700, 1.4, 0.7, o);
    const bonk = this.ctx.createWaveShaper(); bonk.curve = this.curve(40); const bg = this.ctx.createGain(); bg.connect(o); bonk.connect(bg);
    const osc = this.ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(320, t); osc.frequency.exponentialRampToValueAtTime(48, t + 0.45); const eg = this.ctx.createGain(); this.env(eg, t, 0.003, 0.5, 0.45); osc.connect(eg); eg.connect(bonk); osc.start(t); osc.stop(t + 0.6);
    [0.13, 0.27, 0.43, 0.6].forEach((dt, k) => { const oo = this.out(pan + (Math.random() - 0.5) * 0.4, vol * (0.6 - k * 0.12)); this.osc('sine', 100 - k * 12, t + dt, 0.2, oo, 0.7, 0.002, 40); this.nz(t + dt, 0.14, 'lowpass', 1600, 300, 0.7, 0.5, oo); });
    for (let k = 0; k < 5; k++) this.nz(t + 0.05 + Math.random() * 0.5, 0.025, 'highpass', 5000 + Math.random() * 3000, 5000, 1, 0.3, o);
    void sev;
  }
  bump(i: number, pan = 0, vol = 1) {
    if (!this.ready) return; this.count('bump'); const t = this.ctx.currentTime, o = this.out(pan, vol * Math.min(1, 0.4 + i / 14)), k = Math.min(1, i / 10);
    this.osc('sine', 120, t, 0.14, o, 0.9, 0.002, 55); this.nz(t, 0.1, 'bandpass', 700, 400, 0.8, 0.7, o); this.nz(t, 0.03, 'highpass', 4000, 4000, 1, 0.3 * k, o);
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 520; f.Q.value = 3; f.connect(o);
    const oo = this.ctx.createOscillator(); oo.type = 'sawtooth'; oo.frequency.setValueAtTime(170, t); oo.frequency.exponentialRampToValueAtTime(105, t + 0.14); const g = this.ctx.createGain(); this.env(g, t, 0.005, 0.25 * k, 0.14); oo.connect(g); g.connect(f); oo.start(t); oo.stop(t + 0.22);
  }
  shove(hard: boolean, pan = 0, vol = 1) {
    if (!this.ready) return; this.count('shove'); const t = this.ctx.currentTime, o = this.out(pan, vol);
    this.nz(t - 0.0, 0.12, 'bandpass', 2600, 700, 1.1, 0.5, o, 0.02);
    this.osc('sine', 115, t + 0.06, 0.22, o, 1.0, 0.002, 48); this.nz(t + 0.06, 0.14, 'lowpass', 1100, 250, 0.9, 0.9, o); this.nz(t + 0.06, 0.04, 'highpass', 3500, 3500, 1, 0.5, o);
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 800; f.Q.value = 2.5; f.connect(o); const oo = this.ctx.createOscillator(); oo.type = 'sawtooth'; oo.frequency.setValueAtTime(240, t + 0.04); oo.frequency.exponentialRampToValueAtTime(140, t + 0.2); const g = this.ctx.createGain(); this.env(g, t + 0.04, 0.01, 0.35, 0.16); oo.connect(g); g.connect(f); oo.start(t + 0.04); oo.stop(t + 0.3);
    if (hard) { this.osc('sine', 60, t + 0.07, 0.5, o, 0.9, 0.003, 32); }
  }
  shoveMiss(pan = 0, vol = 1) { if (!this.ready) return; this.count('shoveMiss'); const t = this.ctx.currentTime, o = this.out(pan, vol * 0.8); this.nz(t, 0.2, 'bandpass', 2200, 600, 1, 0.45, o, 0.03); this.nz(t + 0.12, 0.1, 'bandpass', 500, 300, 1, 0.3, o); }
  boostOn() {
    if (!this.ready) return; this.count('boostOn'); const t = this.ctx.currentTime, o = this.out(0, 1);
    this.osc('sawtooth', 70, t, 0.7, o, 0.5, 0.01, 480); this.nz(t, 0.8, 'bandpass', 300, 6000, 1.3, 0.75, o, 0.08);
    this.osc('sine', 100, t + 0.05, 0.6, o, 1.1, 0.002, 28); this.nz(t + 0.02, 0.5, 'lowpass', 2500, 200, 0.7, 0.8, o);
    this.chime(4, 1); this.nz(t + 0.1, 1.1, 'highpass', 5000, 3500, 0.7, 0.35, o);
  }
  chime(n: number, v: number) { if (!this.ready) return; const t = this.ctx.currentTime, o = this.out(0, 0.55 * v); const base = [0, 4, 7, 12, 16, 19, 24]; for (let k = 0; k < Math.min(n, 7); k++) { this.osc('triangle', mtof(81 + base[k]), t + k * 0.055, 0.28, o, 0.35); this.osc('sine', mtof(93 + base[k]), t + k * 0.055, 0.2, o, 0.12); } }
  boostGain(amount: number) { if (!this.ready) return; this.count('boostGain'); this.chime(Math.min(7, 2 + Math.floor(amount / 6)), 0.8 + Math.min(0.6, amount / 40)); }
  grindStart(pan = 0, vol = 1) { if (!this.ready) return; this.count('grindStart'); const t = this.ctx.currentTime, o = this.out(pan, vol); for (const f of [1210, 1893, 2711, 3510]) this.osc('square', f, t, 0.18, o, 0.14); this.nz(t, 0.12, 'highpass', 4000, 4000, 1, 0.5, o); this.osc('sine', 120, t, 0.12, o, 0.5, 0.002, 70); }
  pass(dir: number) { if (!this.ready) return; this.count('pass'); const t = this.ctx.currentTime, o = this.out(0, 0.9); this.nz(t, 0.35, 'bandpass', 2000, 450, 1, 0.45, o, 0.05); if (dir > 0) { this.osc('triangle', 660, t, 0.1, o, 0.3); this.osc('triangle', 990, t + 0.07, 0.18, o, 0.3); } else this.osc('triangle', 300, t, 0.2, o, 0.25, 0.005, 200); }
  pad(pan = 0, vol = 1) { if (!this.ready) return; this.count('pad'); const t = this.ctx.currentTime, o = this.out(pan, vol); this.osc('sawtooth', 300, t, 0.35, o, 0.3, 0.005, 1500); this.nz(t, 0.4, 'bandpass', 800, 5000, 1.5, 0.5, o, 0.03); this.osc('sine', 80, t, 0.2, o, 0.5, 0.002, 160); }
  wall(i: number, pan = 0, vol = 1) { if (!this.ready) return; this.count('wall'); const t = this.ctx.currentTime, o = this.out(pan, vol * Math.min(1, i / 14 + 0.3)); this.osc('sine', 90, t, 0.18, o, 0.8, 0.002, 45); this.nz(t, 0.35, 'bandpass', 1500, 500, 0.9, 0.6, o); }
  beep(go: boolean) { if (!this.ready) return; this.count(go ? 'go' : 'beep'); const t = this.ctx.currentTime, o = this.out(0, 0.8); if (go) { this.osc('square', 880, t, 0.5, o, 0.45); this.osc('sawtooth', 440, t, 0.5, o, 0.3); this.nz(t, 0.6, 'highpass', 4000, 3000, 0.6, 0.5, o); this.osc('sine', 80, t, 0.5, o, 1.0, 0.002, 30); } else this.osc('square', 440, t, 0.16, o, 0.4); }
  ui() { if (!this.ready) return; const t = this.ctx.currentTime, o = this.out(0, 0.6); this.osc('triangle', 700, t, 0.07, o, 0.3, 0.002, 1100); }
  finishSting(rank: number) {
    if (!this.ready) return; this.count('finish'); const t = this.ctx.currentTime, o = this.out(0, 1);
    const win = rank <= 3, notes = win ? [69, 73, 76, 81, 85, 88] : [69, 67, 64, 62];
    notes.forEach((m, k) => { this.osc('sawtooth', mtof(m), t + k * 0.09, 0.9, o, 0.22, 0.005); this.osc('square', mtof(m + 12), t + k * 0.09, 0.5, o, 0.1, 0.005); });
    this.nz(t, 2.2, 'highpass', 5000, 3500, 0.6, 0.55, o); this.osc('sine', 90, t, 0.8, o, 1.1, 0.002, 30);
    for (const m of win ? [57, 61, 64] : [57, 60, 64]) this.osc('sawtooth', mtof(m), t + 0.5, 1.8, o, 0.2, 0.01);
  }
}
