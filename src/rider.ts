// Rider state + arcade physics in course space (s along, l lateral, y world height).
import { Course, Frame, FINISH_S } from './course';

export interface RiderInput {
  steer: number; pitch: number; tuck: number; brake: number;
  jump: boolean; grab: number; shoveL: boolean; shoveR: boolean; boost: boolean;
}
export const blankInput = (): RiderInput => ({ steer: 0, pitch: 0, tuck: 0, brake: 0, jump: false, grab: 0, shoveL: false, shoveR: false, boost: false });

export type Mode = 'wait' | 'ride' | 'air' | 'grind' | 'crash';
export interface Persona {
  name: string; aggression: number; skill: number; boostUse: number; shortcut: number; tech: number; caution: number;
  pace: number; mass: number; lane: number; mistake: number; blurb: string;
}
export type EvName = 'takeoff' | 'land' | 'crash' | 'recover' | 'bump' | 'shove' | 'shoveMiss' | 'wall' | 'pad' | 'boostOn' | 'boostOff'
  | 'boostGain' | 'grindStart' | 'grindEnd' | 'finish' | 'pass' | 'hit';
export type Emit = (ev: EvName, r: Rider, a?: number, b?: any) => void;

export const G = 44, GAIR = 24, KDRAG = 0.0058;
export const DT = 1 / 120;

export class Rider {
  id = 0; name = ''; color = 0xffffff; trim = 0xffffff; isPlayer = false; persona!: Persona; mass = 1;
  mode: Mode = 'wait';
  s = 0; l = 0; y = 0; v = 0; theta = 0; thetaRate = 0; kl = 0; vs = 0; vl = 0; vy = 0; vyG = 0;
  tuck = 0; balance = 1; t = 0;
  boost = 0; boosting = false; padT = 0; padCd = 0; pushT = 0; paceMul = 1; draft = false;
  airT = 0; spin = 0; flip = 0; spinV = 0; flipV = 0; spinTot = 0; flipTot = 0; grabT = 0; grabBits = 0; grabAmt = 0; grabKind = 0;
  spinVis = 0; flipVis = 0; hopped = false; tookOff = false;
  grindT = 0; rail = -1; grindGain = 0;
  chain = 0; chainT = 0; combo = 0; lastTrick = '';
  crashT = 0; crashDur = 0; crashV = 0; tumble = [0, 0, 0]; crashCause = ''; invulnT = 0; crashes = 0;
  shoveCd = 0; shoveT = 0; shoveDir = 0; shovedT = 0; shoverId = -1; lean = 0; bumpT = 0; bumpSide = 0;
  finished = false; finishTime = 0; finishRank = 0; rank = 0; lastRank = 0;
  stats = { shoves: 0, shoved: 0, tricks: 0, boostUsed: 0, wallHits: 0, airMax: 0, shortcut: false, stuckT: 0 };
  /** AI scratch */
  ai: any = null;
}

const tmpF: Frame = { x: 0, z: 0, y: 0, psi: 0, desc: 0, kappa: 0, bank: 0, W: 0 };
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const PI = Math.PI;

export interface Ctx { course: Course; riders: Rider[]; emit: Emit; time: number }

export function maxTheta(r: Rider, brake: number) { return (0.62 - 0.22 * r.tuck) * (1 + 0.5 * brake); }

export function addBoost(r: Rider, amt: number, ctx: Ctx) {
  const before = r.boost; r.boost = clamp(r.boost + amt, 0, 100);
  if (r.boost - before > 0.5) ctx.emit('boostGain', r, r.boost - before);
}

export function crash(r: Rider, cause: string, sev: number, ctx: Ctx) {
  if (r.mode === 'crash' || r.mode === 'wait' || r.finished) return;
  if (r.invulnT > 0 && cause !== 'bail') return;
  const wasBoosting = r.boosting;
  r.mode = 'crash'; r.crashT = 0; r.crashCause = cause;
  r.v = Math.max(r.v, 10); r.crashV = r.v;
  r.crashDur = 1.0 + Math.min(0.5, sev * 0.25);
  r.boosting = false; r.padT = 0; r.chain = 0; r.combo = 0; r.chainT = 0;
  r.tumble = [(Math.random() - .5) * 14, (Math.random() - .5) * 10, (Math.random() - .5) * 14];
  r.crashes++; r.balance = 0; r.grabAmt = 0;
  r.kl = r.kl + (Math.random() - 0.5) * 6;
  if (wasBoosting) ctx.emit('boostOff', r);
  ctx.emit('crash', r, sev, cause);
}

