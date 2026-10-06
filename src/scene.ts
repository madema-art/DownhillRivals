// Builds the stylized 3D world from the Course model.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Course, FINISH_S, START_S } from './course';

export const HAZE = 0xdcd2f2;
const ROWS_DS = 1.25;
const COLS = 56;
const MARGIN = 26;

export function toWorld(c: Course, s: number, l: number, y: number, out: THREE.Vector3) {
  const f = c.sample(s);
  out.set(f.x + Math.cos(f.psi) * l, y, f.z + Math.sin(f.psi) * l);
  return out;
}
export function fwdAt(c: Course, s: number, out: THREE.Vector3) {
  const f = c.sample(s);
  const g = c.sample(s + 2), h = c.sample(s - 2);
  out.set(g.x - h.x, g.y - h.y, g.z - h.z).normalize(); void f;
  return out;
}

const col = (hex: number) => new THREE.Color(hex);
const C = {
  snowA: col(0xffffff), snowB: col(0xcfe0f8), edgeA: col(0xff5a1f), edgeB: col(0xffffff), powder: col(0xbfc8ff), powderB: col(0xa9b4f5),
  rampA: col(0xffa21a), rampB: col(0xffe14d), rampDrop: col(0x7b3a46), rock: col(0x586a94), rockB: col(0x7b86ab), rockSnow: col(0xe9f1ff),
  ice: col(0xc7f2ff), iceB: col(0xa6e4fb), berm: col(0xc9d9f2), bermB: col(0xb2c4e6), wall: col(0x4d5a82), wallTop: col(0xf2f8ff),
};

function hash(a: number, b: number) { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); }

function faceColor(c: Course, s: number, l: number, ny: number, out: THREE.Color) {
  const W = c.halfWidth(s), al = Math.abs(l);
  const stripe = (Math.floor(s / 7) & 1) === 1;
  const n = 0.96 + hash(Math.floor(s * 0.8), Math.floor(l * 0.7)) * 0.07;
  const sp = c.split;
  const w = c.wallAt(s, l, 0.8);
  if (w) { if (ny > 0.8) out.copy(C.wallTop); else out.copy(hash(s, l) > 0.5 ? C.wall : C.rock); return out.multiplyScalar(n); }
  const rp = c.rampAt(s, l);
  if (rp) {
    if (s > rp.s0 + rp.len + 0.2) out.copy(C.rampDrop);
    else out.copy((Math.floor((s - rp.s0) / 2.4) & 1) === 0 ? C.rampA : C.rampB);
    if (s > rp.s0 + rp.len - 2.2 && s <= rp.s0 + rp.len + 0.2) out.set(0xffffff);
    return out;
  }
  if (al <= W + 0.15) {
    if (al > W - 1.5) { out.copy((Math.floor(s / 5) & 1) === 0 ? C.edgeA : C.edgeB); return out; }
    const P = c.powder;
    if (s > P.s0 && s < P.s1 && l < P.l1 && l > P.l0) { out.copy(stripe ? C.powder : C.powderB); return out.multiplyScalar(n); }
    if (s > sp.s0 - 10 && s < sp.s1 + 10 && l > 4.4 && l < 15.7) { out.copy((Math.floor(s / 3) & 1) === 0 ? C.ice : C.iceB); return out.multiplyScalar(n); }
    out.copy(stripe ? C.snowA : C.snowB);
    return out.multiplyScalar(n);
  }
  // beyond boundary: berm / mountain wall
  if (ny < 0.62) out.copy(hash(s * 0.3, l * 0.3) > 0.5 ? C.rock : C.rockB);
  else out.copy(hash(s * 0.2, l * 0.2) > 0.6 ? C.berm : C.bermB);
  return out.multiplyScalar(n);
}

