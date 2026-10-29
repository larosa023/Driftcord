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
