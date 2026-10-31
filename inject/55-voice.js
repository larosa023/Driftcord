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
  const realLocal = proto.setLocalDescription;
  proto.setLocalDescription = function () { trackPc(this); return realLocal.apply(this, arguments); };
  const realRemote = proto.setRemoteDescription;
  proto.setRemoteDescription = function (desc) {
    trackPc(this);
    const kbps = streamKbps(this);
    if (kbps && desc && typeof desc.sdp === 'string' && (desc.type === 'answer' || desc.type === 'offer')) {
      const sdp = sharpStartSdp(desc.sdp, kbps);
      if (sdp !== desc.sdp) return realRemote.call(this, { type: desc.type, sdp }).then((r) => { tuneSenders(this); return r; });
    }
    const r = realRemote.apply(this, arguments);
    if (r && r.then) r.then(() => tuneSenders(this), () => {});
    return r;
  };
  const realClose = proto.close;
  proto.close = function () {
    const r = realClose.apply(this, arguments);
    voicePcs.delete(this);
    updateCallState();
    return r;
  };
}

function tuneSenders(pc) {
  try { for (const s of pc.getSenders()) tuneShareSender(s); } catch (_) {}
}

// ── Sharp streams from the first second ──
// WebRTC starts every video at a few hundred kbps and feels its way up, which
// is why a stream used to look blurry for its first few seconds. When this
// connection is sending your screen share, the answer is told to start at the
// bitrate that share needs (and not dip far below it). Discord's own maximum
// for your account still applies. Voice and camera are left alone.

/** Start bitrate for this connection if it's (about to be) sending a share:
 *  either a share track is attached, or a share is live and the connection
 *  has an empty video slot Discord will put it in. Camera/voice give 0. */
function streamKbps(pc) {
  let kbps = 0, emptyVideoSlot = false;
  try {
    for (const t of pc.getTransceivers()) {
      const track = t.sender && t.sender.track;
      if (track && shareTracks.has(track)) kbps = Math.max(kbps, shareTracks.get(track));
      else if (!track && /send/.test(t.direction || '') && t.receiver && t.receiver.track && t.receiver.track.kind === 'video') emptyVideoSlot = true;
    }
  } catch (_) { /* closed */ }
  if (!kbps && emptyVideoSlot && live) {
    for (const t of live.stream.getVideoTracks()) kbps = Math.max(kbps, shareTracks.get(t) || 0);
  }
  return kbps;
}

// Keep the share at full resolution: when bandwidth is short WebRTC normally
// shrinks the picture first and grows it back over several seconds, which is
// the "starts blurry, sharpens while you watch" effect. Sharp/Balanced trade
// frame rate instead; Smooth keeps frame rate (and may scale).
function shareDegradation(track) {
  return adapt.motion || track.contentHint === 'motion' ? 'maintain-framerate' : 'maintain-resolution';
}

/** Set by the adaptive controller (52-quality) when the encoder or bandwidth can't keep up. */
const adapt = { scale: 1, motion: false };

/** Highest bitrate a share may use: headroom over its start bitrate. */
const shareMaxKbps = (kbps) => Math.min(25000, Math.round(kbps * 1.5));

/** Discord's web client caps every stream at its own quality profile (720p30
 *  and about 2.5 Mbps without Nitro) through the encoder parameters. Lift
 *  those to what you picked in Driftcord. Returns true if anything changed. */
function liftShareParams(p, track) {
  let changed = false;
  const want = shareDegradation(track);
  if (p.degradationPreference !== want) { p.degradationPreference = want; changed = true; }
  const kbps = shareTracks.get(track) || 0;
  const fps = (track.getSettings && track.getSettings().frameRate) || 0;
  // Only the main layer: a lower simulcast layer (rid "50") is meant to be small.
  const enc = p.encodings || [];
  const e = enc.find((x) => !x.rid || x.rid === '100') || enc[0];
  if (e) {
    if (kbps && e.maxBitrate && e.maxBitrate < shareMaxKbps(kbps) * 1000) { e.maxBitrate = shareMaxKbps(kbps) * 1000; changed = true; }
    if (fps && e.maxFramerate && e.maxFramerate < fps) { e.maxFramerate = fps; changed = true; }
    if ((e.scaleResolutionDownBy || 1) !== adapt.scale) { e.scaleResolutionDownBy = adapt.scale; changed = true; }
  }
  return changed;
}