export function buildGround(c: Course): THREE.Group {
  const g = new THREE.Group();
  const rowsTotal = Math.floor(c.total / ROWS_DS);
  const CH = 40; // rows per chunk
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const P = new Float32Array((CH + 1) * COLS * 3);
  const colr = new THREE.Color();
  for (let r0 = 0; r0 < rowsTotal; r0 += CH) {
    const r1 = Math.min(rowsTotal, r0 + CH), nr = r1 - r0;
    const grid = (r: number, j: number) => (r * COLS + j) * 3;
    const ls = new Float32Array((nr + 1) * COLS);
    for (let r = 0; r <= nr; r++) {
      const s = (r0 + r) * ROWS_DS, f = c.sample(s);
      const Wt = f.W + MARGIN;
      for (let j = 0; j < COLS; j++) {
        const l = (j / (COLS - 1) * 2 - 1) * Wt;
        ls[r * COLS + j] = l;
        const y = c.height(s, l);
        P[grid(r, j)] = f.x + Math.cos(f.psi) * l; P[grid(r, j) + 1] = y; P[grid(r, j) + 2] = f.z + Math.sin(f.psi) * l;
      }
    }
    const tris = nr * (COLS - 1) * 2;
    const pos = new Float32Array(tris * 9), cols = new Float32Array(tris * 9);
    let o = 0;
    const put = (i: number, j: number, i2: number, j2: number, i3: number, j3: number, s: number, l: number) => {
      const a = grid(i, j), b = grid(i2, j2), d = grid(i3, j3);
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1; ny = Math.abs(ny / len);
      faceColor(c, s, l, ny, colr);
      for (const k of [a, b, d]) { pos[o] = P[k]; pos[o + 1] = P[k + 1]; pos[o + 2] = P[k + 2]; cols[o] = colr.r; cols[o + 1] = colr.g; cols[o + 2] = colr.b; o += 3; }
    };
    for (let r = 0; r < nr; r++) for (let j = 0; j < COLS - 1; j++) {
      const sm = (r0 + r + 0.5) * ROWS_DS;
      const lm = (ls[r * COLS + j] + ls[r * COLS + j + 1]) / 2;
      // winding so normals face up (+y): quad corners (r,j) (r+1,j) (r,j+1) (r+1,j+1); forward=-z-ish, right=+x
      put(r, j, r, j + 1, r + 1, j, sm, lm);
      put(r, j + 1, r + 1, j + 1, r + 1, j, sm, lm);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.computeVertexNormals(); geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, mat);
    g.add(m);
  }
  return g;
}

