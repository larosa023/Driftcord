// ── Honest quality badge ─────────────────────────────────────────────────────
// Discord's "720p 30FPS" pill (and the Go Live card's "1440p 1FPS") come from
// stream info it keeps, which can say less than the stream really is. Here the
// text is rewritten from what is actually measured:
//   · watching a stream: the decoded height and frame rate of the <video>
//   · sharing: what the encoder is really sending (WebRTC stats)
// The frame rate shown is the best over the last ~12 s, so a still screen
// doesn't make the badge read "1FPS".

const labels = (() => {
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

  /** The local preview of our own share (its track is ours, or it has the picked size). */
  function isOwnPreview(v) {
    try {
      const so = v.srcObject;
      if (so && so.getVideoTracks) for (const t of so.getVideoTracks()) if (shareTracks.has(t)) return true;
    } catch (_) {}
    try { const p = discordQuality.debug().pick; return !!p && v.videoWidth === p.w && v.videoHeight === p.h; } catch (_) { return false; }
  }

  function truthFor(el) {
    const near = videoFor(el);
    if (near) {
      // Our own preview runs at whatever rate the page paints it; what viewers get is what the encoder sends.
      if (liveShare() && isOwnPreview(near)) return encoderTruth() || measure(near);
      return measure(near);
    }
    if (liveShare()) return encoderTruth();      // e.g. the Go Live card
    const only = mainVideo();                    // e.g. the badge in the stream view's top bar
    return only ? measure(only) : null;
  }

  // Quality text is found as text nodes, so it does not matter how Discord
  // nests the pieces ("720p" / "30FPS" / "LIVE" may each be their own span, or
  // one string with an icon in front).
  const COMBINED = /^(\s*)(\d{3,4})p(\s+)(\d{1,3})\s*FPS(\s*)$/i;
  const RES_ONLY = /^(\s*)(\d{3,4})p(\s*)$/i;
  const FPS_ONLY = /^(\s*)(\d{1,3})\s*FPS(\s*)$/i;

  function textNodes() {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const v = n.nodeValue;
        if (!v || v.length > 16 || !/\d/.test(v)) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (!p || p.closest('script,style,textarea,#driftcord-root')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n);
    return out;
  }

  /** Every quality badge on the page: { anchor, res: node, fps: node|null, combined: bool } */
  function findPills() {
    const nodes = textNodes(), pills = [];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i], v = n.nodeValue;
      if (COMBINED.test(v)) { pills.push({ anchor: n.parentElement, res: n, fps: null, combined: true }); continue; }
      if (!RES_ONLY.test(v)) continue;
      // The frame-rate piece is the next text node, inside the same small box.
      const next = nodes[i + 1];
      if (!next || !FPS_ONLY.test(next.nodeValue)) continue;
      const box = n.parentElement.closest('div,span,li,button,a') || n.parentElement;
      const common = box.contains(next) ? box : box.parentElement;
      if (!common || !common.contains(next) || common === document.body) continue;
      pills.push({ anchor: common, res: n, fps: next, combined: false });
      i++;
    }
    return pills;
  }

  function fixPill(pill, m) {
    const h = m.h + 'p', f = niceFps(m.fps) + 'FPS';
    if (pill.combined) {
      const mm = COMBINED.exec(pill.res.nodeValue);
      const text = mm[1] + h + mm[3] + f + mm[5];
      if (pill.res.nodeValue !== text) pill.res.nodeValue = text;
      return;
    }
    const r = RES_ONLY.exec(pill.res.nodeValue), q = FPS_ONLY.exec(pill.fps.nodeValue);
    const rt = r[1] + h + r[3], ft = q[1] + f + q[3];
    if (pill.res.nodeValue !== rt) pill.res.nodeValue = rt;
    if (pill.fps.nodeValue !== ft) pill.fps.nodeValue = ft;
  }

  function scan() {
    stats.when = Date.now();
    if (document.hidden) { stats.note = 'window hidden'; return 0; }
    stats.videos = document.getElementsByTagName('video').length;
    // Only look when there is a stream to measure: a video playing, or we are sharing.
    if (!loneVideoAny() && !liveShare()) { stats.note = 'no stream playing'; return 0; }
    let fixed = 0;
    const pills = findPills();
    stats.sample = '';
    for (const pill of pills) {
      const m = truthFor(pill.anchor);
      if (m) { fixPill(pill, m); fixed++; }
      else if (!stats.sample) stats.sample = (pill.res.nodeValue + (pill.fps ? ' ' + pill.fps.nodeValue : '')).trim();
    }
    stats.pills = pills.length; stats.fixed = fixed;
    stats.note = !pills.length ? 'no quality badge on screen' : fixed ? 'ok' : 'badge found, no matching video measured yet';
    if (fixed) stats.sample = '';
    return fixed;
  }

  // ── Diagnostics: what the page really looks like around the quality badges ──
  function describe(el, depth = 7) {
    const parts = [];
    for (let n = el, d = 0; n && n !== document.body && d < depth; n = n.parentElement, d++) {
      const cls = (typeof n.className === 'string' ? n.className : '').split(/\s+/).filter(Boolean).slice(0, 4).join('.');
      parts.push(n.tagName.toLowerCase() + (cls ? '.' + cls : '') + (n.id ? '#' + n.id : ''));
    }
    return parts.join(' < ');
  }
  function snippet(el, max = 700) {
    let html = el.outerHTML || '';
    html = html.replace(/\s(href|src|srcset|style)="[^"]*"/g, '');
    return html.length > max ? html.slice(0, max) + '…' : html;
  }
  function diagnostics() {
    const out = [];
    out.push('Driftcord ' + VERSION + ' · ' + new Date().toISOString());
    out.push('badge fixer: ' + JSON.stringify(stats));
    try { out.push('discordQuality: ' + JSON.stringify(discordQuality.debug())); } catch (e) { out.push('discordQuality: error ' + e); }
    out.push('encoder: ' + JSON.stringify(encStats));
    try { out.push('store census: ' + discordQuality.census()); } catch (e) { out.push('store census: error ' + e); }
    out.push('capabilities: ' + (capProbe.text || 'probing…'));
    out.push('ua: ' + navigator.userAgent);
    out.push('');
    out.push('— videos —');
    for (const v of document.getElementsByTagName('video')) {
      const r = v.getBoundingClientRect();
      let q = null; try { q = v.getVideoPlaybackQuality(); } catch (_) {}
      out.push(`video ${v.videoWidth}x${v.videoHeight} on screen ${Math.round(r.width)}x${Math.round(r.height)} ready=${v.readyState} paused=${v.paused} frames=${q ? q.totalVideoFrames : '?'} src=${v.srcObject ? 'stream' : (v.currentSrc ? 'url' : 'none')} :: ${describe(v, 5)}`);
    }
    out.push('');
    out.push('— text that looks like a quality badge —');
    const seenBoxes = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const v = n.nodeValue;
      if (!v || v.length > 40 || !/(\d{3,4}p\b|\d{1,3}\s*fps\b)/i.test(v)) continue;
      const p = n.parentElement;
      if (!p || p.closest('#driftcord-root,script,style')) continue;
      const box = p.closest('div,span,li,button,a') || p;
      const outer = box.parentElement || box;
      if (seenBoxes.has(outer)) continue;
      seenBoxes.add(outer);
      out.push(`text ${JSON.stringify(v)} :: ${describe(p)}`);
      out.push('  html: ' + snippet(outer));
    }
    out.push('');
    out.push('— pills the fixer recognises —');
    for (const pill of findPills()) {
      const m = truthFor(pill.anchor);
      out.push(`${JSON.stringify(pill.res.nodeValue + (pill.fps ? ' | ' + pill.fps.nodeValue : ''))} combined=${pill.combined} truth=${m ? m.h + 'p ' + niceFps(m.fps) : 'none'} :: ${describe(pill.anchor)}`);
    }
    return out.join('\n');
  }
  // Can this browser encode these in hardware? (mediaCapabilities, asked once per minute)
  const capProbe = { text: '', t: 0 };
  function probeCaps() {
    const now = Date.now();
    if (now - capProbe.t < 60000 || !navigator.mediaCapabilities || !navigator.mediaCapabilities.encodingInfo) return;
    capProbe.t = now;
    const codecs = [['H264 CBP', 'video/H264;profile-level-id=42e01f'], ['H264 Main', 'video/H264;profile-level-id=4d001f'], ['H264 High', 'video/H264;profile-level-id=64001f'],
      ['VP8', 'video/VP8'], ['VP9', 'video/VP9'], ['AV1', 'video/AV1']];
    Promise.all(codecs.map(([name, ct]) => navigator.mediaCapabilities.encodingInfo({ type: 'webrtc',
      video: { contentType: ct, width: 2560, height: 1440, framerate: 60, bitrate: 8000000 } })
      .then((r) => `${name}: ${r.supported ? (r.powerEfficient ? 'hardware' : 'software only') : 'no'}`)
      .catch((e) => `${name}: error ${e && e.message || e}`)))
      .then((lines) => { capProbe.text = lines.join(' · '); });
  }

  let lastDiag = 0;
  function saveDiagnostics(force) {
    if (!bridge.available()) return Promise.resolve('');
    const now = Date.now();
    if (!force && now - lastDiag < 8000) return Promise.resolve('');
    lastDiag = now;
    probeCaps();
    let text;
    try { text = diagnostics(); } catch (e) { text = 'diagnostics failed: ' + (e && e.stack || e); }
    return bridge.invoke('write_diag', { text }).catch((e) => { stats.note += ' (diag write failed: ' + e + ')'; return ''; });
  }

  function start() {
    clearInterval(timer);
    timer = setInterval(() => {
      try { scan(); } catch (e) { stats.note = 'error: ' + (e && e.message || e); }
      // While a stream is up, keep a fresh snapshot on disk for the dev.
      if (stats.note !== 'no stream playing' && stats.note !== 'window hidden') saveDiagnostics(false);
    }, 1500);
  }
  window.driftcordFixLabels = scan;
  window.driftcordStreamDiag = diagnostics;
  return { start, scan, stats, diagnostics, saveDiagnostics };
})();
