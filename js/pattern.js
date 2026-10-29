// Muestreo del patrón y métricas numéricas (directividad, HPBW, F/B, lóbulos).

const TAU = Math.PI * 2;

// Grilla θ ∈ [0, π] (NT filas, incluye polos) × φ ∈ [0, 2π) (NP columnas).
export function sampleGrid(ant, p, NT, NP) {
  const F = new Float32Array(NT * NP);
  let max = 0;
  for (let i = 0; i < NT; i++) {
    const th = (i * Math.PI) / (NT - 1);
    const st = Math.sin(th), ct = Math.cos(th);
    for (let j = 0; j < NP; j++) {
      const ph = (j * TAU) / NP;
      const v = ant.field(st * Math.cos(ph), st * Math.sin(ph), ct, p);
      F[i * NP + j] = v;
      if (v > max) max = v;
    }
  }
  return { F, max };
}

// D = 4π·Fmax² / ∮|F|² dΩ (regla del punto medio).
export function directivity(ant, p, n = 240) {
  const nt = n, np = 2 * n;
  const dth = Math.PI / nt, dph = TAU / np;
  let sum = 0, max = 0;
  for (let i = 0; i < nt; i++) {
    const th = (i + 0.5) * dth;
    const st = Math.sin(th), ct = Math.cos(th);
    let row = 0;
    for (let j = 0; j < np; j++) {
      const ph = (j + 0.5) * dph;
      const f = ant.field(st * Math.cos(ph), st * Math.sin(ph), ct, p);
      row += f * f;
      if (f > max) max = f;
    }
    sum += row * st;
  }
  sum *= dth * dph;
  const [bx, by, bz] = ant.boresight;
  max = Math.max(max, ant.field(bx, by, bz, p));
  return { D: (4 * Math.PI * max * max) / sum, Fmax: max };
}

// Corte por el plano que contiene al eje principal u y al eje v.
// α = 0 apunta a u, α = +90° apunta a v.
export function cutPattern(ant, p, plane, n = 720) {
  const [ux, uy, uz] = ant.boresight;
  const [vx, vy, vz] = plane.v;
  const alpha = new Float32Array(n);
  const F = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const a = -180 + (k * 360) / n;
    const r = (a * Math.PI) / 180;
    const c = Math.cos(r), s = Math.sin(r);
    alpha[k] = a;
    F[k] = ant.field(c * ux + s * vx, c * uy + s * vy, c * uz + s * vz, p);
  }
  return { alpha, F };
}

// Analiza un corte circular: dB relativo a Fref, HPBW y nivel del mayor lóbulo secundario.
export function analyzeCut(cut, Fref) {
  const { alpha, F } = cut;
  const n = F.length;
  const step = 360 / n;
  const db = new Float32Array(n);
  let pk = 0;
  for (let k = 0; k < n; k++) {
    db[k] = 20 * Math.log10(Math.max(F[k] / Fref, 1e-6));
    if (db[k] > db[pk]) pk = k;
  }
  const rel = (k) => db[((k % n) + n) % n] - db[pk];
  let minRel = 0;
  for (let k = 0; k < n; k++) minRel = Math.min(minRel, rel(k));

  let hpbw = null, aL = null, aR = null;
  if (minRel < -3) {
    let k = 1;
    while (k < n && rel(pk + k) >= -3) k++;
    let r1 = rel(pk + k - 1), r2 = rel(pk + k);
    const offR = (k - 1 + (r1 + 3) / (r1 - r2)) * step;
    k = 1;
    while (k < n && rel(pk - k) >= -3) k++;
    r1 = rel(pk - k + 1); r2 = rel(pk - k);
    const offL = (k - 1 + (r1 + 3) / (r1 - r2)) * step;
    if (offR + offL < 360) {
      hpbw = offR + offL;
      aR = alpha[pk] + offR;
      aL = alpha[pk] - offL;
    }
  }

  // Lóbulo principal: desde el pico hasta el primer mínimo a cada lado.
  let offR = 0;
  while (offR < n - 1 && rel(pk + offR + 1) <= rel(pk + offR) + 1e-6) offR++;
  let offL = 0;
  while (offL < n - 1 && rel(pk - offL - 1) <= rel(pk - offL) + 1e-6) offL++;
  let sll = null;
  for (let k = offR + 1; k < n - offL; k++) {
    const v = rel(pk + k);
    if (sll === null || v > sll) sll = v;
  }

  return { db, peak: pk, peakAlpha: alpha[pk], hpbw, aL, aR, sll };
}

export function frontToBack(ant, p) {
  const [x, y, z] = ant.boresight;
  const f = ant.field(x, y, z, p);
  const b = ant.field(-x, -y, -z, p);
  if (b <= f * 1e-4) return Infinity;
  return 20 * Math.log10(f / b);
}
