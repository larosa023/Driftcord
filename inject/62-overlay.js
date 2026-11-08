// ── In-game voice overlay ────────────────────────────────────────────────────
// While you are in a voice call and Driftcord is not the window in front (you are in a
// game), a small click-through window shows who is in the channel and who is talking.
// The list comes from Discord's own stores (reached through Vencord/Equicord) and goes
// to the app, which draws it; it works over borderless/windowed games.

const voiceOverlay = (() => {
  const speaking = new Set();
  const info = { stores: false, dispatcher: false, users: 0, note: 'idle', shown: false };
  let S = null, D = null, subscribed = false, timer = 0, poll = 0, lastKey = '', active = false, previewTimer = 0;

  const W = () => { const m = window.Vencord || window.Equicord; return m && m.Webpack ? m.Webpack : null; };

  function findStores() {
    if (S) return S;
    const w = W();
    if (!w || !w.findStore) return null;
    const get = (n) => { try { return w.findStore(n); } catch (_) { return null; } };
    const s = { vs: get('VoiceStateStore'), sel: get('SelectedChannelStore'), user: get('UserStore'), chan: get('ChannelStore'), member: get('GuildMemberStore') };
    if (!s.vs || !s.sel || !s.user) return null;
    S = s; info.stores = true;
    return S;
  }

  function onSpeaking(e) {
    if (!e || !e.userId) return;
    if (e.speakingFlags > 0 || e.speaking === true) speaking.add(e.userId); else speaking.delete(e.userId);
    quick();
  }

  function subscribe() {
    if (subscribed) return;
    try {
      const w = W();
      D = w && w.Common && w.Common.FluxDispatcher;
      if (D && D.subscribe) { D.subscribe('SPEAKING', onSpeaking); subscribed = true; info.dispatcher = true; }
    } catch (_) { /* no dispatcher: the list still updates, just without the talking ring */ }
  }

  function avatarOf(u) {
    try { const a = u.getAvatarURL && u.getAvatarURL(undefined, 64, false); if (a) return String(a); } catch (_) { /* fall through */ }
    return u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : '';
  }

  /** The people in your current voice channel, or null if we can't read Discord. */
  function snapshot() {
    const s = findStores();
    if (!s) return null;
    const chId = s.sel.getVoiceChannelId && s.sel.getVoiceChannelId();
    if (!chId) return { rows: [], channel: '' };
    const states = (s.vs.getVoiceStatesForChannel && s.vs.getVoiceStatesForChannel(chId)) || {};
    const ch = s.chan && s.chan.getChannel ? s.chan.getChannel(chId) : null;
    const rows = [];
    for (const vs of Object.values(states)) {
      const u = s.user.getUser && s.user.getUser(vs.userId);
      if (!u) continue;
      let name = u.globalName || u.username || 'User';
      try { const nick = s.member && ch && ch.guild_id && s.member.getNick(ch.guild_id, u.id); if (nick) name = nick; } catch (_) { /* no nickname */ }
      rows.push({ id: u.id, name, avatar: avatarOf(u), speaking: speaking.has(u.id), muted: !!(vs.mute || vs.selfMute), deaf: !!(vs.deaf || vs.selfDeaf) });
    }
    // Always list yourself, even if Discord's list hasn't caught up yet.
    const self = me();
    if (self && !rows.some((r) => r.id === self.id)) {
      rows.unshift({ ...self, speaking: speaking.has(self.id), muted: false, deaf: false });
    }
    return { rows, channel: ch && ch.name || '' };
  }

  const cfg = () => ({
    on: store.get('overlay.enabled') !== false,
    corner: store.get('overlay.corner') || 'top-right',
    scale: { small: 0.85, medium: 1, large: 1.25 }[store.get('overlay.size')] || 1,
    onlyTalking: !!store.get('overlay.onlyTalking'),
    opacity: Number(store.get('overlay.opacity')) || 0.78,
  });

  function send(rows, show, c, more = 0) {
    const state = JSON.stringify({ rows, more, scale: c.scale, opacity: c.opacity, dimQuiet: !c.onlyTalking });
    const key = state + '|' + show + '|' + c.corner;
    if (key === lastKey) return;
    lastKey = key;
    info.shown = show && rows.length > 0;
    bridge.invoke('overlay_update', { state, show, corner: c.corner, scale: c.scale, rows: rows.length + (more ? 1 : 0) })
      .catch((e) => { info.note = 'overlay failed: ' + errText(e); });
  }

  /** You, as Discord knows you (name and picture), for the preview and as a safety net. */
  function me() {
    const s = findStores();
    let u = null;
    try { u = s && s.user.getCurrentUser && s.user.getCurrentUser(); } catch (_) { /* not ready */ }
    return u ? { id: u.id, name: u.globalName || u.username || 'You', avatar: avatarOf(u) } : null;
  }

  function tick() {
    if (!active || !bridge.available()) return;
    const c = cfg();
    // Driftcord is in front: the call is on screen already.
    const front = document.hasFocus() && !document.hidden;
    if (!c.on || front) { if (lastKey) { send([], false, c); } info.note = c.on ? 'Driftcord is in front' : 'turned off'; return; }
    let snap;
    try { snap = snapshot(); } catch (e) { info.note = 'read failed: ' + (e && e.message || e); return; }
    if (!snap) { info.note = 'needs Vencord or Equicord'; return; }
    let rows = snap.rows;
    if (c.onlyTalking) rows = rows.filter((r) => r.speaking);
    rows.sort((a, b) => Number(b.speaking) - Number(a.speaking));
    const max = 8, more = Math.max(0, rows.length - max);
    info.users = snap.rows.length; info.note = snap.rows.length ? 'showing' : 'not in a voice channel';
    send(rows.slice(0, max), true, c, more);
  }

  let quickTimer = 0;
  function quick() { if (!active || quickTimer) return; quickTimer = setTimeout(() => { quickTimer = 0; try { tick(); } catch (_) {} }, 60); }

  function callChanged(inCall) {
    active = !!inCall;
    clearInterval(poll); poll = 0;
    if (active) {
      subscribe();
      poll = setInterval(() => { try { tick(); } catch (_) {} }, 800);
      setTimeout(tick, 300);
    } else {
      speaking.clear(); lastKey = ''; info.shown = false; info.note = 'idle';
      if (!previewTimer && bridge.available()) bridge.invoke('overlay_close').catch(() => {});
    }
  }

  /** Settings changed: apply right away. */
  function refresh() { lastKey = ''; if (active) tick(); }

  /** Shows sample people for a few seconds so you can see placement and size. */
  function preview() {
    const log = (t) => { try { if (bridge.available()) bridge.invoke('log_page_event', { line: 'overlay preview: ' + t }).catch(() => {}); } catch (_) {} };
    log('clicked, bridge=' + bridge.available());
    if (!bridge.available()) { toast('The overlay needs the Driftcord app', { duration: 5000 }); return; }
    const c = cfg();
    const self = me();
    const rows = [
      { id: '1', name: self ? self.name : 'You', avatar: self ? self.avatar : '', speaking: true, muted: false, deaf: false },
      { id: '2', name: 'Friend', avatar: '', speaking: false, muted: true, deaf: false },
      { id: '3', name: 'Another friend', avatar: '', speaking: false, muted: false, deaf: false },
    ];
    clearTimeout(previewTimer);
    lastKey = '';
    const state = JSON.stringify({ rows, more: 0, scale: c.scale, opacity: c.opacity, dimQuiet: true });
    bridge.invoke('overlay_update', { state, show: true, corner: c.corner, scale: c.scale, rows: rows.length })
      .then(() => { info.note = 'preview shown'; log('app accepted it'); })
      .catch((e) => { info.note = 'overlay failed: ' + errText(e); log('failed: ' + errText(e)); toast('The overlay could not open', { sub: errText(e).slice(0, 160), duration: 9000 }); });
    previewTimer = setTimeout(() => { previewTimer = 0; lastKey = ''; if (active) tick(); else bridge.invoke('overlay_close').catch(() => {}); }, 6000);
  }

  for (const ev of ['focus', 'blur']) window.addEventListener(ev, () => { if (active) setTimeout(tick, 120); });
  document.addEventListener('visibilitychange', () => { if (active) setTimeout(tick, 120); });
  store.onChange((path) => { if (path === '*' || String(path).startsWith('overlay.')) refresh(); });

  return { callChanged, refresh, preview, info };
})();
window.driftcordOverlay = voiceOverlay;   // dev console: driftcordOverlay.info
