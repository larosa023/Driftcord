//! Optional client mods (Vencord / Equicord).
//!
//! Driftcord doesn't bundle either project. When the user turns one on, the
//! official web build (the same `.user.js` file browser users install) is
//! downloaded from that project's GitHub releases, cached, and injected at
//! document start on the next launch. A background refresh on every launch keeps
//! it current.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    net::IpAddr,
    path::PathBuf,
    sync::Once,
    time::{Duration, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, Url};

pub struct ModSource {
    pub id: &'static str,
    pub name: &'static str,
    pub url: &'static str,
}

pub const MODS: &[ModSource] = &[
    ModSource {
        id: "vencord",
        name: "Vencord",
        url: "https://github.com/Vendicated/Vencord/releases/latest/download/Vencord.user.js",
    },
    ModSource {
        id: "equicord",
        name: "Equicord",
        url: "https://github.com/Equicord/Equicord/releases/latest/download/Equicord.user.js",
    },
];

const MAX_MOD_BYTES: usize = 40 * 1024 * 1024;
const MAX_FETCH_BYTES: usize = 25 * 1024 * 1024;

pub fn find(id: &str) -> Option<&'static ModSource> {
    MODS.iter().find(|m| m.id == id)
}

fn cache_path(app: &AppHandle, id: &str) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("mods").join(format!("{id}.user.js")))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModStatus {
    pub id: &'static str,
    pub name: &'static str,
    pub installed: bool,
    pub size: u64,
    /// Seconds since the Unix epoch when the cached copy was last refreshed.
    pub updated: u64,
}

/// Seconds since a cached mod was refreshed (from `ModStatus::updated`).
pub fn age_secs(updated: u64) -> u64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs().saturating_sub(updated))
        .unwrap_or(u64::MAX)
}

pub fn status(app: &AppHandle) -> Vec<ModStatus> {
    MODS.iter()
        .map(|m| {
            let meta = cache_path(app, m.id).and_then(|p| fs::metadata(p).ok());
            ModStatus {
                id: m.id,
                name: m.name,
                installed: meta.is_some(),
                size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
                updated: meta
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0),
            }
        })
        .collect()
}

/// Userscript APIs the mods expect (`unsafeWindow`, `GM_xmlhttpRequest`),
/// implemented on top of Driftcord's `mod_fetch` command.
const SHIM: &str = include_str!("../../inject/mod-shim.js");

/// The init script for the enabled mod, if it's been downloaded.
///
/// The mod runs inside its own function scope, like a userscript manager does.
/// At the top level its `var Vencord` becomes a non-configurable property of
/// `window`, so the mod's own `Object.defineProperty(unsafeWindow, 'Vencord')`
/// throws and the rest of the script (including its stylesheet) never runs.
pub fn startup_script(app: &AppHandle, id: &str) -> Option<String> {
    let code = fs::read_to_string(cache_path(app, id)?).ok()?;
    Some(format!(
        // `code` must start the function body so its "use strict" directive still applies.
        "{SHIM}\n;(function () {{\n{code}\n}}).call(window);"
    ))
}

/// `public_only`: for requests on behalf of mods (GM_xmlhttpRequest), only
/// public addresses, checked at DNS time and without a proxy. Downloads of the
/// mods themselves come from GitHub and may use the system proxy.
fn client(public_only: bool) -> Result<reqwest::Client, String> {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
    let mut b = reqwest::Client::builder()
        .user_agent(concat!("Driftcord/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(90));
    if public_only {
        // Resolution must go through the check, not a proxy.
        b = b.dns_resolver(PublicOnlyResolver).no_proxy();
    }
    b.redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() > 8 || !is_public_url(attempt.url()) {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| e.to_string())
}

/// Download (or refresh) a mod into the cache. Returns the new size in bytes.
pub async fn download(app: &AppHandle, id: &str) -> Result<u64, String> {
    let src = find(id).ok_or("unknown mod")?;
    let res = client(false)?.get(src.url).send().await.map_err(|e| format!("download failed: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("download failed: HTTP {}", res.status()));
    }
    let bytes = res.bytes().await.map_err(|e| format!("download failed: {e}"))?;
    if bytes.len() > MAX_MOD_BYTES {
        return Err("download too large".into());
    }
    let text = std::str::from_utf8(&bytes).map_err(|_| "download wasn't a script")?;
    if !text.contains("==UserScript==") {
        return Err("download wasn't a userscript".into());
    }

    let path = cache_path(app, id).ok_or("no data directory")?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(bytes.len() as u64)
}

// ── GM_xmlhttpRequest backend ────────────────────────────────────────────────
// Mods use this for cross-origin requests that Discord's CSP would block.
// Only public http(s) hosts are reachable: no localhost or private networks.

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            !(v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_multicast()
                || o[0] == 0                                   // 0.0.0.0/8
                || o[0] == 100 && (64..128).contains(&o[1])    // carrier-grade NAT
                || o[0] == 192 && o[1] == 0 && o[2] == 0       // 192.0.0.0/24
                || o[0] == 198 && (o[1] == 18 || o[1] == 19)   // benchmarking
                || o[0] >= 240) // reserved
        }
        IpAddr::V6(v6) => {
            // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::/96) carry an IPv4 address.
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public_ip(IpAddr::V4(v4));
            }
            let seg = v6.segments();
            if seg[0] == 0x64 && seg[1] == 0xff9b {
                return false;
            }
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (seg[0] & 0xfe00) == 0xfc00 // unique local
                || (seg[0] & 0xffc0) == 0xfe80) // link local
        }
    }
}