function treeGeo() {
  const parts: THREE.BufferGeometry[] = [];
  const add = (geo: THREE.BufferGeometry, y: number, color: number) => {
    geo.translate(0, y, 0);
    const n = geo.attributes.position.count, arr = new Float32Array(n * 3), cc = new THREE.Color(color);
    for (let i = 0; i < n; i++) { arr[i * 3] = cc.r; arr[i * 3 + 1] = cc.g; arr[i * 3 + 2] = cc.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    parts.push(geo.toNonIndexed());
  };
  add(new THREE.CylinderGeometry(0.22, 0.3, 1.2, 5), 0.6, 0x5a3a2e);
  add(new THREE.ConeGeometry(1.5, 2.6, 6), 2.2, 0x1f7a6a);
  add(new THREE.ConeGeometry(1.15, 2.2, 6), 3.6, 0x2a9a80);
  add(new THREE.ConeGeometry(0.75, 1.8, 6), 4.8, 0xf4fbff);
  return mergeGeometries(parts)!;
}

export function buildDecor(c: Course): THREE.Group {
  const grp = new THREE.Group();
  const matV = new THREE.MeshLambertMaterial({ vertexColors: true });
  const tg = treeGeo();
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x6d7aa3, flatShading: true });
  const barrierGeo = new THREE.BoxGeometry(1, 1, 1);
  const bMat = new THREE.MeshLambertMaterial({ color: 0xff7a1a });
  const pylGeo = new THREE.CylinderGeometry(0.5, 0.7, 1, 8);
  const pMat = new THREE.MeshLambertMaterial({ color: 0xff2d55 });
  const CHUNK = 200;
  const nChunks = Math.ceil(c.total / CHUNK);
  const treeSets: { m: THREE.Matrix4 }[][] = Array.from({ length: nChunks }, () => []);
  const rockSets: { m: THREE.Matrix4 }[][] = Array.from({ length: nChunks }, () => []);
  const v = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), e = new THREE.Euler();
  const mk = (s: number, l: number, scale: number, yoff = 0, sy = 1) => {
    const y = c.height(s, l) + yoff; toWorld(c, s, l, y, v);
    e.set(0, Math.random() * 6.28, 0); q.setFromEuler(e); sc.set(scale, scale * sy, scale);
    return new THREE.Matrix4().compose(v, q, sc);
  };
  let seed = 3; const rn = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // scenery trees + rocks on the slopes
  for (let s = 0; s < c.total; s += 5.5) {
    for (const side of [-1, 1]) {
      const W = c.halfWidth(s);
      const rows = 3;
      for (let k = 0; k < rows; k++) {
        if (rn() < 0.35) continue;
        const l = side * (W + 2.5 + k * 7 + rn() * 5);
        const ci = Math.min(nChunks - 1, Math.floor(s / CHUNK));
        const big = 0.9 + rn() * 1.3;
        if (rn() < 0.82) treeSets[ci].push({ m: mk(s + rn() * 4, l, big, -0.2) });
        else rockSets[ci].push({ m: mk(s + rn() * 4, l, 1.5 + rn() * 2.8, 0.2) });
      }
    }
  }
  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, list: { m: THREE.Matrix4 }[]) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => im.setMatrixAt(i, it.m));
    im.computeBoundingSphere(); grp.add(im);
  };
  for (let i = 0; i < nChunks; i++) { instanced(tg, matV, treeSets[i]); instanced(rockGeo, rockMat, rockSets[i]); }
  // collidable obstacles
  const oTrees: { m: THREE.Matrix4 }[] = [], oRocks: { m: THREE.Matrix4 }[] = [], oBar: { m: THREE.Matrix4 }[] = [], oPyl: { m: THREE.Matrix4 }[] = [];
  for (const o of c.obstacles) {
    if (o.kind === 'tree') oTrees.push({ m: mk(o.s, o.l, o.r * 1.15, -0.1) });
    else if (o.kind === 'rock') oRocks.push({ m: mk(o.s, o.l, o.r * 1.15, o.r * 0.3, 0.9) });
    else if (o.kind === 'barrier') { const y = c.height(o.s, o.l) + 0.7; toWorld(c, o.s, o.l, y, v); const f = c.sample(o.s); e.set(0, -f.psi, 0); q.setFromEuler(e); sc.set(2.8, 1.4, 0.7); oBar.push({ m: new THREE.Matrix4().compose(v, q, sc) }); }
    else { const y = c.height(o.s, o.l) + o.h / 2; toWorld(c, o.s, o.l, y, v); q.identity(); sc.set(o.r, o.h, o.r); oPyl.push({ m: new THREE.Matrix4().compose(v, q, sc) }); }
  }
  instanced(tg, matV, oTrees); instanced(rockGeo, rockMat, oRocks); instanced(barrierGeo, bMat, oBar); instanced(pylGeo, pMat, oPyl);

  // boost pads
  const padTex = canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#04202c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#00e5ff' : '#7dffe8'; g.beginPath(); const y = 20 + i * 58; g.moveTo(10, y + 40); g.lineTo(w / 2, y); g.lineTo(w - 10, y + 40); g.lineTo(w - 10, y + 62); g.lineTo(w / 2, y + 22); g.lineTo(10, y + 62); g.fill(); }
  });
  const padMat = new THREE.MeshBasicMaterial({ map: padTex, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const p of c.pads) {
    const geo = new THREE.PlaneGeometry(4.6, 7, 1, 6);
    const pa = geo.attributes.position;
    const f = c.sample(p.s);
    for (let i = 0; i < pa.count; i++) {
      const lx = pa.getX(i), ly = pa.getY(i); // ly along s (plane Y -> forward)
      const ss = p.s - ly, ll = p.l + lx;
      toWorld(c, ss, ll, c.height(ss, ll) + 0.08, v);
      pa.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals(); void f;
    grp.add(new THREE.Mesh(geo, padMat));
  }
  return grp;
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

function signTexture(text: string, bg: string, fg: string, w = 512, h = 128) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; for (let i = 0; i < w; i += 64) g.fillRect(i, 0, 32, 10), g.fillRect(i + 32, h - 10, 32, 10);
    g.fillStyle = fg; g.font = 'bold 74px Impact, Arial Black, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,.4)'; g.shadowBlur = 8; g.fillText(text, w / 2, h / 2 + 4);
  });
}

