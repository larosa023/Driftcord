// ── Privacy: drop telemetry before it leaves the app ─────────────────────────
// Requests that match are answered locally with an empty 204, so Discord thinks
// they succeeded and doesn't retry.

const BLOCK_RULES = [
  { setting: 'privacy.telemetry',    test: (u) => /\/api\/v\d+\/(science|metrics|track)\b/.test(u) },
  { setting: 'privacy.crashReports', test: (u) => /sentry\.io|\/error-reporting-proxy\//.test(u) },
  { setting: 'privacy.silentTyping', test: (u, m) => m === 'POST' && /\/api\/v\d+\/channels\/\d+\/typing\b/.test(u) },
];

function shouldBlock(url, method = 'GET') {
  const u = String(url);
  return BLOCK_RULES.some((r) => store.get(r.setting) && r.test(u, method.toUpperCase()));
}

// fetch
const realFetch = window.fetch;
window.fetch = function (input, init) {
  const url = typeof input === 'string' ? input : input && input.url;
  const method = (init && init.method) || (input && input.method) || 'GET';
  if (shouldBlock(url, method)) return Promise.resolve(new Response(null, { status: 204 }));
  return realFetch.apply(this, arguments);
};

// XMLHttpRequest (Discord's API client uses this)
const XHR = XMLHttpRequest.prototype;
const realOpen = XHR.open;
const realSend = XHR.send;

XHR.open = function (method, url) {
  this.__driftBlocked = shouldBlock(url, method);
  return realOpen.apply(this, arguments);
};

XHR.send = function () {
  if (!this.__driftBlocked) return realSend.apply(this, arguments);
  // Fake a successful, empty response.
  const fake = { readyState: 4, status: 204, statusText: 'No Content', responseText: '', response: '' };
  for (const [k, v] of Object.entries(fake)) Object.defineProperty(this, k, { value: v, configurable: true });
  setTimeout(() => {
    // dispatchEvent also runs onreadystatechange/onload/onloadend handlers.
    for (const type of ['readystatechange', 'load', 'loadend']) this.dispatchEvent(new ProgressEvent(type));
  }, 0);
};

// navigator.sendBeacon (used for some analytics on page unload)
if (navigator.sendBeacon) {
  const realBeacon = navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon = (url, body) => (shouldBlock(url, 'POST') ? true : realBeacon(url, body));
}