function recover(r: Rider, ctx: Ctx) {
  const c = ctx.course;
  const lim: [number, number] = [0, 0];
  r.s += 2;
  c.lateralLimits(r.s, r.l, lim);
  let l = clamp(r.l, lim[0] + 2.5, lim[1] - 2.5);
  // nudge away from obstacles directly ahead
  for (let tries = 0; tries < 4; tries++) {
    let bad = 0;
    c.obstaclesIn(r.s - 2, r.s + 14, (o) => { if (Math.abs(o.l - l) < o.r + 2.2) bad = o.l > l ? -1 : 1; });
    if (!bad) break;
    l = clamp(l + bad * 3, lim[0] + 2.5, lim[1] - 2.5);
  }
  r.l = l; r.mode = 'ride'; r.v = Math.max(16, r.crashV * 0.5); r.theta = 0; r.kl = 0; r.balance = 0.85;
  r.invulnT = 1.8; r.y = c.height(r.s, r.l); r.vyG = 0; r.spin = r.flip = 0;
  ctx.emit('recover', r);
}

export function trickLabel(r: Rider): string {
  const parts: string[] = [];
  const half = Math.floor(r.spinTot / PI + 0.3);
  if (half >= 1) parts.push(`${half * 180}`);
  const fl = Math.floor(r.flipTot / (2 * PI) + 0.35);
  if (fl >= 1) parts.push(fl > 1 ? `${fl}x FLIP` : 'FLIP');
  if (r.grabT > 0.12) parts.push(['', 'MUTE', 'INDY', 'MELON', 'TAIL', 'NOSE', 'STALE', 'TWEAK'][r.grabKind || 1] + ' GRAB');
  return parts.join(' + ');
}

function trickGain(r: Rider, quality: number) {
  const half = Math.floor(r.spinTot / PI + 0.3), fl = Math.floor(r.flipTot / (2 * PI) + 0.35);
  let g = 0, cats = 0;
  for (let i = 0; i < half; i++) g += 6 + 3 * i; if (half) cats++;
  for (let i = 0; i < fl; i++) g += 15 + 8 * i; if (fl) cats++;
  if (r.grabT > 0.12) { g += Math.min(14, r.grabT * 8) + (r.grabBits & (r.grabBits - 1) ? 5 : 0); cats++; }
  g += Math.max(0, r.airT - 0.8) * 5;
  const mult = 1 + 0.3 * Math.max(0, cats - 1) + 0.25 * Math.min(4, r.chain);
  return g * mult * quality;
}

function bank(r: Rider, label: string, ctx: Ctx, quality: number) {
  const gain = trickGain(r, quality);
  if (gain > 0.5) { addBoost(r, gain, ctx); r.stats.tricks++; r.chain++; r.chainT = 3; r.lastTrick = label; r.combo = gain; }
  return gain;
}

function land(r: Rider, ctx: Ctx) {
  const c = ctx.course;
  const s = r.s, l = r.l, gy = c.height(s, l);
  const gvy = r.vs * (c.height(s + .5, l) - gy) / .5 + r.vl * (c.height(s, l + .5) - gy) / .5;
  const impact = Math.max(0, gvy - r.vy);
  const spinErr = Math.abs(r.spin - Math.round(r.spin / PI) * PI);
  const flipErr = Math.abs(r.flip - Math.round(r.flip / (2 * PI)) * 2 * PI);
  const tricked = r.spinTot > 0.8 || r.flipTot > 0.8 || r.grabT > 0.2;
  let quality = 1, q = 'clean';
  if (spinErr > 0.85 || flipErr > 1.0) { quality = 0.4; q = 'sloppy'; }
  if (spinErr > 1.45 || flipErr > 1.7) { quality = 0; q = 'bail'; }
  if (spinErr < 0.3 && flipErr < 0.35 && tricked) q = 'perfect';
  if (r.airT < 0.35 && !tricked) { q = 'clean'; quality = 1; }
  const label = trickLabel(r);
  r.y = gy;
  r.spinVis = r.spin - Math.round(r.spin / PI) * PI; r.flipVis = r.flip - Math.round(r.flip / (2 * PI)) * 2 * PI;
  r.stats.airMax = Math.max(r.stats.airMax, r.airT);
  const airT = r.airT;
  r.v = Math.max(8, Math.hypot(r.vs, r.vl) * (1 - Math.min(0.12, 0.003 * Math.max(0, impact - 16))));
  r.theta = Math.atan2(r.vl, Math.max(1, r.vs)); r.kl = 0; r.vyG = 0;
  let gain = 0;
  if (q === 'bail') {
    r.mode = 'ride'; // transition so crash() accepts
    ctx.emit('land', r, impact, { q, gain: 0, label, airT });
    crash(r, 'bail', 1, ctx); return;
  }
  if (q === 'sloppy') { r.v *= 0.86; r.chain = 0; }
  if (q === 'perfect') quality = 1.25;
  gain = bank(r, label, ctx, quality);
  r.mode = 'ride'; r.airT = 0;
  r.balance = Math.min(r.balance, q === 'sloppy' ? 0.55 : 1);
  ctx.emit('land', r, impact, { q, gain, label, airT });
}

