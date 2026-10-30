// ── Honest quality badge ─────────────────────────────────────────────────────
// Discord's "720p 30FPS" pill comes from stream info it keeps, which can say
// less than the video really is (a stream that is 1440p/60 can still be
// labelled 720p/30). Here the pill is rewritten from what the <video> next to
// it is actually decoding: its real height, and its measured frame rate.

const labels = (() => {
  const PILL = /^\s*(\d{3,4})p\s*(\d{2,3})\s*fps\s*$/i;
  const SPLIT_A = /^\s*\d{3,4}p\s*$/i, SPLIT_B = /^\s*\d{2,3}\s*fps\s*$/i;
  const seen = new WeakMap();   // video → { t, frames, fps }
  let timer = 0;

  function measure(v) {
    const q = v.getVideoPlaybackQuality && v.getVideoPlaybackQuality();
    if (!q || !v.videoWidth) return null;
    const now = performance.now();
    const s = seen.get(v);
    if (!s) { seen.set(v, { t: now, frames: q.totalVideoFrames, fps: 0 }); return null; }
    const dt = now - s.t;
    if (dt >= 900) {
      s.fps = ((q.totalVideoFrames - s.frames) * 1000) / dt;
      s.t = now; s.frames = q.totalVideoFrames;
    }
    return s.fps ? { h: v.videoHeight, fps: s.fps } : null;
  }

  const niceFps = (f) => {
    for (const n of [15, 24, 30, 48, 50, 60, 90, 120, 144]) if (Math.abs(f - n) <= n * 0.1) return n;
    return Math.round(f);
  };

  // The video this pill belongs to: the closest ancestor that holds one.
  function videoFor(el) {
    for (let n = el.parentElement, d = 0; n && d < 10; n = n.parentElement, d++) {
      const vids = n.querySelectorAll('video');
      if (!vids.length) continue;
      // Two videos in reach means we can't tell which one the pill is for.
      return vids.length === 1 && vids[0].videoWidth ? vids[0] : null;
    }
    return null;
  }

  function fixPill(el, m) {
    const h = m.h + 'p', f = niceFps(m.fps) + 'FPS';
    const kids = el.children;
    if (!kids.length) {
      const text = h + ' ' + f;
      if (el.textContent !== text && el.firstChild) el.firstChild.nodeValue = text;
    } else if (kids.length === 2 && SPLIT_A.test(kids[0].textContent) && SPLIT_B.test(kids[1].textContent)) {
      if (kids[0].textContent !== h) kids[0].textContent = h;
      if (kids[1].textContent !== f) kids[1].textContent = f;
    }
  }

  function scan() {
    if (document.hidden || !document.querySelector('video')) return 0;
    let fixed = 0;
    for (const el of document.querySelectorAll('div,span')) {
      const t = el.textContent;
      if (t.length > 16 || t.length < 6) continue;
      const kids = el.children;
      const pill = PILL.test(t) && (!kids.length || (kids.length === 2 && SPLIT_A.test(kids[0].textContent) && SPLIT_B.test(kids[1].textContent)));
      if (!pill) continue;
      // Skip wrappers: only the innermost element that holds the whole pill.
      if ([...kids].some((k) => PILL.test(k.textContent))) continue;
      const v = videoFor(el);
      const m = v && measure(v);
      if (m) { fixPill(el, m); fixed++; }
    }
    return fixed;
  }

  function start() {
    clearInterval(timer);
    timer = setInterval(() => { try { scan(); } catch (_) {} }, 1500);
  }
  window.driftcordFixLabels = scan;
  return { start, scan };
})();
