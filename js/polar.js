// Diagrama polar 2D de un corte (en dB relativos al máximo global).
// α = 0 (eje principal) arriba, α = +90° a la derecha.

export function drawPolar(canvas, analysis, alpha, opts) {
  const w = canvas.clientWidth;
  if (w < 80) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(w * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, w);

  const css = getComputedStyle(document.documentElement);
  const grid = css.getPropertyValue('--grid').trim() || '#2a3350';
  const text = css.getPropertyValue('--muted').trim() || '#8b95b5';
  const color = opts.color;

  const cx = w / 2, cy = w / 2;
  const R = w / 2 - 24;
  const floor = opts.floor;
  const rad = (db) => (R * Math.max(0, db - floor)) / -floor;
  const pt = (a, r) => {
    const t = (a * Math.PI) / 180;
    return [cx + r * Math.sin(t), cy - r * Math.cos(t)];
  };

  ctx.lineWidth = 1;
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Anillos cada 10 dB
  for (let d = 0; d >= floor; d -= 10) {
    ctx.strokeStyle = grid;
    ctx.beginPath();
    ctx.arc(cx, cy, rad(d), 0, Math.PI * 2);
    ctx.stroke();
    if (d > floor) {
      ctx.fillStyle = text;
      const [x, y] = pt(15, rad(d));
      ctx.fillText(`${d}`, x + 8, y);
    }
  }
  // Anillo de −3 dB
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = text;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.arc(cx, cy, rad(-3), 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // Radios cada 30°
  for (let a = -150; a <= 180; a += 30) {
    ctx.strokeStyle = grid;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(...pt(a, R));
    ctx.stroke();
    ctx.fillStyle = text;
    const [x, y] = pt(a, R + 12);
    ctx.fillText(`${a}°`, x, y);
  }

  // Ejes
  ctx.fillStyle = opts.labelColor || text;
  ctx.font = 'bold 11px system-ui, sans-serif';
  const [ux, uy] = pt(0, R - 10);
  ctx.fillText(opts.uLabel, ux + 14, uy);
  const [vx, vy] = pt(90, R - 10);
  ctx.fillText(opts.vLabel, vx - 6, vy - 12);

  // Curva
  const { db } = analysis;
  ctx.beginPath();
  for (let k = 0; k <= db.length; k++) {
    const i = k % db.length;
    const [x, y] = pt(alpha[i], rad(db[i]));
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = color + '33';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Puntos de media potencia
  if (analysis.hpbw !== null) {
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    for (const a of [analysis.aL, analysis.aR]) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(...pt(a, R));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
}
