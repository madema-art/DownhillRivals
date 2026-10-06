import { Race } from '../src/race';
const hist: Record<string, number> = {};
for (let n = 0; n < 20; n++) {
  const race = new Race({ autoPlayer: true });
  race.on((ev, r, a, b) => { if (ev === 'crash') { const k = `${b}@${Math.round(r.s / 25) * 25}`; hist[k] = (hist[k] || 0) + 1; } });
  while (race.state !== 'done' && race.time < 150) race.step();
}
console.log(Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 22).map(([k, v]) => `${k}:${v}`).join('  '));
