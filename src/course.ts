// Course model: a spline-like centerline (s = distance along, l = lateral offset) with
// analytic ground height, features (ramps, rails, pads, walls, obstacles). Pure logic, no DOM/Three.
export type Key = [number, number];
export interface Ramp { s0: number; len: number; h: number; l0: number; l1: number; name: string }
export interface Rail { s0: number; s1: number; l: number; h: number }
export interface Pad { s: number; l: number }
export interface Wall { s0: number; s1: number; l0: number; l1: number; h: number }
export interface Obstacle { s: number; l: number; r: number; h: number; kind: 'tree' | 'rock' | 'barrier' | 'pylon' }
export interface Zone { s0: number; s1: number; l0: number; l1: number }
export interface Frame { x: number; z: number; y: number; psi: number; desc: number; kappa: number; bank: number; W: number }

export const FINISH_S = 3200;
export const START_S = 12;
export const RUNOUT = 260;
const DS = 1;

const ss = (t: number) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
export const smooth = ss;
function keyed(keys: Key[], s: number): number {
  if (s <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (s <= keys[i][0]) {
      const a = keys[i - 1], b = keys[i];
      return a[1] + (b[1] - a[1]) * ss((s - a[0]) / (b[0] - a[0]));
    }
  }
  return keys[keys.length - 1][1];
}

