import { Race } from '../src/race';
const race = new Race({ autoPlayer: true });
let t = 0, tick = 0;
while (race.state !== 'done' && t < 120) {
  race.step(); t += 1 / 120; tick++;
  if (race.state === 'racing' && tick % 600 === 0) console.log(race.time.toFixed(0).padStart(3) + 's ' + race.riders.map((r) => `${r.name.slice(0, 4)} s${r.s.toFixed(0).padStart(4)} l${r.l.toFixed(0).padStart(3)} v${r.v.toFixed(0).padStart(2)} ${r.mode[0]}${r.boosting ? '*' : ' '}`).join(' | '));
}
