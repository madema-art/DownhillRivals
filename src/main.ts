import * as THREE from 'three';
import { Race } from './race';
import { DT, Rider, trickLabel, EvName } from './rider';
import { buildGround, buildDecor, buildProps, buildSky, toWorld, HAZE } from './scene';
import { RiderView } from './view';
import { Particles, SpeedLines } from './fx';
import { CamRig } from './camera';
import { AudioEngine } from './audio';
import { Hud } from './hud';
import { Input } from './input';
import { makeAI } from './ai';
import { PERSONAS } from './ai';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
scene.background = new THREE.Color(HAZE);
scene.fog = new THREE.Fog(HAZE, 90, 620);
const camera = new THREE.PerspectiveCamera(66, 1, 0.3, 4200);
scene.add(camera);
scene.add(new THREE.HemisphereLight(0xd6e8ff, 0x9a86d6, 1.5));
const sunL = new THREE.DirectionalLight(0xfff0d6, 2.2); sunL.position.set(-80, 120, 60); scene.add(sunL); scene.add(sunL.target);

const race = new Race();
const course = race.course;
scene.add(buildGround(course)); scene.add(buildDecor(course)); scene.add(buildProps(course));
const sky = buildSky(course, scene);
const spray = new Particles(2600, false, 9, 1.2, scene, 900);
const glow = new Particles(1400, true, 3, 1.6, scene, 800);
const lines = new SpeedLines(camera);
const rig = new CamRig(camera);
const audio = new AudioEngine();
const hud = new Hud();
const input = new Input();
let views: RiderView[] = [];
const SPEED_REF = 70;

function buildViews() { views.forEach((v) => v.dispose()); views = race.riders.map((r) => new RiderView(r, scene)); rig.reset(); }
buildViews();

// ---------- settings UI ----------
for (const [id, k] of [['vMaster', 'master'], ['vMusic', 'music'], ['vSfx', 'sfx']] as const) {
  const el = document.getElementById(id) as HTMLInputElement; el.value = String(audio.vol[k]);
  el.addEventListener('input', () => audio.setVolume(k, parseFloat(el.value)));
}

// ---------- game flow ----------
let started = false; let resultsT = -1; let muted = false;
async function startRace() {
  if (started) return; started = true;
  document.getElementById('title')!.classList.remove('show');
  try { await audio.unlock(); } catch (e) { console.warn('audio unlock failed', e); }
  audio.ui(); resetRace();
}
function resetRace() {
  hud.hideResults(); resultsT = -1;
  race.reset(); if (autoMode) enableAuto(true);
  buildViews(); hud.built = false; hud.lastRank = 0; lastShortcutToast = false; started = true;
}
let autoMode = false;
function enableAuto(on: boolean) {
  autoMode = on; race.autoPlayer = on;
  if (on) { race.player.persona = PERSONAS[1]; race.player.name = 'YOU'; makeAI(race.player); }
}
document.getElementById('startBtn')!.addEventListener('click', startRace);
document.getElementById('againBtn')!.addEventListener('click', () => { audio.ui(); resetRace(); });