function startAir(r: Rider, vy: number, ctx: Ctx, fromRail = false) {
  r.mode = 'air'; r.vy = vy; r.airT = 0;
  r.vs = r.v * Math.cos(r.theta); r.vl = r.v * Math.sin(r.theta) + r.kl;
  r.spin = r.flip = r.spinV = r.flipV = r.spinTot = r.flipTot = 0; r.grabT = 0; r.grabBits = 0; r.grabKind = 0;
  r.tookOff = true;
  ctx.emit('takeoff', r, vy, fromRail);
}

function findRail(r: Rider, ctx: Ctx, ahead: number, latTol: number): number {
  const rails = ctx.course.rails;
  for (let i = 0; i < rails.length; i++) {
    const ra = rails[i];
    if (r.s > ra.s0 - ahead && r.s < ra.s1 - 3 && Math.abs(r.l - ra.l) < latTol) return i;
  }
  return -1;
}

function startGrind(r: Rider, i: number, ctx: Ctx) {
  r.mode = 'grind'; r.rail = i; r.grindT = 0; r.grindGain = 0; r.balance = 1;
  r.v = Math.max(r.v, Math.hypot(r.vs, r.vl)); r.theta = 0;
  if (r.id === 0 || true) r.stats.tricks += 0;
  ctx.emit('grindStart', r);
}

