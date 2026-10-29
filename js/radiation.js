// Escena del patrón de radiación reutilizable (visor 3D y modo cámara AR):
// patrón 3D, onda animada en un plano, frentes de onda, modelo de la antena y ejes.
import * as THREE from 'three';
import { LAMBDA_SCENE } from './antennas.js';
import { buildModel } from './models.js';
import { sampleGrid, directivity, cutPattern, analyzeCut, frontToBack } from './pattern.js';
import { turbo, srgbToLinear } from './colormap.js';

export const NT = 121;          // filas en θ (paso 1,5°)
export const NP = 240;          // columnas en φ (paso 1,5°)
export const PATTERN_R = 2.2;   // radio del patrón en la escena (arbitrario)
export const WAVE_R = 6.5;      // radio de la región donde se dibuja la onda
const TAU = Math.PI * 2;

export function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xe6ecff, 0x1a2035, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(5, 8, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fb4ff, 0.8);
  rim.position.set(-6, -2, -5);
  scene.add(rim);
}

function makeLabel(text, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.font = 'bold 84px system-ui, sans-serif';
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(0.32, 0.32, 1);
  s.renderOrder = 10;
  return s;
}

const PAT_GLSL = /* glsl */ `
  uniform sampler2D uPat;
  const float M_PI_ = 3.14159265359;
  float pat(vec3 d) {
    d = normalize(d);
    float th = acos(clamp(d.z, -1.0, 1.0));
    float ph = atan(d.y, d.x);
    if (ph < 0.0) ph += 2.0 * M_PI_;
    vec2 uv = vec2(ph / (2.0 * M_PI_) + 0.5 / ${NP}.0,
                   th / M_PI_ * (${NT}.0 - 1.0) / ${NT}.0 + 0.5 / ${NT}.0);
    return texture2D(uPat, uv).r;
  }
`;

export class RadiationView {
  constructor() {
    // Grupo en coordenadas físicas: z arriba (Three.js usa y arriba).
    this.root = new THREE.Group();
    this.root.rotation.x = -Math.PI / 2;
    this.ant = null;
    this.plane = 'E';
    this.model = null;
    this.buildRefs();
    this.buildPattern();
    this.buildWave();
    this.buildShells();
  }

  // --- Referencias: ejes y grilla del plano xy
  buildRefs() {
    this.refs = new THREE.Group();
    this.root.add(this.refs);
    const grid = new THREE.PolarGridHelper(WAVE_R, 12, Math.round(WAVE_R / LAMBDA_SCENE), 96, 0x33406a, 0x222b47);
    grid.rotation.x = Math.PI / 2;
    grid.material.transparent = true;
    grid.material.opacity = 0.45;
    grid.material.depthWrite = false;
    this.grid = grid;
    this.refs.add(grid);
    for (const [dir, color, label] of [
      [[1, 0, 0], '#ff5d73', 'x'],
      [[0, 1, 0], '#7ee081', 'y'],
      [[0, 0, 1], '#5bc0ff', 'z'],
    ]) {
      const v = new THREE.Vector3(...dir);
      const len = PATTERN_R + 0.9;
      this.refs.add(new THREE.ArrowHelper(v, new THREE.Vector3(), len, new THREE.Color(color), 0.16, 0.08));
      const l = makeLabel(label, color);
      l.position.copy(v.clone().multiplyScalar(len + 0.22));
      this.refs.add(l);
    }
  }

  // --- Patrón 3D: grilla θ×φ con radio y color según |F|
  buildPattern() {
    const nV = NT * (NP + 1);
    const dirs = new Float32Array(nV * 3);
    for (let i = 0; i < NT; i++) {
      const th = (i * Math.PI) / (NT - 1);
      for (let j = 0; j <= NP; j++) {
        const ph = (j * TAU) / NP;
        const o = (i * (NP + 1) + j) * 3;
        dirs[o] = Math.sin(th) * Math.cos(ph);
        dirs[o + 1] = Math.sin(th) * Math.sin(ph);
        dirs[o + 2] = Math.cos(th);
      }
    }
    this.dirs = dirs;
    const vid = (i, j) => i * (NP + 1) + j;
    const triIdx = [];
    for (let i = 0; i < NT - 1; i++) {
      for (let j = 0; j < NP; j++) {
        const a = vid(i, j), b = vid(i, j + 1), c = vid(i + 1, j), d = vid(i + 1, j + 1);
        triIdx.push(a, c, b, b, c, d);
      }
    }
    const lineIdx = [];
    for (let j = 0; j < NP; j += 10) for (let i = 0; i < NT - 1; i++) lineIdx.push(vid(i, j), vid(i + 1, j));
    for (let i = 10; i < NT - 1; i += 10) for (let j = 0; j < NP; j++) lineIdx.push(vid(i, j), vid(i, j + 1));

    this.posAttr = new THREE.BufferAttribute(new Float32Array(nV * 3), 3);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(nV * 3), 3);
    this.patGeom = new THREE.BufferGeometry();
    this.patGeom.setAttribute('position', this.posAttr);
    this.patGeom.setAttribute('color', this.colAttr);
    this.patGeom.setIndex(triIdx);
    this.patMat = new THREE.MeshPhongMaterial({ vertexColors: true, side: THREE.DoubleSide, shininess: 35, specular: 0x333333 });
    this.patMesh = new THREE.Mesh(this.patGeom, this.patMat);
    this.patMesh.renderOrder = 3;
    this.root.add(this.patMesh);

