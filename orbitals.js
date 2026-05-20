// Hydrogen orbital volume renderer via WebGL ray-marching.
// Real spherical harmonics. Atomic units (a0 = 1).

const ORBITALS = [
  // id, n, l, mi (angular index), box (half-extent in Bohr), s (brightness scale)
  // s values tuned for pow(0.4) density compression + exp tone-map.
  { id: '1s',        n:1, l:0, mi:0, box: 6,  s: 6 },
  { id: '2s',        n:2, l:0, mi:0, box: 16, s: 4 },
  { id: '2p_z',      n:2, l:1, mi:0, box: 16, s: 5 },
  { id: '2p_x',      n:2, l:1, mi:1, box: 16, s: 5 },
  { id: '2p_y',      n:2, l:1, mi:2, box: 16, s: 5 },
  { id: '3s',        n:3, l:0, mi:0, box: 30, s: 5 },
  { id: '3p_z',      n:3, l:1, mi:0, box: 30, s: 4 },
  { id: '3p_x',      n:3, l:1, mi:1, box: 30, s: 4 },
  { id: '3p_y',      n:3, l:1, mi:2, box: 30, s: 4 },
  { id: '3d_z²',     n:3, l:2, mi:0, box: 30, s: 4 },
  { id: '3d_xz',     n:3, l:2, mi:1, box: 30, s: 4 },
  { id: '3d_yz',     n:3, l:2, mi:2, box: 30, s: 4 },
  { id: '3d_x²-y²',  n:3, l:2, mi:3, box: 30, s: 4 },
  { id: '3d_xy',     n:3, l:2, mi:4, box: 30, s: 4 },
  { id: '4s',        n:4, l:0, mi:0, box: 55, s: 8 },
  { id: '4p_z',      n:4, l:1, mi:0, box: 55, s: 5 },
  { id: '4p_x',      n:4, l:1, mi:1, box: 55, s: 5 },
  { id: '4p_y',      n:4, l:1, mi:2, box: 55, s: 5 },
  { id: '4d_z²',     n:4, l:2, mi:0, box: 55, s: 4 },
  { id: '4d_xz',     n:4, l:2, mi:1, box: 55, s: 4 },
  { id: '4d_yz',     n:4, l:2, mi:2, box: 55, s: 4 },
  { id: '4d_x²-y²',  n:4, l:2, mi:3, box: 55, s: 4 },
  { id: '4d_xy',     n:4, l:2, mi:4, box: 55, s: 4 },
  { id: '4f_z³',         n:4, l:3, mi:0, box: 55, s: 3 },
  { id: '4f_xz²',        n:4, l:3, mi:1, box: 55, s: 3 },
  { id: '4f_yz²',        n:4, l:3, mi:2, box: 55, s: 3 },
  { id: '4f_xyz',        n:4, l:3, mi:3, box: 55, s: 3 },
  { id: '4f_z(x²-y²)',   n:4, l:3, mi:4, box: 55, s: 3 },
  { id: '4f_x(x²-3y²)',  n:4, l:3, mi:5, box: 55, s: 3 },
  { id: '4f_y(3x²-y²)',  n:4, l:3, mi:6, box: 55, s: 3 },
];

const VERT_SRC = `
attribute vec2 aPos;
varying vec2 vNdc;
void main() {
  vNdc = aPos;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG_SRC = `
precision highp float;
varying vec2 vNdc;

uniform mat3 uRot;
uniform float uBoxHalf;
uniform float uBright;
uniform float uCamDist;
uniform float uAspect;
uniform int uN;
uniform int uL;
uniform int uMi;
uniform vec3 uBg;

// Radial part R_nl(r), unnormalized. r in Bohr.
float radial(float r) {
  if (uN == 1) {
    return exp(-r);
  } else if (uN == 2) {
    float e = exp(-r * 0.5);
    if (uL == 0) return (2.0 - r) * e;
    return r * e;
  } else if (uN == 3) {
    float e = exp(-r / 3.0);
    if (uL == 0) return (27.0 - 18.0*r + 2.0*r*r) * e;
    if (uL == 1) return r * (6.0 - r) * e;
    return r * r * e;
  } else {
    float e = exp(-r * 0.25);
    if (uL == 0) return (192.0 - 144.0*r + 24.0*r*r - r*r*r) * e;
    if (uL == 1) return r * (80.0 - 20.0*r + r*r) * e;
    if (uL == 2) return r*r * (12.0 - r) * e;
    return r*r*r * e;
  }
}