export function stepRider(r: Rider, inp: RiderInput, dt: number, ctx: Ctx) {
  const c = ctx.course;
  r.t += dt;
  if (r.invulnT > 0) r.invulnT -= dt;
  if (r.shoveCd > 0) r.shoveCd -= dt;
  if (r.shoveT > 0) r.shoveT -= dt;
  if (r.shovedT > 0) r.shovedT -= dt;
  if (r.padT > 0) r.padT -= dt;
  if (r.padCd > 0) r.padCd -= dt;
  if (r.pushT > 0) r.pushT -= dt;
  if (r.chainT > 0) { r.chainT -= dt; if (r.chainT <= 0) r.chain = 0; }
  if (r.bumpT > 0) r.bumpT -= dt;
  r.lean += ((r.shoveT > 0 ? r.shoveDir * 0.9 : 0) - r.lean) * Math.min(1, dt * 14);
  r.spinVis *= Math.exp(-9 * dt); r.flipVis *= Math.exp(-9 * dt);

  // boost state
  if (r.mode !== 'crash' && r.mode !== 'wait' && !r.finished) {
    if (inp.boost && !r.boosting && r.boost >= 15) { r.boosting = true; r.stats.boostUsed++; ctx.emit('boostOn', r); }
    if (r.boosting && (!inp.boost || r.boost <= 0)) { r.boosting = false; ctx.emit('boostOff', r); }
    if (r.boosting) r.boost = Math.max(0, r.boost - 22 * dt);
  }
  const vTerm = Math.sqrt(Math.max(1, G * c.sample(r.s, tmpF).desc) / KDRAG) * r.paceMul;
  const cap = clamp((1.32 * vTerm - (r.mode === 'air' ? r.vs : r.v)) / (0.25 * vTerm), 0, 1);
  const boostAcc = ((r.boosting ? 20 : 0) + (r.padT > 0 ? 12 : 0)) * cap + (r.pushT > 0 ? 9 : 0);

  switch (r.mode) {
    case 'wait': {
      r.y = c.height(r.s, r.l); r.v = 0; return;
    }
    case 'crash': {
      r.crashT += dt;
      r.v *= Math.exp(-1.9 * dt);
      r.s += r.v * Math.cos(r.theta * 0.3) * dt; r.l += (r.kl + r.v * Math.sin(r.theta) * 0.3) * dt; r.kl *= Math.exp(-3 * dt);
      const lim: [number, number] = [0, 0]; c.lateralLimits(r.s, r.l, lim);
      r.l = clamp(r.l, lim[0] + 0.6, lim[1] - 0.6);
      const gy = c.height(r.s, r.l);
      const t = r.crashT, bounce = 1.1 * Math.exp(-2.6 * t) * Math.abs(Math.sin(t * 8));
      r.y = gy + bounce;
      if (r.crashT >= r.crashDur) recover(r, ctx);
      return;
    }
    case 'grind': {
      const ra = c.rails[r.rail];
      r.grindT += dt;
      r.l += (ra.l - r.l) * Math.min(1, dt * 14);
      r.theta *= Math.exp(-10 * dt);
      r.v = Math.max(14, r.v - 2.5 * dt + (r.boosting ? 14 * dt : 0));
      r.s += r.v * dt;
      r.y = c.height(r.s, r.l) + ra.h;
      const g = 9 * dt; r.grindGain += g; addBoostQuiet(r, g);
      if (r.s >= ra.s1 || inp.jump) {
        const bonus = Math.min(14, r.grindT * 6);
        addBoost(r, bonus, ctx); r.stats.tricks++; r.chain++; r.chainT = 3; r.lastTrick = 'RAIL GRIND'; r.combo = r.grindGain + bonus;
        ctx.emit('grindEnd', r, r.grindT);
        r.vs = r.v; r.vl = 0; r.theta = 0; r.kl = 0;
        startAir(r, inp.jump ? 9 : 4, ctx, true);
        r.vs = r.v; r.vl = 0;
      }
      return;
    }
    case 'ride': {
      ride(r, inp, dt, ctx, boostAcc); return;
    }
    case 'air': {
      air(r, inp, dt, ctx, boostAcc); return;
    }
  }
}

function addBoostQuiet(r: Rider, amt: number) { r.boost = clamp(r.boost + amt, 0, 100); }