    const meshGeom = new THREE.BufferGeometry();
    meshGeom.setAttribute('position', this.posAttr);
    meshGeom.setIndex(lineIdx);
    this.meshMat = new THREE.LineBasicMaterial({ color: 0x0b1020, transparent: true, opacity: 0.35 });
    this.meshLines = new THREE.LineSegments(meshGeom, this.meshMat);
    this.meshLines.renderOrder = 4;
    this.root.add(this.meshLines);

    // Textura con |F| normalizado, para los shaders de la onda.
    this.texData = new Uint8Array(NP * NT * 4);
    this.patTex = new THREE.DataTexture(this.texData, NP, NT, THREE.RGBAFormat);
    this.patTex.wrapS = THREE.RepeatWrapping;
    this.patTex.wrapT = THREE.ClampToEdgeWrapping;
    this.patTex.magFilter = THREE.LinearFilter;
    this.patTex.minFilter = THREE.LinearFilter;
  }

  // --- Onda en un plano: Re{E} ∝ F(θ,φ)·cos(kr − ωt)·(1/r)
  buildWave() {
    this.waveMat = new THREE.ShaderMaterial({
      uniforms: {
        uPat: { value: this.patTex },
        uPhase: { value: 0 },
        uLambda: { value: LAMBDA_SCENE },
        uR0: { value: LAMBDA_SCENE },
        uAtten: { value: 1 },
        uRmax: { value: WAVE_R },
        uOpacity: { value: 0.95 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vP;
        void main() {
          vP = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${PAT_GLSL}
        varying vec3 vP;
        uniform float uPhase, uLambda, uR0, uAtten, uRmax, uOpacity;
        void main() {
          float r = length(vP);
          float a = pat(vP + vec3(1e-5));
          float w = cos(2.0 * M_PI_ / uLambda * r - uPhase);
          float amp = a;
          if (uAtten > 0.5) amp *= min(1.0, uR0 / max(r, 1e-4));
          float s = w * amp;
          float m = pow(abs(s), 0.6);
          vec3 col = s >= 0.0 ? vec3(1.0, 0.45, 0.2) : vec3(0.25, 0.55, 1.0);
          float edge = 1.0 - smoothstep(uRmax * 0.8, uRmax, r);
          float alpha = (0.05 + 0.95 * clamp(m * 1.15, 0.0, 1.0)) * edge * uOpacity;
          gl_FragColor = vec4(col * (0.35 + 0.65 * m), alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.waveMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.waveMat);
    this.waveMesh.renderOrder = 1;
    this.root.add(this.waveMesh);
  }

  // --- Frentes de onda 3D: esferas en cada cresta, con opacidad ∝ |F|
  buildShells() {
    const shellGeom = new THREE.SphereGeometry(1, 96, 48);
    this.shells = [];
    const nShells = Math.ceil(WAVE_R / LAMBDA_SCENE) + 1;
    for (let i = 0; i < nShells; i++) {
      const m = new THREE.ShaderMaterial({
        uniforms: {
          uPat: { value: this.patTex },
          uRadius: { value: 1 },
          uLambda: { value: LAMBDA_SCENE },
          uR0: { value: LAMBDA_SCENE },
          uAtten: { value: 1 },
          uRmax: { value: WAVE_R },
        },
        vertexShader: /* glsl */ `
          varying vec3 vD;
          void main() {
            vD = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          ${PAT_GLSL}
          varying vec3 vD;
          uniform float uRadius, uLambda, uR0, uAtten, uRmax;
          void main() {
            float a = pat(vD);
            float amp = a;
            if (uAtten > 0.5) amp *= min(1.0, uR0 / max(uRadius, 1e-4));
            float fade = (1.0 - smoothstep(uRmax * 0.7, uRmax, uRadius)) * smoothstep(0.0, uLambda * 0.6, uRadius);
            vec3 col = mix(vec3(0.3, 0.5, 1.0), vec3(1.0, 0.6, 0.3), a);
            gl_FragColor = vec4(col, pow(amp, 0.7) * fade * 0.5);
          }
        `,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const s = new THREE.Mesh(shellGeom, m);
      s.renderOrder = 2;
      this.root.add(s);
      this.shells.push(s);
    }
  }

  // Recalcula patrón, textura, modelo y métricas. Devuelve las métricas.
  update(ant, p, { scale = 'db', range = 30 } = {}) {
    this.ant = ant;
    const grid = sampleGrid(ant, p, NT, NP);
    const dir = directivity(ant, p);
    const cutE = cutPattern(ant, p, ant.planes.E);
    const cutH = cutPattern(ant, p, ant.planes.H);
    let Fmax = Math.max(grid.max, dir.Fmax);
    for (const c of [cutE, cutH]) for (const f of c.F) Fmax = Math.max(Fmax, f);

    const metrics = {
      D: dir.D,
      Ddb: 10 * Math.log10(dir.D),
      Fmax,
      E: analyzeCut(cutE, Fmax),
      H: analyzeCut(cutH, Fmax),
      alphaE: cutE.alpha,
      alphaH: cutH.alpha,
      fb: frontToBack(ant, p),
    };

    const pos = this.posAttr.array, col = this.colAttr.array, dirs = this.dirs;
    for (let i = 0; i < NT; i++) {
      for (let j = 0; j <= NP; j++) {
        const v = i * (NP + 1) + j;
        const f = grid.F[i * NP + (j % NP)] / Fmax;
        const db = 20 * Math.log10(Math.max(f, 1e-6));
        const t = Math.min(1, Math.max(0, (db + range) / range));
        const r = PATTERN_R * (scale === 'db' ? t : f);
        pos[v * 3] = dirs[v * 3] * r;
        pos[v * 3 + 1] = dirs[v * 3 + 1] * r;
        pos[v * 3 + 2] = dirs[v * 3 + 2] * r;
        const [cr, cg, cb] = turbo(t);
        col[v * 3] = srgbToLinear(cr);
        col[v * 3 + 1] = srgbToLinear(cg);
        col[v * 3 + 2] = srgbToLinear(cb);
      }
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.patGeom.computeVertexNormals();
    this.patGeom.computeBoundingSphere();

    const tex = this.texData;
    for (let i = 0; i < NT; i++) {
      for (let j = 0; j < NP; j++) {
        const v = Math.round((255 * grid.F[i * NP + j]) / Fmax);
        const o = (i * NP + j) * 4;
        tex[o] = tex[o + 1] = tex[o + 2] = v;
        tex[o + 3] = 255;
      }
    }
    this.patTex.needsUpdate = true;

    const visible = this.model ? this.model.visible : true;
    if (this.model) this.root.remove(this.model);
    this.model = buildModel(ant.id, p);
    this.model.visible = visible;
    this.root.add(this.model);

    this.setPlane(this.plane);
    return metrics;
  }

  // Orienta el disco de la onda en el plano E o H de la antena actual.
  setPlane(key) {
    this.plane = key;
    if (!this.ant) return;
    const u = new THREE.Vector3(...this.ant.boresight);
    const v = new THREE.Vector3(...this.ant.planes[key].v);
    const n = new THREE.Vector3().crossVectors(u, v);
    const geo = new THREE.CircleGeometry(WAVE_R, 160);
    geo.applyMatrix4(new THREE.Matrix4().makeBasis(u, v, n));
    this.waveMesh.geometry.dispose();
    this.waveMesh.geometry = geo;
  }

  // mode: 'patron' | 'onda' | 'ambos'
  setVisibility({ mode, opacity, shells, atten, showAnt, showAxes, showMesh, showGrid = true }) {
    const showPattern = mode !== 'onda';
    const showWave = mode !== 'patron';
    this.patMesh.visible = showPattern;
    this.meshLines.visible = showPattern && showMesh;
    const op = mode === 'patron' ? Math.max(opacity, 0.999) : opacity;
    const transparent = op < 0.99;
    this.patMat.transparent = transparent;
    this.patMat.opacity = op;
    this.patMat.depthWrite = !transparent;
    this.patMat.needsUpdate = true;
    this.meshMat.opacity = 0.35 * op;
    this.waveMesh.visible = showWave;
    for (const s of this.shells) s.visible = showWave && shells;
    if (this.model) this.model.visible = showAnt;
    this.refs.visible = showAxes;
    this.grid.visible = showGrid;
    this.waveMat.uniforms.uAtten.value = atten ? 1 : 0;
    for (const s of this.shells) s.material.uniforms.uAtten.value = atten ? 1 : 0;
  }

  setPhase(phase) {
    this.waveMat.uniforms.uPhase.value = phase;
    const frac = phase / TAU;
    this.shells.forEach((s, i) => {
      const r = Math.max(1e-3, (i + frac) * LAMBDA_SCENE);
      s.scale.setScalar(r);
      s.material.uniforms.uRadius.value = r;
    });
  }
}
