// Chase camera: damped follow, speed FOV, bank, pullback, jump framing, impact shake.
import * as THREE from 'three';
import { Course } from './course';
import { Rider } from './rider';
import { RiderView } from './view';

const lerpExp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

export class CamRig {
  pos = new THREE.Vector3(); look = new THREE.Vector3(); dir = new THREE.Vector3(0, 0, -1);
  init2 = false; fov = 66; roll = 0; trauma = 0; dist = 8; height = 3; init = false; airK = 0; landDip = 0; t = 0;
  constructor(public cam: THREE.PerspectiveCamera) {}
  shake(a: number) { this.trauma = Math.min(1, this.trauma + a); }
  reset() { this.init = false; this.trauma = 0; }

  update(dt: number, c: Course, r: Rider, view: RiderView, speedMax: number) {
    this.t += dt;
    const sp = Math.min(1.2, r.v / speedMax);
    const air = r.mode === 'air';
    this.airK += ((air ? 1 : 0) - this.airK) * lerpExp(air ? 3 : 5, dt);
    const hAbove = Math.max(0, r.y - c.height(r.s, r.l));
    const jump = Math.min(1, hAbove / 14) * this.airK;
    // direction: course tangent with slight lean toward heading
    const tan = view.fwd.clone(); tan.y *= 0.6; tan.normalize();
    const f = c.sample(r.s);
    const th = new THREE.Vector3(Math.sin(f.psi), 0, -Math.cos(f.psi));
    const d = th.clone().multiplyScalar(0.85).add(tan.multiplyScalar(0.15)).normalize();
    // heading influence: rotate toward rider heading for a more connected feel
    const yaw = -r.theta * 0.28 * (air ? 0.2 : 1);
    d.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    if (!this.init) { this.dir.copy(d); }
    this.dir.lerp(d, lerpExp(4.5, dt)).normalize();
    const boost = r.boosting || r.padT > 0 ? 1 : 0;
    const targetDist = 7.6 + sp * 3.4 + boost * 1.6 + jump * 4.5;
    const targetH = 3.1 + sp * 0.9 + jump * 2.6 - r.tuck * 0.35;
    this.dist += (targetDist - this.dist) * lerpExp(2.6, dt);
    this.height += (targetH - this.height) * lerpExp(3, dt);
    const target = view.pos;
    const want = new THREE.Vector3().copy(target).addScaledVector(this.dir, -this.dist);
    want.y = target.y + this.height + (r.mode === 'crash' ? 0.8 : 0);
    // never dip below ground
    const gy = c.height(r.s - this.dist * 0.9, r.l) + 1.4;
    if (want.y < gy) want.y = gy;
    if (!this.init) { this.pos.copy(want); this.init = true; this.init2 = false; }
    const kx = lerpExp(9, dt), ky = lerpExp(5.5, dt);
    this.pos.x += (want.x - this.pos.x) * kx; this.pos.z += (want.z - this.pos.z) * kx; this.pos.y += (want.y - this.pos.y) * ky;
    const lookT = new THREE.Vector3().copy(target).addScaledVector(this.dir, 7 + sp * 5).add(new THREE.Vector3(0, 1.0 - jump * 3.5, 0));
    if (!this.init2) { this.look.copy(lookT); this.init2 = true; }
    this.look.lerp(lookT, lerpExp(8, dt));
    this.cam.position.copy(this.pos);
    // shake
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    const sh = this.trauma * this.trauma;
    const bs = (r.boosting ? 0.012 : 0) + (sp > 0.9 ? 0.006 : 0);
    this.cam.position.x += (Math.sin(this.t * 53) + Math.sin(this.t * 31.7)) * 0.18 * sh + Math.sin(this.t * 41) * bs;
    this.cam.position.y += (Math.sin(this.t * 47.3) + Math.sin(this.t * 27)) * 0.18 * sh + Math.sin(this.t * 37) * bs;
    this.cam.lookAt(this.look);
    const rollT = -(r.theta * 0.11 + r.thetaRate * 0.004) * (r.mode === 'ride' ? 1 : 0.3) + (r.mode === 'crash' ? Math.sin(this.t * 14) * 0.06 : 0);
    this.roll += (rollT - this.roll) * lerpExp(6, dt);
    this.cam.rotateZ(this.roll);
    const fovT = 64 + 30 * Math.min(1, Math.max(0, (r.v - 18) / 52)) + boost * 9 + jump * 6;
    this.fov += (fovT - this.fov) * lerpExp(3.5, dt);
    if (Math.abs(this.cam.fov - this.fov) > 0.05) { this.cam.fov = this.fov; this.cam.updateProjectionMatrix(); }
  }
}
