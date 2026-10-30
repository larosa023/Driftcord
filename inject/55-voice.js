// ── Voice calls ──────────────────────────────────────────────────────────────
// Two things keep the green "speaking" ring prompt:
// * Driftcord knows when you're in a call and tells the app, which then skips
//   the background memory saver for as long as the call lasts (it can slow a
//   page that's still on screen, e.g. while you're in a game).
// * The ring switches on and off instantly instead of fading.

// ── In a call? ──
// Every call is an RTCPeerConnection; we notice them when they negotiate.
const voicePcs = new Set();
let inCall = false;
let callCheck = 0;

function updateCallState() {
  for (const pc of voicePcs) {
    if (pc.connectionState === 'closed' || pc.signalingState === 'closed') voicePcs.delete(pc);
  }
  const now = [...voicePcs].some((pc) => pc.connectionState === 'connected' ||
    pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed');
  if (now === inCall) return;
  inCall = now;
  if (bridge.available()) bridge.invoke('set_in_call', { on: now }).catch(() => {});
  // close() fires no events, so double-check now and then while a call is up.
  clearInterval(callCheck);
  if (now) {
    callCheck = setInterval(updateCallState, 5000);
    // Discord loads its call styles on demand: find the ring once they're in.
    setTimeout(instantSpeakingRing, 1000);
    setTimeout(instantSpeakingRing, 6000);
  }
}

function trackPc(pc) {
  if (voicePcs.has(pc)) return;
  voicePcs.add(pc);
  pc.addEventListener('connectionstatechange', updateCallState);
  pc.addEventListener('iceconnectionstatechange', updateCallState);
}

if (window.RTCPeerConnection) {
  const proto = RTCPeerConnection.prototype;
  for (const name of ['setLocalDescription', 'setRemoteDescription']) {
    const real = proto[name];
    if (typeof real !== 'function') continue;
    proto[name] = function () { trackPc(this); return real.apply(this, arguments); };
  }
  const realClose = proto.close;
  proto.close = function () {
    const r = realClose.apply(this, arguments);
    voicePcs.delete(this);
    updateCallState();
    return r;
  };
}

// ── Instant speaking ring ──
// Discord's class names change every build, so read them from its own
// stylesheets: every rule about "speaking" names the ring's classes, and the
// ring's transition lives on those (or their ::before/::after).
const ringStyle = ownStyle('driftcord-voice');
const ringClasses = new Set();
let ringSheets = 0;

function instantSpeakingRing() {
  const sheets = document.styleSheets;
  if (sheets.length === ringSheets) return; // nothing new loaded
  ringSheets = sheets.length;
  for (const sheet of sheets) {
    let rules;
    try { rules = sheet.cssRules; } catch (_) { continue; } // other-origin sheet
    if (rules) scanRules(rules);
  }
  if (!ringClasses.size) return;
  const sel = [...ringClasses].flatMap((c) => ['.' + c, '.' + c + '::before', '.' + c + '::after']).join(',');
  setCss(ringStyle, sel + ' { transition: none !important; }');
}

function scanRules(rules) {
  for (const r of rules) {
    if (r.cssRules && !r.selectorText) { scanRules(r.cssRules); continue; } // @media etc.
    const s = r.selectorText;
    if (!s || !/speaking/i.test(s)) continue;
    // Only the compound selector that names the speaking class, e.g.
    // ".avatar_x.avatarSpeaking_x" → avatar_x, avatarSpeaking_x.
    for (const part of s.split(',')) {
      for (const compound of part.split(/[\s>+~]+/)) {
        if (!/speaking/i.test(compound)) continue;
        for (const m of compound.matchAll(/\.([\w-]+)/g)) {
          // Skip Discord's generic layout helpers that also appear in these rules.
          if (!/^(?:theme-|dark|light|wrapper|flex|clickable|container)/i.test(m[1])) ringClasses.add(m[1]);
        }
      }
    }
  }
}

// The ring also shows in the channel list, so look once after startup too.
setTimeout(instantSpeakingRing, 15000);