// ---------- events -> audio / fx / hud ----------
let lastShortcutToast = false;
const tmpV = new THREE.Vector3();
function spatial(r: Rider) {
  const p = race.player; if (r === p) return { pan: 0, vol: 1 };
  const d = Math.hypot(r.s - p.s, (r.l - p.l) * 1.2);
  return { pan: Math.max(-1, Math.min(1, (r.l - p.l) / 12)), vol: Math.pow(Math.max(0, 1 - d / 70), 1.5) * 0.85 };
}
function burst(r: Rider, n: number, speed: number, size: number, up = 1) {
  const v = views[r.id]; const p = v.pos;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.28, sp = (0.3 + Math.random()) * speed;
    spray.emit(p.x + (Math.random() - .5) * 0.8, p.y + 0.2, p.z + (Math.random() - .5) * 0.8, Math.cos(a) * sp + v.vel.x * 0.25, (2 + Math.random() * 5) * up + sp * 0.3, Math.sin(a) * sp + v.vel.z * 0.25, 0.7 + Math.random() * 0.9, size * (0.6 + Math.random()), 0.96, 0.98, 1);
  }
}
race.on((ev: EvName, r: Rider, a?: number, b?: any) => {
  const sp = spatial(r), isP = r === race.player;
  if (sp.vol < 0.02 && ev !== 'hit') return;
  switch (ev) {
    case 'hit':
      if (b === 'count') { audio.beep(false); hud.countdown(String(a)); }
      else if (b === 'go') { audio.beep(true); hud.countdown('GO!'); }
      break;
    case 'takeoff': if (isP) { if ((a ?? 0) > 12) audio.takeoffBig(Math.min(1.2, (a ?? 12) / 22)); else audio.jump(0, 1); rig.shake(0.05); } break;
    case 'land': {
      const i = a ?? 0, info = b || {};
      audio.landing(i, info.q || 'clean', sp.pan, sp.vol);
      if (i > 6) burst(r, Math.min(70, 12 + i * 2), 4 + i * 0.25, 0.9, 1);
      if (isP) {
        rig.shake(Math.min(0.7, i / 45));
        if (info.q === 'bail') hud.trickResult('BAILED!', 'bad');
        else if (info.gain > 0.5) hud.trickResult(`${info.label || 'CLEAN'}`.replace(/^$/, 'AIR'), info.q === 'perfect' ? 'perfect' : info.q === 'sloppy' ? 'bad' : 'good', `${info.q === 'perfect' ? 'PERFECT LANDING · ' : info.q === 'sloppy' ? 'SLOPPY · ' : ''}+${Math.round(info.gain)} BOOST`);
        else if (info.q === 'sloppy') hud.trickResult('SLOPPY', 'bad');
      }
      break;
    }
    case 'crash':
      audio.crashSfx(a ?? 1, sp.pan, sp.vol); burst(r, 60, 9, 1.2, 1.3);
      if (isP) { rig.shake(0.85); hud.toast(b === 'shoved' ? 'KNOCKED OUT!' : b === 'bail' ? 'BAILED!' : 'WIPEOUT!', '#ff6b6b', true); hud.trickResult('', 'bad'); }
      else if (r.shoverId === race.player.id && b === 'shoved') hud.toast('TAKEDOWN!', '#7dff9a', true);
      break;
    case 'bump': { audio.bump(a ?? 3, sp.pan, sp.vol); if (isP || (b as Rider)?.isPlayer) rig.shake(Math.min(0.35, (a ?? 0) / 30)); burst(r, 6, 4, 0.5); break; }
    case 'shove': audio.shove(!!a, sp.pan, sp.vol); burst(b as Rider, 20, 6, 0.8); if (isP) { hud.toast(a ? 'SMASHED!' : 'SHOVE!', '#ffd21a'); rig.shake(0.2); } else if ((b as Rider).isPlayer) { rig.shake(0.5); hud.toast('SHOVED!', '#ff6b6b'); } break;
    case 'shoveMiss': audio.shoveMiss(sp.pan, sp.vol); break;
    case 'wall': audio.wall(a ?? 6, sp.pan, sp.vol); if (isP) rig.shake(Math.min(0.5, (a ?? 5) / 30)); burst(r, 15, 5, 0.7); break;
    case 'pad': audio.pad(sp.pan, sp.vol); if (isP) hud.toast('SPEED PAD', '#7dffe8'); break;
    case 'boostOn': if (isP) { audio.boostOn(); rig.shake(0.3); } break;
    case 'boostGain': if (isP) { audio.boostGain(a ?? 5); hud.boostPulse(); } break;
    case 'grindStart': audio.grindStart(sp.pan, sp.vol); break;
    case 'finish': if (isP) { audio.finishSting(a ?? 6); resultsT = 1.6; hud.toast(`${['', '1ST', '2ND', '3RD', '4TH', '5TH', '6TH'][a ?? 6]} PLACE!`, '#ffd21a', true); } break;
    case 'pass': if (isP) { audio.pass(b as number); hud.toast((b as number) > 0 ? `PASSED! ${a}/6` : `${a}/6`, (b as number) > 0 ? '#7dff9a' : '#ff9a9a'); } break;
  }
});