function ride(r: Rider, inp: RiderInput, dt: number, ctx: Ctx, boostAcc: number) {
  const c = ctx.course;
  const f = c.sample(r.s, tmpF);
  r.tuck += (inp.tuck - r.tuck) * Math.min(1, dt * 8);
  const brake = inp.brake;
  const maxT = maxTheta(r, brake);
  let steer = inp.steer;
  if (r.balance < 0.6) steer += Math.sin(r.t * 15 + r.id * 2) * (0.6 - r.balance) * 1.2;
  if (r.finished) steer = clamp((0 - r.l) * 0.05, -0.5, 0.5);
  const target = clamp(steer, -1, 1) * maxT;
  const dth = clamp((target - r.theta) * 9, -5.5, 5.5);
  r.theta += dth * dt; r.thetaRate = dth;
  const sinT = Math.sin(r.theta), cosT = Math.cos(r.theta);
  let v = r.v;
  const pm = r.paceMul;
  const dragMul = c.dragMul(r.s, r.l);
  let drag = KDRAG * v * v * (1 - 0.22 * r.tuck) * (1 + 2.0 * sinT * sinT) * (1 + 2.2 * brake) * dragMul * (r.draft ? 0.86 : 1);
  if (r.boosting || r.padT > 0) drag *= 0.9;
  const acc = G * f.desc * cosT * pm * pm + boostAcc;
  v += (acc - drag - 13 * brake - (dragMul > 1 ? 3 : 0) - (r.balance < 0.35 ? 9 : 0) - (r.finished ? 18 : 0)) * dt;
  if (v < 5) v = 5;
  r.v = v;
  const drift = -f.kappa * v * v * 0.55 * (1 - Math.min(1, Math.abs(f.bank) / 0.27) * 0.65);
  const vlat = v * sinT + r.kl + drift;
  const prevS = r.s;
  r.l += vlat * dt; r.kl *= Math.exp(-5 * dt);
  r.s += v * cosT * dt;
  if (r.balance < 1 && r.mode === 'ride') r.balance = Math.min(1, r.balance + 0.42 * dt);

  // pads
  if (r.padCd <= 0) for (const p of c.pads) if (Math.abs(p.s - r.s) < 2.2 && Math.abs(p.l - r.l) < 2.6) {
    r.v += 7; r.padT = 1.4; r.padCd = 1.2; ctx.emit('pad', r); break;
  }
  // walls (edges + island)
  const inW = c.wallAt(r.s, r.l);
  if (inW) {
    if (prevS < inW.s0) { r.s = prevS; r.v *= 0.6; crash(r, 'rock', 1.2, ctx); return; }
    const mid = (inW.l0 + inW.l1) / 2;
    r.l = r.l < mid ? inW.l0 - 0.55 : inW.l1 + 0.55;
    wallHit(r, Math.abs(vlat), ctx);
    if (r.mode !== 'ride') return;
  }
  const W = f.W;
  if (r.l > W + 0.3) { r.l = W + 0.3; wallHit(r, Math.max(0, vlat), ctx); if (r.mode !== 'ride') return; r.theta = Math.min(r.theta, 0); r.kl = -Math.abs(r.kl) - 2; }
  else if (r.l < -W - 0.3) { r.l = -W - 0.3; wallHit(r, Math.max(0, -vlat), ctx); if (r.mode !== 'ride') return; r.theta = Math.max(r.theta, 0); r.kl = Math.abs(r.kl) + 2; }

  // obstacles
  if (r.invulnT <= 0) {
    c.obstaclesIn(r.s - 3, r.s + 3, (o) => {
      if (r.mode !== 'ride') return;
      const d = Math.hypot(o.s - r.s, o.l - r.l);
      if (d < o.r + 0.5) {
        if (o.kind === 'barrier' && r.v < 14) return;
        const depth = o.r + 0.5 - d;
        if (depth < 0.55 && r.balance > 0.45) {   // glancing blow: scrape past instead of wiping out
          const side = r.l >= o.l ? 1 : -1;
          r.l += side * (0.55 - depth + 0.1); r.kl += side * 5; r.v *= 0.88; r.balance -= 0.4; r.stats.wallHits++;
          ctx.emit('wall', r, 9); if (r.balance <= 0) crash(r, o.kind, 1, ctx);
          return;
        }
        r.v *= 0.7; crash(r, o.kind, 1.3, ctx);
      }
    });
    if (r.mode !== 'ride') return;
  }

  // rail auto-ollie assist
  if (inp.jump) {
    const ri = findRail(r, ctx, 9, 1.8);
    if (ri >= 0 && r.s < c.rails[ri].s1 - 6) { r.l += (c.rails[ri].l - r.l) * 0.5; startGrind(r, ri, ctx); return; }
  }

  // ground / takeoff
  const gy = c.height(r.s, r.l);
  const pred = r.y + r.vyG * dt - 0.5 * GAIR * dt * dt;
  if (inp.jump) {
    startAir(r, r.vyG + 9 + r.v * 0.04, ctx); r.y = Math.max(pred, gy) + 0.02; r.hopped = true; return;
  }
  if (pred > gy + 0.07 && r.vyG > -40) {
    r.y = pred; startAir(r, r.vyG - GAIR * dt, ctx); r.hopped = false; return;
  }
  r.vyG = (gy - r.y) / dt; if (r.vyG > 60) r.vyG = 60; if (r.vyG < -80) r.vyG = -80;
  r.y = gy;
  // stuck detection stat
  if (r.v < 7 && !r.finished) r.stats.stuckT += dt; else r.stats.stuckT = 0;
  if (r.balance <= 0) crash(r, 'balance', 0.8, ctx);
}

function wallHit(r: Rider, vlat: number, ctx: Ctx) {
  if (vlat < 2) return;
  r.stats.wallHits++;
  r.v *= 1 - 0.07 * Math.min(1, vlat / 18);
  if (r.shovedT > 0 && vlat > 4) { crash(r, 'wall', 1.3, ctx); return; }
  r.balance -= Math.min(0.55, vlat * 0.028);
  ctx.emit('wall', r, vlat);
  if (r.balance <= 0) crash(r, 'wall', 1, ctx);
}

