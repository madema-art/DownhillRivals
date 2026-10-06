import { Race } from './race';
import { Rider, trickLabel } from './rider';
import { FINISH_S } from './course';

const $ = (id: string) => document.getElementById(id)!;
const fmt = (t: number) => { if (t < 0) t = 0; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(2).padStart(5, '0')}`; };
const ord = (n: number) => (n === 1 ? '1ST' : n === 2 ? '2ND' : n === 3 ? '3RD' : n + 'TH');
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

export class Hud {
  pos = $('pos'); time = $('time'); boostFill = $('boostFill'); boostBar = $('boostBar'); boostHint = $('boostHint'); speed = $('speed').querySelector('b')!;
  trick = $('trick'); toastEl = $('toast'); count = $('count'); prog = $('prog'); mini = $('mini');
  dots: HTMLElement[] = []; lastTrickT = 0; trickHold = 0; lastRank = 0; posTimer = 0;
  built = false;
  constructor() {}

  build(race: Race) {
    this.prog.innerHTML = ''; this.dots = [];
    const c = race.course;
    const zone = (a: number, b: number) => { const z = document.createElement('div'); z.className = 'zone'; z.style.top = (a / FINISH_S * 100) + '%'; z.style.height = ((b - a) / FINISH_S * 100) + '%'; this.prog.appendChild(z); };
    zone(c.split.s0, c.split.s1);
    for (const s of [830, 2400, 1170]) { const m = document.createElement('div'); m.className = 'mark'; m.style.top = (s / FINISH_S * 100) + '%'; this.prog.appendChild(m); }
    for (const r of race.riders) { const d = document.createElement('div'); d.className = 'dot' + (r.isPlayer ? ' me' : ''); d.style.background = hex(r.color); this.prog.appendChild(d); this.dots[r.id] = d; }
    this.built = true;
  }

  toast(text: string, color = '#fff', big = false) {
    const t = this.toastEl; t.textContent = text; t.style.color = color; t.style.fontSize = big ? '70px' : '46px';
    t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  }
  countdown(text: string) { const c = this.count; c.textContent = text; c.classList.remove('show'); void c.offsetWidth; c.classList.add('show'); }
  trickResult(text: string, cls: string, sub = '') {
    const t = this.trick; t.className = cls + ' pop'; t.innerHTML = text + (sub ? `<small>${sub}</small>` : ''); this.trickHold = 1.6;
  }
  boostPulse() { this.boostBar.classList.remove('pulse'); void this.boostBar.offsetWidth; this.boostBar.classList.add('pulse'); }

  update(dt: number, race: Race) {
    if (!this.built) this.build(race);
    const p = race.player;
    this.time.textContent = fmt(p.finished ? p.finishTime : race.time);
    if (p.rank !== this.lastRank) {
      const up = this.lastRank && p.rank < this.lastRank, down = this.lastRank && p.rank > this.lastRank;
      this.lastRank = p.rank; this.pos.innerHTML = `<span class="big">${p.rank}</span><span class="sm">/6</span>`;
      this.pos.classList.remove('up', 'down'); if (up) this.pos.classList.add('up'); if (down) this.pos.classList.add('down'); this.posTimer = 0.5;
    }
    if (this.posTimer > 0) { this.posTimer -= dt; if (this.posTimer <= 0) this.pos.classList.remove('up', 'down'); }
    this.boostFill.style.width = p.boost.toFixed(1) + '%';
    this.boostBar.classList.toggle('ready', p.boost >= 15 && !p.boosting);
    this.boostBar.classList.toggle('active', p.boosting);
    this.boostHint.textContent = p.boosting ? 'BOOSTING!' : p.boost >= 15 ? 'SHIFT / Y' : '';
    this.speed.textContent = String(Math.round(p.v * 3.1));
    // live trick text
    if (p.mode === 'air' || p.mode === 'grind') {
      const lbl = p.mode === 'grind' ? 'RAIL GRIND' : trickLabel(p);
      this.trick.className = 'good'; this.trickHold = 0.4;
      this.trick.innerHTML = lbl ? lbl + (p.chain ? `<small>CHAIN x${p.chain + 1}</small>` : '') : '';
    } else if (this.trickHold > 0) { this.trickHold -= dt; if (this.trickHold <= 0) this.trick.innerHTML = ''; }
    // progress + standings
    for (const r of race.riders) this.dots[r.id].style.top = Math.min(100, r.s / FINISH_S * 100) + '%';
    const arr = race.riders.slice().sort((a, b) => a.rank - b.rank);
    this.mini.innerHTML = arr.map((r) => `<div class="${r.isPlayer ? 'me' : ''}"><i style="background:${hex(r.color)}"></i>${r.rank} ${r.name}</div>`).join('');
  }

  showResults(race: Race) {
    const p = race.player;
    $('resPlace').textContent = ord(p.finishRank || p.rank);
    $('resTime').textContent = fmt(p.finishTime || race.time);
    const arr = race.riders.slice().sort((a, b) => a.rank - b.rank);
    $('resTable').innerHTML = arr.map((r) => `<tr class="${r.isPlayer ? 'me' : ''}"><td>${r.rank}</td><td>${r.name}</td><td>${r.finished ? fmt(r.finishTime) : 'racing…'}</td></tr>`).join('');
    $('res').classList.add('show');
  }
  hideResults() { $('res').classList.remove('show'); }
}