// ---------- per-frame effects ----------
const fA = new THREE.Vector3(), fR = new THREE.Vector3();
let fxAcc = new Map<number, number>();
function emitFX(r: Rider, v: RiderView, dt: number) {
  if (r.mode === 'wait') return;
  const cam = camera.position; const dist = v.pos.distanceTo(cam);
  const lod = dist < 70 ? 1 : dist < 160 ? 0.5 : 0.15;
  fR.set(1, 0, 0).applyQuaternion(v.root.quaternion); fA.copy(v.fwd);
  const p = v.pos;
  if (r.mode === 'ride' || r.mode === 'grind') {
    const sp = r.v, carve = Math.min(1, Math.abs(r.theta) / 0.45);
    let n = (sp * dt * (0.55 + carve * 1.6) * lod) + (fxAcc.get(r.id) || 0);
    const c = Math.floor(n); fxAcc.set(r.id, n - c);
    const side = -Math.sign(r.theta) || 1;
    for (let i = 0; i < c; i++) {
      const spread = 0.5 + carve * 1.2;
      spray.emit(p.x - fA.x * 0.7 + fR.x * side * 0.45 + (Math.random() - .5) * 0.5, p.y + 0.15, p.z - fA.z * 0.7 + fR.z * side * 0.45 + (Math.random() - .5) * 0.5,
        -fA.x * sp * 0.12 + fR.x * side * (2 + carve * 9) * Math.random() + (Math.random() - .5) * spread * 3, 1.2 + Math.random() * (2 + carve * 4), -fA.z * sp * 0.12 + fR.z * side * (2 + carve * 9) * Math.random() + (Math.random() - .5) * spread * 3,
        0.45 + Math.random() * 0.55, 0.45 + Math.random() * 0.6 + carve * 0.4, 0.95, 0.97, 1);
    }
    if (r.mode === 'grind' && Math.random() < 0.7 * lod * 60 * dt) for (let i = 0; i < 3; i++) glow.emit(p.x, p.y - 0.1, p.z, (Math.random() - .5) * 6 - fA.x * 8, 2 + Math.random() * 5, (Math.random() - .5) * 6 - fA.z * 8, 0.4, 0.4, 1, 0.7, 0.2);
  }
  if (r.boosting || r.padT > 0) {
    const n = Math.round(60 * dt * 2.2 * lod);
    for (let i = 0; i < n; i++) glow.emit(p.x - fA.x * 0.9 + (Math.random() - .5) * 0.8, p.y + 0.5 + Math.random() * 0.8, p.z - fA.z * 0.9 + (Math.random() - .5) * 0.8,
      -fA.x * 10 + (Math.random() - .5) * 3, (Math.random() - .5) * 2, -fA.z * 10 + (Math.random() - .5) * 3, 0.35 + Math.random() * 0.3, 0.7, r.padT > 0 && !r.boosting ? 0.2 : 1, r.padT > 0 && !r.boosting ? 0.9 : 0.55, r.padT > 0 && !r.boosting ? 1 : 0.15);
  }
  if (r.mode === 'air' && r.airT > 0.2 && Math.random() < 0.3 * lod) spray.emit(p.x, p.y, p.z, (Math.random() - .5) * 2, -1, (Math.random() - .5) * 2, 0.5, 0.5, 1, 1, 1);
  if (r.mode === 'crash' && Math.random() < 0.8) spray.emit(p.x, p.y + 0.3, p.z, (Math.random() - .5) * 8, 2 + Math.random() * 4, (Math.random() - .5) * 8, 0.8, 0.9, 0.95, 0.97, 1);
}

