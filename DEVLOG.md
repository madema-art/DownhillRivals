# DOWNHILL RIVALS — dev log

Arcade snowboard **racing** prototype (SSX-era feel, original assets). Browser game: TypeScript + Vite + Three.js + Web Audio.
(The earlier Unity/C# plan was abandoned — no Unity exists in the cloud box. Nothing of it remains.)

## How it ships
`push` → GitHub Actions (`.github/workflows/deploy.yml`): `npm ci` → headless AI race sim → `tsc` + `vite build` → Playwright e2e (non-blocking) → deploy `dist/` to GitHub Pages.
Vite `base: './'` so it works under any Pages sub-path. One-time account step: repo **Settings → Pages → Source: GitHub Actions** (the workflow also tries `configure-pages enablement:true`).

## Commands
- `npm run dev` – dev server · `npm run build` – typecheck + build · `npm run preview`
- `npm run sim -- 12 [-v]` – headless: 12 full AI races (player is an AI too) and prints stats (times, crashes, shoves, bumps, pack spread, shortcut vs main time, early-race action).
- `npx tsx tools/crashmap.ts` – histogram of where/why AI crashes. `npx tsx tools/trace.ts` – per-5s positions of all riders.
- `npm run e2e` – Playwright against the production build (needs chromium; sandbox uses `/opt/pw-browsers`). Screenshots in `shots/`.
- `node tools/shots.mjs 8,16,23` – fast-forward an AI race and screenshot key moments (software GL, slow but works).
- URL `?auto=1` starts a race with the player driven by AI (demo / visual tests). `window.__game` exposes race/audio/hud for tests.

## Architecture (src/)
- `course.ts` – **constrained 3D**: centerline built from keyframed descent/curvature/width tables. A position is `(s, l, y)` = distance along course, lateral offset, world height. `height(s,l)` is analytic: base + banking + ramps (power-curve rise then lip drop) + island/outer walls + powder moguls + side berms. Features: ramps, rails, boost pads, walls (shortcut island), obstacles (rock/tree/pylon/barrier), powder zone (slow lane), `split` (shortcut). Pure logic, no DOM → runs in Node for `sim`.
- `rider.ts` – arcade physics. Grounded: heading angle θ vs course tangent, speed `v` along heading; gravity ∝ descent × cosθ, quadratic drag (tuck −22%, carving/brake +), soft cap on boost/pads. Takeoff happens when ground falls away faster than ballistic fall (ramps/crests). Air: spin/flip/grab input, landing assist rotates toward nearest valid angle, landing classified perfect/clean/sloppy/bail. Rail grind (airborne capture or jump-assist), crash (tumble ~1–1.5s, keeps ~½ speed, auto-recover on a free lane), `balance` stat (wobble/ crash), contact resolution (circle-ish, mass-weighted, impulse + balance damage), `tryShove` (side-aimed, risk on whiff/recoil, ×2.2 damage near hazard, `shovedT` makes wall hits fatal).
- `ai.ts` – lane-target racer: personality (BRICK aggressive, VEX speedster, JUNO technical, DASH shortcut hunter, MELLOW cautious), pass/defend/side-by-side logic, ramp choose/avoid, route choice at the split, rail lining, obstacle gap-finding, boost timing, in-air trick plans (+mistakes), retaliation shoves, random mistakes. Rubber band in `race.ts` (±, based on distance to player) keeps pack tight without teleporting.
- `race.ts` – grid/countdown/step loop (fixed 120 Hz), ranking, finish, drafting, anti-stuck.
- `scene.ts` – flat-shaded vertex-colored ground chunks, instanced trees/rocks, rails, pads, gates with canvas-text banners, flags, sky dome, sun sprite, distant mountains. `view.ts` – chunky rider model + pose/tumble/detached board. `fx.ts` – GPU-point particles (snow + additive glow) and camera speed lines. `camera.ts` – chase cam (damped, FOV by speed/boost, bank, pullback, jump framing, shake).
- `audio.ts` – everything synthesized: wind/slide/carve/grind/boost loops scaled by speed; one-shots (thump, crash layers, bump, shove, boost, chimes, pass, finish sting…); step-sequenced 134 BPM breakbeat/big-beat track (drums, perc, funk bass, synth hook, pad, "rock" layer with distorted power chords + acid arp). Reactive: layers by speed/pack/boost/final section; lowpass in air, snaps open on big landing with kick slam; crash = muffle+duck; countdown intro then drop on GO; finish sting. Volume sliders (master/music/sfx, persisted).
- `input.ts` (keyboard + Gamepad API), `hud.ts` (DOM HUD, results), `main.ts` (glue: events → audio/fx/hud).

## Controls
Keyboard: A/D or ←/→ steer & air spin · W tuck / air front flip · S brake(hard carve) / back flip · Space jump (near a rail start = pop onto rail) · J/K/L grabs (hold in air) · Q shove left · E shove right · Shift boost (hold) · R restart · M mute · H hide volume panel.
Gamepad: left stick steer/spin/flip (right stick also), RT tuck, LT brake, A jump, X shove L, B shove R, Y boost, LB/RB/R3 grabs.

## Course (≈3200 m, ~69 s for AI winner)
start (slow flat push) → steep opening drop w/ kicker @420 & pads → S-curve carve zone (banked) @540–790 → **BIG AIR** (3 ramps) @830 → bottleneck @1060–1290 (W=12, center rock, pylons, barrier fences) → banked left → **split** @1500–1840: main lane (left, powder drag + hop) vs cyan **shortcut** (right: pads, kicker→rail→pad→huge ramp @1815, trees) → right hairpin @1880–2130 with inside rail @2085 → **GIANT AIR** @2400 → final drop → finish @3200 (+260 m run-out).

## Status / sim numbers (latest `npm run sim -- 16`)
winner ≈69 s · ~3.3 crashes/race (obstacles+shoves) · ~11 shoves & ~10 bumps/race · first 22 s: ~7 bumps, ~9 shoves, ~6 big-air takeoffs · shortcut zone ≈1.1 s faster than main · wins spread across riders.

## Known issues / next
- I (the AI dev) cannot *feel* the game; tuning is by simulation + screenshots. Needs a human playtest: steering sharpness, tuck, boost strength, trick difficulty, shove range, camera.
- Pack spread first→last still ~120 m avg (crashes/rubber band). Consider stronger catch-up or slipstream.
- Software-GL e2e only; real GPU fps unmeasured. Particle counts/instancing are modest, ground is chunked.
- Ideas: tunnel/arch section, more rails, replay of best trick, per-rider names over heads, gamepad rumble, richer crash ragdoll, music key/section changes per course zone, mobile touch controls.
