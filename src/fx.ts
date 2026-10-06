// Particle systems (snow spray, glow sparks) + camera-space speed lines.
import * as THREE from 'three';

const VERT = `
attribute vec4 aColor; attribute float aSize; varying vec4 vColor;
uniform float uScale;
void main(){ vColor=aColor; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv; gl_PointSize=aSize*uScale/max(0.5,-mv.z); }`;
const FRAG = `
varying vec4 vColor;
void main(){ vec2 p=gl_PointCoord-0.5; float d=length(p); if(d>0.5) discard; float a=smoothstep(0.5,0.1,d)*vColor.a; gl_FragColor=vec4(vColor.rgb,a); }`;

export class Particles {
  N: number; pos: Float32Array; vel: Float32Array; life: Float32Array; max: Float32Array; size0: Float32Array; col: Float32Array;
  aColor: Float32Array; aSize: Float32Array; head = 0; points: THREE.Points; grav: number; drag: number; live = 0;
  constructor(n: number, additive: boolean, grav: number, drag: number, scene: THREE.Scene, scale = 700) {
    this.N = n; this.grav = grav; this.drag = drag;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n).fill(1);
    this.size0 = new Float32Array(n); this.col = new Float32Array(n * 3); this.aColor = new Float32Array(n * 4); this.aSize = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.aColor, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.aSize, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms: { uScale: { value: scale } } });
    this.points = new THREE.Points(g, m); this.points.frustumCulled = false; scene.add(this.points);
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -1e5;
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, r: number, g: number, b: number) {
    const i = this.head; this.head = (this.head + 1) % this.N;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.max[i] = life; this.size0[i] = size; this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
  }
  update(dt: number) {
    const N = this.N, k = Math.exp(-this.drag * dt);
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) { this.aSize[i] = 0; continue; }
      this.life[i] -= dt;
      const u = Math.max(0, this.life[i] / this.max[i]);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.aColor[i * 4] = this.col[i * 3]; this.aColor[i * 4 + 1] = this.col[i * 3 + 1]; this.aColor[i * 4 + 2] = this.col[i * 3 + 2];
      this.aColor[i * 4 + 3] = Math.min(1, u * 2.2) * 0.9;
      this.aSize[i] = this.size0[i] * (0.6 + (1 - u) * 1.1);
    }
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** streaks attached to the camera; intensity follows speed */
export class SpeedLines {
  N = 90; lines: THREE.LineSegments; data: { x: number; y: number; z: number; len: number }[] = [];
  pos: Float32Array; mat: THREE.LineBasicMaterial;
  constructor(cam: THREE.Camera) {
    this.pos = new Float32Array(this.N * 6);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
    this.lines = new THREE.LineSegments(g, this.mat); this.lines.frustumCulled = false; this.lines.renderOrder = 50; cam.add(this.lines);
    for (let i = 0; i < this.N; i++) this.data.push(this.spawn(true));
  }
  spawn(init: boolean) {
    const a = Math.random() * Math.PI * 2, r = 2.2 + Math.random() * 7;
    return { x: Math.cos(a) * r * 1.5, y: Math.sin(a) * r * 0.9, z: -(init ? Math.random() * 40 : 40 + Math.random() * 10), len: 0.5 + Math.random() * 1.5 };
  }
  update(dt: number, speed01: number, boost: boolean) {
    const sp = speed01 * (boost ? 1.4 : 1);
    this.mat.opacity = Math.max(0, Math.min(0.55, (speed01 - 0.35) * 1.1 + (boost ? 0.2 : 0)));
    this.mat.color.setHex(boost ? 0xaaf4ff : 0xffffff);
    const vel = 45 + sp * 140;
    for (let i = 0; i < this.N; i++) {
      const d = this.data[i];
      d.z += vel * dt;
      if (d.z > -1.5) { const n = this.spawn(false); d.x = n.x; d.y = n.y; d.z = n.z; d.len = n.len; }
      const L = d.len * (1 + sp * 5);
      this.pos[i * 6] = d.x; this.pos[i * 6 + 1] = d.y; this.pos[i * 6 + 2] = d.z;
      this.pos[i * 6 + 3] = d.x; this.pos[i * 6 + 4] = d.y; this.pos[i * 6 + 5] = d.z - L;
    }
    (this.lines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
