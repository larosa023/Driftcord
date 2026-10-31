// ── Updates ──────────────────────────────────────────────────────────────────
// Driftcord checks its GitHub releases for a newer signed build. Installing
// downloads it, runs the installer quietly and restarts the app.

let updateToast = null;
let pendingUpdate = null;   // an update found but not installed yet
let lastUpdateCheck = 0;

/** Returns the update info, `null` when up to date, or `undefined` on error. */
async function checkForUpdates(manual = false) {
  if (!bridge.available()) {
    if (manual) toast('Updates work in the installed Driftcord app');
    return undefined;
  }
  try {
    lastUpdateCheck = Date.now();
    const u = await bridge.invoke('check_update');
    pendingUpdate = u || null;
    if (u) offerUpdate(u);
    else if (manual) toast('You\'re on the latest version', { sub: 'Driftcord ' + VERSION, duration: 3500 });
    return u || null;
  } catch (e) {
    if (manual) toast('Couldn\'t check for updates', { sub: errText(e) });
    return undefined;
  }
}

function offerUpdate(u) {
  if (updateToast) updateToast.close();
  updateToast = toast(`Driftcord ${u.version} is available`, {
    sub: 'Takes a few seconds. Discord will reopen right where you were.',
    duration: 0,
    actions: [
      { label: 'Update & restart', primary: true, keepOpen: true, run: installUpdate },
      { label: 'Later', run: () => { updateToast = null; } },
    ],
  });
}

async function installUpdate(el) {
  if (el) el.querySelectorAll('button').forEach((b) => (b.disabled = true));
  if (updateToast) updateToast.update('Downloading update…', 'Driftcord will restart when it\'s ready.');
  try {
    await bridge.invoke('install_update'); // restarts the app on success
  } catch (e) {
    if (updateToast) updateToast.close();
    updateToast = null;
    toast('Update failed', { sub: errText(e) });
  }
}

function startUpdateChecks() {
  if (!bridge.available()) return;
  const tick = () => { if (store.get('updates.auto')) checkForUpdates(false); };
  setTimeout(tick, 15000);                   // shortly after launch
  setInterval(tick, 3 * 60 * 60 * 1000);     // then every 3 hours
  // Back from a long sleep or a day in the tray: look right away.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastUpdateCheck > 60 * 60 * 1000) tick();
  });
}
