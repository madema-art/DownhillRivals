// Race director: grid, countdown, stepping every rider, ranking, finish.
import { Course, FINISH_S, START_S } from './course';
import { Rider, RiderInput, blankInput, stepRider, resolveContacts, tryShove, Ctx, Emit, EvName, DT, crash } from './rider';
import { PERSONAS, PLAYER_PERSONA, makeAI, aiThink } from './ai';

export type RaceState = 'countdown' | 'racing' | 'done';
export const COLORS = [0xff3d6e, 0xffc400, 0x2ee6a6, 0x9b5cff, 0xff7a1a, 0x35a7ff];
const TRIMS = [0x24102b, 0x16213a, 0x0f2f2a, 0xf3e9ff, 0x2b1500, 0xfff4cc];

export class Race {
  course = new Course();
  riders: Rider[] = [];
  player!: Rider;
  state: RaceState = 'countdown';
  time = -3.4;          // negative during countdown
  doneT = 0;
  finishCount = 0;
  listeners: Emit[] = [];
  ctx: Ctx;
  playerInput: RiderInput = blankInput();
  aiInputs: RiderInput[] = [];
  autoPlayer = false;   // sim: player driven by AI
  lastCount = 4;

  constructor(opts: { autoPlayer?: boolean } = {}) {
    this.autoPlayer = !!opts.autoPlayer;
    this.ctx = { course: this.course, riders: this.riders, time: 0, emit: (ev, r, a, b) => { for (const l of this.listeners) l(ev, r, a, b); } };
    this.reset();
  }
  on(l: Emit) { this.listeners.push(l); }

  reset() {
    this.riders.length = 0; this.aiInputs.length = 0;
    this.state = 'countdown'; this.time = -3.4; this.doneT = 0; this.finishCount = 0; this.lastCount = 4;
    const slots: [number, number][] = [[START_S + 4, -8], [START_S + 4, 0], [START_S + 4, 8], [START_S - 1, -12], [START_S - 1, -4], [START_S - 1, 4]];
    // shuffle AI into slots; player starts mid-back so there is a pack to carve through
    const order = [0, 1, 2, 3, 4];
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (let i = 0; i < 6; i++) {
      const r = new Rider(); r.id = i; r.color = COLORS[i]; r.trim = TRIMS[i];
      if (i === 0) { r.isPlayer = true; r.persona = PLAYER_PERSONA; r.name = 'YOU'; }
      else { r.persona = PERSONAS[order[i - 1]]; r.name = r.persona.name; makeAI(r); }
      if (this.autoPlayer && i === 0) { r.persona = PERSONAS[1]; r.name = 'YOU(AI)'; makeAI(r); }
      r.mass = r.persona.mass;
      const slot = i === 0 ? slots[4] : slots[[0, 1, 2, 3, 5][i - 1]];
      r.s = slot[0]; r.l = slot[1]; r.mode = 'wait'; r.y = this.course.height(r.s, r.l); r.vyG = 0; r.paceMul = r.persona.pace;
      this.riders.push(r); this.aiInputs.push(blankInput());
    }
    this.player = this.riders[0];
    this.updateRanks();
  }

  go() {
    this.state = 'racing';
    for (const r of this.riders) { r.mode = 'ride'; r.v = 7 + Math.random() * 1.5; r.pushT = 3.3; }
    this.ctx.emit('hit', this.player, -1, 'go');
  }

  updateRanks() {
    const arr = this.riders.slice().sort((a, b) => (a.finished && b.finished) ? a.finishRank - b.finishRank : a.finished ? -1 : b.finished ? 1 : b.s - a.s);
    arr.forEach((r, i) => { r.lastRank = r.rank; r.rank = i + 1; });
    return arr;
  }

  step(dt = DT) {
    this.ctx.time = this.time;
    if (this.state === 'countdown') {
      this.time += dt;
      const c = Math.ceil(-this.time);
      if (c !== this.lastCount && c >= 1 && c <= 3) { this.lastCount = c; this.ctx.emit('hit', this.player, c, 'count'); }
      if (this.time >= 0) { this.time = 0; this.go(); }
      for (const r of this.riders) stepRider(r, blankInput(), dt, this.ctx);
      return;
    }
    this.time += dt;
    let lead = 0; for (const r of this.riders) if (r.s > lead) lead = r.s;
    const ref = this.player.finished || this.autoPlayer ? lead : this.player.s;
    for (let i = 0; i < this.riders.length; i++) {
      const r = this.riders[i];
      let inp: RiderInput;
      if (r.isPlayer && !this.autoPlayer) inp = this.playerInput;
      else { inp = this.aiInputs[i]; aiThink(r, inp, this.ctx, dt); }
      if (!r.isPlayer || this.autoPlayer) {
        const d = r.s - ref;
        const band = Math.max(-0.045, Math.min(0.09, -d / 1100));
        r.paceMul = r.persona.pace * (1 + (r.isPlayer ? 0 : band));
      }
      if (r.finished) { inp = { ...inp, jump: false, boost: false, shoveL: false, shoveR: false, steer: 0, tuck: 0 }; }
      r.draft = false;
      if (r.mode === 'ride') for (const o of this.riders) { if (o !== r && o.s > r.s + 1.5 && o.s < r.s + 14 && Math.abs(o.l - r.l) < 1.8 && o.mode === 'ride') { r.draft = true; break; } }
      if (inp.shoveL) tryShove(r, -1, this.ctx);
      if (inp.shoveR) tryShove(r, 1, this.ctx);
      stepRider(r, inp, dt, this.ctx);
      if (r.stats.stuckT > 2.2 && r.mode === 'ride') { r.stats.stuckT = 0; crash(r, 'stuck', 0.5, this.ctx); }
      if (r.s > this.course.total - 18) { r.s = this.course.total - 18; r.v = Math.min(r.v, 4); }
      if (!r.finished && r.s >= FINISH_S) {
        r.finished = true; r.finishRank = ++this.finishCount; r.finishTime = this.time - (r.s - FINISH_S) / Math.max(1, r.v);
        this.ctx.emit('finish', r, r.finishRank);
      }
    }
    resolveContacts(this.ctx, dt);
    const before = this.player.rank;
    this.updateRanks();
    if (this.state === 'racing' && this.player.rank !== before && !this.player.finished) this.ctx.emit('pass', this.player, this.player.rank, this.player.rank < before ? 1 : -1);
    if (this.state === 'racing' && this.riders.every((r) => r.finished)) this.state = 'done';
    if (this.player.finished) { this.doneT += dt; if (this.doneT > 14) this.state = 'done'; }
    if (this.time > 240) this.state = 'done';
  }
}
