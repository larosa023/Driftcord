// ── Memory saver (page side) ─────────────────────────────────────────────────
// No autoplay: GIF-style clips and embedded videos stay paused (and don't
// decode) until you hover or click them. Live media is never touched: call
// video, Go Live streams and anything else backed by a MediaStream play as
// normal, and audio elements (Discord's sounds) aren't affected.

const allowed = new WeakSet();   // clicked: plays freely from now on
const hovering = new WeakSet();  // playing because the pointer is over it

let pressed = null; // { video, t }: a click or key press on/near this video

function isLive(v) { return !!v.srcObject; }
function mayPlay(v) {
  if (!store.get('memory.noAutoplay') || isLive(v) || allowed.has(v) || hovering.has(v)) return true;
  // You just pressed this video's play button (or the video itself).
  if (pressed && pressed.video === v && performance.now() - pressed.t < 1500) {
    allowed.add(v);
    return true;
  }
  return false;
}

/** The video a click/key press is aimed at: the element itself, or the one
 *  inside the nearest player wrapper (Discord's play buttons sit beside it). */
function videoNear(el) {
  for (let n = el, depth = 0; n && n.nodeType === 1 && depth < 6; n = n.parentElement, depth++) {
    if (n.tagName === 'VIDEO') return n;
    const v = n.querySelector && n.querySelector('video');
    if (v) return v;
  }
  return null;
}

// Calls to play() that aren't allowed resolve quietly without decoding.
const realPlay = HTMLVideoElement.prototype.play;
HTMLVideoElement.prototype.play = function () {
  return mayPlay(this) ? realPlay.apply(this, arguments) : Promise.resolve();
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

// Clicking a video or its play button (or pressing Enter/Space on it) means "play this".
document.addEventListener('pointerdown', (e) => {
  if (!(e.target instanceof Element) || !store.get('memory.noAutoplay')) return;
  const v = videoNear(e.target);
  if (!v) return;
  pressed = { video: v, t: performance.now() };
  if (hovering.has(v)) allowed.add(v); // clicked while hover-playing: keep playing
}, true);
document.addEventListener('keydown', (e) => {
  if ((e.key !== 'Enter' && e.key !== ' ') || !(e.target instanceof Element) || !store.get('memory.noAutoplay')) return;
  const v = videoNear(e.target);
  if (v) pressed = { video: v, t: performance.now() };
}, true);

// Called by the app after a few minutes in the tray, and again when it's back.
window.__driftcordTrim = (away) => {
  if (!away) return;
  // Stop anything decoding off-screen (live call media is left alone).
  for (const v of document.querySelectorAll('video')) {
    // Leave live media and anything you deliberately started alone.
    if (!isLive(v) && !allowed.has(v) && !v.paused) v.pause();
  }
};
