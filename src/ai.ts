// AI: lane-seeking pack racer with personality. Produces the same RiderInput a player would.
import { Rider, RiderInput, Ctx, maxTheta, GAIR, Persona } from './rider';

export const PERSONAS: Persona[] = [
  { name: 'BRICK', aggression: 0.9, skill: 0.6, boostUse: 0.5, shortcut: 0.35, tech: 0.5, caution: 0.1, pace: 1.0, mass: 1.25, lane: 0.3, mistake: 0.7, blurb: 'Aggressive' },
  { name: 'VEX', aggression: 0.3, skill: 0.85, boostUse: 0.9, shortcut: 0.2, tech: 0.5, caution: 0.3, pace: 1.02, mass: 0.95, lane: 0, mistake: 0.3, blurb: 'Speedster' },
  { name: 'JUNO', aggression: 0.25, skill: 0.8, boostUse: 0.6, shortcut: 0.55, tech: 1.0, caution: 0.4, pace: 0.995, mass: 0.9, lane: -0.3, mistake: 0.4, blurb: 'Technical' },
  { name: 'DASH', aggression: 0.5, skill: 0.55, boostUse: 0.6, shortcut: 0.95, tech: 0.7, caution: 0.1, pace: 0.99, mass: 1.0, lane: 0.5, mistake: 0.9, blurb: 'Shortcut hunter' },
  { name: 'MELLOW', aggression: 0.1, skill: 0.7, boostUse: 0.4, shortcut: 0.05, tech: 0.3, caution: 0.95, pace: 0.99, mass: 1.0, lane: -0.5, mistake: 0.25, blurb: 'Cautious' },
];
export const PLAYER_PERSONA: Persona = { name: 'YOU', aggression: 0.5, skill: 1, boostUse: 0.5, shortcut: 0.5, tech: 1, caution: 0.5, pace: 1.0, mass: 1.0, lane: 0, mistake: 0, blurb: 'Player' };

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const rnd = Math.random;

export function makeAI(r: Rider) {
  r.ai = { noise: 0, noiseT: 0, route: '', routeDone: false, passSide: 0, passT: 0, mistakeT: 0, mistakeOff: 0, lateT: 0,
    steer: 0, boostHold: 0, rampPlan: new Map<number, boolean>(), spinT: 0, flipT: 0, grab: 0, planned: false, trickMistake: false,
    reactT: 0, lim: [0, 0] as [number, number] };
}

