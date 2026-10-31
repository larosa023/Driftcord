// ── Stream quality on Discord's side ─────────────────────────────────────────
// Driftcord captures at the quality you picked, but web Discord decides on
// its own what to *send*: it asks its "default Go Live quality" (720p30
// without Nitro), writes that into the stream connection's
// videoStreamParameters (what the voice server and viewers go by) and
// constrains the track it holds. So what you picked was quietly replaced.
//
// This does what Vesktop (Vencord's desktop client) does, at runtime:
// 1. Reach Discord's media engine through MediaEngineStore (via webpack).
// 2. Patch getDefaultGoliveQuality on the connection's prototype so it
//    answers with your pick while a Driftcord share is on.
// 3. Write your pick into the stream connection's videoStreamParameters,
//    and keep it there while you're live (Discord re-evaluates quality).
// 4. Re-apply constraints to the track Discord holds (its own copy).
// Camera and voice are untouched: no share → nothing is changed.

const discordQuality = (() => {
  const state = {
    wreq: false, store: false, userStore: false, engine: false, conn: false, method: false, how: '',
    params: null, applied: null, asserts: 0, errors: [],
  };
  let stores = null;      // { media, user }
  let patchedProtos = new WeakSet();
  let ticker = 0;
  let stream = null;      // the Driftcord share stream, while live
  const log = (...a) => console.log('%c Driftcord share ', 'background:#4fa3ff;color:#fff;border-radius:4px', ...a);
  const fail = (what, e) => { const m = what + ': ' + errText(e); if (!state.errors.includes(m)) state.errors.push(m); };

  function webpackRequire() {
    const chunks = window.webpackChunkdiscord_app;
    if (!chunks || typeof chunks.push !== 'function') return null;
    let wreq = null;
    try { chunks.push([[Symbol('driftcord-quality')], {}, (r) => { wreq = r; }]); } catch (e) { fail('webpack', e); }
    state.wreq = !!(wreq && wreq.c);
    return wreq && wreq.c ? wreq : null;
  }

  /** What a flux store calls itself: getName() on older builds,
   *  constructor.displayName on current ones (what Vencord matches on). */
  function storeName(v) {
    if (!v || (typeof v !== 'object' && typeof v !== 'function')) return null;
    try { if (typeof v.getName === 'function') { const n = v.getName(); if (typeof n === 'string') return n; } } catch (_) {}
    try { const c = v.constructor; if (c && typeof c.displayName === 'string') return c.displayName; } catch (_) {}
    return null;
  }

  /** Vencord / Equicord expose their module finder; use it when present. */
  function storesViaMod() {
    const V = window.Vencord || window.Equicord;
    const W = V && V.Webpack;
    if (!W || typeof W.findStore !== 'function') return null;
    let media = null, user = null;
    try { media = W.findStore('MediaEngineStore'); } catch (e) { fail('mod findStore', e); }
    try { user = (W.Common && W.Common.UserStore) || W.findStore('UserStore'); } catch (_) {}
    if (!media) return null;
    state.how = (window.Equicord ? 'Equicord' : 'Vencord') + ' webpack';
    return { media, user };
  }

  /** Own scan of the webpack module cache (no client mod, or it had no answer). */
  function storesViaScan() {
    const wreq = webpackRequire();
    if (!wreq) return null;
    const want = { MediaEngineStore: null, UserStore: null };
    let left = 2;
    const check = (v) => {
      const name = storeName(v);
      if (name && name in want && !want[name]) { want[name] = v; left--; }
    };
    for (const id in wreq.c) {
      let exp;
      try { exp = wreq.c[id].exports; } catch (_) { continue; }
      if (!exp || exp === window || (typeof exp !== 'object' && typeof exp !== 'function')) continue;
      try {
        check(exp);
        for (const k of Object.keys(exp)) {
          let v; try { v = exp[k]; } catch (_) { continue; }
          check(v);
          if (!left) break;
        }
      } catch (_) { /* some exports throw on access */ }
      if (!left) break;
    }
    if (!want.MediaEngineStore) return null;
    state.how = 'module scan';
    return { media: want.MediaEngineStore, user: want.UserStore };
  }

  let lastLookup = 0;
  /** Discord's flux stores by name. A failed lookup is retried at most every 10 s. */
  function findStores() {
    if (stores) return stores;
    const now = Date.now();
    if (now - lastLookup < 10000) return null;
    lastLookup = now;
    const found = storesViaMod() || storesViaScan();
    state.store = !!(found && found.media);
    state.userStore = !!(found && found.user);
    if (!found) return null;
    stores = found;
    return stores;
  }

  /** For diagnostics: the store names visible in the module cache. */
  function storeCensus(limit = 40) {
    const wreq = webpackRequire();
    if (!wreq) return 'no webpack';
    const names = new Set();
    for (const id in wreq.c) {
      let exp;
      try { exp = wreq.c[id].exports; } catch (_) { continue; }
      if (!exp || exp === window || (typeof exp !== 'object' && typeof exp !== 'function')) continue;
      try {
        const n = storeName(exp); if (n) names.add(n);
        for (const k of Object.keys(exp)) { let v; try { v = exp[k]; } catch (_) { continue; } const m = storeName(v); if (m) names.add(m); }
      } catch (_) {}
    }
    const all = [...names];
    const hit = all.filter((n) => /media|stream|user|rtc|voice/i.test(n));
    return `${all.length} stores; relevant: ${hit.slice(0, limit).join(', ')}`;
  }

  function engine() {
    const st = findStores();
    if (!st) return null;
    try {
      const e = st.media.getMediaEngine();
      state.engine = !!e;
      return e || null;
    } catch (e) { fail('getMediaEngine', e); return null; }
  }

  function connections(eng) {
    const c = eng && eng.connections;
    if (!c) return [];
    try { return Array.isArray(c) ? c : [...(typeof c.values === 'function' ? c.values() : c)]; } catch (_) { return []; }
  }

  /** Your own stream's connection (the one that sends your screen). */
  function streamConnection() {
    const eng = engine();
    if (!eng) return null;
    let me = null;
    try { me = stores.user && stores.user.getCurrentUser && stores.user.getCurrentUser(); } catch (_) {}
    const myId = me && me.id;
    const all = connections(eng);
    let conn = myId ? all.find((c) => c && c.streamUserId === myId) : null;
    if (!conn && stream) {
      // Fallback: the connection whose input is our share.
      const ours = new Set(stream.getTracks());
      conn = all.find((c) => {
        try { return c && c.input && c.input.stream && c.input.stream.getTracks().some((t) => ours.has(t)); } catch (_) { return false; }
      }) || null;
    }
    state.conn = !!conn;
    return conn;
  }

  /** Patch getDefaultGoliveQuality wherever it lives on the prototype chain
   *  of these objects (the connection, its quality manager, the engine). */
  function patchQualityMethod(roots) {
    for (const root of roots) {
      let o = root;
      for (let depth = 0; o && o !== Object.prototype && depth < 12; o = Object.getPrototypeOf(o), depth++) {
        const d = Object.getOwnPropertyDescriptor(o, 'getDefaultGoliveQuality');
        if (!d || typeof d.value !== 'function') continue;
        if (patchedProtos.has(o)) { state.method = true; return true; }
        const original = d.value;
        const patched = function () {
          const q = original.apply(this, arguments);
          return pickedQuality ? liftedQuality(q, pickedQuality) : q;
        };
        try {
          Object.defineProperty(o, 'getDefaultGoliveQuality', { ...d, value: patched });
          patchedProtos.add(o);
          state.method = true;
          log('quality method patched');
          return true;
        } catch (e) { fail('patch method', e); }
      }
    }
    return false;
  }

  /** Discord's quality object with the pick written in. */
  function liftedQuality(q, pick) {
    q = (q && typeof q === 'object') ? q : {};
    const dims = { width: pick.w, height: pick.h, framerate: pick.fps, pixelCount: pick.w * pick.h };
    const kbps = pickKbps(pick);
    q.capture = Object.assign(q.capture && typeof q.capture === 'object' ? q.capture : {}, dims);
    if (q.encode && typeof q.encode === 'object') Object.assign(q.encode, dims);
    q.bitrateTarget = kbps * 1000;
    q.bitrateMax = Math.min(25000, Math.round(kbps * 1.5)) * 1000;
    q.bitrateMin = Math.min(Math.round(kbps * 0.3), 1500) * 1000;
    return q;
  }
  const pickKbps = (p) => Math.round(Math.min(10000, Math.max(1500, (p.w * p.h * p.fps * 0.07) / 1000)));

  /** Write the pick into the connection's stream parameters. */
  function writeParams(conn, pick) {
    const list = conn.videoStreamParameters;
    if (!Array.isArray(list) || !list.length) return false;
    let changed = false;
    for (const p of list) {
      if (!p || typeof p !== 'object') continue;
      if (p.maxFrameRate !== pick.fps) { p.maxFrameRate = pick.fps; changed = true; }
      const r = p.maxResolution && typeof p.maxResolution === 'object' ? p.maxResolution : (p.maxResolution = { type: 'fixed', width: 0, height: 0 });
      if (r.width !== pick.w || r.height !== pick.h) { r.width = pick.w; r.height = pick.h; changed = true; }
      if (r.type === undefined) r.type = 'fixed';
    }
    state.params = { fps: list[0].maxFrameRate, res: list[0].maxResolution && `${list[0].maxResolution.width}x${list[0].maxResolution.height}` };
    return changed;
  }

  /** Constrain the track Discord holds (may be its own copy of ours). */
  function constrainDiscordTrack(conn, pick) {
    try {
      const t = conn.input && conn.input.stream && conn.input.stream.getVideoTracks()[0];
      if (!t) return;
      t.applyConstraints({
        ...(t.getConstraints ? t.getConstraints() : {}),
        frameRate: { min: Math.min(15, pick.fps), ideal: pick.fps },
        width: { min: 640, ideal: pick.w, max: pick.w },
        height: { min: 480, ideal: pick.h, max: pick.h },
        advanced: [{ width: pick.w, height: pick.h }],
        resizeMode: 'none',
      }).then(() => { state.applied = `${pick.w}x${pick.h}@${pick.fps}`; }).catch((e) => fail('constraints', e));
    } catch (e) { fail('discord track', e); }
  }

  /** Apply everything once. Returns true when the connection was reached. */
  function assert() {
    const pick = pickedQuality;
    if (!pick) return false;
    const conn = streamConnection();
    const eng = engine();
    patchQualityMethod([conn, conn && conn.videoQualityManager, eng].filter(Boolean));
    if (!conn) return false;
    const changed = writeParams(conn, pick);
    state.asserts++;
    if (changed || state.asserts === 1) {
      constrainDiscordTrack(conn, pick);
      if (changed && state.asserts > 1) log('Discord changed the stream quality; set back to', pick);
    }
    return true;
  }

  return {
    /** Called when the share picker opens: get hold of Discord early. */
    prepare() { try { patchQualityMethod([streamConnection(), engine()].filter(Boolean)); } catch (e) { fail('prepare', e); } },
    /** A Driftcord share just started. */
    onShareStart(s) {
      stream = s;
      state.asserts = 0; state.errors = []; state.params = null; state.applied = null;
      clearInterval(ticker);
      // Discord sets its own values right after the stream starts; keep ours.
      const delays = [0, 100, 300, 700, 1500, 3000];
      for (const d of delays) setTimeout(() => { try { assert(); } catch (e) { fail('assert', e); } }, d);
      ticker = setInterval(() => { try { assert(); } catch (e) { fail('assert', e); } refreshEncoderStats(); }, 2000);
      setTimeout(() => {
        if (!state.conn) toast('Stream quality may be capped by Discord', {
          sub: 'Driftcord couldn\'t reach Discord\'s stream connection. See About → Stream.', duration: 8000 });
      }, 3500);
    },
    onShareEnd() { stream = null; clearInterval(ticker); ticker = 0; encPrev = null; adaptReset(); },
    assert() { try { assert(); } catch (e) { fail('assert', e); } },
    debug() { return { ...state, pick: pickedQuality, live: !!stream }; },
    history() { return [...encHistory, ...adaptState.notes.slice(-10)]; },
    census() { try { return storeCensus(); } catch (e) { return 'census failed: ' + e; } },
  };
})();
window.driftcordStreamDebug = () => discordQuality.debug();
/** Dev console: try to reach Discord's internals now and report. */
window.driftcordStreamProbe = () => { discordQuality.prepare(); return { ...discordQuality.debug(), census: discordQuality.census() }; };