function air(r: Rider, inp: RiderInput, dt: number, ctx: Ctx, boostAcc: number) {
  const c = ctx.course;
  r.airT += dt;
  const spinTarget = inp.steer * 7.4, flipTarget = inp.pitch * 6.2;
  r.spinV += (spinTarget - r.spinV) * Math.min(1, dt * 9);
  r.flipV += (flipTarget - r.flipV) * Math.min(1, dt * 9);
  const gy0 = c.height(r.s, r.l);
  const hgt = r.y - gy0;
  const falling = r.vy < -2 && hgt < 3.4;
  if (falling && Math.abs(inp.steer) < 0.35 && Math.abs(inp.pitch) < 0.35) {
    const ns = Math.round(r.spin / PI) * PI, nf = Math.round(r.flip / (2 * PI)) * 2 * PI;
    const k = Math.min(1, dt * 6);
    if (Math.abs(ns - r.spin) < 1.3) { r.spin += (ns - r.spin) * k; r.spinV *= 0.8; }
    if (Math.abs(nf - r.flip) < 1.5) { r.flip += (nf - r.flip) * k; r.flipV *= 0.8; }
  }
  r.spin += r.spinV * dt; r.flip += r.flipV * dt;
  r.spinTot += Math.abs(r.spinV) * dt; r.flipTot += Math.abs(r.flipV) * dt;
  const g = inp.grab;
  r.grabAmt += ((g ? 1 : 0) - r.grabAmt) * Math.min(1, dt * 12);
  if (g) { r.grabT += dt; r.grabBits |= g; r.grabKind = g === 1 ? 1 : g === 2 ? 2 : g === 4 ? 3 : g === 3 ? 4 : g === 5 ? 5 : g === 6 ? 6 : 7; }
  r.vy -= GAIR * dt;
  const fa = c.sample(r.s, tmpF);
  r.vs += (G * fa.desc * 0.7 * r.paceMul * r.paceMul + boostAcc * 0.7 - KDRAG * 0.85 * r.vs * Math.abs(r.vs)) * dt; r.vl *= Math.exp(-0.2 * dt);
  r.y += r.vy * dt; r.s += r.vs * dt; r.l += r.vl * dt;
  const lim: [number, number] = [0, 0];
  c.lateralLimits(r.s, r.l, lim);
  if (r.l < lim[0]) { r.l = lim[0]; r.vl = Math.abs(r.vl) * 0.3; } else if (r.l > lim[1]) { r.l = lim[1]; r.vl = -Math.abs(r.vl) * 0.3; }
  // rails
  if (r.vy < 3) {
    const ri = findRail(r, ctx, 0, 1.5);
    if (ri >= 0) {
      const ra = c.rails[ri], top = c.height(r.s, ra.l) + ra.h;
      if (r.y - top < 0.45 && r.y - top > -1.3) { r.v = Math.max(10, Math.hypot(r.vs, r.vl)); r.y = top; r.l += (ra.l - r.l) * 0.5; r.spinVis = r.spin; startGrind(r, ri, ctx); return; }
    }
  }
  const gy = c.height(r.s, r.l);
  if (r.y <= gy) { land(r, ctx); if (r.mode === 'ride') r.vyG = 0; }
}