function tuneShareSender(sender) {
  const track = sender && sender.track;
  if (!track || !shareTracks.has(track) || !sender.getParameters) return;
  try {
    const p = sender.getParameters();
    if (!p.encodings || !p.encodings.length) return; // not negotiated yet
    if (liftShareParams(p, track)) realSetParameters.call(sender, p).catch(() => {});
  } catch (_) { /* closed or unsupported */ }
}

const senderProto = window.RTCRtpSender && RTCRtpSender.prototype;
const realSetParameters = senderProto && senderProto.setParameters;
if (realSetParameters) {
  // Discord adjusts the share's parameters too; keep our preference in them.
  senderProto.setParameters = function (params) {
    if (params && this.track && shareTracks.has(this.track)) liftShareParams(params, this.track);
    return realSetParameters.apply(this, arguments);
  };
  const realReplace = senderProto.replaceTrack;
  if (realReplace) senderProto.replaceTrack = function () {
    return realReplace.apply(this, arguments).then((r) => { tuneShareSender(this); return r; });
  };
}

const VIDEO_CODECS = /^(VP8|VP9|H264|H265|AV1)$/i;

/** Sets x-google-start/min-bitrate on every video codec in an SDP, and lifts
 *  Discord's x-google-max-bitrate (about 2.5 Mbps without Nitro) to what the
 *  picked quality needs (a higher existing max, e.g. from a plugin, is kept). */
function sharpStartSdp(sdp, kbps) {
  // The floor the bandwidth estimate may not sink below. A still screen sends almost
  // nothing, so the estimate decays; with a low floor the next burst of motion is
  // blurry until it climbs back. Half the start bitrate (at most 5 Mbps) keeps it
  // ready, and Discord's own maximum still applies on top.
  const min = Math.min(Math.round(kbps * 0.5), 5000);
  const maxWanted = shareMaxKbps(kbps);
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(eol);
  const out = [];
  let video = false, pts = new Set(), fmtpSeen = new Set();
  const setParams = (params) => {
    const parts = params.split(';').map((p) => p.trim()).filter(Boolean);
    const old = parts.find((p) => /^x-google-max-bitrate=/i.test(p));
    const max = Math.max(maxWanted, old ? Number(old.split('=')[1]) || 0 : 0);
    const kept = parts.filter((p) => !/^x-google-(start|min|max)-bitrate=/i.test(p));
    return [...kept, 'x-google-start-bitrate=' + kbps, 'x-google-min-bitrate=' + min, 'x-google-max-bitrate=' + max].join(';');
  };
  // Codecs without an fmtp line get one, right after the section's last line.
  const flush = () => {
    if (!video) return;
    for (const pt of pts) if (!fmtpSeen.has(pt)) out.push(`a=fmtp:${pt} x-google-start-bitrate=${kbps};x-google-min-bitrate=${min};x-google-max-bitrate=${maxWanted}`);
  };
  for (const line of lines) {
    if (line.startsWith('m=')) {
      flush();
      video = line.startsWith('m=video');
      pts = new Set(); fmtpSeen = new Set();
      out.push(line);
      continue;
    }
    if (video) {
      const rtp = /^a=rtpmap:(\d+) ([\w-]+)\//.exec(line);
      if (rtp && VIDEO_CODECS.test(rtp[2])) pts.add(rtp[1]);
      const fmtp = /^a=fmtp:(\d+) (.*)$/.exec(line);
      if (fmtp && pts.has(fmtp[1])) {
        fmtpSeen.add(fmtp[1]);
        out.push(`a=fmtp:${fmtp[1]} ${setParams(fmtp[2])}`);
        continue;
      }
    }
    out.push(line);
  }
  // Keep a trailing empty line (SDP ends with a line break) last.
  if (out.length && out[out.length - 1] === '') { out.pop(); flush(); out.push(''); } else flush();
  return out.join(eol);
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
  // The ring turns on fast (40 ms) and fades off a little slower (180 ms):
  // the "on" delay is gone, and the brief gaps in voice detection no longer
  // make it flicker. CSS uses the transition of the state being entered, so
  // the speaking classes carry the fast value and the base classes the slow.
  const all = [...ringClasses];
  const cls = (list) => list.flatMap((c) => ['.' + c, '.' + c + '::before', '.' + c + '::after']).join(',');
  const on = all.filter((c) => /speaking/i.test(c)), off = all.filter((c) => !/speaking/i.test(c));
  setCss(ringStyle,
    (off.length ? cls(off) + ' { transition-duration: 180ms !important; transition-delay: 0s !important; }\n' : '') +
    (on.length ? cls(on) + ' { transition-duration: 40ms !important; transition-delay: 0s !important; }' : ''));
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