export function aiThink(r: Rider, inp: RiderInput, ctx: Ctx, dt: number) {
  inp.steer = 0; inp.pitch = 0; inp.tuck = 0; inp.brake = 0; inp.jump = false; inp.grab = 0; inp.shoveL = false; inp.shoveR = false; inp.boost = false;
  const a = r.ai, P = r.persona, c = ctx.course;
  if (r.mode === 'wait' || r.mode === 'crash') { a.planned = false; return; }

  if (r.mode === 'air') { airAI(r, inp, ctx); return; }
  a.planned = false;
  if (r.mode === 'grind') { return; }

  const W = c.halfWidth(r.s);
  a.noiseT -= dt;
  if (a.noiseT <= 0) { a.noise = (rnd() - 0.5) * 0.9; a.noiseT = 1.2 + rnd() * 2.2; }
  // mistakes
  if (a.mistakeT > 0) a.mistakeT -= dt;
  else if (rnd() < P.mistake * 0.035 * dt) { a.mistakeT = 0.9 + rnd() * 0.8; a.mistakeOff = (rnd() < 0.5 ? -1 : 1) * (5 + rnd() * 5); a.lateT = a.mistakeT; }
  let tl = (P.lane * 0.55 + a.noise) * W * 0.6;
  if (a.mistakeT > 0) tl += a.mistakeOff;

  // route choice at the split
  const sp = c.split;
  if (r.s > sp.s0 - 170 && r.s < sp.s1 && !a.routeDone) {
    if (!a.route) { let p = P.shortcut + (r.rank > 3 ? 0.15 : 0); a.route = rnd() < p ? 'short' : 'main'; }
  }
  if (r.s >= sp.s1) { a.route = ''; a.routeDone = true; }
  if (a.route && r.s < sp.s1 + 10) {
    const rl = a.route === 'short' ? sp.shortL : sp.mainL;
    const k = clamp((r.s - (sp.s0 - 170)) / 120, 0, 1);
    tl = tl * (1 - k) + (rl + (a.route === 'short' ? (a.noise * 1.5 - (P.tech > 0.6 ? 0 : 1.2) * (a.rampPlan.get(1700) === false ? 1 : 0)) : a.noise * 8)) * k;
    if (a.route === 'short' && r.s > sp.s0 - 40) r.stats.shortcut = true;
  }

  // ramps
  const lim = a.lim; c.lateralLimits(r.s, r.l, lim);
  let lastGroup = -1;
  for (const rp of c.ramps) {
    if (rp.s0 < r.s + 6 || rp.s0 > r.s + 110) continue;
    if (rp.s0 === lastGroup) continue;
    lastGroup = rp.s0;
    // only consider ramps relevant to the lane I'm heading for
    if (!a.rampPlan.has(rp.s0)) {
      const want = rp.name === 'big' || rp.name === 'giant' || rp.name === 'shortbig' ? 0.35 + P.tech * 0.45 + P.skill * 0.15 - P.caution * 0.35 : 0.55 + P.tech * 0.3 - P.caution * 0.3;
      a.rampPlan.set(rp.s0, rnd() < want);
    }
    const group = c.ramps.filter((q) => q.s0 === rp.s0);
    // is any ramp of this group near my intended lane? if not, ignore
    const near = group.some((q) => tl > q.l0 - 5 && tl < q.l1 + 5);
    if (!near) continue;
    if (a.rampPlan.get(rp.s0)) {
      // aim at the ramp: techy/hunters prefer the biggest
      let best = group[0], bs = -1e9;
      for (const q of group) { const mid = (q.l0 + q.l1) / 2; const sc = -Math.abs(mid - tl) * 0.35 + q.h * (0.4 + P.tech * 0.6); if (sc > bs && mid > lim[0] && mid < lim[1]) { bs = sc; best = q; } }
      tl = (best.l0 + best.l1) / 2 + (rnd() - 0.5) * 0.02 + a.noise * (best.l1 - best.l0) * 0.2;
    } else {
      // avoid: nearest lane outside every ramp in the group
      let bestL = tl, bd = 1e9;
      for (let l = lim[0] + 1.5; l <= lim[1] - 1.5; l += 0.5) {
        if (group.some((q) => l > q.l0 - 1.3 && l < q.l1 + 1.3)) continue;
        const d = Math.abs(l - tl); if (d < bd) { bd = d; bestL = l; }
      }
      if (bd < 1e8) tl = bestL; else a.rampPlan.set(rp.s0, true);
    }
  }

  // rails: techy riders line up
  for (let i = 0; i < c.rails.length; i++) {
    const ra = c.rails[i];
    if (r.s > ra.s0 - 50 && r.s < ra.s1 - 4 && P.tech * 0.8 + P.skill * 0.2 > 0.45 && rnd() < 1) {
      if (Math.abs(r.l - ra.l) < 6 || a.route === 'short' && i === 0) tl = ra.l + a.noise * 0.2;
      if (r.s > ra.s0 - 11 && r.s < ra.s0 - 2 && Math.abs(r.l - ra.l) < 1.6) inp.jump = true;
    }
  }

  // obstacles
  let brakeNeed = 0;
  if (a.lateT <= 0) c.obstaclesIn(r.s + 2, r.s + 14 + r.v * 0.55, (o) => {
    const clear = o.r + 2.1;
    const dsO = o.s - r.s;
    if (dsO < 0) return;
    if (Math.abs(o.l - tl) < clear || (Math.abs(o.l - r.l) < clear && dsO < 22)) {
      const side = o.l > r.l ? -1 : 1;
      const cand = o.l + (side * -1 * -1) * 0 + (o.l > tl ? -clear - 0.4 : clear + 0.4);
      const alt = o.l > tl ? o.l + clear + 0.4 : o.l - clear - 0.4;
      // pick the side with more room
      const pick = (cand > lim[0] + 1.2 && cand < lim[1] - 1.2) ? cand : alt;
      tl = pick;
      if (dsO < 9 && Math.abs(o.l - r.l) < o.r + 1.4) brakeNeed = Math.max(brakeNeed, 0.5);
    }
  }); else a.lateT -= dt;

  // other riders: pass / defend / contest
  let blocker: Rider | null = null, bd = 99, behind: Rider | null = null, bb = 99;
  for (const o of ctx.riders) {
    if (o === r || o.mode === 'wait' || o.mode === 'crash') continue;
    const ds = o.s - r.s, dl = o.l - r.l;
    if (ds > 1 && ds < 15 && Math.abs(dl) < 2.6 && ds < bd) { bd = ds; blocker = o; }
    if (ds < -0.5 && ds > -7 && Math.abs(dl) < 3 && -ds < bb) { bb = -ds; behind = o; }
  }
  if (a.passT > 0) a.passT -= dt;
  if (blocker) {
    if (a.passT <= 0) {
      const b = blocker;
      c.lateralLimits(b.s, b.l, lim);
      const roomL = (b.l - lim[0]), roomR = (lim[1] - b.l);
      let side = roomR > roomL ? 1 : -1;
      if (Math.abs(roomL - roomR) < 3) side = rnd() < 0.5 ? -1 : 1;
      a.passSide = side; a.passT = 1.1 + rnd() * 0.8;
    }
    const off = 2.4 + (1 - P.aggression) * 1.1;
    tl = clamp(blocker.l + a.passSide * off, lim[0] + 1.6, lim[1] - 1.6);
  } else if (behind && P.aggression > 0.35 && rnd() < P.aggression * dt * 3 && a.mistakeT <= 0) {
    tl = tl * 0.4 + behind.l * 0.6; // defend: cover their line
  }
  // fighters like running side-by-side
  if (!blocker && P.aggression > 0.6) {
    for (const o of ctx.riders) {
      if (o === r || o.mode !== 'ride') continue;
      const ds = o.s - r.s;
      if (Math.abs(ds) < 12 && Math.abs(o.l - r.l) < 7 && Math.abs(o.l - r.l) > 1.8) { tl = o.l + (o.l > r.l ? -2.1 : 2.1) * 1.0; break; }
    }
  }
  c.lateralLimits(r.s, r.l, lim);
  tl = clamp(tl, lim[0] + 1.5, lim[1] - 1.5);

  // steer toward target lane
  const v = Math.max(10, r.v);
  const err = tl - r.l;
  const vmax = Math.max(8, v * 0.42);
  const vlDes = clamp(err * 1.5, -vmax, vmax);
  const sinT = clamp((vlDes - r.kl) / v, -0.85, 0.85);
  const th = Math.asin(sinT);
  const mt = maxTheta(r, 0);
  let st = clamp(th / mt, -1, 1);
  a.steer += (st - a.steer) * Math.min(1, dt * (6 + P.skill * 8));
  inp.steer = a.steer;
  inp.tuck = Math.abs(inp.steer) < 0.25 && brakeNeed === 0 && !blocker ? 1 : 0;
  inp.brake = brakeNeed + (P.caution > 0.8 && Math.abs(err) > 10 ? 0.2 : 0);

  // boost use
  if (a.boostHold > 0) { a.boostHold -= dt; inp.boost = r.boost > 0; }
  else if (r.boost > 28 + (1 - P.boostUse) * 45 && rnd() < dt * (0.5 + P.boostUse * 2)) {
    // don't waste right before a jump if cautious
    a.boostHold = 1.4 + rnd() * 1.6 * P.boostUse;
  }

  // shove
  if (r.shoveCd <= 0 && r.balance > 0.35) {
    for (const o of ctx.riders) {
      if (o === r || o.mode !== 'ride') continue;
      const ds = o.s - r.s, dl = o.l - r.l;
      if (Math.abs(ds) > 2.3 || Math.abs(dl) < 0.3 || Math.abs(dl) > 3.2) continue;
      const dir = dl > 0 ? 1 : -1;
      let rate = Math.pow(P.aggression, 1.5) * 1.5;
      if (r.shovedT > 0 && r.shoverId === o.id) rate += 3.5;
      if (o.balance < 0.6) rate += 1.2 * P.aggression;
      const hz = dir > 0 ? c.halfWidth(o.s) - o.l : o.l + c.halfWidth(o.s);
      if (hz < 6) rate += 1.5 * P.aggression;
      if (rnd() < rate * dt) { if (dir < 0) inp.shoveL = true; else inp.shoveR = true; break; }
    }
  }
}

