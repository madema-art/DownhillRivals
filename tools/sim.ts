// Headless race simulation: runs full AI races (player replaced by an AI) and prints stats.
import { Race } from '../src/race';
import { FINISH_S } from '../src/course';

const N = Number(process.argv[2] || 6);
const verbose = process.argv.includes('-v');
const allCauses: Record<string, number> = {};
const totals = { time: 0, crashes: 0, shoves: 0, bumps: 0, stuck: 0, wins: {} as Record<string, number>, finished: 0, spread: 0, packN: 0,
  shortTimes: [] as number[], mainTimes: [] as number[], tricks: 0, airMax: 0, walls: 0 };
for (let n = 0; n < N; n++) {
  const race = new Race({ autoPlayer: true });
  let bumps = 0, shoveEv = 0, crashEv = 0; const early = { bump: 0, shove: 0, air: 0, crash: 0, pass: 0 };
  const lane: Record<number, string> = {}, sAt: Record<number, number> = {}, rp: Record<number, number> = {};
  const causes: Record<string, number> = {};
  race.on((ev, r, a, b) => { if (race.time > 0 && race.time < 22) { if (ev === 'bump') early.bump++; if (ev === 'shove') early.shove++; if (ev === 'takeoff' && (a ?? 0) > 8) early.air++; if (ev === 'crash') early.crash++; } if (ev === 'bump') bumps++; if (ev === 'shove') shoveEv++; if (ev === 'crash') { crashEv++; causes[b] = (causes[b] || 0) + 1; allCauses[b] = (allCauses[b] || 0) + 1; } });
  let t = 0, spreadSum = 0, spreadN = 0, tick = 0;
  while (race.state !== 'done' && t < 200) {
    race.step(); t += 1 / 120; tick++;
    if (race.state === 'racing' && tick % 120 === 0) {
      const ss = race.riders.map((r) => r.s); const sorted = ss.slice().sort((a, b) => b - a);
      if (sorted[0] < FINISH_S - 100) { for (const x of ss) { if (ss.some((y) => y !== x && Math.abs(y - x) < 25)) (totals as any).packHit = ((totals as any).packHit || 0) + 1; (totals as any).packTot = ((totals as any).packTot || 0) + 1; } spreadSum += sorted[0] - sorted[5]; spreadN++; }
    }
    for (const r of race.riders) {
      const sp = race.course.split;
      if (r.s > sp.s0 + 30 && lane[r.id] === undefined) { lane[r.id] = r.l > 0 ? 'short' : 'main'; sAt[r.id] = race.time; }
      if (r.s > sp.s1 + 140 && rp[r.id] === undefined && sAt[r.id] !== undefined) { rp[r.id] = race.time - sAt[r.id]; (lane[r.id] === 'short' ? totals.shortTimes : totals.mainTimes).push(rp[r.id]); }
    }
  }
  for (const k of Object.keys(early)) (totals as any)['e_' + k] = ((totals as any)['e_' + k] || 0) + (early as any)[k];
  const ranked = race.riders.slice().sort((a, b) => (a.finishRank || 99) - (b.finishRank || 99));
  const w = ranked[0].name; totals.wins[w] = (totals.wins[w] || 0) + 1;
  totals.time += ranked[0].finishTime; totals.bumps += bumps; totals.shoves += shoveEv; totals.crashes += crashEv;
  totals.finished += race.riders.filter((r) => r.finished).length; totals.spread += spreadSum / Math.max(1, spreadN); totals.packN++;
  for (const r of race.riders) { totals.stuck += r.stats.stuckT > 1 ? 1 : 0; totals.tricks += r.stats.tricks; totals.airMax = Math.max(totals.airMax, r.stats.airMax); totals.walls += r.stats.wallHits; }
  if (verbose || N === 1) {
    console.log(`race ${n}: ` + ranked.map((r) => `${r.name} ${r.finished ? r.finishTime.toFixed(1) : 'DNF@' + r.s.toFixed(0)} (cr${r.crashes} sh${r.stats.shoves}/${r.stats.shoved} tr${r.stats.tricks} ${lane[r.id] || '?'} b${r.stats.boostUsed})`).join(' | '));
    console.log('  crash causes', JSON.stringify(causes));
  }
}
const f = (x: number) => (x / N).toFixed(2);
const avg = (a: number[]) => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : 'n/a';
console.log(`\n${N} races | winner avg ${f(totals.time)}s | finishers/race ${f(totals.finished)} | crashes/race ${f(totals.crashes)} | shoves/race ${f(totals.shoves)} | bumps/race ${f(totals.bumps)} | tricks/race ${f(totals.tricks)} | wallHits/race ${f(totals.walls)} | longest air ${totals.airMax.toFixed(2)}s`);
console.log(`first 22s per race: bumps ${f((totals as any).e_bump)} shoves ${f((totals as any).e_shove)} bigAirTakeoffs ${f((totals as any).e_air)} crashes ${f((totals as any).e_crash)}`);
console.log(`riders with a rival within 25m: ${(100 * (totals as any).packHit / (totals as any).packTot).toFixed(0)}% of the time`);
console.log('crash causes', JSON.stringify(allCauses));
console.log(`pack spread first->last avg ${(totals.spread / totals.packN).toFixed(1)}m | wins ${JSON.stringify(totals.wins)}`);
console.log(`split zone time: shortcut n=${totals.shortTimes.length} avg ${avg(totals.shortTimes)}s | main n=${totals.mainTimes.length} avg ${avg(totals.mainTimes)}s | stuck ${totals.stuck}`);
