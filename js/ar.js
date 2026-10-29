// Modo cámara AR: detecta marcadores ArUco impresos y dibuja el patrón
// de la antena correspondiente anclado al marcador.
import * as THREE from 'three';
import { ANTENNAS } from './antennas.js';
import { RadiationView, addLights, PATTERN_R } from './radiation.js';
import { poseFromCorners, refineCorners, toThreeRows } from './pose.js';

const TAU = Math.PI * 2;
const query = new URLSearchParams(location.search);
const PROC_MAX = Number(query.get('proc')) || 640;  // ancho máximo del cuadro que se analiza
const useRefine = !query.has('norefine');            // refinamiento subpíxel de esquinas
const LOST_MS = 600;       // tiempo sin ver el marcador antes de ocultar el patrón
const SMOOTH = 0.55;       // suavizado de la pose (0 = nada, 1 = congelado)
const DICTIONARY = 'ARUCO_MIP_36h12';
const STORE_KEY = 'antenas3d-ar';

const $ = (id) => document.getElementById(id);
const fmt = (v, d = 0) => v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
const byMarker = Object.fromEntries(ANTENNAS.map((a) => [a.markerId, a]));
const defaultParams = (a) => Object.fromEntries(a.params.map((p) => [p.key, p.value]));

// ---------------------------------------------------------------- Ajustes

const DEFAULTS = {
  markerCm: 15,
  patternCm: 40,
  fovDeg: 62,
  mode: 'ambos',
  plane: 'E',
  opacity: 0.6,
  shells: false,
  showAnt: false,
  showAxes: true,
  offsets: Object.fromEntries(ANTENNAS.map((a) => [a.id, { x: 0, y: 0, z: 20 }])),
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return { ...structuredClone(DEFAULTS), ...saved, offsets: { ...structuredClone(DEFAULTS.offsets), ...(saved.offsets || {}) } };
  } catch {
    return structuredClone(DEFAULTS);
  }
}
function saveSettings() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(cfg));
  } catch { /* sin almacenamiento: los ajustes duran hasta cerrar la página */ }
}

const cfg = loadSettings();
const state = { playing: true, phase: 0, speed: 0.5, current: null };

// ---------------------------------------------------------------- Escena

const stage = $('stage');
const video = $('video');
const canvas = $('ar3d');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.01, 50);
addLights(scene);

const anchor = new THREE.Group();   // sistema del marcador
anchor.visible = false;
scene.add(anchor);
const holder = new THREE.Group();   // desplazamiento y escala de la antena
anchor.add(holder);
const view = new RadiationView();
holder.add(view.root);

function applyVisibility() {
  view.setVisibility({
    mode: cfg.mode,
    opacity: cfg.opacity,
    shells: cfg.shells,
    atten: true,
    showAnt: cfg.showAnt,
    showAxes: cfg.showAxes,
    showMesh: true,
    showGrid: false,
  });
}

function applyHolder() {
  if (!state.current) return;
  const o = cfg.offsets[state.current.id];
  // Física (x adelante, y hacia adentro del papel, z arriba) → marcador (X der, Y arriba, Z afuera).
  holder.position.set(o.x / 100, o.z / 100, -o.y / 100);
  holder.scale.setScalar(cfg.patternCm / 100 / PATTERN_R);
}

function setAntenna(a) {
  state.current = a;
  view.setPlane(cfg.plane);
  view.update(a, defaultParams(a), { scale: 'db', range: 30 });
  applyVisibility();
  applyHolder();
  renderOffsets();
}

// ---------------------------------------------------------------- Fuente de imagen y detección

let source = null;          // { el, width(), height(), ready(), tick?() }
let detector = null;
const proc = document.createElement('canvas');
const pctx = proc.getContext('2d', { willReadFrequently: true });
let intr = null;            // { w, h, f, cx, cy }
let sizeKey = '';
let lastSeen = -Infinity;