// Real angular part Y_lm in Cartesian / r^l (unnormalized).
float angular(vec3 p, float r) {
  float x = p.x, y = p.y, z = p.z;
  if (uL == 0) return 1.0;
  if (uL == 1) {
    if (uMi == 0) return z / r;
    if (uMi == 1) return x / r;
    return y / r;
  }
  float rr = r * r;
  if (uL == 2) {
    if (uMi == 0) return (3.0*z*z - rr) / rr;     // d_z^2
    if (uMi == 1) return (x*z) / rr;              // d_xz
    if (uMi == 2) return (y*z) / rr;              // d_yz
    if (uMi == 3) return (x*x - y*y) / rr;        // d_x^2-y^2
    return (x*y) / rr;                            // d_xy
  }
  float rrr = rr * r;
  // l = 3 (f orbitals, general set)
  if (uMi == 0) return z*(5.0*z*z - 3.0*rr) / rrr;        // f_z^3
  if (uMi == 1) return x*(5.0*z*z - rr) / rrr;            // f_xz^2
  if (uMi == 2) return y*(5.0*z*z - rr) / rrr;            // f_yz^2
  if (uMi == 3) return x*y*z / rrr;                       // f_xyz
  if (uMi == 4) return z*(x*x - y*y) / rrr;               // f_z(x^2-y^2)
  if (uMi == 5) return x*(x*x - 3.0*y*y) / rrr;           // f_x(x^2-3y^2)
  return y*(3.0*x*x - y*y) / rrr;                         // f_y(3x^2-y^2)
}

float psi(vec3 p) {
  float r = max(length(p), 1e-4);
  return radial(r) * angular(p, r);
}

// Ray-AABB intersection for box [-B, B]^3
bool intersectBox(vec3 ro, vec3 rd, float B, out float t0, out float t1) {
  vec3 invD = 1.0 / rd;
  vec3 tMin = (vec3(-B) - ro) * invD;
  vec3 tMax = (vec3( B) - ro) * invD;
  vec3 t1v = min(tMin, tMax);
  vec3 t2v = max(tMin, tMax);
  t0 = max(max(t1v.x, t1v.y), t1v.z);
  t1 = min(min(t2v.x, t2v.y), t2v.z);
  return t1 > max(t0, 0.0);
}

void main() {
  // Camera at (0,0,-D), looking at origin
  vec2 uv = vNdc;
  uv.x *= uAspect;
  float fov = 0.6; // half-angle tangent
  vec3 ro = vec3(0.0, 0.0, -uCamDist);
  vec3 rd = normalize(vec3(uv.x * fov, uv.y * fov, 1.0));

  float t0, t1;
  if (!intersectBox(ro, rd, uBoxHalf, t0, t1)) {
    gl_FragColor = vec4(uBg, 1.0);
    return;
  }
  t0 = max(t0, 0.0);

  const int STEPS = 96;
  float dt = (t1 - t0) / float(STEPS);

  float accPos = 0.0;
  float accNeg = 0.0;

  for (int i = 0; i < STEPS; i++) {
    float t = t0 + (float(i) + 0.5) * dt;
    vec3 pWorld = ro + rd * t;
    vec3 pAtom = uRot * pWorld;
    float v = psi(pAtom);
    float v2 = v * v;
    if (v >= 0.0) accPos += v2;
    else accNeg += v2;
  }

  float k = uBright * dt;
  vec3 cyan = vec3(0.2, 1.0, 1.0);
  vec3 red  = vec3(1.0, 0.15, 0.25);
  // Perceptual density compression — |psi|^2 spans many orders of magnitude
  // between the compact core and the outer lobes. A power curve squeezes that
  // huge range into something the display can show at once, revealing nodes
  // and angular structure that would otherwise blow out to pure white.
  vec3 emissive = cyan * pow(accPos, 0.4) * k + red * pow(accNeg, 0.4) * k;
  // Exponential saturation: preserves structure in bright cores, never clips.
  emissive = vec3(1.0) - exp(-emissive);
  // Screen-blend the glow over the background
  vec3 col = 1.0 - (1.0 - uBg) * (1.0 - emissive);
  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(sh), src);
    throw new Error('shader compile failed');
  }
  return sh;
}

function makeProgram(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(p));
    throw new Error('link failed');
  }
  return p;
}

// 3x3 rotation matrix helpers (column-major for WebGL mat3 uniform)
function rotMatrix(yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  // R = Rx(pitch) * Ry(yaw), applied to world points -> atom frame.
  // Stored column-major for WebGL uniformMatrix3fv.
  return new Float32Array([
    cy,    sy * sp,  sy * cp,   // column 0
    0,     cp,      -sp,        // column 1
    -sy,   cy * sp,  cy * cp,   // column 2
  ]);
}