/** About → Stream card: what Driftcord could reach on Discord's side. */
// ── Adaptive quality ─────────────────────────────────────────────────────────
// If frames are being captured but the encoder can't send them (CPU-bound, or the
// bandwidth estimate collapsed), ease the load instead of letting the stream
// crawl: first keep the frame rate and let the picture soften (bandwidth), or
// shrink what is encoded a step at a time (CPU). Step back up once it has run
// cleanly for a while. A still screen (the capture itself is slow) is not a problem.
const ADAPT_SCALES = [1, 4 / 3, 16 / 9];
const adaptState = { bad: 0, goodSince: 0, lastChange: 0, recoverWait: 40000, lastRecover: 0, level: 0, notes: [] };

function adaptApply() { for (const pc of voicePcs) tuneSenders(pc); }

function adaptReset() {
  adaptState.bad = 0; adaptState.goodSince = 0; adaptState.lastChange = 0; adaptState.level = 0; adaptState.recoverWait = 40000;
  if (adapt.scale !== 1 || adapt.motion) { adapt.scale = 1; adapt.motion = false; adaptApply(); }
}

function adaptTick(e, pick = pickedQuality) {
  if (store.get('screenshare.adaptive') === false) { if (adapt.scale !== 1 || adapt.motion) adaptReset(); return; }
  if (!pick || !e || !e.fps) return;
  const now = Date.now();
  const want = pick.fps;
  const captureOk = e.srcFps < 0 || e.srcFps >= want * 0.8;     // frames are being delivered
  const slow = captureOk && e.fps < want * 0.7;
  adaptState.bad = slow ? adaptState.bad + 1 : 0;
  if (slow) adaptState.goodSince = 0;
  else if (!adaptState.goodSince && e.fps >= want * 0.9) adaptState.goodSince = now;

  if (adaptState.bad >= 3 && now - adaptState.lastChange > 8000) {
    adaptState.bad = 0; adaptState.lastChange = now; adaptState.goodSince = 0;
    // Re-eased soon after recovering: wait longer before trying again.
    if (now - adaptState.lastRecover < 90000) adaptState.recoverWait = Math.min(adaptState.recoverWait * 2, 300000);
    if (e.why === 'bandwidth' && !adapt.motion) {
      adapt.motion = true; adaptApply();
      toast('Keeping your stream smooth', { sub: 'Bandwidth dipped, so the picture may soften briefly instead of stuttering.', duration: 5000 });
    } else if (adaptState.level < ADAPT_SCALES.length - 1) {
      adaptState.level++; adapt.scale = ADAPT_SCALES[adaptState.level]; adaptApply();
      toast('Keeping your stream smooth', { sub: `Your PC couldn't encode full quality at ${want} fps, so it's sending ${Math.round(pick.h / adapt.scale)}p for now.`, duration: 6000 });
    }
    adaptState.notes.push(`${new Date(now).toISOString().slice(11, 19)} eased: scale=${adapt.scale.toFixed(2)} motion=${adapt.motion}`);
    return;
  }
  const eased = adapt.scale > 1 || adapt.motion;
  if (eased && adaptState.goodSince && now - adaptState.goodSince >= adaptState.recoverWait && now - adaptState.lastChange > 8000) {
    adaptState.lastChange = now; adaptState.lastRecover = now; adaptState.goodSince = 0;
    if (adapt.scale > 1) { adaptState.level = Math.max(0, adaptState.level - 1); adapt.scale = ADAPT_SCALES[adaptState.level]; }
    else adapt.motion = false;
    adaptApply();
    adaptState.notes.push(`${new Date(now).toISOString().slice(11, 19)} recovered: scale=${adapt.scale.toFixed(2)} motion=${adapt.motion}`);
  }
}
window.driftcordAdaptTick = adaptTick;
window.driftcordAdaptState = () => ({ scale: adapt.scale, motion: adapt.motion, level: adaptState.level, bad: adaptState.bad, recoverWait: adaptState.recoverWait });