function configureSize() {
  const vw = source.width(), vh = source.height();
  const key = `${vw}x${vh}|${stage.clientWidth}x${stage.clientHeight}|${cfg.fovDeg}`;
  if (key === sizeKey) return;
  sizeKey = key;

  const w = Math.min(PROC_MAX, vw);
  const h = Math.round((vh * w) / vw);
  proc.width = w;
  proc.height = h;
  const f = Math.max(w, h) / 2 / Math.tan((cfg.fovDeg * Math.PI) / 360);
  intr = { w, h, f, cx: w / 2, cy: h / 2 };

  camera.fov = (2 * Math.atan(h / 2 / f) * 180) / Math.PI;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  // El lienzo 3D tiene la proporción del video y se recorta igual (object-fit: cover).
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const s = Math.max(stage.clientWidth / vw, stage.clientHeight / vh) * dpr;
  const k = Math.min(1, 2048 / Math.max(vw * s, vh * s));
  renderer.setSize(Math.round(vw * s * k), Math.round(vh * s * k), false);
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

function detect(now) {
  const { w, h, f, cx, cy } = intr;
  pctx.drawImage(source.el, 0, 0, w, h);
  const img = pctx.getImageData(0, 0, w, h);
  const markers = detector.detect(img);

  let best = null, bestArea = 0;
  for (const m of markers) {
    if (!byMarker[m.id]) continue;
    const c = m.corners;
    const area = Math.abs((c[2].x - c[0].x) * (c[3].y - c[1].y) - (c[3].x - c[1].x) * (c[2].y - c[0].y)) / 2;
    if (area > bestArea) { best = m; bestArea = area; }
  }

  if (best) {
    const corners = useRefine ? refineCorners(img, best.corners) : best.corners;
    const pose = poseFromCorners(corners, cfg.markerCm / 100, f, cx, cy);
    if (pose) {
      const a = byMarker[best.id];
      if (state.current !== a) {
        setAntenna(a);
        anchor.visible = false;
      }
      const r = toThreeRows(pose);
      _m.set(...r[0], ...r[1], ...r[2], ...r[3]);
      _m.decompose(_p, _q, _s);
      if (!anchor.visible) {
        anchor.position.copy(_p);
        anchor.quaternion.copy(_q);
      } else {
        anchor.position.lerp(_p, 1 - SMOOTH);
        anchor.quaternion.slerp(_q, 1 - SMOOTH);
      }
      anchor.visible = true;
      lastSeen = now;
      window.__arDebug = { est: _m.clone().elements, id: best.id };
      setStatus(true, `${a.full} · marcador ${best.id}`);
    }
  } else if (now - lastSeen > LOST_MS) {
    anchor.visible = false;
    setStatus(false, 'Buscando marcador…');
  }
}

function setStatus(found, text) {
  const el = $('status');
  if (el.dataset.found === String(found) && el.textContent === text) return;
  el.dataset.found = found;
  $('statusText').textContent = text;
}

async function startCamera() {
  if (!window.isSecureContext) {
    throw new Error('La cámara solo funciona en páginas seguras (HTTPS). Abrí la versión publicada en GitHub Pages.');
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Este navegador no permite usar la cámara.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  video.srcObject = stream;
  await video.play();
  source = {
    el: video,
    width: () => video.videoWidth,
    height: () => video.videoHeight,
    ready: () => video.readyState >= 2 && video.videoWidth > 0,
  };
}

// Demo sin cámara: una tarjeta con el marcador, renderizada y movida por la computadora.
async function startDemo() {
  const W = 960, H = 720;
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.setSize(W, H, false);
  r.domElement.className = 'ar-src';
  video.replaceWith(r.domElement);

  const sc = new THREE.Scene();
  sc.background = new THREE.Color(0x5d6470);
  sc.add(new THREE.AmbientLight(0xffffff, 2.5));
  const f = W / 2 / Math.tan((cfg.fovDeg * Math.PI) / 360);
  const cam = new THREE.PerspectiveCamera((2 * Math.atan(H / 2 / f) * 180) / Math.PI, W / H, 0.01, 20);

  const dict = new window.AR.Dictionary(DICTIONARY);
  const textures = {};
  for (const a of ANTENNAS) textures[a.markerId] = await svgTexture(dict.generateSVG(a.markerId));

  const side = cfg.markerCm / 100;
  const card = new THREE.Group();
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(side * 1.7, side * 2.1), new THREE.MeshBasicMaterial({ color: 0xf4f4f0 }));
  paper.position.set(0, -side * 0.15, -0.001);
  const markMat = new THREE.MeshBasicMaterial({ map: textures[1] });
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(side * 1.25, side * 1.25), markMat);
  card.add(paper, mark);
  sc.add(card);

  source = {
    el: r.domElement,
    width: () => W,
    height: () => H,
    ready: () => true,
    tick(now) {
      const t = now / 1000;
      const id = ANTENNAS[Math.floor(t / 10) % ANTENNAS.length].markerId;
      markMat.map = textures[id];
      card.position.set(0.12 * Math.sin(t * 0.3), -0.05 + 0.04 * Math.sin(t * 0.23), -0.75 - 0.15 * Math.sin(t * 0.17));
      card.rotation.set(0.25 * Math.sin(t * 0.37), 0.6 * Math.sin(t * 0.5), 0.15 * Math.sin(t * 0.29), 'YXZ');
      card.updateMatrixWorld();
      r.render(sc, cam);
      window.__arTruth = { gt: card.matrixWorld.clone().elements, id };
    },
  };
}

function svgTexture(svg) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 500;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, 0, 500, 500);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      resolve(tex);
    };
    img.onerror = reject;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

// ---------------------------------------------------------------- Interfaz

function segmented(el, items, current, onPick) {
  el.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = it.label;
    b.setAttribute('aria-pressed', it.value === current);
    b.addEventListener('click', () => {
      for (const o of el.children) o.setAttribute('aria-pressed', o === b);
      onPick(it.value);
    });
    el.appendChild(b);
  }
}

