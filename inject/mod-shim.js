// Userscript APIs for Vencord / Equicord's web builds.
// Loaded right before the mod, only when a mod is enabled.
(function () {
  'use strict';
  window.unsafeWindow = window;

  const invoke = (cmd, args) => {
    const t = window.__TAURI_INTERNALS__;
    return t ? t.invoke(cmd, args) : Promise.reject(new Error('Driftcord bridge unavailable'));
  };

  const toB64 = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  async function encodeBody(data) {
    if (data == null) return null;
    if (typeof data === 'string') return toB64(new TextEncoder().encode(data));
    if (data instanceof ArrayBuffer) return toB64(new Uint8Array(data));
    if (ArrayBuffer.isView(data)) return toB64(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    if (data instanceof Blob) return toB64(new Uint8Array(await data.arrayBuffer()));
    if (data instanceof URLSearchParams) return toB64(new TextEncoder().encode(data.toString()));
    return toB64(new TextEncoder().encode(JSON.stringify(data)));
  }

  window.GM_xmlhttpRequest = function (opts) {
    let done = false;
    const finish = (fn, arg) => { if (!done) { done = true; fn && fn(arg); opts.onloadend && opts.onloadend(arg); } };
    let timer = 0;
    if (opts.timeout > 0) timer = setTimeout(() => finish(opts.ontimeout, { status: 0 }), opts.timeout);

    (async () => {
      const res = await invoke('mod_fetch', {
        req: {
          method: opts.method || 'GET',
          url: String(opts.url),
          headers: opts.headers || {},
          bodyB64: await encodeBody(opts.data),
        },
      });
      clearTimeout(timer);
      const bytes = fromB64(res.bodyB64);
      const type = (res.headers.match(/^content-type:\s*(.+)$/im) || [])[1] || '';
      let text;
      const getText = () => (text ??= new TextDecoder().decode(bytes));
      let response;
      switch (opts.responseType) {
        case 'arraybuffer': response = bytes.buffer; break;
        case 'blob': response = new Blob([bytes], { type }); break;
        case 'json': try { response = JSON.parse(getText()); } catch (_) { response = null; } break;
        default: response = getText();
      }
      finish(opts.onload, {
        readyState: 4,
        status: res.status,
        statusText: res.statusText,
        finalUrl: res.finalUrl,
        responseHeaders: res.headers,
        response,
        get responseText() { return getText(); },
      });
    })().catch((e) => {
      clearTimeout(timer);
      finish(opts.onerror, { status: 0, error: String(e && e.message || e) });
    });

    return { abort() { clearTimeout(timer); finish(opts.onabort, { status: 0 }); } };
  };
})();
