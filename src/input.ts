// Keyboard + gamepad -> RiderInput
import { RiderInput } from './rider';

const dz = (v: number, d = 0.14) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));

export class Input {
  keys = new Set<string>(); edge = new Set<string>();
  padPrev: boolean[] = []; kbSteer = 0; padActive = false;
  restart = false; start = false; mute = false; hideHints = false;
  constructor() {
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat) { this.edge.add(e.code); if (e.code === 'KeyR') this.restart = true; if (e.code === 'Enter' || e.code === 'Space') this.start = true; if (e.code === 'KeyM') this.mute = true; if (e.code === 'KeyH') this.hideHints = true; }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); });
  }
  private k(...c: string[]) { return c.some((x) => this.keys.has(x)); }
  private e(...c: string[]) { return c.some((x) => this.edge.has(x)); }

  /** fill `o` for this frame (edge actions set; caller clears them after the first physics step) */
  read(o: RiderInput, dt: number) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp: Gamepad | null = null; for (const p of pads) if (p && p.connected) { gp = p; break; }
    const left = this.k('KeyA', 'ArrowLeft'), right = this.k('KeyD', 'ArrowRight');
    const kt = (right ? 1 : 0) - (left ? 1 : 0);
    const rate = kt === 0 ? 14 : 9;
    this.kbSteer += (kt - this.kbSteer) * Math.min(1, dt * rate);
    let steer = this.kbSteer;
    let pitch = (this.k('KeyS', 'ArrowDown') ? 1 : 0) - (this.k('KeyW', 'ArrowUp') ? 1 : 0);
    let tuck = this.k('KeyW', 'ArrowUp') ? 1 : 0, brake = this.k('KeyS', 'ArrowDown') ? 1 : 0;
    let jump = this.e('Space'), sL = this.e('KeyQ'), sR = this.e('KeyE');
    let boost = this.k('ShiftLeft', 'ShiftRight');
    let grab = (this.k('KeyJ') ? 1 : 0) | (this.k('KeyK') ? 2 : 0) | (this.k('KeyL') ? 4 : 0);
    if (gp) {
      const b = (i: number) => !!gp!.buttons[i]?.pressed, ax = (i: number) => gp!.axes[i] || 0;
      const lx = dz(ax(0)), ly = dz(ax(1)), rx = dz(ax(2)), ry = dz(ax(3));
      if (Math.abs(lx) + Math.abs(ly) + Math.abs(rx) > 0.05 || gp.buttons.some((x) => x.pressed)) this.padActive = true;
      if (Math.abs(lx) > 0.01 || Math.abs(rx) > 0.01) steer = Math.max(-1, Math.min(1, lx + rx));
      if (Math.abs(ly) > 0.2 || Math.abs(ry) > 0.2) pitch = Math.max(-1, Math.min(1, ly + ry));
      const rt = gp.buttons[7]?.value || 0, lt = gp.buttons[6]?.value || 0;
      tuck = Math.max(tuck, rt); brake = Math.max(brake, lt);
      const pe = (i: number) => b(i) && !this.padPrev[i];
      if (pe(0)) jump = true; if (pe(2)) sL = true; if (pe(1)) sR = true;
      if (b(3)) boost = true;
      if (b(4)) grab |= 1; if (b(5)) grab |= 2; if (b(11) || (b(4) && b(5))) grab |= 4;
      if (pe(9) || pe(0)) { this.start = true; }
      if (pe(8) || pe(9)) this.restart = this.restart || false;
      this.padPrev = gp.buttons.map((x) => x.pressed);
    }
    o.steer = steer; o.pitch = pitch; o.tuck = tuck; o.brake = brake; o.boost = boost; o.grab = grab;
    o.jump = o.jump || jump; o.shoveL = o.shoveL || sL; o.shoveR = o.shoveR || sR;
  }
  endFrame() { this.edge.clear(); }
}