/** What the encoder is really doing right now (WebRTC stats of the share sender). */
let encStats = null, encBusy = false;
/** The last few minutes of encoder health, one line per sample, for the diagnostics file. */
const encHistory = [];
let encPrev = null;
function recordEnc(e) {
  const now = Date.now();
  // Average time to encode one frame since the last sample: the real cost of this codec.
  let encMs = -1;
  if (encPrev && e.encoded > encPrev.encoded) encMs = Math.round(((e.encTime - encPrev.encTime) / (e.encoded - encPrev.encoded)) * 1000);
  encPrev = { encoded: e.encoded, encTime: e.encTime };
  encHistory.push(`${new Date(now).toISOString().slice(11, 19)} sent=${e.w}x${e.h}@${e.fps} source=${e.srcW}x${e.srcH}@${e.srcFps} encodeMs=${encMs} why=${e.why} target=${e.target}kbps est=${e.est}kbps pli=${e.pli} nack=${e.nack}`);
  if (encHistory.length > 90) encHistory.shift();
}
async function refreshEncoderStats() {
  if (encBusy) return;
  encBusy = true;
  try {
    let best = null;
    for (const pc of voicePcs) {
      if (pc.connectionState === 'closed') continue;
      for (const sender of pc.getSenders()) {
        const tr = sender.track;
        if (!tr || tr.kind !== 'video' || tr.readyState !== 'live') continue;
        const isShare = shareTracks.has(tr);
        const report = await sender.getStats();
        let pair = null; const codecs = {};
        report.forEach((r) => {
          if (r.type === 'candidate-pair' && (r.nominated || r.state === 'succeeded') && r.availableOutgoingBitrate) pair = r;
          if (r.type === 'codec' && r.mimeType) codecs[r.id] = r.mimeType.replace(/^video\//i, '') + (r.sdpFmtpLine ? ' (' + r.sdpFmtpLine + ')' : '');
        });
        let src = null;
        report.forEach((r) => { if (r.type === 'media-source' && r.kind === 'video') src = r; });
        report.forEach((r) => {
          if (r.type !== 'outbound-rtp' || r.kind !== 'video' || !r.frameWidth) return;
          const cand = { w: r.frameWidth, h: r.frameHeight, fps: Math.round(r.framesPerSecond || 0),
            why: r.qualityLimitationReason || 'none', changes: r.qualityLimitationResolutionChanges || 0,
            target: r.targetBitrate ? Math.round(r.targetBitrate / 1000) : 0,
            est: pair ? Math.round(pair.availableOutgoingBitrate / 1000) : 0, share: isShare, rid: r.rid || '',
            codec: codecs[r.codecId] || '', encoder: r.encoderImplementation || '', pli: r.pliCount || 0, nack: r.nackCount || 0,
            srcFps: src ? Math.round(src.framesPerSecond || 0) : -1, srcW: src ? src.width : 0, srcH: src ? src.height : 0,
            encoded: r.framesEncoded || 0, encTime: r.totalEncodeTime || 0, sent: r.framesSent || 0, huge: r.hugeFramesSent || 0,
            limitMs: r.qualityLimitationDurations ? { cpu: Math.round((r.qualityLimitationDurations.cpu || 0) * 1000), bw: Math.round((r.qualityLimitationDurations.bandwidth || 0) * 1000) } : null,
            power: r.powerEfficientEncoder, mode: (() => { try { const e = sender.getParameters().encodings || []; return e.map((x) => x.scalabilityMode || '-').join(','); } catch (_) { return ''; } })() };
          if (!best || (cand.share && !best.share) || (cand.share === best.share && cand.w > best.w)) best = cand;
        });
      }
    }
    encStats = best;
    if (best && best.share) { recordEnc(best); try { adaptTick(best); } catch (_) {} }
  } catch (_) { encStats = null; }
  encBusy = false;
}

/** Offer Boosted graphics when video is being encoded on the CPU (OpenH264). */
function softEncodeNotice() {
  if (!encStats || !/openh264/i.test(encStats.encoder || '') || !bridge.available()) return null;
  return h('div', { class: 'notice' },
    h('span', { class: 'grow' }, 'Your stream is being encoded on the CPU. Boosted graphics can let Windows use your graphics card instead (takes effect after a restart; not guaranteed on every PC).'),
    h('button', { class: 'btn primary', onclick: (e) => {
      e.currentTarget.disabled = true;
      bridge.invoke('set_memory', { gpuBoost: true }).then(() => bridge.invoke('restart_app')).catch(() => {});
    } }, 'Try it & restart'));
}

function streamDebugCard() {
  const box = h('div', {});
  const draw = () => {
    const d = discordQuality.debug();
    const yes = (b) => b ? 'yes' : 'no';
    const row = (label, val, desc) => h('div', { class: 'row' }, h('span', { class: 'label' }, label, desc ? h('span', { class: 'desc' }, desc) : null), h('b', {}, val));
    box.replaceChildren(...[
      row('Sharing now', d.live ? `${d.pick.w}x${d.pick.h} @ ${d.pick.fps}` : 'no'),
      row('Discord internals reached', yes(d.store), d.how ? 'MediaEngineStore via ' + d.how : 'MediaEngineStore via webpack'),
      row('Stream connection found', yes(d.conn), d.live ? (d.userStore ? 'by your user id' : 'UserStore not found; matched by track') : 'Only while you\'re live'),
      row('Quality method patched', yes(d.method), 'getDefaultGoliveQuality'),
      row('Discord sends', d.params ? `${d.params.res} @ ${d.params.fps}` : '—', 'videoStreamParameters'),
      row('Discord track constrained', d.applied || '—'),
      row('Encoder is really sending', encStats ? `${encStats.w}x${encStats.h} @ ${encStats.fps}` : '—', 'Measured from WebRTC, what leaves this PC'),
      row('Held back by', encStats ? ({ none: 'nothing', bandwidth: 'bandwidth estimate', cpu: 'CPU', other: 'other' }[encStats.why] || encStats.why) : '—', encStats && encStats.why === 'bandwidth' ? 'The connection says it can only carry about ' + encStats.est + ' kbps' : ''),
      row('Badge fixer', labels.stats.note, `${labels.stats.videos} video(s), ${labels.stats.pills} badge(s) found, ${labels.stats.fixed} corrected${labels.stats.sample ? ' · not matched: ' + labels.stats.sample : ''}`),
      row('Target bitrate', encStats ? encStats.target + ' kbps' : '—', encStats && encStats.est ? 'Estimate ' + encStats.est + ' kbps' : ''),
      row('Codec / encoder', encStats ? (encStats.codec || '?') + (encStats.encoder ? ' · ' + encStats.encoder : '') : '—'),
      softEncodeNotice(),
      d.errors.length ? h('p', { class: 'hint' }, 'Errors: ' + d.errors.join(' · ')) : null,
      h('p', { class: 'hint' }, 'If a badge is wrong, press Save diagnostics and send the file it names to the dev.'),
      h('button', { class: 'btn', onclick: (e) => {
        const b = e.currentTarget; b.textContent = 'Saving…';
        labels.saveDiagnostics(true).then((path) => { b.textContent = path ? 'Saved: ' + path : 'Could not save'; });
      } }, 'Save diagnostics'),
    ].filter(Boolean));
  };
  draw();
  const timer = setInterval(() => {
    if (!box.isConnected) { clearInterval(timer); return; }
    if (discordQuality.debug().live) refreshEncoderStats().then(draw); else { encStats = null; draw(); }
  }, 2000);
  return box;
}