// seeded RNG so the course is identical every run
function mulberry(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// descent rate (dy/ds, positive = downhill) — drives speed
const DESC: Key[] = [[0, .08], [80, .13], [160, .30], [500, .31], [580, .20], [900, .18], [980, .26], [1100, .26],
  [1180, .22], [1330, .21], [1400, .24], [1850, .23], [1900, .21], [2200, .2], [2300, .24], [2480, .30], [2640, .34],
  [3150, .36], [3230, .12], [3400, .03], [3500, .03]];
// curvature (positive = turn right)
const KAPPA: Key[] = [[0, 0], [300, 0], [340, .0010], [480, .0012], [520, 0], [545, .0045], [620, .0045], [650, 0], [690, -.0045],
  [760, -.0045], [790, 0], [1280, 0], [1310, -.0050], [1420, -.0050], [1460, 0], [1850, 0], [1880, .0062], [2090, .0062],
  [2130, 0], [2600, 0], [2650, -.0022], [2850, -.0022], [2900, 0], [3500, 0]];
// half width
const WIDTH: Key[] = [[0, 20], [100, 25], [400, 29], [560, 31], [900, 29], [1000, 28], [1060, 22], [1130, 13], [1170, 12], [1230, 13],
  [1290, 24], [1450, 27], [1490, 27], [1850, 26], [1930, 27], [2200, 29], [2380, 28], [2480, 27], [2640, 25], [3100, 27], [3200, 29], [3500, 42]];

export class Course {
  readonly L = FINISH_S;
  readonly total = FINISH_S + RUNOUT;
  readonly N: number;
  cx: Float32Array; cz: Float32Array; cy: Float32Array; psi: Float32Array;
  desc: Float32Array; kappa: Float32Array; bank: Float32Array; W: Float32Array;
  ramps: Ramp[] = []; rails: Rail[] = []; pads: Pad[] = []; walls: Wall[] = [];
  obstacles: Obstacle[] = [];
  powder: Zone = { s0: 1560, s1: 1800, l0: -40, l1: -5 };
  split = { s0: 1500, s1: 1840, mainL: -15.5, shortL: 10 };
  bottleneck = { s: 1170 };
  tmp: Frame = { x: 0, z: 0, y: 0, psi: 0, desc: 0, kappa: 0, bank: 0, W: 0 };

  constructor() {
    const N = this.N = Math.ceil(this.total / DS) + 4;
    this.cx = new Float32Array(N); this.cz = new Float32Array(N); this.cy = new Float32Array(N); this.psi = new Float32Array(N);
    this.desc = new Float32Array(N); this.kappa = new Float32Array(N); this.bank = new Float32Array(N); this.W = new Float32Array(N);
    let x = 0, z = 0, y = 900, psi = 0;
    for (let i = 0; i < N; i++) {
      const s = i * DS;
      const d = keyed(DESC, s), k = keyed(KAPPA, s);
      this.cx[i] = x; this.cz[i] = z; this.cy[i] = y; this.psi[i] = psi; this.desc[i] = d; this.kappa[i] = k;
      this.bank[i] = Math.max(-0.3, Math.min(0.3, k * 60)); this.W[i] = keyed(WIDTH, s);
      x += Math.sin(psi) * DS; z -= Math.cos(psi) * DS; y -= d * DS; psi += k * DS;
    }
    this.buildFeatures();
  }

  private buildFeatures() {
    const R = this.ramps, rn = mulberry(7);
    const ramp = (name: string, s0: number, len: number, h: number, l0: number, l1: number) => R.push({ name, s0, len, h, l0, l1 });
    ramp('kicker', 420, 12, 2.6, -4, 4);              // early air within ~12s
    ramp('side', 500, 12, 2.2, -27, -19); ramp('side', 500, 12, 2.2, 19, 27);
    // JUMP 1
    ramp('big', 830, 20, 9.5, -9, 9); ramp('mid', 830, 14, 4.5, -27, -15); ramp('mid', 830, 14, 5, 15, 27);
    // shortcut kicker + huge shortcut ramp, main-lane small hop
    ramp('kicker', 1700, 11, 2.4, 8.4, 11.6);
    ramp('shortbig', 1815, 18, 11, 6, 14);
    ramp('hop', 1730, 12, 3.2, -19, -12);
    ramp('kicker', 2040, 11, 2.4, 6.5, 9.5);
    // JUMP 2
    ramp('giant', 2400, 24, 13, -10, 10); ramp('mid', 2400, 16, 6, -26, -14); ramp('mid', 2400, 16, 6, 14, 26);
    ramp('kicker', 3000, 12, 3, -4, 4);
    this.rails.push({ s0: 1730, s1: 1790, l: 10, h: 1.15 });       // shortcut rail (kicker -> rail -> pad -> huge ramp)
    this.rails.push({ s0: 2085, s1: 2150, l: 8, h: 1.15 });        // hairpin inside rail
    this.rails.push({ s0: 3060, s1: 3110, l: -9, h: 1.15 });       // late rail beside final descent
    for (const s of [140, 300, 760, 1000, 1360, 1560, 1700 + 55, 1900, 2210, 2560, 2820, 3100]) this.pads.push({ s, l: s === 1755 ? 10 : (rn() - 0.5) * 8 });
    this.pads.push({ s: 1790, l: 10 }, { s: 1640, l: 10 }, { s: 1660, l: -15 });
    // island splitting main lane (left) and shortcut (right); outer wall narrows shortcut
    this.walls.push({ s0: 1530, s1: 1830, l0: -4.5, l1: 4.5, h: 4 });
    this.walls.push({ s0: 1520, s1: 1850, l0: 15.5, l1: 60, h: 4 });
    // bottleneck centre rock + hazards
    const O = this.obstacles;
    O.push({ s: 1170, l: 0, r: 2.2, h: 3, kind: 'rock' });
    O.push({ s: 1135, l: -9, r: 1.3, h: 2, kind: 'rock' }, { s: 1205, l: 8.5, r: 1.3, h: 2, kind: 'rock' });
    O.push({ s: 1120, l: 4.5, r: 1, h: 2.5, kind: 'pylon' }, { s: 1250, l: -5, r: 1, h: 2.5, kind: 'pylon' });
    // boulders/trees in the mid-course so shoving there is dangerous
    O.push({ s: 450, l: 8, r: 1.6, h: 2.5, kind: 'rock' }, { s: 600, l: -4, r: 1.6, h: 2.5, kind: 'rock' });
    O.push({ s: 2260, l: 2, r: 1.2, h: 3, kind: 'pylon' }, { s: 2262, l: -3, r: 1.2, h: 3, kind: 'pylon' });
    O.push({ s: 2330, l: 6, r: 1.6, h: 2.5, kind: 'rock' });
    O.push({ s: 2900, l: 9, r: 1.8, h: 3, kind: 'rock' }, { s: 3140, l: -8, r: 1.8, h: 3, kind: 'rock' });
    // shortcut trees
    O.push({ s: 1620, l: 13.5, r: 1, h: 4, kind: 'tree' }, { s: 1675, l: 6.2, r: 1, h: 4, kind: 'tree' }, { s: 1760, l: 13.8, r: 1, h: 4, kind: 'tree' });
    // edge clutter (collidable-ish): rocks and trees hugging the edges
    for (let s = 220; s < 3150; s += 38 + rn() * 30) {
      const near = (a: number, b: number) => s > a - 25 && s < b + 25;
      if (near(820, 870) || near(2390, 2440) || near(1500, 1860) || near(1090, 1260)) continue;
      const W = this.W[Math.round(s)], side = rn() < 0.5 ? -1 : 1;
      const off = 1.4 + rn() * 4;
      if (rn() < 0.55) O.push({ s, l: side * (W - off), r: 1.1 + rn() * .8, h: 3, kind: 'tree' });
      else O.push({ s, l: side * (W - off - 1), r: 1.2 + rn() * 1, h: 2.2, kind: 'rock' });
    }
    // barrier fence lining the bottleneck entry
    for (let k = 0; k < 4; k++) { O.push({ s: 1085 + k * 7, l: -(this.W[1085 + k * 7] - 1.5), r: 1.3, h: 1.6, kind: 'barrier' });
      O.push({ s: 1085 + k * 7, l: this.W[1085 + k * 7] - 1.5, r: 1.3, h: 1.6, kind: 'barrier' }); }
    O.sort((a, b) => a.s - b.s);
  }

  sample(s: number, o: Frame = this.tmp): Frame {
    if (s < 0) s = 0; const max = this.N - 3; if (s > max) s = max;
    const i = Math.floor(s / DS), f = s / DS - i;
    const L = (a: Float32Array) => a[i] + (a[i + 1] - a[i]) * f;
    o.x = L(this.cx); o.z = L(this.cz); o.y = L(this.cy); o.psi = L(this.psi);
    o.desc = L(this.desc); o.kappa = L(this.kappa); o.bank = L(this.bank); o.W = L(this.W);
    return o;
  }
  halfWidth(s: number) { return this.sample(s).W; }

  /** ground height at (s,l), incl. banking, ramps, walls, powder moguls, side berms */
  height(s: number, l: number): number {
    const f = this.sample(s);
    let y = f.y - f.bank * l;
    const W = f.W, a = Math.abs(l);
    if (a > W) { const d = a - W; y += 0.5 * d + 0.03 * d * d + Math.sin(s * 0.21 + l * 0.17) * 0.04 * d; }
    y += this.featureH(s, l);
    return y;
  }
  featureH(s: number, l: number): number {
    let y = 0;
    for (const r of this.ramps) {
      if (s < r.s0 || s > r.s0 + r.len + 4) continue;
      const m = ss((l - r.l0 + 0.8) / 1.6) * (1 - ss((l - r.l1 + 0.8) / 1.6));
      if (m <= 0) continue;
      const t = (s - r.s0) / r.len;
      const p = t <= 1 ? r.h * Math.pow(t, 1.5) : r.h * (1 - ss((s - r.s0 - r.len) / 4));
      y += p * m;
    }
    for (const w of this.walls) {
      if (s < w.s0 - 3 || s > w.s1 + 3) continue;
      const m = ss((s - w.s0 + 3) / 3) * (1 - ss((s - w.s1) / 3)) * ss((l - w.l0 + 1.2) / 2.4) * (1 - ss((l - w.l1 + 1.2) / 2.4));
      y += w.h * m;
    }
    const P = this.powder;
    if (s > P.s0 && s < P.s1 && l < P.l1) y += 0.28 * Math.sin(s * 0.85) * Math.sin(l * 0.6 + 1) * ss((s - P.s0) / 8) * (1 - ss((s - P.s1 + 8) / 8));
    return y;
  }
  /** > 1 drag multiplier for powder lane */
  dragMul(s: number, l: number) {
    const P = this.powder;
    return s > P.s0 && s < P.s1 && l < P.l1 && l > P.l0 ? 1.65 : 1;
  }
  /** wall rectangle containing (s,l), or null */
  wallAt(s: number, l: number, pad = 0): Wall | null {
    for (const w of this.walls) if (s > w.s0 - pad && s < w.s1 + pad && l > w.l0 - pad && l < w.l1 + pad) return w;
    return null;
  }
  /** free-space lateral limits at s, accounting for walls (returns [min,max] around l) */
  lateralLimits(s: number, l: number, out: [number, number]) {
    const W = this.halfWidth(s);
    let lo = -W, hi = W;
    for (const w of this.walls) {
      if (s < w.s0 - 1 || s > w.s1 + 1) continue;
      if (w.l1 <= l) lo = Math.max(lo, w.l1); else if (w.l0 >= l) hi = Math.min(hi, w.l0);
    }
    out[0] = lo; out[1] = hi; return out;
  }
  obstaclesIn(s0: number, s1: number, cb: (o: Obstacle) => void) {
    const O = this.obstacles;
    let lo = 0, hi = O.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (O[m].s < s0 - 4) lo = m + 1; else hi = m; }
    for (let i = lo; i < O.length && O[i].s <= s1 + 4; i++) cb(O[i]);
  }
}