/** arch gate across the course at s with a banner texture facing the oncoming riders */
function gate(c: Course, s: number, text: string, bg: string, fg: string, hang = 12, post = 0x2a2f55): THREE.Group {
  const g = new THREE.Group(); const f = c.sample(s); const W = f.W;
  const pm = new THREE.MeshLambertMaterial({ color: post });
  const v = new THREE.Vector3();
  for (const side of [-1, 1]) {
    const l = side * (W + 0.6); const y = c.height(s, l);
    toWorld(c, s, l, y + hang / 2, v);
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.1, hang + 2, 1.1), pm); p.position.copy(v); g.add(p);
  }
  toWorld(c, s, 0, c.height(s, 0) + hang, v);
  const bw = W * 2 + 2.4;
  const banner = new THREE.Mesh(new THREE.BoxGeometry(bw, 3.6, 0.6), pm); banner.position.copy(v); banner.rotation.y = -f.psi; g.add(banner);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(bw - 1, 3.2), new THREE.MeshBasicMaterial({ map: signTexture(text, bg, fg, 1024, 128), fog: false }));
  // faces back toward the oncoming riders (they look along +forward; plane normal must point to -forward)
  sign.position.copy(v); sign.rotation.y = -f.psi;
  const back = new THREE.Vector3(Math.sin(f.psi), 0, -Math.cos(f.psi)).multiplyScalar(-0.35); sign.position.add(back);
  g.add(sign);
  return g;
}

export function buildProps(c: Course): THREE.Group {
  const grp = new THREE.Group();
  grp.add(gate(c, START_S - 8, 'DOWNHILL RIVALS', '#ff2d6f', '#ffffff', 14));
  const fin = gate(c, FINISH_S, 'FINISH', '#101018', '#ffffff', 14, 0xffffff);
  grp.add(fin);
  grp.add(gate(c, 1020, 'BOTTLENECK AHEAD', '#ffb300', '#1a1030', 11));
  grp.add(gate(c, c.split.s0 - 60, '◀ MAIN      SHORTCUT ▶', '#00c8ff', '#06121f', 11));
  grp.add(gate(c, 2290, 'GIANT AIR', '#ff2d6f', '#fff', 12));
  grp.add(gate(c, 2780, 'FINAL DROP', '#7b2cff', '#fff', 12));
  grp.add(gate(c, 700, 'CARVE ZONE', '#2ee6a6', '#05221a', 11));
  grp.add(gate(c, 800, 'BIG AIR', '#ff8a1f', '#2a0d00', 10));
  // finish checker line on the ground
  const fw = c.halfWidth(FINISH_S) * 2;
  const chk = canvasTex(256, 32, (g) => { for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) & 1 ? '#fff' : '#111'; g.fillRect(i * 8, j * 8, 8, 8); } });
  chk.wrapS = THREE.RepeatWrapping;
  const geo = new THREE.PlaneGeometry(fw, 3, 24, 2); const pa = geo.attributes.position; const v = new THREE.Vector3();
  for (let i = 0; i < pa.count; i++) { const ss = FINISH_S - pa.getY(i), ll = pa.getX(i); toWorld(c, ss, ll, c.height(ss, ll) + 0.07, v); pa.setXYZ(i, v.x, v.y, v.z); }
  grp.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: chk, polygonOffset: true, polygonOffsetFactor: -2 })));
  // rails
  const railMat = new THREE.MeshStandardMaterial({ color: 0xff2d95, metalness: 0.5, roughness: 0.35, emissive: 0x550022 });
  const postMat = new THREE.MeshLambertMaterial({ color: 0x38406e });
  const a = new THREE.Vector3(), b = new THREE.Vector3(), mid = new THREE.Vector3(), dir = new THREE.Vector3();
  for (const r of c.rails) {
    for (let s = r.s0; s < r.s1; s += 2) {
      toWorld(c, s, r.l, c.height(s, r.l) + r.h, a); toWorld(c, s + 2, r.l, c.height(s + 2, r.l) + r.h, b);
      mid.addVectors(a, b).multiplyScalar(0.5); dir.subVectors(b, a); const len = dir.length();
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, len + 0.05), railMat);
      seg.position.copy(mid); seg.lookAt(b); grp.add(seg);
      if (((s - r.s0) / 2) % 3 === 0) { const g0 = c.height(s, r.l); const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, r.h, 0.2), postMat); toWorld(c, s, r.l, g0 + r.h / 2, mid); post.position.copy(mid); grp.add(post); }
    }
  }
  // edge flags
  const poleG = new THREE.CylinderGeometry(0.08, 0.08, 3, 5), poleM = new THREE.MeshLambertMaterial({ color: 0x22264a });
  const flagG = new THREE.PlaneGeometry(1.6, 1), flagCols = [0xff2d6f, 0xffc400, 0x00d4ff, 0x9b5cff];
  const flagMats = flagCols.map((cc) => new THREE.MeshBasicMaterial({ color: cc, side: THREE.DoubleSide }));
  let k = 0;
  for (let s = 30; s < c.total - 40; s += 55) for (const side of [-1, 1]) {
    const l = side * (c.halfWidth(s) + 0.3); const y = c.height(s, l);
    const p = new THREE.Mesh(poleG, poleM); toWorld(c, s, l, y + 1.5, v); p.position.copy(v); grp.add(p);
    const f = new THREE.Mesh(flagG, flagMats[k++ % 4]); toWorld(c, s, l, y + 2.5, v); f.position.copy(v); const fr = c.sample(s); f.rotation.y = -fr.psi + Math.PI / 2; f.position.x += Math.cos(fr.psi) * -side * 0.8; f.position.z += Math.sin(fr.psi) * -side * 0.8; grp.add(f);
  }
  // direction chevrons floating before ramps
  return grp;
}

