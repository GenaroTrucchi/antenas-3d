// Geometría 3D simple de cada antena, en coordenadas físicas (z arriba)
// y a escala: LAMBDA_SCENE unidades por longitud de onda.
import * as THREE from 'three';
import { LAMBDA_SCENE as LS } from './antennas.js';

const metal = new THREE.MeshPhongMaterial({ color: 0xc9ced8, shininess: 90, specular: 0x777777, side: THREE.DoubleSide });
const darkMetal = new THREE.MeshPhongMaterial({ color: 0x8a919e, shininess: 60, specular: 0x555555 });
const feedMat = new THREE.MeshPhongMaterial({ color: 0xffb703, emissive: 0x6b4100, shininess: 40 });

// Cilindro a lo largo del eje indicado ('x', 'y' o 'z').
function rod(len, r, mat, axis) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 20), mat);
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  return m;
}

function buildDipole(p) {
  const g = new THREE.Group();
  const gap = 0.03;
  const arm = Math.max(0.01, (p.L * LS - gap) / 2);
  for (const s of [1, -1]) {
    const r = rod(arm, 0.014, metal, 'z');
    r.position.z = s * (gap / 2 + arm / 2);
    g.add(r);
  }
  const feed = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, gap * 1.6), feedMat);
  g.add(feed);
  const coax = rod(0.35, 0.01, darkMetal, 'x');
  coax.position.x = -0.175 - 0.025;
  g.add(coax);
  return g;
}

function buildYagi(p) {
  const g = new THREE.Group();
  const N = p.N, d = p.d * LS;
  const x0 = (-(N - 1) / 2) * d;
  const boom = rod((N - 1) * d + 0.12, 0.018, darkMetal, 'x');
  boom.position.z = -0.03;
  g.add(boom);
  for (let n = 0; n < N; n++) {
    let len;
    if (n === 0) len = 0.5;
    else if (n === 1) len = 0.47;
    else len = Math.max(0.38, 0.44 - 0.006 * (n - 2));
    const x = x0 + n * d;
    if (n === 1) {
      const gap = 0.025;
      const arm = (len * LS - gap) / 2;
      for (const s of [1, -1]) {
        const r = rod(arm, 0.011, metal, 'y');
        r.position.set(x, s * (gap / 2 + arm / 2), 0);
        g.add(r);
      }
      const feed = new THREE.Mesh(new THREE.BoxGeometry(0.035, gap * 1.6, 0.035), feedMat);
      feed.position.x = x;
      g.add(feed);
    } else {
      const r = rod(len * LS, 0.011, metal, 'y');
      r.position.x = x;
      g.add(r);
    }
  }
  return g;
}

function quad(pos, a, b, c, d) {
  pos.push(...a, ...b, ...c, ...a, ...c, ...d);
}

function buildHorn(p) {
  const g = new THREE.Group();
  const A = (p.a * LS) / 2, B = (p.b * LS) / 2;
  const wa = (Math.min(0.72, p.a) * LS) / 2, wb = (Math.min(0.34, p.b) * LS) / 2;
  const Lh = LS * Math.max(1.2, 0.9 * Math.max(p.a, p.b));
  const xt = -Lh;
  const pos = [];
  quad(pos, [xt, -wa, wb], [0, -A, B], [0, A, B], [xt, wa, wb]);
  quad(pos, [xt, wa, -wb], [0, A, -B], [0, -A, -B], [xt, -wa, -wb]);
  quad(pos, [xt, wa, wb], [0, A, B], [0, A, -B], [xt, wa, -wb]);
  quad(pos, [xt, -wa, -wb], [0, -A, -B], [0, -A, B], [xt, -wa, wb]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, metal));
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x5b6475 })));

  const wgLen = 0.6 * LS;
  const wg = new THREE.Mesh(new THREE.BoxGeometry(wgLen, 2 * wa, 2 * wb), darkMetal);
  wg.position.x = xt - wgLen / 2;
  g.add(wg);
  const coax = rod(0.12, 0.018, feedMat, 'z');
  coax.position.set(xt - wgLen * 0.7, 0, wb + 0.06);
  g.add(coax);
  return g;
}

const BUILDERS = { dipolo: buildDipole, yagi: buildYagi, bocina: buildHorn };

export function buildModel(antId, p) {
  return BUILDERS[antId](p);
}
