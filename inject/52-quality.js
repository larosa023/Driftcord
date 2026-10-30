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
    wreq: false, store: false, userStore: false, engine: false, conn: false, method: false,
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

  /** Discord's flux stores by name, found once through the module cache. */
  function findStores() {
    if (stores) return stores;
    const wreq = webpackRequire();
    if (!wreq) return null;
    const want = { MediaEngineStore: null, UserStore: null };
    let left = 2;
    const check = (v) => {
      if (!v || (typeof v !== 'object' && typeof v !== 'function')) return;
      let name;
      try { name = typeof v.getName === 'function' ? v.getName() : null; } catch (_) { return; }
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
    state.store = !!want.MediaEngineStore;
    state.userStore = !!want.UserStore;
    if (!want.MediaEngineStore) return null;
    stores = { media: want.MediaEngineStore, user: want.UserStore };
    return stores;
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
      ticker = setInterval(() => { try { assert(); } catch (e) { fail('assert', e); } }, 2000);
      setTimeout(() => {
        if (!state.conn) toast('Stream quality may be capped by Discord', {
          sub: 'Driftcord couldn\'t reach Discord\'s stream connection. See About → Stream.', duration: 8000 });
      }, 3500);
    },
    onShareEnd() { stream = null; clearInterval(ticker); ticker = 0; },
    assert() { try { assert(); } catch (e) { fail('assert', e); } },
    debug() { return { ...state, pick: pickedQuality, live: !!stream }; },
  };
})();
window.driftcordStreamDebug = () => discordQuality.debug();

/** About → Stream card: what Driftcord could reach on Discord's side. */
function streamDebugCard() {
  const box = h('div', {});
  const draw = () => {
    const d = discordQuality.debug();
    const yes = (b) => b ? 'yes' : 'no';
    const row = (label, val, desc) => h('div', { class: 'row' }, h('span', { class: 'label' }, label, desc ? h('span', { class: 'desc' }, desc) : null), h('b', {}, val));
    box.replaceChildren(
      row('Sharing now', d.live ? `${d.pick.w}x${d.pick.h} @ ${d.pick.fps}` : 'no'),
      row('Discord internals reached', yes(d.store), 'MediaEngineStore via webpack'),
      row('Stream connection found', yes(d.conn), d.live ? (d.userStore ? 'by your user id' : 'UserStore not found; matched by track') : 'Only while you\'re live'),
      row('Quality method patched', yes(d.method), 'getDefaultGoliveQuality'),
      row('Discord sends', d.params ? `${d.params.res} @ ${d.params.fps}` : '—', 'videoStreamParameters'),
      row('Discord track constrained', d.applied || '—'),
      d.errors.length ? h('p', { class: 'hint' }, 'Errors: ' + d.errors.join(' · ')) : null,
      h('p', { class: 'hint' }, 'If a viewer sees less than "Discord sends", screenshot this card for the dev.'),
    );
  };
  draw();
  const timer = setInterval(() => { if (!box.isConnected) clearInterval(timer); else draw(); }, 2000);
  return box;
}