/// Resolves hostnames and refuses any that point at a non-public address, so
/// names like `127.0.0.1.nip.io`, DNS rebinding and redirects to them can't
/// reach your PC or local network. Applies to every connection, including
/// redirects, because it runs at connect time.
struct PublicOnlyResolver;

impl reqwest::dns::Resolve for PublicOnlyResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let addrs = tauri::async_runtime::spawn_blocking(move || {
                use std::net::ToSocketAddrs;
                (host.as_str(), 0u16).to_socket_addrs().map(|it| it.collect::<Vec<_>>())
            })
            .await
            .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { e.to_string().into() })??;
            let public: Vec<std::net::SocketAddr> = addrs.into_iter().filter(|a| is_public_ip(a.ip())).collect();
            if public.is_empty() {
                return Err("blocked: host doesn't resolve to a public address".into());
            }
            Ok(Box::new(public.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

fn is_public_url(url: &Url) -> bool {
    if !matches!(url.scheme(), "https" | "http") {
        return false;
    }
    match url.host() {
        Some(url::Host::Domain(d)) => {
            let d = d.trim_end_matches('.').to_ascii_lowercase();
            !(d == "localhost" || d.ends_with(".localhost") || d.ends_with(".local") || d.ends_with(".internal"))
        }
        Some(url::Host::Ipv4(ip)) => is_public_ip(IpAddr::V4(ip)),
        Some(url::Host::Ipv6(ip)) => is_public_ip(IpAddr::V6(ip)),
        None => false,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchRequest {
    method: Option<String>,
    url: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    body_b64: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchResponse {
    status: u16,
    status_text: String,
    final_url: String,
    headers: String,
    body_b64: String,
}

pub async fn fetch(req: FetchRequest) -> Result<FetchResponse, String> {
    let url: Url = req.url.parse().map_err(|_| "invalid url")?;
    if !is_public_url(&url) {
        return Err("blocked: only public http(s) addresses are allowed".into());
    }
    let method = reqwest::Method::from_bytes(req.method.as_deref().unwrap_or("GET").to_ascii_uppercase().as_bytes())
        .map_err(|_| "invalid method")?;

    let mut rb = client(true)?.request(method, url.as_str());
    for (k, v) in &req.headers {
        let lk = k.to_ascii_lowercase();
        // Never forward Discord session headers to third parties.
        if lk == "authorization" || lk == "cookie" || lk == "host" {
            continue;
        }
        rb = rb.header(k, v);
    }
    if let Some(b) = req.body_b64 {
        rb = rb.body(B64.decode(b).map_err(|_| "invalid body")?);
    }

    let res = rb.send().await.map_err(|e| e.to_string())?;
    if res.content_length().unwrap_or(0) as usize > MAX_FETCH_BYTES {
        return Err("response too large".into());
    }
    let status = res.status();
    let final_url = res.url().to_string();
    let headers = res
        .headers()
        .iter()
        .map(|(k, v)| format!("{}: {}", k, v.to_str().unwrap_or("")))
        .collect::<Vec<_>>()
        .join("\r\n");
    let mut res = res;
    let mut body: Vec<u8> = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        if body.len() + chunk.len() > MAX_FETCH_BYTES {
            return Err("response too large".into());
        }
        body.extend_from_slice(&chunk);
    }

    Ok(FetchResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        final_url,
        headers,
        body_b64: B64.encode(&body),
    })
}
