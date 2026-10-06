// Browser end-to-end smoke test against the production build (vite preview).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const URL_ = process.env.GAME_URL || 'http://localhost:4173/';
const shots = 'shots'; fs.mkdirSync(shots, { recursive: true });
let server;
if (!process.env.GAME_URL) {
  server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 2500));
}
const errors = [], logs = [];
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); else logs.push(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
const checks = [];
const ok = (name, cond, extra = '') => { checks.push([name, !!cond, extra]); console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
const st = () => page.evaluate(() => window.__game.state());

await page.goto(URL_, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game, null, { timeout: 15000 });
ok('page loads, game object exists', true);
await page.screenshot({ path: `${shots}/01-title.png` });
await page.click('#startBtn');
await page.waitForTimeout(500);
let s = await st();
ok('audio context running after click', s.audio === 'running', s.audio);
await page.waitForFunction(() => window.__game.state().state === 'racing', null, { timeout: 40000 });
await page.screenshot({ path: `${shots}/02-go.png` });
s = await st();
ok('race started (state racing)', s.state === 'racing', s.state);
// hold tuck + steer, jump, shove
await page.keyboard.down('KeyW');
await page.waitForTimeout(4000);
const s1 = await st();
ok('player accelerates downhill', s1.v > 15 && s1.s > 30, `v=${s1.v.toFixed(1)} s=${s1.s.toFixed(0)}`);
await page.keyboard.down('KeyD'); await page.waitForTimeout(400); await page.keyboard.up('KeyD');
const lat = await page.evaluate(() => window.__game.race.player.l);
ok('steering moves rider laterally', Math.abs(lat) > 1, `l=${lat.toFixed(2)}`);
await page.keyboard.press('Space'); await page.waitForTimeout(150);
const mode = await page.evaluate(() => window.__game.race.player.mode);
ok('jump leaves ground', mode === 'air' || mode === 'ride', mode);
await page.keyboard.press('KeyQ'); await page.waitForTimeout(100);
await page.screenshot({ path: `${shots}/03-racing.png` });
await page.keyboard.up('KeyW');
// force boost, check engages
await page.evaluate(() => { window.__game.race.player.boost = 80; });
await page.keyboard.down('ShiftLeft'); await page.waitForTimeout(700);
const boosting = await page.evaluate(() => window.__game.race.player.boosting);
ok('boost activates', boosting);
await page.screenshot({ path: `${shots}/04-boost.png` });
await page.keyboard.up('ShiftLeft');
// switch to AI autoplay to test full race, finish detection, restart
await page.evaluate(() => window.__game.enableAuto(true));
await page.waitForTimeout(2000);
await page.screenshot({ path: `${shots}/05-mid.png` });
// speed the sim: step the race in-page quickly rather than waiting 70s
await page.evaluate(() => { const g = window.__game; for (let i = 0; i < 120 * 140 && g.race.state !== 'done'; i++) g.race.step(); });
s = await st();
const fin = await page.evaluate(() => window.__game.race.riders.map((r) => ({ n: r.name, f: r.finished, t: r.finishTime, rank: r.finishRank })));
ok('all riders finish', fin.every((r) => r.f), JSON.stringify(fin.map((r) => r.n + ':' + r.t.toFixed(1))));
await page.waitForTimeout(2500);
await page.screenshot({ path: `${shots}/06-results.png` });
const resShown = await page.evaluate(() => document.getElementById('res').classList.contains('show'));
ok('results panel appears', resShown);
await page.keyboard.press('KeyR'); await page.waitForTimeout(600);
s = await st();
ok('restart works (countdown again)', s.state === 'countdown' && s.time < 0, s.state + ' t=' + s.time.toFixed(2));
const ev = s.events;
ok('audio produced sfx', s.sfx > 5 && s.steps > 100, `sfx=${s.sfx} steps=${s.steps} events=${JSON.stringify(ev)}`);
console.log('fps (software GL, not representative):', s.fps.toFixed(1));
ok('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close(); if (server) server.kill();
const failed = checks.filter((c) => !c[1]);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASSED');
process.exit(failed.length ? 1 : 0);
