import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ANTENNAS } from './antennas.js';
import { RadiationView, addLights } from './radiation.js';
import { turboCss } from './colormap.js';
import { drawPolar } from './polar.js';

const TAU = Math.PI * 2;
const CAM_DIR = new THREE.Vector3(5.2, 3.6, 6.4).normalize();
const COLOR_E = '#ff8a5b';
const COLOR_H = '#5bc0ff';

// ---------------------------------------------------------------- Estado

const state = {
  antId: 'dipolo',
  params: Object.fromEntries(ANTENNAS.map((a) => [a.id, Object.fromEntries(a.params.map((p) => [p.key, p.value]))])),
  mode: 'ambos',
  plane: 'E',
  scale: 'db',
  range: 30,
  opacity: 0.45,
  speed: 0.5,
  playing: true,
  phase: 0,
  shells: false,
  atten: true,
  showAnt: true,
  showAxes: true,
  showMesh: true,
};

const ant = () => ANTENNAS.find((a) => a.id === state.antId);
const params = () => state.params[state.antId];

// ---------------------------------------------------------------- Escena

const viewer = document.getElementById('viewer');
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x0b1020);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);

// Distancia inicial de la cámara: más lejos en pantallas angostas (celular vertical).
function camHome() {
  const aspect = camera.aspect || 1;
  return CAM_DIR.clone().multiplyScalar(11 / Math.min(1, Math.pow(aspect, 0.85)));
}
camera.position.copy(camHome());
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.minDistance = 1.2;
controls.maxDistance = 30;

addLights(scene);
const view = new RadiationView();
scene.add(view.root);

// ---------------------------------------------------------------- Actualización

let metrics = null;

function updateAll() {
  metrics = view.update(ant(), params(), state);
  applyVisibility();
  renderLegend();
  renderMetrics();
  renderPolars();
}

function applyVisibility() {
  view.setVisibility(state);
}

// ---------------------------------------------------------------- UI

const $ = (id) => document.getElementById(id);
const fmt = (v, d = 1) => v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });

function segmented(el, items, current, onPick) {
  el.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = it.label;
    b.dataset.value = it.value;
    b.setAttribute('aria-pressed', it.value === current);
    b.addEventListener('click', () => {
      for (const o of el.children) o.setAttribute('aria-pressed', o === b);
      onPick(it.value);
    });
    el.appendChild(b);
  }
}

function renderAntennaUI() {
  const a = ant();
  $('antName').textContent = a.full;
  $('antDesc').textContent = a.desc;
  $('antTags').innerHTML = a.tags.map((t) => `<span class="tag">${t}</span>`).join('');
  $('antNotes').innerHTML = a.notes.map((n) => `<li>${n}</li>`).join('');

  const box = $('params');
  box.innerHTML = '';
  for (const pd of a.params) {
    const row = document.createElement('label');
    row.className = 'slider-row';
    const val = params()[pd.key];
    row.innerHTML = `
      <span class="slider-head"><span>${pd.label}</span><output>${fmtParam(val, pd)}</output></span>
      <input type="range" min="${pd.min}" max="${pd.max}" step="${pd.step}" value="${val}">`;
    const input = row.querySelector('input');
    const out = row.querySelector('output');
    input.addEventListener('input', () => {
      params()[pd.key] = parseFloat(input.value);
      out.textContent = fmtParam(params()[pd.key], pd);
      scheduleUpdate();
    });
    box.appendChild(row);
  }
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'link-btn';
  reset.textContent = 'Valores por defecto';
  reset.addEventListener('click', () => {
    for (const pd of a.params) params()[pd.key] = pd.value;
    renderAntennaUI();
    scheduleUpdate();
  });
  box.appendChild(reset);

  segmented($('planeSeg'), [
    { value: 'E', label: a.planes.E.name },
    { value: 'H', label: a.planes.H.name },
  ], state.plane, (v) => {
    state.plane = v;
    view.setPlane(v);
  });
}

function fmtParam(v, pd) {
  const d = pd.step >= 1 ? 0 : 2;
  return `${fmt(v, d)}${pd.unit ? ' ' + pd.unit : ''}`;
}

function renderLegend() {
  const top = metrics.Ddb;
  const stops = [];
  for (let k = 0; k <= 10; k++) stops.push(`${turboCss(1 - k / 10)} ${k * 10}%`);
  $('legendBar').style.background = `linear-gradient(to bottom, ${stops.join(', ')})`;
  const ticks = $('legendTicks');
  ticks.innerHTML = '';
  const n = Math.round(state.range / 10);
  for (let k = 0; k <= n; k++) {
    const db = -k * (state.range / n);
    const s = document.createElement('span');
    s.style.top = `${(k / n) * 100}%`;
    s.textContent = fmt(top + db, 1);
    ticks.appendChild(s);
  }
}