/** rider<->rider contact (grounded riders only) */
export function resolveContacts(ctx: Ctx, dt: number) {
  const R = ctx.riders;
  for (let i = 0; i < R.length; i++) {
    const a = R[i]; if (a.mode === 'wait' || a.mode === 'crash') continue;
    for (let j = i + 1; j < R.length; j++) {
      const b = R[j]; if (b.mode === 'wait' || b.mode === 'crash') continue;
      const ds = b.s - a.s, dl = b.l - a.l;
      if (Math.abs(ds) > 1.8 || Math.abs(dl) > 1.8) continue;
      if (Math.abs(a.y - b.y) > 1.5) continue;
      const d = Math.hypot(ds * 0.8, dl) ;
      const minD = 1.25;
      if (d >= minD || d < 1e-4) continue;
      const nS = ds * 0.8 / d, nL = dl / d;
      const pen = minD - d;
      const wa = b.mass / (a.mass + b.mass), wb = 1 - wa;
      if (a.mode !== 'grind') { a.l -= nL * pen * wa; a.s -= nS * pen * wa * 0.5; }
      if (b.mode !== 'grind') { b.l += nL * pen * wb; b.s += nS * pen * wb * 0.5; }
      const avs = a.mode === 'air' ? a.vs : a.v * Math.cos(a.theta), bvs = b.mode === 'air' ? b.vs : b.v * Math.cos(b.theta);
      const avl = (a.mode === 'air' ? a.vl : a.v * Math.sin(a.theta)) + a.kl, bvl = (b.mode === 'air' ? b.vl : b.v * Math.sin(b.theta)) + b.kl;
      const rel = (bvs - avs) * nS + (bvl - avl) * nL;
      if (rel < 0) {
        const imp = (-(1 + 0.35) * rel) / (1 / a.mass + 1 / b.mass);
        const dvaS = -imp / a.mass * nS * 0.6, dvbS = imp / b.mass * nS * 0.6;
        const dvaL = -imp / a.mass * nL, dvbL = imp / b.mass * nL;
        applyKick(a, dvaS, dvaL); applyKick(b, dvbS, dvbL);
        const hard = -rel;
        if (hard > 2.5) {
          const dmg = Math.min(0.5, hard * 0.02);
          a.balance -= dmg / a.mass; b.balance -= dmg / b.mass;
          a.bumpT = b.bumpT = 0.25; a.bumpSide = nL > 0 ? 1 : -1; b.bumpSide = -a.bumpSide;
          ctx.emit('bump', a, hard, b);
          if (a.balance <= 0) crash(a, 'collision', 0.8, ctx);
          if (b.balance <= 0) crash(b, 'collision', 0.8, ctx);
        }
      }
    }
  }
}
function applyKick(r: Rider, dvS: number, dvL: number) {
  if (r.mode === 'air') { r.vs += dvS; r.vl += dvL; return; }
  r.v = Math.max(5, r.v + dvS); r.kl += dvL;
}

/** is there a hazard (wall/edge/obstacle) close on the given side (dir=+1 right) of rider r? */
export function hazardOnSide(r: Rider, dir: number, ctx: Ctx): number {
  const c = ctx.course;
  const lim: [number, number] = [0, 0]; c.lateralLimits(r.s, r.l, lim);
  let d = dir > 0 ? lim[1] - r.l : r.l - lim[0];
  c.obstaclesIn(r.s, r.s + 14, (o) => {
    const dl = (o.l - r.l) * dir;
    if (dl > 0 && dl < d + 1) { if (Math.abs(o.l - r.l) < 7) d = Math.min(d, dl - o.r); }
  });
  return d;
}

/** attempt a shove by `a` toward dir (-1 left, +1 right). Returns victim or null. */
export function tryShove(a: Rider, dir: number, ctx: Ctx): Rider | null {
  if (a.shoveCd > 0 || a.mode !== 'ride') return null;
  a.shoveDir = dir; a.shoveT = 0.32; a.stats.shoves++;
  let best: Rider | null = null, bd = 99;
  for (const b of ctx.riders) {
    if (b === a || b.mode !== 'ride') continue;
    const ds = b.s - a.s, dl = (b.l - a.l) * dir;
    if (Math.abs(ds) > 2.6 || dl < 0.2 || dl > 3.4) continue;
    const d = Math.hypot(ds, dl);
    if (d < bd) { bd = d; best = b; }
  }
  if (!best) {
    a.shoveCd = 1.1; a.v *= 0.95; a.balance -= 0.14; a.kl += dir * 2;
    ctx.emit('shoveMiss', a, dir);
    if (a.balance <= 0) crash(a, 'balance', 0.6, ctx);
    return null;
  }
  const b = best;
  a.shoveCd = 0.75; a.kl += dir * 3.5; a.v *= 0.985;
  const power = (0.45 + clamp((a.balance - 0.5), 0, 0.5) * 0.3) * (a.mass / b.mass);
  const hz = hazardOnSide(b, dir, ctx);
  const near = hz < 5.5;
  b.kl += dir * (9 + (near ? 4 : 0)) / b.mass;
  b.shovedT = 1.7; b.shoverId = a.id; b.stats.shoved++;
  b.balance -= power * (near ? 2.2 : 1) * (b.boosting ? 0.8 : 1);
  b.bumpT = 0.3; b.bumpSide = -dir;
  // recoil on attacker (heavy victim / counter-contact)
  a.balance -= 0.06 * (b.mass / a.mass);
  ctx.emit('shove', a, near ? 1 : 0, b);
  if (b.balance <= 0) crash(b, 'shoved', 1.2, ctx);
  if (a.balance <= 0) crash(a, 'balance', 0.6, ctx);
  return b;
}

export function finishLine(r: Rider) { return r.s >= FINISH_S; }
