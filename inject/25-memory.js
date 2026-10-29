// ── Memory saver (page side) ─────────────────────────────────────────────────
// No autoplay: GIF-style clips and embedded videos stay paused (and don't
// decode) until you hover or click them. Live media is never touched: call
// video, Go Live streams and anything else backed by a MediaStream play as
// normal, and audio elements (Discord's sounds) aren't affected.

const allowed = new WeakSet();   // clicked: plays freely from now on
const hovering = new WeakSet();  // playing because the pointer is over it

function isLive(v) { return !!v.srcObject; }
function mayPlay(v) {
  if (!store.get('memory.noAutoplay') || isLive(v) || allowed.has(v) || hovering.has(v)) return true;
  // A click/keypress just happened (e.g. pressing a play button).
  return !!(navigator.userActivation && navigator.userActivation.isActive);
}

// Calls to play() that aren't allowed resolve quietly without decoding.
const realPlay = HTMLVideoElement.prototype.play;
HTMLVideoElement.prototype.play = function () {
  if (mayPlay(this)) {
    if (!hovering.has(this) && !isLive(this) && navigator.userActivation && navigator.userActivation.isActive) allowed.add(this);
    return realPlay.apply(this, arguments);
  }
  return Promise.resolve();
};

// The `autoplay` attribute starts media without calling play(); catch that too.
document.addEventListener('play', (e) => {
  const v = e.target;
  if (v instanceof HTMLVideoElement && !mayPlay(v)) v.pause();
}, true);

// Hover to play, leave to pause (unless it was clicked).
document.addEventListener('pointerover', (e) => {
  const v = e.target instanceof Element && e.target.closest('video');
  if (!v || isLive(v) || allowed.has(v) || !store.get('memory.noAutoplay')) return;
  if (v.paused && (v.autoplay || v.loop)) {
    hovering.add(v);
    realPlay.call(v).catch(() => {});
    const leave = () => {
      v.removeEventListener('pointerleave', leave);
      hovering.delete(v);
      if (!allowed.has(v)) v.pause();
    };
    v.addEventListener('pointerleave', leave);
  }
}, true);

// Clicking a video (or its controls) means "play this".
document.addEventListener('pointerdown', (e) => {
  const v = e.target instanceof Element && e.target.closest('video');
  if (v) allowed.add(v);
}, true);

// Called by the app after a few minutes in the tray, and again when it's back.
window.__driftcordTrim = (away) => {
  if (!away) return;
  // Stop anything decoding off-screen (live call media is left alone).
  for (const v of document.querySelectorAll('video')) {
    if (!isLive(v) && !v.paused) v.pause();
  }
};
