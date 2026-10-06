// Fast-forward an AI-driven race and screenshot key moments. usage: node tools/shots.mjs [t1,t2,...]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
fs.mkdirSync('shots', { recursive: true });
const times = (process.argv[2] || '8,16,23,30,40,55,66').split(',').map(Number);
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({ executablePath: process.env.CHROME || (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined), args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto('http://localhost:4173/?auto=1'); await page.waitForFunction(() => window.__game && window.__game.state().state === 'racing', null, { timeout: 60000 });
for (const T of times) {
  await page.evaluate((T) => { const g = window.__game; while (g.race.time < T && g.race.state !== 'done') g.race.step(); g.rig.reset(); }, T);
  await page.waitForTimeout(1800);
  const info = await page.evaluate(() => { const p = window.__game.race.player; return `t=${window.__game.race.time.toFixed(1)} s=${p.s.toFixed(0)} l=${p.l.toFixed(1)} v=${p.v.toFixed(0)} ${p.mode} rank=${p.rank}`; });
  console.log(T, info);
  await page.screenshot({ path: `shots/t${String(T).padStart(2, '0')}.png` });
}
await browser.close(); server.kill();