export function buildSky(c: Course, scene: THREE.Scene) {
  const g = new THREE.SphereGeometry(3000, 24, 16);
  const n = g.attributes.position.count, arr = new Float32Array(n * 3);
  const top = col(0x1f4fd8), mid = col(0x6fb2ff), hor = col(HAZE), tmp = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const y = g.attributes.position.getY(i) / 3000;
    if (y > 0) { tmp.copy(hor).lerp(mid, Math.min(1, y * 3)).lerp(top, Math.max(0, y * 1.6 - 0.2)); }
    else tmp.copy(hor);
    arr[i * 3] = tmp.r; arr[i * 3 + 1] = tmp.g; arr[i * 3 + 2] = tmp.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  const sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10; scene.add(sky);
  // sun
  const sunTex = canvasTex(256, 256, (cx, w, h) => { const gr = cx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, '#fff'); gr.addColorStop(0.25, 'rgba(255,240,200,.95)'); gr.addColorStop(0.5, 'rgba(255,190,140,.35)'); gr.addColorStop(1, 'rgba(255,160,120,0)'); cx.fillStyle = gr; cx.fillRect(0, 0, w, h); });
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, fog: false, depthWrite: false, transparent: true }));
  sun.scale.set(900, 900, 1); sun.renderOrder = -9; scene.add(sun);
  // distant mountains (unfogged flat-ish silhouettes)
  const mg = new THREE.Group();
  const rnd = (() => { let s = 11; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
  const mats = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
  for (let i = 0; i < 46; i++) {
    const s = rnd() * c.total, side = rnd() < 0.5 ? -1 : 1, dist = 600 + rnd() * 1400;
    const f = c.sample(s);
    const h = 350 + rnd() * 700, r = h * (0.7 + rnd() * 0.5);
    const geo = new THREE.ConeGeometry(r, h, 6 + Math.floor(rnd() * 3), 4, true); const pa = geo.attributes.position;
    const cc = new Float32Array(pa.count * 3); const far = Math.min(1, dist / 2000);
    const baseC = col(0x5a4fc7).lerp(col(HAZE), 0.25 + far * 0.55), capC = col(0xffffff).lerp(col(HAZE), far * 0.35), tt = new THREE.Color();
    for (let k = 0; k < pa.count; k++) {
      const yy = pa.getY(k) / h + 0.5; // 0 base .. 1 tip
      pa.setX(k, pa.getX(k) + (hash(k, i) - 0.5) * r * 0.08);
      tt.copy(baseC); if (yy > 0.55) tt.copy(capC).lerp(baseC, (1 - yy) * 0.5 + (hash(k * 3, i) * 0.12)); else tt.lerp(col(0x7f8fe0), yy * 0.4);
      cc[k * 3] = tt.r; cc[k * 3 + 1] = tt.g; cc[k * 3 + 2] = tt.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    const m = new THREE.Mesh(geo.toNonIndexed(), mats);
    m.position.set(f.x + Math.cos(f.psi) * side * dist, f.y - 260 + h / 2 - rnd() * 120, f.z + Math.sin(f.psi) * side * dist);
    mg.add(m);
  }
  scene.add(mg);
  return { sky, sun };
}