function renderMetrics() {
  const a = ant(), m = metrics;
  const hp = (c) => (c.hpbw === null ? 'Omnidireccional' : `${fmt(c.hpbw, 1)}°`);
  const sll = (c) => (c.sll === null ? '—' : `${fmt(c.sll, 1)} dB`);
  const fb = !a.directional ? '0 dB (simétrica)' : m.fb === Infinity || m.fb > 40 ? '> 40 dB' : `${fmt(m.fb, 1)} dB`;
  const rows = [
    ['Directividad', `${fmt(m.Ddb, 2)} dBi`, `${fmt(m.D, 2)} veces un radiador isotrópico`],
    [`HPBW ${a.planes.E.name}`, hp(m.E), 'Ancho del haz entre puntos de −3 dB'],
    [`HPBW ${a.planes.H.name}`, hp(m.H), ''],
    ['Relación frente/espalda', fb, ''],
  ];
  if (a.directional) {
    rows.push([`Lóbulo secundario (E)`, sll(m.E), 'Relativo al máximo']);
    rows.push([`Lóbulo secundario (H)`, sll(m.H), '']);
  }
  $('metrics').innerHTML = rows
    .map(([k, v, h]) => `<div class="metric"><dt>${k}</dt><dd>${v}</dd>${h ? `<small>${h}</small>` : ''}</div>`)
    .join('');
}

function renderPolars() {
  if (!metrics) return;
  const a = ant();
  const floor = -Math.max(20, Math.round(state.range / 10) * 10);
  drawPolar($('polarE'), metrics.E, metrics.alphaE, {
    floor, color: COLOR_E, uLabel: a.planes.E.uLabel, vLabel: a.planes.E.vLabel,
  });
  drawPolar($('polarH'), metrics.H, metrics.alphaH, {
    floor, color: COLOR_H, uLabel: a.planes.H.uLabel, vLabel: a.planes.H.vLabel,
  });
  $('capE').textContent = a.planes.E.name;
  $('capH').textContent = a.planes.H.name;
}

let pending = false;
function scheduleUpdate() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    updateAll();
  });
}

function syncPhaseUI() {
  const deg = Math.round((state.phase * 180) / Math.PI) % 360;
  $('phase').value = deg;
  $('phaseLabel').textContent = `ωt = ${deg}°`;
}

function setPlaying(p) {
  state.playing = p;
  const b = $('playBtn');
  b.setAttribute('aria-label', p ? 'Pausar' : 'Reproducir');
  b.dataset.playing = p;
}

function setupUI() {
  segmented($('antennaTabs'), ANTENNAS.map((a) => ({ value: a.id, label: a.name })), state.antId, (v) => {
    state.antId = v;
    renderAntennaUI();
    scheduleUpdate();
  });

  const modeItems = [
    { value: 'patron', label: 'Patrón' },
    { value: 'onda', label: 'Onda' },
    { value: 'ambos', label: 'Ambos' },
  ];
  segmented($('modeSeg'), modeItems, state.mode, (v) => {
    state.mode = v;
    if (v === 'ambos' && state.opacity > 0.6) setOpacity(0.45);
    if (v === 'patron') setOpacity(1);
    applyVisibility();
  });

  segmented($('scaleSeg'), [
    { value: 'db', label: 'dB' },
    { value: 'lin', label: 'Lineal' },
  ], state.scale, (v) => {
    state.scale = v;
    scheduleUpdate();
  });

  bindRange('range', (v) => {
    state.range = v;
    $('rangeOut').textContent = `${v} dB`;
    scheduleUpdate();
  });
  bindRange('opacity', (v) => {
    state.opacity = v;
    $('opacityOut').textContent = `${Math.round(v * 100)} %`;
    applyVisibility();
  });
  bindRange('speed', (v) => {
    state.speed = v;
    $('speedOut').textContent = `${fmt(v, 2)} ciclos/s`;
  });

  for (const [id, keyName] of [
    ['chkShells', 'shells'],
    ['chkAtten', 'atten'],
    ['chkAnt', 'showAnt'],
    ['chkAxes', 'showAxes'],
    ['chkMesh', 'showMesh'],
  ]) {
    const el = $(id);
    el.checked = state[keyName];
    el.addEventListener('change', () => {
      state[keyName] = el.checked;
      applyVisibility();
    });
  }

  $('playBtn').addEventListener('click', () => setPlaying(!state.playing));
  $('phase').addEventListener('input', (e) => {
    setPlaying(false);
    state.phase = (parseFloat(e.target.value) * Math.PI) / 180;
    syncPhaseUI();
  });

  $('resetView').addEventListener('click', () => {
    camera.position.copy(camHome());
    controls.target.set(0, 0, 0);
    controls.update();
  });

  const hideHint = () => $('hint').classList.add('hidden');
  canvas.addEventListener('pointerdown', hideHint, { once: true });
  setTimeout(hideHint, 6000);

  setPlaying(state.playing);
  renderAntennaUI();
}

function setOpacity(v) {
  state.opacity = v;
  $('opacity').value = v;
  $('opacityOut').textContent = `${Math.round(v * 100)} %`;
}

function bindRange(id, fn) {
  const el = $(id);
  el.addEventListener('input', () => fn(parseFloat(el.value)));
  fn(parseFloat(el.value));
}

// ---------------------------------------------------------------- Bucle

let firstResize = true;
function resize() {
  const w = viewer.clientWidth, h = viewer.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (firstResize) {
    firstResize = false;
    camera.position.copy(camHome());
  }
}
new ResizeObserver(resize).observe(viewer);
new ResizeObserver(() => renderPolars()).observe($('polarE'));

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state.playing) {
    state.phase = (state.phase + dt * state.speed * TAU) % TAU;
    syncPhaseUI();
  }
  view.setPhase(state.phase);
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

setupUI();
updateAll();
resize();
requestAnimationFrame(frame);
