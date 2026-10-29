// Pose 3D de un marcador cuadrado a partir de sus 4 esquinas en la imagen,
// usando la homografía plana H = K·[r1 r2 t].
//
// Sistema del marcador: origen en el centro, X a la derecha, Y hacia arriba
// (tal como se imprime) y Z saliendo del papel hacia quien lo mira.
// Esquinas en el orden de js-aruco: sup-izq, sup-der, inf-der, inf-izq.

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    if (Math.abs(d) < 1e-12) return null;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / d;
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// Homografía (3×3, por filas) que lleva src[i] = [X, Y] a dst[i] = [u, v].
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [X, Y] = src[i], [u, v] = dst[i];
    A.push([X, Y, 1, 0, 0, 0, -u * X, -u * Y]); b.push(u);
    A.push([0, 0, 0, X, Y, 1, -v * X, -v * Y]); b.push(v);
  }
  const h = solve(A, b);
  return h ? [...h, 1] : null;
}

// Refina las esquinas a precisión subpíxel: en cada lado del cuadrado negro busca el
// borde (máximo gradiente) en varias normales, ajusta una recta por lado y vuelve a
// calcular cada esquina como la intersección de dos rectas vecinas.
export function refineCorners(img, corners) {
  const { width: W, height: H, data } = img;
  const lum = (x, y) => {
    const o = (y * W + x) * 4;
    return 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  };
  const sample = (x, y) => {
    if (x < 0 || y < 0 || x >= W - 1 || y >= H - 1) return NaN;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    return (lum(x0, y0) * (1 - fx) + lum(x0 + 1, y0) * fx) * (1 - fy)
      + (lum(x0, y0 + 1) * (1 - fx) + lum(x0 + 1, y0 + 1) * fx) * fy;
  };

  const lines = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 12) return corners;
    const tx = dx / len, ty = dy / len;
    const nx = -ty, ny = tx;
    const r = Math.max(2.5, len * 0.06);
    const pts = [];
    for (let k = 1; k < 16; k++) {
      const s = k / 16;
      if (s < 0.12 || s > 0.88) continue;
      const px = a.x + dx * s, py = a.y + dy * s;
      let bestG = 0, bestT = 0, prev = sample(px - nx * r, py - ny * r);
      const gs = [];
      for (let t = -r + 0.5; t <= r; t += 0.5) {
        const cur = sample(px + nx * t, py + ny * t);
        const g = Math.abs(cur - prev);
        gs.push([t - 0.25, g]);
        if (g > bestG) { bestG = g; bestT = gs.length - 1; }
        prev = cur;
      }
      if (!(bestG > 12) || bestT === 0 || bestT === gs.length - 1) continue;
      const [t1, g0] = gs[bestT - 1], [, g1] = gs[bestT], [, g2] = gs[bestT + 1];
      const den = g0 - 2 * g1 + g2;
      const off = den < 0 ? (0.5 * (g0 - g2)) / den : 0;
      const t = t1 + 0.5 + off * 0.5;
      pts.push([px + nx * t, py + ny * t]);
    }
    if (pts.length < 4) return corners;
    // Recta por mínimos cuadrados (dirección principal).
    let mx = 0, my = 0;
    for (const [x, y] of pts) { mx += x; my += y; }
    mx /= pts.length; my /= pts.length;
    let sxx = 0, sxy = 0, syy = 0;
    for (const [x, y] of pts) {
      sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); syy += (y - my) ** 2;
    }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    lines.push({ x: mx, y: my, dx: Math.cos(ang), dy: Math.sin(ang) });
  }

  const out = [];
  for (let i = 0; i < 4; i++) {
    const L1 = lines[(i + 3) % 4], L2 = lines[i];
    const det = L1.dx * -L2.dy - L1.dy * -L2.dx;
    if (Math.abs(det) < 1e-6) return corners;
    const ex = L2.x - L1.x, ey = L2.y - L1.y;
    const s = (ex * -L2.dy - ey * -L2.dx) / det;
    const p = { x: L1.x + L1.dx * s, y: L1.y + L1.dy * s };
    if (Math.hypot(p.x - corners[i].x, p.y - corners[i].y) > 4) return corners;
    out.push(p);
  }
  return out;
}

const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const scale = (v, k) => [v[0] * k, v[1] * k, v[2] * k];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (v) => scale(v, 1 / norm(v));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// corners: [{x, y}] en píxeles (y hacia abajo). size: lado del marcador.
// f, cx, cy: intrínsecos de la cámara en píxeles.
// Devuelve { r1, r2, r3, t } en coordenadas de cámara de visión (x der, y abajo, z adelante).
export function poseFromCorners(corners, size, f, cx, cy) {
  const s = size / 2;
  const obj = [[-s, s], [s, s], [s, -s], [-s, -s]];
  const H = homography(obj, corners.map((c) => [c.x, c.y]));
  if (!H) return null;
  const kinv = (a, b, c) => [(a - cx * c) / f, (b - cy * c) / f, c];
  const h1 = kinv(H[0], H[3], H[6]);
  const h2 = kinv(H[1], H[4], H[7]);
  const h3 = kinv(H[2], H[5], H[8]);
  let l = 2 / (norm(h1) + norm(h2));
  if (h3[2] * l < 0) l = -l; // el marcador tiene que estar delante de la cámara
  const a = unit(scale(h1, l)), b = unit(scale(h2, l));
  // Ortonormalización simétrica de r1 y r2.
  const p = unit(add(a, b)), q = unit(sub(a, b));
  const r1 = scale(add(p, q), Math.SQRT1_2);
  const r2 = scale(sub(p, q), Math.SQRT1_2);
  return { r1, r2, r3: cross(r1, r2), t: scale(h3, l) };
}

// Matriz 4×4 (por filas) para Three.js, cuya cámara mira hacia −z con y arriba.
export function toThreeRows(pose) {
  const { r1, r2, r3, t } = pose;
  const sg = [1, -1, -1];
  const rows = [];
  for (let i = 0; i < 3; i++) rows.push([sg[i] * r1[i], sg[i] * r2[i], sg[i] * r3[i], sg[i] * t[i]]);
  rows.push([0, 0, 0, 1]);
  return rows;
}