function mountOrbital(canvas, opts) {
  opts = opts || {};
  const interactive = opts.interactive !== false;
  const gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: false });
  if (!gl) {
    canvas.replaceWith(Object.assign(document.createElement('div'),
      { textContent: 'WebGL not supported in this browser.', style: 'color:#fff;padding:2rem;' }));
    return;
  }

  const program = makeProgram(gl, VERT_SRC, FRAG_SRC);
  gl.useProgram(program);

  // Fullscreen quad
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,  1, -1,  -1, 1,
    -1,  1,  1, -1,   1, 1,
  ]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const u = {
    rot:     gl.getUniformLocation(program, 'uRot'),
    boxHalf: gl.getUniformLocation(program, 'uBoxHalf'),
    bright:  gl.getUniformLocation(program, 'uBright'),
    camDist: gl.getUniformLocation(program, 'uCamDist'),
    aspect:  gl.getUniformLocation(program, 'uAspect'),
    n:       gl.getUniformLocation(program, 'uN'),
    l:       gl.getUniformLocation(program, 'uL'),
    mi:      gl.getUniformLocation(program, 'uMi'),
    bg:      gl.getUniformLocation(program, 'uBg'),
  };

  // Default background = page cream (#f6eddc). Override via opts.bg = [r,g,b] in 0..1.
  const bg = opts.bg || [0xf6/255, 0xed/255, 0xdc/255];

  // Optional controls (only when interactive page is present)
  const sel = interactive ? document.getElementById('orbitalSelect') : null;
  const brightnessEl = interactive ? document.getElementById('brightness') : null;
  const zoomEl = interactive ? document.getElementById('zoom') : null;
  const spinEl = interactive ? document.getElementById('spinSpeed') : null;
  const autoEl = interactive ? document.getElementById('autoRotate') : null;
  const resetBtn = interactive ? document.getElementById('resetView') : null;

  if (sel) {
    ORBITALS.forEach((o, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = o.id;
      sel.appendChild(opt);
    });
    const def = opts.defaultOrbital || '2p_y';
    sel.value = String(ORBITALS.findIndex(o => o.id === def));
  }

  const fixedIdx = opts.orbital
    ? ORBITALS.findIndex(o => o.id === opts.orbital)
    : -1;
  const fixedBrightness = opts.brightness;
  const fixedZoom = opts.zoom != null ? opts.zoom : 1;
  const fixedSpin = opts.spin != null ? opts.spin : 0.3;
  const fixedAuto = opts.autoRotate !== false;

  let yaw = opts.yaw != null ? opts.yaw : 0.6;
  let pitch = opts.pitch != null ? opts.pitch : 0.4;
  let dragging = false, lastX = 0, lastY = 0;

  if (interactive || opts.draggable) {
    canvas.addEventListener('pointerdown', e => {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      yaw   += dx * 0.01;
      pitch += dy * 0.01;
      pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
    });
    canvas.addEventListener('pointerup',   () => { dragging = false; });
    canvas.addEventListener('pointercancel', () => { dragging = false; });
  }

  if (resetBtn) resetBtn.addEventListener('click', () => { yaw = 0.6; pitch = 0.4; });

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    const w = canvas.clientWidth | 0;
    const h = canvas.clientHeight | 0;
    const W = Math.max(1, (w * dpr) | 0);
    const H = Math.max(1, (h * dpr) | 0);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W; canvas.height = H;
      gl.viewport(0, 0, W, H);
    }
  }
  window.addEventListener('resize', resize);
  resize();

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    resize();

    const autoOn = autoEl ? autoEl.checked : fixedAuto;
    const spinV = spinEl ? parseFloat(spinEl.value) : fixedSpin;
    if (autoOn && !dragging) {
      yaw += dt * spinV;
    }

    const idx = sel ? parseInt(sel.value, 10) : fixedIdx;
    const orb = ORBITALS[idx];
    const zoom = zoomEl ? parseFloat(zoomEl.value) : fixedZoom;
    const bRaw = brightnessEl ? parseFloat(brightnessEl.value)
                              : (fixedBrightness != null ? fixedBrightness : 1.2);
    const bright = bRaw * orb.s;
    const camDist = orb.box * 2.4 / zoom;

    gl.useProgram(program);
    gl.uniformMatrix3fv(u.rot, false, rotMatrix(yaw, pitch));
    gl.uniform1f(u.boxHalf, orb.box);
    gl.uniform1f(u.bright,  bright);
    gl.uniform1f(u.camDist, camDist);
    gl.uniform1f(u.aspect,  canvas.width / canvas.height);
    gl.uniform1i(u.n,  orb.n);
    gl.uniform1i(u.l,  orb.l);
    gl.uniform1i(u.mi, orb.mi);
    gl.uniform3f(u.bg, bg[0], bg[1], bg[2]);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

window.mountOrbital = mountOrbital;

document.addEventListener('DOMContentLoaded', () => {
  const main = document.getElementById('orbitalCanvas');
  if (main) mountOrbital(main, { interactive: true, bg: [0, 0, 0] });
  document.querySelectorAll('canvas[data-orbital]').forEach(c => {
    let bg;
    if (c.dataset.bg) {
      const h = c.dataset.bg.replace('#', '');
      bg = [parseInt(h.slice(0,2),16)/255, parseInt(h.slice(2,4),16)/255, parseInt(h.slice(4,6),16)/255];
    }
    mountOrbital(c, {
      interactive: false,
      orbital: c.dataset.orbital,
      brightness: c.dataset.brightness ? parseFloat(c.dataset.brightness) : undefined,
      zoom: c.dataset.zoom ? parseFloat(c.dataset.zoom) : undefined,
      spin: c.dataset.spin ? parseFloat(c.dataset.spin) : undefined,
      autoRotate: c.dataset.autorotate !== 'false',
      draggable: c.dataset.draggable === 'true',
      bg,
    });
  });
});
