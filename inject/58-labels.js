// ── Honest quality badge ─────────────────────────────────────────────────────
// Discord's "720p 30FPS" pill (and the Go Live card's "1440p 1FPS") come from
// stream info it keeps, which can say less than the stream really is. Here the
// text is rewritten from what is actually measured:
//   · watching a stream: the decoded height and frame rate of the <video>
//   · sharing: what the encoder is really sending (WebRTC stats)
// The frame rate shown is the best over the last ~12 s, so a still screen
// doesn't make the badge read "1FPS".

const labels = (() => {
  const PILL = /^\s*(\d{3,4})p\s*(\d{1,3})\s*fps\s*$/i;
  const SPLIT_A = /^\s*\d{3,4}p\s*$/i, SPLIT_B = /^\s*\d{1,3}\s*fps\s*$/i;
  const WINDOW_MS = 12000;
  const vids = new WeakMap();   // video → { t, frames, samples: [{t, v}] }
  const ENC = { samples: [] };
  let timer = 0;
  const stats = { when: 0, videos: 0, pills: 0, fixed: 0, note: 'not run yet', sample: '' };

  function peak(samples, now) {
    while (samples.length && now - samples[0].t > WINDOW_MS) samples.shift();
    let m = 0;
    for (const s of samples) if (s.v > m) m = s.v;
    return m;
  }

  function measure(v) {
    const q = v.getVideoPlaybackQuality && v.getVideoPlaybackQuality();
    if (!q || !v.videoWidth) return null;
    const now = performance.now();
    let s = vids.get(v);
    if (!s) { vids.set(v, { t: now, frames: q.totalVideoFrames, samples: [] }); return null; }
    const dt = now - s.t;
    if (dt >= 900) {
      s.samples.push({ t: now, v: ((q.totalVideoFrames - s.frames) * 1000) / dt });
      s.t = now; s.frames = q.totalVideoFrames;
    }
    const fps = peak(s.samples, now);
    return fps ? { h: v.videoHeight, fps } : null;
  }

  function encoderTruth() {
    refreshEncoderStats();                       // async; the answer lands on a later scan
    if (!encStats) return null;
    const now = performance.now();
    ENC.samples.push({ t: now, v: encStats.fps });
    const fps = peak(ENC.samples, now);
    return fps ? { h: encStats.h, fps } : null;
  }

  const niceFps = (f) => {
    for (const n of [15, 24, 30, 48, 50, 60, 90, 120, 144]) if (Math.abs(f - n) <= n * 0.1) return n;
    return Math.round(f);
  };

  // The video this pill belongs to: the closest ancestor that holds one.
  function videoFor(el) {
    for (let n = el.parentElement, d = 0; n && d < 10; n = n.parentElement, d++) {
      const vs = n.querySelectorAll('video');
      if (!vs.length) continue;
      // Two videos in reach means we can't tell which one the pill is for.
      return vs.length === 1 && vs[0].videoWidth ? vs[0] : null;
    }
    return null;
  }

  // The stream being watched: the biggest video on screen, as long as it is
  // clearly bigger than any other (so a grid of equal tiles stays untouched).
  function mainVideo() {
    const area = (v) => { const r = v.getBoundingClientRect(); return Math.max(0, r.width) * Math.max(0, r.height); };
    const big = [...document.querySelectorAll('video')].filter((v) => v.videoWidth >= 320)
      .map((v) => ({ v, a: area(v) })).sort((x, y) => y.a - x.a);
    if (!big.length) return null;
    if (big.length === 1) return big[0].v;
    return big[0].a > 0 && big[0].a >= big[1].a * 1.5 ? big[0].v : null;
  }

  function loneVideoAny() { for (const v of document.getElementsByTagName('video')) if (v.videoWidth) return true; return false; }

  function liveShare() { try { return !!discordQuality.debug().live; } catch (_) { return false; } }

  function truthFor(el) {
    const near = videoFor(el);
    if (near) return measure(near);
    if (liveShare()) return encoderTruth();      // e.g. the Go Live card
    const only = mainVideo();                    // e.g. the badge in the stream view's top bar
    return only ? measure(only) : null;
  }

  /** 0 = not a pill, 1 = the text is directly in the element (icons allowed), 2 = two text spans. */
  function pillMode(el) {
    const t = el.textContent;
    if (t.length < 6 || t.length > 16 || !PILL.test(t)) return 0;
    const texty = [...el.children].filter((k) => k.textContent.trim());
    if (!texty.length) return 1;
    if (texty.length === 2 && SPLIT_A.test(texty[0].textContent) && SPLIT_B.test(texty[1].textContent)) return 2;
    return 0;
  }

  function fixPill(el, mode, m) {
    const h = m.h + 'p', f = niceFps(m.fps) + 'FPS';
    if (mode === 1) {
      const text = h + ' ' + f;
      if (el.textContent === text) return;
      const nodes = [...el.childNodes].filter((n) => n.nodeType === 3);
      if (!nodes.length) return;
      nodes[0].nodeValue = text;
      for (const n of nodes.slice(1)) n.nodeValue = '';
    } else {
      const [a, b] = [...el.children].filter((k) => k.textContent.trim());
      if (a.textContent !== h) a.textContent = h;
      if (b.textContent !== f) b.textContent = f;
    }
  }

  function scan() {
    stats.when = Date.now();
    if (document.hidden) { stats.note = 'window hidden'; return 0; }
    stats.videos = document.getElementsByTagName('video').length;
    // Only look when there is a stream to measure: a video playing, or we are sharing.
    if (!loneVideoAny() && !liveShare()) { stats.note = 'no stream playing'; return 0; }
    let fixed = 0, found = 0;
    for (const el of document.querySelectorAll('div,span')) {
      const mode = pillMode(el);
      if (!mode) continue;
      // Skip wrappers: only the innermost element that holds the whole pill.
      if ([...el.children].some((k) => pillMode(k))) continue;
      found++;
      const m = truthFor(el);
      if (m) { fixPill(el, mode, m); fixed++; }
      else if (!stats.sample) stats.sample = el.textContent.trim();
    }
    stats.pills = found; stats.fixed = fixed;
    stats.note = !found ? 'no quality badge on screen' : fixed ? 'ok' : 'badge found, no matching video measured yet';
    if (fixed) stats.sample = '';
    return fixed;
  }

  function start() {
    clearInterval(timer);
    timer = setInterval(() => { try { scan(); } catch (_) {} }, 1500);
  }
  window.driftcordFixLabels = scan;
  return { start, scan, stats };
})();
