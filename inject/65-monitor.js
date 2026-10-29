// ── Memory monitor ───────────────────────────────────────────────────────────
// Samples the page's JavaScript heap and DOM size every 15 s and keeps the last
// 30 minutes. Shown in About → Memory, and available in the dev console as
// `driftcordMemory()`. It tells apart "code is holding on to memory" (heap
// climbs) from "Discord is caching images/media" (heap flat, total climbs).

const MON_INTERVAL = 15000;
const MON_KEEP = 120; // 30 minutes
const monSamples = [];

function sampleMemory() {
  const m = performance.memory;
  monSamples.push({
    t: Date.now(),
    heap: m ? m.usedJSHeapSize : 0,
    heapTotal: m ? m.totalJSHeapSize : 0,
    nodes: document.getElementsByTagName('*').length,
  });
  if (monSamples.length > MON_KEEP) monSamples.shift();
}

function startMonitor() {
  sampleMemory();
  setInterval(sampleMemory, MON_INTERVAL);
}

const mb = (b) => (b / 1048576).toFixed(0) + ' MB';

/** Change per minute over (up to) the last 10 minutes. */
function memoryTrend(key) {
  const now = monSamples[monSamples.length - 1];
  if (!now) return 0;
  const from = monSamples.find((s) => now.t - s.t <= 10 * 60000) || now;
  const mins = (now.t - from.t) / 60000;
  return mins >= 1 ? (now[key] - from[key]) / mins : 0;
}

window.driftcordMemory = () => {
  const s = monSamples[monSamples.length - 1] || {};
  return {
    jsHeap: mb(s.heap || 0), jsHeapReserved: mb(s.heapTotal || 0), domNodes: s.nodes,
    jsHeapPerMinute: mb(memoryTrend('heap')).replace(' MB', '') + ' MB/min',
    samples: monSamples.length,
  };
};

function sparkline(key, w = 300, h = 36) {
  const pts = monSamples.map((s) => s[key]);
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', String(h));
  if (pts.length < 2) return svg;
  const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
  const line = document.createElementNS(svgNS, 'polyline');
  line.setAttribute('points', pts.map((v, i) =>
    `${(i / (MON_KEEP - 1)) * w},${h - 3 - ((v - lo) / span) * (h - 6)}`).join(' '));
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'var(--d-accent)');
  line.setAttribute('stroke-width', '2');
  line.setAttribute('stroke-linejoin', 'round');
  svg.append(line);
  return svg;
}

/** The About → Memory card. Re-renders itself while visible. */
function memoryCard() {
  const box = h('div', {});
  const draw = () => {
    const s = monSamples[monSamples.length - 1];
    if (!s) { box.replaceChildren(h('p', { class: 'hint' }, 'Collecting…')); return; }
    const trend = memoryTrend('heap');
    const nodesTrend = memoryTrend('nodes');
    const mins = Math.round((s.t - monSamples[0].t) / 60000);
    const verdict = mins < 3 ? 'Collecting a few minutes of data…'
      : trend > 1.5 * 1048576 ? 'JavaScript memory is climbing steadily. If it keeps going while idle, something is holding on to memory.'
      : 'JavaScript memory is steady.';
    box.replaceChildren(
      h('div', { class: 'row' }, h('span', { class: 'label' }, 'JavaScript memory',
        h('span', { class: 'desc' }, `${trend >= 0 ? '+' : ''}${(trend / 1048576).toFixed(1)} MB/min over the last ${Math.min(mins, 10)} min`)),
        h('b', {}, s.heap ? mb(s.heap) : 'n/a')),
      sparkline('heap'),
      h('div', { class: 'row' }, h('span', { class: 'label' }, 'Page size',
        h('span', { class: 'desc' }, `${nodesTrend >= 0 ? '+' : ''}${Math.round(nodesTrend)} elements/min`)),
        h('b', {}, s.nodes.toLocaleString() + ' elements')),
      h('p', { class: 'hint' }, verdict + ' Task Manager also counts images, video and graphics memory, which aren\'t shown here.'),
    );
  };
  draw();
  const timer = setInterval(() => { if (!box.isConnected) clearInterval(timer); else draw(); }, MON_INTERVAL);
  return box;
}


// ── Frame rate ───────────────────────────────────────────────────────────────
// Counts animation frames for a moment. Only runs when asked (About tab or
// `driftcordFps()` in the console), so it costs nothing otherwise.

function measureFps(ms = 1500) {
  return new Promise((resolve) => {
    let frames = 0, first = 0, last = 0;
    const step = (t) => {
      if (!first) first = t;
      last = t; frames++;
      if (t - first < ms) rawRAF(step);
      else resolve(frames > 1 ? Math.round(((frames - 1) * 1000) / (last - first)) : 0);
    };
    rawRAF(step);
  });
}
window.driftcordFps = () => measureFps().then((fps) => fps + ' fps');