function slider(id, outFmt, onChange) {
  const el = $(id), out = $(id + 'Out');
  const show = () => { out.textContent = outFmt(parseFloat(el.value)); };
  el.addEventListener('input', () => {
    show();
    onChange(parseFloat(el.value));
    saveSettings();
  });
  return { set(v) { el.value = v; show(); } };
}

const offsetSliders = {};
function renderOffsets() {
  const a = state.current;
  $('offsetTitle').textContent = a ? `Posición de la antena (${a.full})` : 'Posición de la antena';
  const o = a ? cfg.offsets[a.id] : { x: 0, y: 0, z: 0 };
  for (const k of ['x', 'y', 'z']) {
    offsetSliders[k].set(o[k]);
    $('off_' + k).disabled = !a;
  }
}

function setupUI() {
  segmented($('modeSeg'), [
    { value: 'patron', label: 'Patrón' },
    { value: 'onda', label: 'Onda' },
    { value: 'ambos', label: 'Ambos' },
  ], cfg.mode, (v) => {
    cfg.mode = v;
    applyVisibility();
    saveSettings();
  });
  segmented($('planeSeg'), [
    { value: 'E', label: 'Plano E' },
    { value: 'H', label: 'Plano H' },
  ], cfg.plane, (v) => {
    cfg.plane = v;
    view.setPlane(v);
    saveSettings();
  });

  slider('markerCm', (v) => `${fmt(v, 1)} cm`, (v) => { cfg.markerCm = v; }).set(cfg.markerCm);
  slider('patternCm', (v) => `${fmt(v)} cm`, (v) => { cfg.patternCm = v; applyHolder(); }).set(cfg.patternCm);
  slider('opacity', (v) => `${Math.round(v * 100)} %`, (v) => { cfg.opacity = v; applyVisibility(); }).set(cfg.opacity);
  slider('fovDeg', (v) => `${fmt(v)}°`, (v) => { cfg.fovDeg = v; }).set(cfg.fovDeg);
  for (const k of ['x', 'y', 'z']) {
    offsetSliders[k] = slider('off_' + k, (v) => `${fmt(v)} cm`, (v) => {
      if (!state.current) return;
      cfg.offsets[state.current.id][k] = v;
      applyHolder();
    });
  }
  renderOffsets();

  for (const [id, key] of [['chkShells', 'shells'], ['chkAnt', 'showAnt'], ['chkAxes', 'showAxes']]) {
    const el = $(id);
    el.checked = cfg[key];
    el.addEventListener('change', () => {
      cfg[key] = el.checked;
      applyVisibility();
      saveSettings();
    });
  }

  $('resetSettings').addEventListener('click', () => {
    try { localStorage.removeItem(STORE_KEY); } catch { /* nada que borrar */ }
    location.reload();
  });

  const sheet = $('sheet');
  $('settingsBtn').addEventListener('click', () => { sheet.hidden = !sheet.hidden; });
  $('closeSheet').addEventListener('click', () => { sheet.hidden = true; });

  $('playBtn').addEventListener('click', () => setPlaying(!state.playing));
  $('phase').addEventListener('input', (e) => {
    setPlaying(false);
    state.phase = (parseFloat(e.target.value) * Math.PI) / 180;
    syncPhaseUI();
  });
  setPlaying(true);

  const begin = async (fn) => {
    $('startError').textContent = '';
    try {
      await fn();
      detector = new window.AR.Detector({ dictionaryName: DICTIONARY, maxHammingDistance: 5 });
      $('start').hidden = true;
    } catch (err) {
      const msg = err && err.name === 'NotAllowedError'
        ? 'No se dio permiso para usar la cámara. Habilitalo en los ajustes del navegador y volvé a intentar.'
        : (err && err.message) || String(err);
      $('startError').textContent = msg;
    }
  };
  $('startCam').addEventListener('click', () => begin(startCamera));
  $('startDemo').addEventListener('click', () => begin(startDemo));
  if (!window.isSecureContext) {
    $('startError').textContent = 'Atención: esta página no es segura (HTTPS), así que el navegador no va a permitir la cámara. Usá la versión publicada en GitHub Pages o probá la demo.';
  }
  if (new URLSearchParams(location.search).has('demo')) begin(startDemo);
}

function setPlaying(p) {
  state.playing = p;
  $('playBtn').dataset.playing = p;
  $('playBtn').setAttribute('aria-label', p ? 'Pausar' : 'Reproducir');
}

function syncPhaseUI() {
  const deg = Math.round((state.phase * 180) / Math.PI) % 360;
  $('phase').value = deg;
  $('phaseLabel').textContent = `ωt = ${deg}°`;
}

// ---------------------------------------------------------------- Bucle

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (source && detector && source.ready()) {
    if (source.tick) source.tick(now);
    configureSize();
    detect(now);
  }
  if (state.playing) {
    state.phase = (state.phase + dt * state.speed * TAU) % TAU;
    syncPhaseUI();
  }
  view.setPhase(state.phase);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

setupUI();
applyVisibility();
requestAnimationFrame(frame);