function airAI(r: Rider, inp: RiderInput, ctx: Ctx) {
  const a = r.ai, P = r.persona;
  if (!a.planned) {
    a.planned = true;
    const T = (2 * Math.max(0, r.vy)) / GAIR + Math.max(0, (r.y - ctx.course.height(r.s, r.l))) * 0.05;
    const cap = Math.max(0, Math.floor((7.4 * Math.max(0, T - 0.45) * 0.6) / Math.PI));
    const want = Math.round(P.tech * 2.2 * (0.5 + P.skill * 0.7) + rnd() * 1.6);
    const n = Math.min(cap, want);
    const dir = rnd() < 0.5 ? -1 : 1;
    a.spinT = dir * Math.PI * n;
    a.flipT = (T > 1.5 && P.tech > 0.55 && rnd() < P.tech * 0.55) ? (rnd() < 0.5 ? -1 : 1) * Math.PI * 2 : 0;
    a.grab = rnd() < 0.35 + P.skill * 0.6 ? (1 + Math.floor(rnd() * 3)) : 0; if (a.grab === 3) a.grab = 4;
    a.trickMistake = rnd() < P.mistake * 0.16;
    if (a.trickMistake) a.spinT += 2.0;
  }
  const es = a.spinT - r.spin, ef = a.flipT - r.flip;
  inp.steer = Math.abs(es) > 0.35 ? clamp(es * 2, -1, 1) : 0;
  inp.pitch = Math.abs(ef) > 0.45 ? clamp(ef * 2, -1, 1) : 0;
  if (a.grab && r.airT > 0.25) inp.grab = a.grab;
  inp.boost = r.boosting && r.boost > 0;
}
