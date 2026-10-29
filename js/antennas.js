// Modelos analíticos de campo lejano.
// Convención física: z hacia arriba. Cada antena define field(x, y, z, p) que
// devuelve |F| (amplitud de campo, sin normalizar) para la dirección unitaria (x, y, z).

const TAU = Math.PI * 2;

// Escala de la escena: unidades de Three.js por cada longitud de onda.
// La antena y la onda animada usan la misma escala; el tamaño del patrón es arbitrario.
export const LAMBDA_SCENE = 0.5;

function dipoleField(x, y, z, p) {
  const kL2 = Math.PI * p.L; // k·L/2 con L en λ
  const s = Math.sqrt(Math.max(0, 1 - z * z));
  if (s < 1e-6) return 0;
  return Math.abs((Math.cos(kL2 * z) - Math.cos(kL2)) / s);
}

// Yagi-Uda aproximada como array end-fire de N dipolos λ/2 paralelos al eje y,
// alineados sobre el eje x (máximo hacia +x). Fase progresiva tipo Hansen-Woodyard
// y corrientes decrecientes: reflector 0,5; excitado 1; directores de 1 a 0,4.
const yagiWeights = new Map();
function yagiCurrents(N) {
  if (!yagiWeights.has(N)) {
    const w = [0.5];
    for (let n = 1; n < N; n++) w.push(1 - (0.6 * (n - 1)) / Math.max(1, N - 2));
    yagiWeights.set(N, w);
  }
  return yagiWeights.get(N);
}

function yagiField(x, y, z, p) {
  const N = p.N;
  const kd = TAU * p.d;
  const beta = -(kd + (0.8 * Math.PI) / N);
  const s = Math.sqrt(Math.max(0, 1 - y * y));
  const fe = s < 1e-6 ? 0 : Math.cos((Math.PI / 2) * y) / s;
  const psi = kd * x + beta;
  const w = yagiCurrents(N);
  let re = 0, im = 0;
  for (let n = 0; n < N; n++) {
    re += w[n] * Math.cos(n * psi);
    im += w[n] * Math.sin(n * psi);
  }
  return Math.abs(fe) * Math.hypot(re, im);
}

// Bocina piramidal como apertura a×b (en λ) con modo TE10, sin error de fase.
// Apertura en el plano yz, máximo hacia +x, campo E vertical (eje z).
function hornField(x, y, z, p) {
  const huygens = (1 + x) / 2;
  const X = Math.PI * p.a * y;
  const q = (2 * X) / Math.PI;
  const fh = Math.abs(1 - q * q) < 1e-6 ? Math.PI / 4 : Math.cos(X) / (1 - q * q);
  const Y = Math.PI * p.b * z;
  const fe = Math.abs(Y) < 1e-6 ? 1 : Math.sin(Y) / Y;
  return Math.abs(huygens * fh * fe);
}

export const ANTENNAS = [
  {
    id: 'dipolo',
    markerId: 1,
    name: 'Dipolo',
    full: 'Dipolo',
    tags: ['Polarización vertical', 'Omnidireccional en plano H'],
    desc: 'Dos brazos conductores alimentados en el centro. Con L = λ/2 el patrón tiene forma de "rosquilla": irradia igual en todo el plano horizontal y nada sobre su propio eje.',
    notes: [
      'Nulos sobre el eje del dipolo (eje z): ahí no hay radiación.',
      'Con L = 0,5 λ la directividad es ≈ 2,15 dBi y el HPBW en el plano E ≈ 78°.',
      'Probá L > 1 λ: el lóbulo se angosta y con L > 1,25 λ aparecen lóbulos adicionales.',
    ],
    params: [
      { key: 'L', label: 'Longitud L', unit: 'λ', min: 0.1, max: 2, step: 0.01, value: 0.5 },
    ],
    field: dipoleField,
    directional: false,
    boresight: [1, 0, 0],
    planes: {
      E: { v: [0, 0, 1], name: 'Plano E (xz)', uLabel: '+x', vLabel: '+z' },
      H: { v: [0, 1, 0], name: 'Plano H (xy)', uLabel: '+x', vLabel: '+y' },
    },
  },
  {
    id: 'yagi',
    markerId: 2,
    name: 'Yagi-Uda',
    full: 'Yagi-Uda',
    tags: ['Polarización horizontal', 'Directiva (end-fire)'],
    desc: 'Un dipolo excitado, un reflector detrás y varios directores delante. Los elementos parásitos acoplan corriente con la fase justa para concentrar la energía hacia adelante (+x).',
    notes: [
      'Modelo simplificado: array end-fire de dipolos λ/2 con corrientes decrecientes hacia los directores.',
      'Más directores → más ganancia y haz más angosto (con rendimientos decrecientes).',
      'Los elementos son horizontales (eje y), por eso el plano E es el horizontal (xy).',
    ],
    params: [
      { key: 'N', label: 'Cantidad de elementos', unit: '', min: 3, max: 15, step: 1, value: 6 },
      { key: 'd', label: 'Separación d', unit: 'λ', min: 0.1, max: 0.4, step: 0.01, value: 0.25 },
    ],
    field: yagiField,
    directional: true,
    boresight: [1, 0, 0],
    planes: {
      E: { v: [0, 1, 0], name: 'Plano E (xy)', uLabel: '+x', vLabel: '+y' },
      H: { v: [0, 0, 1], name: 'Plano H (xz)', uLabel: '+x', vLabel: '+z' },
    },
  },
  {
    id: 'bocina',
    markerId: 3,
    name: 'Bocina',
    full: 'Bocina piramidal',
    tags: ['Polarización vertical', 'Alta directividad'],
    desc: 'Una guía de onda que se abre gradualmente hasta una apertura grande. Cuanto mayor es la apertura en longitudes de onda, más angosto es el haz y mayor la ganancia.',
    notes: [
      'Modelo de apertura a×b con modo TE10 (sin error de fase de la bocina).',
      'Plano E: iluminación uniforme → lóbulos laterales ≈ −13 dB.',
      'Plano H: iluminación coseno → lóbulos laterales más bajos (≈ −23 dB) pero haz más ancho.',
    ],
    params: [
      { key: 'a', label: 'Ancho a (plano H)', unit: 'λ', min: 0.6, max: 6, step: 0.05, value: 2.5 },
      { key: 'b', label: 'Alto b (plano E)', unit: 'λ', min: 0.4, max: 5, step: 0.05, value: 1.9 },
    ],
    field: hornField,
    directional: true,
    boresight: [1, 0, 0],
    planes: {
      E: { v: [0, 0, 1], name: 'Plano E (xz)', uLabel: '+x', vLabel: '+z' },
      H: { v: [0, 1, 0], name: 'Plano H (xy)', uLabel: '+x', vLabel: '+y' },
    },
  },
];
