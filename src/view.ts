// Visual representation of a Rider: chunky stylized snowboarder, pose + tumble + detached board.
import * as THREE from 'three';
import { Course } from './course';
import { Rider } from './rider';
import { toWorld } from './scene';

const V = () => new THREE.Vector3();
const lerpExp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export class RiderView {
  root = new THREE.Group();
  board = new THREE.Group();
  body = new THREE.Group();
  torso!: THREE.Mesh; head!: THREE.Group; armL!: THREE.Mesh; armR!: THREE.Mesh; legL!: THREE.Mesh; legR!: THREE.Mesh;
  shadow: THREE.Mesh;
  pos = V(); up = V().set(0, 1, 0); fwd = V().set(0, 0, -1); prevPos = V(); vel = V();
  qBase = new THREE.Quaternion(); tum = new THREE.Euler();
  boardDetached = false; boardVel = V(); boardSpin = V();
  prevMode = 'wait'; blink = 0; stretch = 0;
  private tmp = { a: V(), b: V(), c: V(), d: V(), m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler() };

  constructor(public r: Rider, private scene: THREE.Scene) {
    const jacket = new THREE.MeshLambertMaterial({ color: r.color });
    const pants = new THREE.MeshLambertMaterial({ color: 0x1b1f3a });
    const trim = new THREE.MeshLambertMaterial({ color: r.trim });
    const skin = new THREE.MeshLambertMaterial({ color: 0xffc9a0 });
    const gog = new THREE.MeshBasicMaterial({ color: r.isPlayer ? 0xffffff : 0x66f0ff });
    // board
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.09, 2.0), new THREE.MeshLambertMaterial({ color: r.isPlayer ? 0xffffff : r.color }));
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.085, 0.4), trim); stripe.position.z = 0;
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.28), pants); nose.position.set(0, 0.07, -0.88); nose.rotation.x = 0.5;
    const tail = nose.clone(); tail.position.z = 0.88; tail.rotation.x = -0.5;
    this.board.add(deck, stripe, nose, tail);
    this.root.add(this.board);
    // rider body faces +x (side stance)
    this.body.rotation.y = -Math.PI / 2;
    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.68, 0.36), jacket); this.torso.position.y = 0.95;
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.26, 0.32), pants); pelvis.position.y = 0.6;
    this.legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.24), pants); this.legL.position.set(0.3, 0.32, 0);
    this.legR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.24), pants); this.legR.position.set(-0.3, 0.32, 0);
    this.armL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.58, 0.16), jacket); this.armL.position.set(0.42, 1.05, 0);
    this.armR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.58, 0.16), jacket); this.armR.position.set(-0.42, 1.05, 0);
    this.armL.geometry.translate(0, -0.25, 0); this.armR.geometry.translate(0, -0.25, 0);
    this.head = new THREE.Group(); this.head.position.y = 1.5;
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8), trim);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), skin); face.position.set(0, -0.04, -0.06);
    const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.14), gog); goggles.position.set(0, 0.02, -0.22);
    this.head.add(face, helm, goggles);
    this.body.add(this.torso, pelvis, this.legL, this.legR, this.armL, this.armR, this.head);
    this.body.position.y = 0.04; this.body.scale.setScalar(1.3);
    this.root.add(this.body);
    this.root.traverse((o) => { o.frustumCulled = true; });
    this.root.scale.setScalar(1.1);
    scene.add(this.root);
    // blob shadow
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.9, 14), new THREE.MeshBasicMaterial({ color: 0x1a2250, transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
    scene.add(this.shadow);
  }

  dispose() { this.scene.remove(this.root); this.scene.remove(this.shadow); if (this.boardDetached) this.scene.remove(this.board); }

  update(c: Course, dt: number, time: number) {
    const r = this.r, t = this.tmp;
    toWorld(c, r.s, r.l, r.y, this.pos);
    this.vel.copy(this.pos).sub(this.prevPos).divideScalar(Math.max(dt, 1e-4)); this.prevPos.copy(this.pos);
    // surface frame
    const g0 = c.height(r.s, r.l);
    const pA = toWorld(c, r.s + 1, r.l, c.height(r.s + 1, r.l), t.a), pB = toWorld(c, r.s - 1, r.l, c.height(r.s - 1, r.l), t.b);
    const tan = V().subVectors(pA, pB).normalize();
    const pC = toWorld(c, r.s, r.l + 1, c.height(r.s, r.l + 1), t.a), pD = toWorld(c, r.s, r.l - 1, c.height(r.s, r.l - 1), t.b);
    const rv = V().subVectors(pC, pD);
    const nrm = rv.cross(tan).normalize();
    let upT = nrm.clone(), fwdT = tan.clone();
    const air = r.mode === 'air';
    if (air) {
      const k = Math.min(1, Math.max(0, 1 - (r.y - g0) / 6));
      upT.copy(WORLD_UP).lerp(nrm, 0.25 + 0.75 * k).normalize();
      const f = c.sample(r.s);
      const th = new THREE.Vector3(Math.sin(f.psi), 0, -Math.cos(f.psi)), rh = new THREE.Vector3(Math.cos(f.psi), 0, Math.sin(f.psi));
      const vd = th.multiplyScalar(r.vs).addScaledVector(rh, r.vl).add(new THREE.Vector3(0, r.vy * 0.8, 0)).normalize();
      fwdT.copy(vd).lerp(tan, k * 0.6).normalize();
    }
    const kk = r.mode === 'crash' ? 1 : lerpExp(air ? 9 : 16, dt);
    this.up.lerp(upT, kk).normalize(); this.fwd.lerp(fwdT, kk).normalize();
    const back = V().copy(this.fwd).negate();
    const right = V().crossVectors(this.up, back).normalize();
    const up2 = V().crossVectors(back, right).normalize();
    t.m.makeBasis(right, up2, back); this.qBase.setFromRotationMatrix(t.m);

    // pose
    const crashing = r.mode === 'crash';
    let yaw = -r.theta * (r.mode === 'grind' ? 0 : 1) - (r.spin + r.spinVis * 0), pitch = r.flip, roll = 0;
    if (!air) { yaw = -r.theta; pitch = r.flipVis; }
    else { yaw = -r.theta * 0.0 - r.spin; pitch = r.flip; }
    if (r.mode === 'ride') {
      roll = -r.theta * 0.95 - r.lean * 0.45 - (r.thetaRate * 0.015);
      const wob = Math.max(0, 0.7 - r.balance);
      roll += Math.sin(time * 22 + r.id * 3) * wob * 0.5;
      roll += r.bumpT > 0 ? r.bumpSide * 0.25 * (r.bumpT / 0.25) : 0;
      if (r.invulnT > 0) this.root.visible = Math.floor(time * 18) % 2 === 0 || r.invulnT < 0.2; else this.root.visible = true;
    } else this.root.visible = true;
    if (r.mode === 'grind') roll = -0.15 * Math.sin(time * 9);
    if (r.mode === 'air') roll = -r.theta * 0.3 + r.spinVis * 0;
    let qx = t.q;
    if (crashing) {
      this.tum.x += r.tumble[0] * dt * (1 - r.crashT / (r.crashDur + 0.1)); this.tum.y += r.tumble[1] * dt; this.tum.z += r.tumble[2] * dt;
      t.e.set(this.tum.x, this.tum.y, this.tum.z, 'YXZ'); qx.setFromEuler(t.e);
    } else { this.tum.set(0, 0, 0); t.e.set(pitch, yaw, roll, 'YXZ'); qx.setFromEuler(t.e); }
    this.root.quaternion.copy(this.qBase).multiply(qx);
    this.root.position.copy(this.pos).addScaledVector(this.up, 0.06);
    // crouch / arms / grab
    const tuck = r.tuck, grab = r.grabAmt;
    const crouch = tuck * 0.32 + grab * 0.16 + (r.mode === 'grind' ? 0.18 : 0) + (r.mode === 'air' ? 0.08 : 0);
    this.body.position.y = 0.04 - crouch * 0.55;
    this.torso.rotation.x = tuck * 0.55 + (r.mode === 'air' ? 0.1 : 0);
    this.legL.scale.y = this.legR.scale.y = 1 - crouch * 0.75;
    this.head.position.y = 1.5 - crouch * 0.55; this.head.position.z = -tuck * 0.35;
    this.torso.position.y = 0.95 - crouch * 0.52;
    const carve = Math.max(-1, Math.min(1, r.theta * 1.6));
    const flail = crashing ? Math.sin(time * 22 + r.id) : 0;
    const armSpread = 0.35 + Math.abs(carve) * 0.4 + (r.mode === 'ride' ? 0 : 0.15);
    this.armL.rotation.z = -armSpread - flail * 1.4 - (tuck * 0.35); this.armR.rotation.z = armSpread + flail * 1.2 + (tuck * 0.35);
    this.armL.rotation.x = -tuck * 0.7 - grab * 1.15 + (r.shoveT > 0 ? -1.4 : 0) * (r.shoveDir < 0 ? 1 : 0.0) + flail * 0.6;
    this.armR.rotation.x = -tuck * 0.7 + (r.shoveT > 0 ? -1.4 : 0) * (r.shoveDir > 0 ? 1 : 0) + flail * 0.8;
    this.armL.position.y = this.armR.position.y = 1.05 - crouch * 0.5;
    this.board.position.y = 0;

    // board detaching during crashes
    if (crashing && this.prevMode !== 'crash') this.detachBoard();
    if (!crashing && this.boardDetached) this.attachBoard();
    if (this.boardDetached) {
      this.boardVel.y -= 28 * dt; this.board.position.addScaledVector(this.boardVel, dt);
      this.board.rotation.x += this.boardSpin.x * dt; this.board.rotation.z += this.boardSpin.z * dt;
      const gy = c.height(r.s, r.l);
      this.boardVel.x *= Math.exp(-0.6 * dt); this.boardVel.z *= Math.exp(-0.6 * dt);
      const minY = gy + 0.1 - Math.max(0, (this.pos.y - gy)) * 0.0;
      if (this.board.position.y < Math.min(minY, this.pos.y) - 0.0) { this.board.position.y = Math.min(minY, this.pos.y); this.boardVel.y = Math.abs(this.boardVel.y) * 0.35; }
    }
    this.prevMode = r.mode;

    // shadow
    const h = Math.max(0, r.y - g0);
    t.c.copy(this.pos); t.c.y = g0 + 0.07;
    this.shadow.position.copy(t.c);
    this.shadow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nrm);
    this.shadow.scale.setScalar(1 + h * 0.05);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.08, 0.34 - h * 0.025);
    this.shadow.visible = r.mode !== 'wait' || true;
  }

  private detachBoard() {
    this.board.updateWorldMatrix(true, false);
    const wp = V().setFromMatrixPosition(this.board.matrixWorld);
    const wq = new THREE.Quaternion().setFromRotationMatrix(this.board.matrixWorld);
    this.root.remove(this.board); this.scene.add(this.board);
    this.board.position.copy(wp); this.board.quaternion.copy(wq);
    this.boardVel.copy(this.vel).multiplyScalar(0.8); this.boardVel.y += 6 + Math.random() * 4; this.boardVel.x += (Math.random() - 0.5) * 10; this.boardVel.z += (Math.random() - 0.5) * 6;
    this.boardSpin.set((Math.random() - 0.5) * 16, 0, (Math.random() - 0.5) * 16);
    this.boardDetached = true;
  }
  private attachBoard() {
    this.scene.remove(this.board); this.root.add(this.board);
    this.board.position.set(0, 0, 0); this.board.quaternion.identity(); this.boardDetached = false;
  }
}