/** About → Smoothness row: measures when shown and on demand. */
function fpsCard() {
  const value = h('b', {}, '…');
  const desc = h('span', { class: 'desc' }, 'Measuring…');
  const run = async () => {
    value.textContent = '…'; desc.textContent = 'Measuring…';
    const fps = await measureFps();
    value.textContent = fps + ' fps';
    desc.textContent = fps >= 55 ? 'Running at your screen\'s refresh rate.'
      : fps >= 28 && fps <= 32 ? 'Running at about half speed. See Graphics and Power below for the likely reason.'
      : 'Below your screen\'s refresh rate right now (Discord may be busy).';
    if (store.get('perf.fps') === 30) desc.textContent = 'Your screen runs at ' + fps + ' fps; Discord\'s animations are limited to 30 (Frame rate setting).';
  };
  setTimeout(run, 300); // let the panel finish opening first
  return h('div', { class: 'row' }, h('span', { class: 'label' }, 'Smoothness', desc), value,
    h('button', { class: 'btn', onclick: run }, 'Measure'));
}

// ── Graphics info ────────────────────────────────────────────────────────────
// Which GPU Chromium is drawing with (or whether it fell back to software),
// and whether the PC is on battery. Only gathered when About is opened.

function graphicsInfo() {
  let renderer = 'Unknown', software = false;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl', { failIfMajorPerformanceCaveat: false });
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = (ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || renderer;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    } else {
      renderer = 'No GPU access'; software = true;
    }
  } catch (_) { /* leave as unknown */ }
  // "ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 …)" → "NVIDIA GeForce RTX 3070"
  const m = /ANGLE \([^,]*,\s*([^,(]+?)(?:\s+Direct3D|\s*\(|,|\))/.exec(renderer);
  const name = (m ? m[1] : renderer).trim();
  if (/swiftshader|basic render|llvmpipe|software/i.test(renderer)) software = true;
  return { name, software, raw: renderer };
}

function graphicsCard() {
  const box = h('div', {});
  const g = graphicsInfo();
  const power = h('b', {}, '…');
  box.append(
    h('div', { class: 'row' }, h('span', { class: 'label' }, 'Graphics',
      h('span', { class: 'desc' }, g.software
        ? 'Software rendering: Chromium isn\'t using your GPU, which caps smoothness. Update your graphics driver.'
        : 'Hardware accelerated')), h('b', { title: g.raw }, g.name)),
    h('div', { class: 'row' }, h('span', { class: 'label' }, 'Power',
      h('span', { class: 'desc' }, 'Windows may lower frame rates on battery or with Energy Saver on')), power),
  );
  // Software rendering is what Boosted graphics fixes: offer it right here.
  if (g.software && bridge.available()) {
    bridge.invoke('get_info').then((info) => {
      if (info.gpuBoost) return;
      const btn = h('button', { class: 'btn primary', onclick: () => bridge.invoke('set_memory', { gpuBoost: true })
        .then(() => bridge.invoke('restart_app')).catch(() => {}) }, 'Turn on & restart');
      box.append(h('div', { class: 'notice' }, h('span', { class: 'grow' }, 'Boosted graphics can usually get your GPU working here.'), btn));
    }).catch(() => {});
  }
  if (navigator.getBattery) {
    navigator.getBattery().then((b) => {
      power.textContent = b.charging || b.level === 1 && b.chargingTime === 0 ? 'Plugged in' : `On battery (${Math.round(b.level * 100)}%)`;
    }).catch(() => { power.textContent = 'Unknown'; });
  } else power.textContent = 'Unknown';
  return box;
}

// ── Frame rate setting ───────────────────────────────────────────────────────
// "60 fps" (default) leaves Chromium at the screen's refresh rate. "30 fps"
// is for very old PCs: page animations driven by requestAnimationFrame run
// on every other frame, roughly halving the page's drawing work.

const rawRAF = window.requestAnimationFrame.bind(window);
const rawCancelRAF = window.cancelAnimationFrame.bind(window);
const halfRate = { callbacks: new Map(), nextId: 1e9, scheduled: false, odd: false };

function halfRateTick(t) {
  halfRate.odd = !halfRate.odd;
  if (halfRate.odd) { rawRAF(halfRateTick); return; } // skip this frame
  halfRate.scheduled = false;
  const due = halfRate.callbacks;
  halfRate.callbacks = new Map();
  for (const cb of due.values()) {
    try { cb(t); } catch (e) { setTimeout(() => { throw e; }); }
  }
}

window.requestAnimationFrame = function (cb) {
  if (store.get('perf.fps') !== 30) return rawRAF(cb);
  const id = halfRate.nextId++;
  halfRate.callbacks.set(id, cb);
  if (!halfRate.scheduled) { halfRate.scheduled = true; rawRAF(halfRateTick); }
  return id;
};
window.cancelAnimationFrame = function (id) {
  if (id >= 1e9) halfRate.callbacks.delete(id);
  else rawCancelRAF(id);
};