// ---------- main loop ----------
let acc = 0, last = performance.now(), fpsAcc = 0, fpsN = 0, fps = 60;
let frameWorst = 0;
function resize() {
  const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
function fitPanels() {
  for (const id of ['title', 'res']) {
    const card = document.querySelector(`#${id} .card`) as HTMLElement; if (!card) continue;
    card.style.zoom = '1'; const h = card.scrollHeight, w = card.scrollWidth;
    card.style.zoom = String(Math.min(1, (window.innerHeight * 0.96) / h, (window.innerWidth * 0.96) / w));
  }
}
window.addEventListener('resize', () => { resize(); fitPanels(); }); resize(); fitPanels();
setInterval(fitPanels, 1500);

function loop(now: number) {
  requestAnimationFrame(loop);
  let dt = (now - last) / 1000; last = now; if (dt > 0.1) dt = 0.1; if (dt <= 0) return;
  fpsAcc += dt; fpsN++; frameWorst = Math.max(frameWorst, dt); if (fpsAcc > 1) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; (window as any).__fps = fps; (window as any).__worst = frameWorst; frameWorst = 0; }
  if (input.mute) { input.mute = false; muted = !muted; audio.setVolume('master', muted ? 0 : audio.vol.master); if (!muted) audio.setVolume('master', audio.vol.master); }
  if (input.hideHints) { input.hideHints = false; const g = document.getElementById('gear')!; g.style.display = g.style.display === 'none' ? '' : 'none'; }
  if (!started) { if (input.start) { input.start = false; startRace(); } }
  else if (input.restart) { input.restart = false; audio.ui(); resetRace(); }
  else if (input.start && resultsT === -2) { input.start = false; resetRace(); }
  input.start = false; input.restart = false;

  if (started) {
    const pin = race.playerInput;
    input.read(pin, dt);
    acc += dt; let steps = 0;
    while (acc >= DT && steps < 16) {
      race.step(DT); acc -= DT; steps++;
      pin.jump = false; pin.shoveL = false; pin.shoveR = false;
    }
    if (acc > DT) acc = 0;
    input.endFrame();
  } else { input.endFrame(); }

  const t = now / 1000;
  const p = race.player;
  for (const v of views) v.update(course, dt, t);
  const pv = views[p.id];
  rig.update(dt, course, p, pv, SPEED_REF * 0.95);
  // sky follows camera
  sky.sky.position.copy(camera.position);
  sunL.position.copy(camera.position).add(tmpV.set(-90, 130, 70)); sunL.target.position.copy(camera.position);
  const f = course.sample(p.s);
  sky.sun.position.copy(camera.position).add(tmpV.set(Math.sin(f.psi) * 2300 - 500, 520, -Math.cos(f.psi) * 2300 + 300));
  for (const v of views) emitFX(v.r, v, dt);
  // ambient flurry near camera
  if (started) for (let i = 0; i < 2; i++) spray.emit(camera.position.x + (Math.random() - .5) * 40, camera.position.y + Math.random() * 14 - 4, camera.position.z + (Math.random() - .5) * 40, (Math.random() - .5), -1.2 - Math.random(), (Math.random() - .5), 2.2, 0.28, 1, 1, 1);
  spray.update(dt); glow.update(dt);
  lines.update(dt, Math.min(1, p.v / SPEED_REF), p.boosting || p.padT > 0);

  // audio + HUD
  let near = 0;
  for (const o of race.riders) if (o !== p && o.mode !== 'wait' && Math.abs(o.s - p.s) < 16 && Math.abs(o.l - p.l) < 9) near++;
  audio.update(dt, {
    speed01: p.v / SPEED_REF, grounded: p.mode === 'ride', carve01: Math.min(1, Math.abs(p.theta) / 0.5 + race.playerInput.brake), grinding: p.mode === 'grind', boosting: p.boosting,
    air: p.mode === 'air', tuck: p.tuck, pack01: Math.min(1, near / 2.5), finalSection: p.s > 2600, crashed: p.mode === 'crash', racing: race.state !== 'countdown' && started, finished: p.finished,
  });
  if (started) hud.update(dt, race);
  if (resultsT > 0) { resultsT -= dt; if (resultsT <= 0) { hud.showResults(race); resultsT = -2; } }
  if (resultsT === -2) { hud.showResults(race); }
  // shortcut toast
  if (!lastShortcutToast && p.s > course.split.s0 + 40 && p.s < course.split.s1 && p.l > 4) { lastShortcutToast = true; hud.toast('SHORTCUT!', '#00e5ff', true); }
  renderer.render(scene, camera);
}
requestAnimationFrame(loop);

// debug / test hooks
(window as any).__game = {
  race, audio, input, rig, hud, views: () => views, renderer, enableAuto, startRace, resetRace,
  state: () => ({ started, resultsT, fps, rank: race.player.rank, s: race.player.s, v: race.player.v, mode: race.player.mode, boost: race.player.boost, state: race.state, time: race.time, audio: audio.ready ? audio.ctx.state : 'none', sfx: audio.stats.sfx, steps: audio.stats.steps, events: audio.stats.events }),
};
const q = new URLSearchParams(location.search);
if (q.get('auto') === '1') { enableAuto(true); startRace(); }
