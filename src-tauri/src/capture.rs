//! Native screen share.
//!
//! WebView2's `getDisplayMedia` always opens the browser engine's own picker
//! window, and WebView2 offers no way to replace it. So Driftcord captures
//! natively instead:
//!
//! * **Video**: Windows Graphics Capture (the same API the Xbox Game Bar and
//!   OBS use), throttled to the chosen frame rate at the source.
//! * **Audio**: WASAPI process loopback. Sharing a window captures that app's
//!   audio; sharing a screen captures everything *except* Driftcord, so people
//!   never hear their own voices echoed back.
//! * **Hand-off**: frames go to the page through WebView2 shared memory
//!   buffers (no encoding, no IPC copies). The page turns them into a normal
//!   `MediaStream` that Discord streams like any other.
//!
//! Thumbnails for the picker come from GDI (`PrintWindow` / `StretchBlt`),
//! which is fast and doesn't flash the yellow capture border.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    /// "screen" or "window"
    pub kind: &'static str,
    pub name: String,
    pub detail: String,
    pub width: u32,
    pub height: u32,
    pub primary: bool,
    /// JPEG data URL, if a thumbnail could be made.
    pub thumb: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(windows), allow(dead_code))]
pub struct StartRequest {
    pub source: String,
    pub max_width: u32,
    pub max_height: u32,
    pub fps: u32,
    pub audio: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartInfo {
    pub audio: bool,
}

#[cfg(windows)]
pub use win::*;

#[cfg(not(windows))]
mod other {
    use super::*;

    #[derive(Default)]
    pub struct CaptureState;

    pub fn supported() -> bool {
        false
    }
    pub fn list_sources(_thumbs: bool) -> Result<Vec<Source>, String> {
        Err("Native screen share is only available on Windows".into())
    }
    pub fn start(_: &CaptureState, _: tauri::WebviewWindow, _: StartRequest) -> Result<StartInfo, String> {
        Err("Native screen share is only available on Windows".into())
    }
    pub fn stop(_: &CaptureState) {}
    pub fn ack(_: &CaptureState, _: &[(u32, u64)]) {}
    pub fn remember_listed(_: &CaptureState, _: &[Source]) {}
}
#[cfg(not(windows))]
pub use other::*;

#[cfg(windows)]
mod win {
    use super::*;
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    use std::{
        cell::RefCell,
        collections::{HashMap, HashSet, VecDeque},
        sync::{
            atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
            mpsc, Arc, Mutex,
        },
        time::{Duration, Instant},
    };
    use tauri::WebviewWindow;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment12, ICoreWebView2SharedBuffer, ICoreWebView2_17,
        COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_ONLY,
    };
    use windows::{
        core::{Interface, HSTRING, PCWSTR},
        Win32::{
            Foundation::{HWND, RECT},
            Graphics::{
                Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED},
                Gdi::{
                    CreateCompatibleBitmap, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC,
                    GetMonitorInfoW, ReleaseDC, SelectObject, SetStretchBltMode, StretchBlt, BITMAPINFO,
                    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HALFTONE, HDC, HGDIOBJ, HMONITOR, MONITORINFO,
                    SRCCOPY,
                },
            },
            Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS},
            UI::WindowsAndMessaging::{GetWindowRect, IsHungAppWindow, IsIconic},
        },
    };
    use windows_capture::{
        capture::{CaptureControl, Context, GraphicsCaptureApiHandler},
        frame::Frame,
        graphics_capture_api::{GraphicsCaptureApi, InternalCaptureControl},
        monitor::Monitor,
        settings::{
            ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
            MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
        },
        window::Window,
    };

    type BoxErr = Box<dyn std::error::Error + Send + Sync>;

    pub fn supported() -> bool {
        GraphicsCaptureApi::is_supported().unwrap_or(false)
    }

    // ── Sources ──────────────────────────────────────────────────────────────

    const THUMB_W: i32 = 384;
    const THUMB_H: i32 = 216;

    fn rect_of_monitor(hmon: HMONITOR) -> Option<RECT> {
        let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        unsafe { GetMonitorInfoW(hmon, &mut mi) }.as_bool().then_some(mi.rcMonitor)
    }

    fn is_cloaked(hwnd: HWND) -> bool {
        let mut cloaked: u32 = 0;
        unsafe {
            DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut _, 4).is_ok() && cloaked != 0
        }
    }

    /// Scale (sw, sh) to fit inside the thumbnail box, keeping aspect ratio.
    fn fit(sw: i32, sh: i32) -> (i32, i32) {
        let s = (THUMB_W as f64 / sw as f64).min(THUMB_H as f64 / sh as f64).min(1.0);
        (((sw as f64 * s).round() as i32).max(1), ((sh as f64 * s).round() as i32).max(1))
    }

    /// Draws `src` (via `draw`) into a small DIB and returns it as a JPEG data URL.
    unsafe fn thumb_from<F: FnOnce(HDC, i32, i32) -> bool>(sw: i32, sh: i32, draw: F) -> Option<String> {
        unsafe {
            let (tw, th) = fit(sw, sh);
            let screen = GetDC(None);
            let dc = CreateCompatibleDC(Some(screen));
            let bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: tw,
                    biHeight: -th, // top-down
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
            let result = match CreateDIBSection(Some(dc), &bmi, DIB_RGB_COLORS, &mut bits, None, 0) {
                Ok(dib) => {
                    let old = SelectObject(dc, HGDIOBJ(dib.0));
                    SetStretchBltMode(dc, HALFTONE);
                    let ok = draw(dc, tw, th);
                    let out = if ok && !bits.is_null() {
                        let px = std::slice::from_raw_parts(bits as *const u8, (tw * th * 4) as usize);
                        let mut jpg = Vec::with_capacity(24 * 1024);
                        jpeg_encoder::Encoder::new(&mut jpg, 72)
                            .encode(px, tw as u16, th as u16, jpeg_encoder::ColorType::Bgra)
                            .ok()
                            .map(|_| format!("data:image/jpeg;base64,{}", B64.encode(&jpg)))
                    } else {
                        None
                    };
                    SelectObject(dc, old);
                    let _ = DeleteObject(HGDIOBJ(dib.0));
                    out
                }
                Err(_) => None,
            };
            let _ = DeleteDC(dc);
            ReleaseDC(None, screen);
            result
        }
    }

    fn monitor_thumb(r: RECT) -> Option<String> {
        let (w, h) = (r.right - r.left, r.bottom - r.top);
        if w <= 0 || h <= 0 {
            return None;
        }
        unsafe {
            thumb_from(w, h, |dc, tw, th| {
                let screen = GetDC(None);
                let ok = StretchBlt(dc, 0, 0, tw, th, Some(screen), r.left, r.top, w, h, SRCCOPY).as_bool();
                ReleaseDC(None, screen);
                ok
            })
        }
    }

    fn window_thumb(hwnd: HWND, w: i32, h: i32) -> Option<String> {
        unsafe {
            // Render the full window (including GPU-drawn content) off-screen first.
            let screen = GetDC(None);
            let full_dc = CreateCompatibleDC(Some(screen));
            let full = CreateCompatibleBitmap(screen, w, h);
            let old = SelectObject(full_dc, HGDIOBJ(full.0));
            const PW_RENDERFULLCONTENT: PRINT_WINDOW_FLAGS = PRINT_WINDOW_FLAGS(2);
            let printed = PrintWindow(hwnd, full_dc, PW_RENDERFULLCONTENT).as_bool();
            let out = if printed {
                thumb_from(w, h, |dc, tw, th| {
                    StretchBlt(dc, 0, 0, tw, th, Some(full_dc), 0, 0, w, h, SRCCOPY).as_bool()
                })
            } else {
                None
            };
            SelectObject(full_dc, old);
            let _ = DeleteObject(HGDIOBJ(full.0));
            let _ = DeleteDC(full_dc);
            ReleaseDC(None, screen);
            out
        }
    }

    fn pretty_process(name: &str) -> String {
        let base = name.strip_suffix(".exe").or_else(|| name.strip_suffix(".EXE")).unwrap_or(name);
        let mut c = base.chars();
        match c.next() {
            Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
            None => String::new(),
        }
    }

    pub fn list_sources(thumbs: bool) -> Result<Vec<Source>, String> {
        let mut out = Vec::new();

        let primary = Monitor::primary().ok().map(|m| m.as_raw_hmonitor() as usize);
        let monitors = Monitor::enumerate().map_err(|e| e.to_string())?;
        for (i, m) in monitors.iter().enumerate() {
            let raw = m.as_raw_hmonitor() as usize;
            let Some(r) = rect_of_monitor(HMONITOR(m.as_raw_hmonitor())) else { continue };
            let (w, h) = ((r.right - r.left) as u32, (r.bottom - r.top) as u32);
            let model = m.device_string().unwrap_or_default();
            out.push(Source {
                id: format!("screen:{raw}"),
                kind: "screen",
                name: if monitors.len() == 1 { "Entire screen".into() } else { format!("Screen {}", i + 1) },
                detail: if model.is_empty() { format!("{w}×{h}") } else { format!("{w}×{h} · {model}") },
                width: w,
                height: h,
                primary: primary == Some(raw),
                thumb: if thumbs { monitor_thumb(r) } else { None },
            });
        }

        let me = std::process::id();
        let mut minimized = Vec::new();
        for win in Window::enumerate().map_err(|e| e.to_string())? {
            let hwnd = HWND(win.as_raw_hwnd());
            let title = win.title().unwrap_or_default();
            if title.trim().is_empty() || win.process_id().ok() == Some(me) || is_cloaked(hwnd) {
                continue;
            }
            let mut r = RECT::default();
            if unsafe { GetWindowRect(hwnd, &mut r) }.is_err() {
                continue;
            }
            let (w, h) = (r.right - r.left, r.bottom - r.top);
            let iconic = unsafe { IsIconic(hwnd) }.as_bool();
            // A frozen app would block PrintWindow; list it without a preview.
            let hung = unsafe { IsHungAppWindow(hwnd) }.as_bool();
            if !iconic && (w < 120 || h < 80) {
                continue;
            }
            let src = Source {
                id: format!("window:{}", hwnd.0 as usize),
                kind: "window",
                name: title,
                detail: pretty_process(&win.process_name().unwrap_or_default()),
                width: w.max(0) as u32,
                height: h.max(0) as u32,
                primary: false,
                thumb: if thumbs && !iconic && !hung { window_thumb(hwnd, w, h) } else { None },
            };
            // Minimized windows can be shared but show up last (no preview).
            if iconic { minimized.push(src) } else { out.push(src) }
        }
        out.extend(minimized);
        Ok(out)
    }

    // ── Shared buffers ───────────────────────────────────────────────────────
    // A small ring of WebView2 shared buffers per stream. The capture thread
    // writes straight into one, the UI thread posts it to the page, and the
    // page acks (id + sequence number) once it has copied the data out. If
    // every slot is still in use the frame is dropped: natural backpressure
    // instead of a growing queue.
    //
    // Buffers are keyed by session, so stopping one share can never close the
    // buffers of the share that replaced it.

    thread_local! {
        // Only touched on the UI thread (inside `with_webview`).
        static BUFFERS: RefCell<HashMap<(u64, u32), ICoreWebView2SharedBuffer>> = RefCell::new(HashMap::new());
    }

    static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

    const VIDEO_SLOTS: u32 = 4;
    const AUDIO_SLOTS: u32 = 8;
    const AUDIO_BASE: u32 = 100;
    /// Slots the page never acked are reclaimed after this long.
    const STALE_MS: u64 = 1000;

    struct Slot {
        id: u32,
        busy: AtomicBool,
        busy_since: AtomicU64,
        /// Bumped on every acquire; acks must match it (a late ack for an
        /// earlier use of this slot is ignored).
        seq: AtomicU64,
        ptr: AtomicUsize,
        cap: AtomicUsize,
    }

    struct Ring {
        slots: Vec<Slot>,
    }

    impl Ring {
        fn new(base: u32, n: u32) -> Self {
            Self {
                slots: (0..n)
                    .map(|i| Slot {
                        id: base + i,
                        busy: AtomicBool::new(false),
                        busy_since: AtomicU64::new(0),
                        seq: AtomicU64::new(0),
                        ptr: AtomicUsize::new(0),
                        cap: AtomicUsize::new(0),
                    })
                    .collect(),
            }
        }

        fn find(&self, id: u32) -> Option<&Slot> {
            self.slots.iter().find(|s| s.id == id)
        }

        /// A free slot and its new sequence number.
        fn acquire(&self, now_ms: u64) -> Option<(&Slot, u64)> {
            for s in &self.slots {
                let busy = s.busy.load(Ordering::Acquire);
                let stale = busy && now_ms.saturating_sub(s.busy_since.load(Ordering::Relaxed)) > STALE_MS;
                if (!busy || stale) && s.busy.compare_exchange(busy, true, Ordering::AcqRel, Ordering::Relaxed).is_ok() {
                    s.busy_since.store(now_ms, Ordering::Relaxed);
                    let seq = s.seq.fetch_add(1, Ordering::AcqRel) + 1;
                    return Some((s, seq));
                }
            }
            None
        }
    }

    struct Shared {
        session: u64,
        window: WebviewWindow,
        stop: AtomicBool,
        started: Instant,
        video: Ring,
        audio: Ring,
        max_w: u32,
        max_h: u32,
        interval: Duration,
    }

    impl Shared {
        fn now_ms(&self) -> u64 {
            self.started.elapsed().as_millis() as u64
        }

        /// Make sure `slot` has room for `need` bytes; returns the write pointer.
        fn ensure(&self, slot: &Slot, need: usize) -> Option<*mut u8> {
            if slot.cap.load(Ordering::Relaxed) >= need {
                return Some(slot.ptr.load(Ordering::Relaxed) as *mut u8);
            }
            // Round up so small size changes (window resizes) don't reallocate.
            let size = need.next_multiple_of(1 << 20);
            let key = (self.session, slot.id);
            let (tx, rx) = mpsc::channel();
            self.window
                .with_webview(move |pv| {
                    let r = unsafe {
                        (|| -> windows::core::Result<usize> {
                            let env: ICoreWebView2Environment12 = pv.environment().cast()?;
                            let buf = env.CreateSharedBuffer(size as u64)?;
                            let mut p: *mut u8 = std::ptr::null_mut();
                            buf.Buffer(&mut p)?;
                            BUFFERS.with(|b| {
                                if let Some(old) = b.borrow_mut().insert(key, buf) {
                                    let _ = old.Close();
                                }
                            });
                            Ok(p as usize)
                        })()
                    };
                    let _ = tx.send(r.ok());
                })
                .ok()?;
            let p = rx.recv_timeout(Duration::from_secs(2)).ok()??;
            slot.ptr.store(p, Ordering::Relaxed);
            slot.cap.store(size, Ordering::Relaxed);
            Some(p as *mut u8)
        }

        /// Hand a filled slot to the page.
        fn post(self: &Arc<Self>, slot_id: u32, json: String) {
            let me = self.clone();
            let key = (self.session, slot_id);
            let res = self.window.with_webview(move |pv| {
                let ok = !me.stop.load(Ordering::Relaxed)
                    && unsafe {
                        (|| -> windows::core::Result<()> {
                            let core: ICoreWebView2_17 = pv.controller().CoreWebView2()?.cast()?;
                            let meta = HSTRING::from(json);
                            BUFFERS.with(|b| match b.borrow().get(&key) {
                                Some(buf) => core.PostSharedBufferToScript(
                                    buf,
                                    COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_ONLY,
                                    PCWSTR(meta.as_ptr()),
                                ),
                                None => Err(windows::core::Error::from_hresult(windows::Win32::Foundation::E_FAIL)),
                            })
                        })()
                        .is_ok()
                    };
                if !ok {
                    me.release_now(slot_id);
                }
            });
            if res.is_err() {
                self.release_now(slot_id);
            }
        }

        fn release_now(&self, id: u32) {
            if let Some(s) = self.video.find(id).or_else(|| self.audio.find(id)) {
                s.busy.store(false, Ordering::Release);
            }
        }

        /// Page acked slot `id` for use `seq`.
        fn ack(&self, id: u32, seq: u64) {
            if let Some(s) = self.video.find(id).or_else(|| self.audio.find(id)) {
                if s.seq.load(Ordering::Acquire) == seq {
                    s.busy.store(false, Ordering::Release);
                }
            }
        }

        /// Capture ended on its own (window closed, error): tell the page once.
        fn end_from_capture(&self, reason: &str) {
            if !self.stop.swap(true, Ordering::Relaxed) {
                let js = format!(
                    "window.__driftcordCaptureEnded && window.__driftcordCaptureEnded({})",
                    serde_json::to_string(reason).unwrap_or_else(|_| "null".into())
                );
                let _ = self.window.eval(js);
                set_indicator(&self.window, false);
            }
        }

        fn warn(&self, message: &str) {
            let js = format!(
                "window.__driftcordCaptureWarning && window.__driftcordCaptureWarning({})",
                serde_json::to_string(message).unwrap_or_else(|_| "null".into())
            );
            let _ = self.window.eval(js);
        }
    }

    /// Native "you're sharing" indicator: the tray icon tooltip.
    fn set_indicator(window: &WebviewWindow, sharing: bool) {
        use tauri::Manager;
        if let Some(tray) = window.app_handle().tray_by_id("driftcord-tray") {
            let _ = tray.set_tooltip(Some(if sharing { "Driftcord · sharing your screen" } else { "Driftcord" }));
        }
    }

    // ── Video ────────────────────────────────────────────────────────────────

    struct Video {
        shared: Arc<Shared>,
        /// When the next frame is due. Frames are taken on an even cadence
        /// (not "at least N ms since the last one"), so a 144 Hz screen shared
        /// at 60 fps doesn't judder between 48 and 72 fps.
        next_due: Option<Instant>,
        /// Reused intermediate buffer for two-step scaling.
        scratch: Vec<u8>,
        /// Bilinear lookup tables, rebuilt when sizes change.
        xmap: Vec<(u32, u32)>,
        xmap_key: (usize, usize),
    }

    /// Box-filter downscale of BGRA rows by an integer factor `k`.
    unsafe fn box_down(src: &[u8], pitch: usize, w: usize, h: usize, k: usize, dst: *mut u8, dst_stride: usize) {
        let (ow, oh) = (w / k, h / k);
        let area = (k * k) as u32;
        for oy in 0..oh {
            let drow = unsafe { dst.add(oy * dst_stride) };
            for ox in 0..ow {
                let (mut b, mut g, mut r) = (0u32, 0u32, 0u32);
                for dy in 0..k {
                    let row = (oy * k + dy) * pitch + ox * k * 4;
                    for dx in 0..k {
                        let i = row + dx * 4;
                        b += src[i] as u32;
                        g += src[i + 1] as u32;
                        r += src[i + 2] as u32;
                    }
                }
                unsafe {
                    let px = drow.add(ox * 4);
                    *px = (b / area) as u8;
                    *px.add(1) = (g / area) as u8;
                    *px.add(2) = (r / area) as u8;
                    *px.add(3) = 255;
                }
            }
        }
    }

    /// Bilinear resample of BGRA (for scale factors under 2×, where a box
    /// filter can't be used). `xmap` holds (source x, 8-bit weight) per column.
    unsafe fn bilinear(src: &[u8], pitch: usize, h: usize, xmap: &[(u32, u32)], ow: usize, oh: usize, dst: *mut u8) {
        let sy_step = h as f64 / oh as f64;
        for oy in 0..oh {
            let fy = ((oy as f64 + 0.5) * sy_step - 0.5).max(0.0);
            let y0 = (fy as usize).min(h - 1);
            let y1 = (y0 + 1).min(h - 1);
            let wy = ((fy - y0 as f64) * 256.0) as u32;
            let (r0, r1) = (y0 * pitch, y1 * pitch);
            let drow = unsafe { dst.add(oy * ow * 4) };
            for (ox, &(x0, wx)) in xmap.iter().enumerate().take(ow) {
                let a = r0 + x0 as usize * 4;
                let c = r1 + x0 as usize * 4;
                for ch in 0..3 {
                    let top = src[a + ch] as u32 * (256 - wx) + src[a + 4 + ch] as u32 * wx;
                    let bot = src[c + ch] as u32 * (256 - wx) + src[c + 4 + ch] as u32 * wx;
                    unsafe { *drow.add(ox * 4 + ch) = ((top * (256 - wy) + bot * wy) >> 16) as u8 };
                }
                unsafe { *drow.add(ox * 4 + 3) = 255 };
            }
        }
    }

    impl Video {
        fn frame(&mut self, frame: &mut Frame) -> Result<(), BoxErr> {
            let sh = self.shared.clone();
            // Frame-rate cap with even pacing: take a frame if it's within a
            // third of a frame of when one is due, then schedule the next one a
            // whole interval later (catching up if we fell behind). Tuned so
            // 60/120/240 Hz screens give perfectly even frames and 144/165 Hz
            // ones still hit the target rate.
            let now = Instant::now();
            let tolerance = sh.interval / 3;
            if let Some(due) = self.next_due {
                if now + tolerance < due {
                    return Ok(());
                }
            }
            let Some((slot, seq)) = sh.video.acquire(sh.now_ms()) else { return Ok(()) };
            let result = self.fill(frame, slot, seq, &sh);
            if result.is_err() {
                sh.release_now(slot.id);
            } else {
                self.next_due = Some(match self.next_due {
                    Some(due) if now < due + sh.interval => due + sh.interval,
                    _ => now + sh.interval,
                });
            }
            result
        }

        fn fill(&mut self, frame: &mut Frame, slot: &Slot, seq: u64, sh: &Arc<Shared>) -> Result<(), BoxErr> {
            let mut fb = frame.buffer()?;
            let (w, h, pitch) = (fb.width() as usize, fb.height() as usize, fb.row_pitch() as usize);
            if w < 2 || h < 2 {
                sh.release_now(slot.id);
                return Ok(());
            }
            let ratio = (w as f64 / sh.max_w.max(1) as f64).max(h as f64 / sh.max_h.max(1) as f64);
            let (ow, oh) = if ratio > 1.02 {
                (((w as f64 / ratio) as usize).max(2) & !1, ((h as f64 / ratio) as usize).max(2) & !1)
            } else {
                (w, h)
            };
            let stride = if (ow, oh) == (w, h) { pitch } else { ow * 4 };
            let need = stride * oh;
            let Some(dst) = sh.ensure(slot, need) else {
                sh.release_now(slot.id);
                return Ok(());
            };
            let src = fb.as_raw_buffer();
            if src.len() < pitch * (h - 1) + w * 4 {
                return Err("short frame buffer".into());
            }
            unsafe {
                if (ow, oh) == (w, h) {
                    std::ptr::copy_nonoverlapping(src.as_ptr(), dst, need.min(src.len()));
                } else {
                    let k = ratio.floor() as usize;
                    // Exact integer factor: box filter straight into the slot.
                    if k >= 2 && w / k == ow && h / k == oh {
                        box_down(src, pitch, w, h, k, dst, ow * 4);
                    } else {
                        // Box down by the integer part first (if any), then bilinear the rest.
                        let (sw, shh, spitch, sbuf): (usize, usize, usize, &[u8]) = if k >= 2 {
                            let (iw, ih) = (w / k, h / k);
                            self.scratch.resize(iw * ih * 4, 0);
                            box_down(src, pitch, w, h, k, self.scratch.as_mut_ptr(), iw * 4);
                            (iw, ih, iw * 4, &self.scratch[..])
                        } else {
                            (w, h, pitch, src)
                        };
                        if self.xmap_key != (sw, ow) {
                            let step = sw as f64 / ow as f64;
                            self.xmap = (0..ow)
                                .map(|ox| {
                                    let fx = ((ox as f64 + 0.5) * step - 0.5).clamp(0.0, (sw - 2) as f64);
                                    (fx as u32, ((fx - fx.floor()) * 256.0) as u32)
                                })
                                .collect();
                            self.xmap_key = (sw, ow);
                        }
                        bilinear(sbuf, spitch, shh, &self.xmap, ow, oh, dst);
                    }
                }
            }
            let t = sh.started.elapsed().as_micros() as u64;
            let json = format!(r#"{{"k":"v","id":{},"seq":{seq},"w":{ow},"h":{oh},"stride":{stride},"t":{t}}}"#, slot.id);
            sh.post(slot.id, json);
            Ok(())
        }
    }

    impl GraphicsCaptureApiHandler for Video {
        type Flags = Arc<Shared>;
        type Error = BoxErr;

        fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
            Ok(Self { shared: ctx.flags, next_due: None, scratch: Vec::new(), xmap: Vec::new(), xmap_key: (0, 0) })
        }

        fn on_frame_arrived(&mut self, frame: &mut Frame, control: InternalCaptureControl) -> Result<(), Self::Error> {
            if self.shared.stop.load(Ordering::Relaxed) {
                control.stop();
                return Ok(());
            }
            if let Err(e) = self.frame(frame) {
                // Capture can't continue: end the stream cleanly instead of freezing it.
                self.shared.end_from_capture(&format!("Screen capture stopped: {e}"));
                control.stop();
            }
            Ok(())
        }

        fn on_closed(&mut self) -> Result<(), Self::Error> {
            self.shared.end_from_capture("The shared window was closed.");
            Ok(())
        }
    }

    // ── Audio ────────────────────────────────────────────────────────────────

    const RATE: u64 = 48_000;
    const CHUNK_FRAMES: usize = 960; // 20 ms
    const BYTES_PER_FRAME: usize = 8; // f32 stereo

    fn audio_loop(sh: Arc<Shared>, pid: u32, include_tree: bool) -> Result<(), BoxErr> {
        use wasapi::*;
        let _ = initialize_mta();
        let format = WaveFormat::new(32, 32, &SampleType::Float, RATE as usize, 2, None);
        let mut client = AudioClient::new_application_loopback_client(pid, include_tree)?;
        client.initialize_client(
            &format,
            &Direction::Capture,
            &StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: 0 },
        )?;
        let event = client.set_get_eventhandle()?;
        let capture = client.get_audiocaptureclient()?;
        client.start_stream()?;

        let chunk = CHUNK_FRAMES * BYTES_PER_FRAME;
        let mut queue: VecDeque<u8> = VecDeque::with_capacity(chunk * 8);
        let mut sent_frames: u64 = 0;
        let started = sh.started.elapsed();

        let result = (|| -> Result<(), BoxErr> {
            while !sh.stop.load(Ordering::Relaxed) {
                if event.wait_for_event(250).is_err() {
                    continue; // nothing playing
                }
                capture.read_from_device_to_deque(&mut queue)?;
                // Don't let a stalled page build up a backlog.
                if queue.len() > chunk * 50 {
                    let excess = queue.len() - chunk * 5;
                    queue.drain(..excess - excess % chunk);
                }
                while queue.len() >= chunk {
                    let t = started.as_micros() as u64 + sent_frames * 1_000_000 / RATE;
                    sent_frames += CHUNK_FRAMES as u64;
                    let Some((slot, seq)) = sh.audio.acquire(sh.now_ms()) else {
                        queue.drain(..chunk);
                        continue;
                    };
                    let Some(dst) = sh.ensure(slot, chunk) else {
                        sh.release_now(slot.id);
                        queue.drain(..chunk);
                        continue;
                    };
                    let (a, b) = queue.as_slices();
                    unsafe {
                        let first = a.len().min(chunk);
                        std::ptr::copy_nonoverlapping(a.as_ptr(), dst, first);
                        if first < chunk {
                            std::ptr::copy_nonoverlapping(b.as_ptr(), dst.add(first), chunk - first);
                        }
                    }
                    queue.drain(..chunk);
                    let json = format!(r#"{{"k":"a","id":{},"seq":{seq},"n":{CHUNK_FRAMES},"t":{t}}}"#, slot.id);
                    sh.post(slot.id, json);
                }
            }
            Ok(())
        })();
        let _ = client.stop_stream();
        result
    }

    // ── Session control ──────────────────────────────────────────────────────
    // Every start and stop holds `op` for its whole duration, so they can
    // never interleave (a late stop can't touch a newer share).

    struct Session {
        shared: Arc<Shared>,
        video: Option<CaptureControl<Video, BoxErr>>,
        audio: Option<std::thread::JoinHandle<()>>,
    }

    #[derive(Default)]
    pub struct CaptureState {
        op: Mutex<()>,
        session: Mutex<Option<Session>>,
        /// Source ids from the last listing; only these can be captured.
        listed: Mutex<HashSet<String>>,
    }

    fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
        m.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn remember_listed(state: &CaptureState, sources: &[Source]) {
        *lock(&state.listed) = sources.iter().map(|s| s.id.clone()).collect();
    }

    fn parse_source(id: &str) -> Option<(&str, usize)> {
        let (kind, raw) = id.split_once(':')?;
        Some((kind, raw.parse().ok()?))
    }

    /// The WebView2 browser process. Discord's voice audio is played from it
    /// (or its audio child process), so that's the tree to exclude from a
    /// screen share, not just driftcord.exe.
    fn webview_browser_pid(window: &WebviewWindow) -> Option<u32> {
        let (tx, rx) = mpsc::channel();
        window
            .with_webview(move |pv| {
                let pid = unsafe {
                    pv.controller().CoreWebView2().ok().and_then(|core| {
                        let mut pid = 0u32;
                        core.BrowserProcessId(&mut pid).ok().map(|_| pid)
                    })
                };
                let _ = tx.send(pid.filter(|p| *p != 0));
            })
            .ok()?;
        rx.recv_timeout(Duration::from_secs(2)).ok().flatten()
    }

    pub fn start(state: &CaptureState, window: WebviewWindow, req: StartRequest) -> Result<StartInfo, String> {
        let _op = lock(&state.op);
        stop_locked(state);

        if !lock(&state.listed).contains(&req.source) {
            return Err("Pick what to share from the list again.".into());
        }
        let (kind, raw) = parse_source(&req.source).ok_or("unknown source")?;
        let exclude_pid = webview_browser_pid(&window).unwrap_or_else(std::process::id);
        let fps = req.fps.clamp(5, 120);

        let shared = Arc::new(Shared {
            session: NEXT_SESSION.fetch_add(1, Ordering::Relaxed),
            window,
            stop: AtomicBool::new(false),
            started: Instant::now(),
            video: Ring::new(0, VIDEO_SLOTS),
            audio: Ring::new(AUDIO_BASE, AUDIO_SLOTS),
            max_w: req.max_width.clamp(320, 7680),
            max_h: req.max_height.clamp(180, 4320),
            interval: Duration::from_secs_f64(1.0 / fps as f64),
        });

        let border = if GraphicsCaptureApi::is_border_settings_supported().unwrap_or(false) {
            DrawBorderSettings::WithoutBorder
        } else {
            DrawBorderSettings::Default
        };
        let interval = if GraphicsCaptureApi::is_minimum_update_interval_supported().unwrap_or(false) {
            MinimumUpdateIntervalSettings::Custom(shared.interval)
        } else {
            MinimumUpdateIntervalSettings::Default
        };

        macro_rules! settings {
            ($item:expr) => {
                Settings::new(
                    $item,
                    CursorCaptureSettings::Default,
                    border,
                    SecondaryWindowSettings::Default,
                    interval,
                    DirtyRegionSettings::Default,
                    ColorFormat::Bgra8,
                    shared.clone(),
                )
            };
        }

        // Audio: a window shares its own app's sound; a screen shares
        // everything except Driftcord's WebView2 processes, which play your
        // call, so friends never hear themselves.
        let (video, audio_target) = match kind {
            "screen" => {
                let m = Monitor::from_raw_hmonitor(raw as *mut core::ffi::c_void);
                let ctl = Video::start_free_threaded(settings!(m)).map_err(|e| format!("Couldn't start capture: {e}"))?;
                (ctl, (exclude_pid, false))
            }
            "window" => {
                let w = Window::from_raw_hwnd(raw as *mut core::ffi::c_void);
                if !w.is_valid() {
                    return Err("That window is no longer available.".into());
                }
                let pid = w.process_id().map_err(|e| e.to_string())?;
                let ctl = Video::start_free_threaded(settings!(w)).map_err(|e| format!("Couldn't start capture: {e}"))?;
                (ctl, (pid, true))
            }
            _ => return Err("unknown source".into()),
        };

        let audio = if req.audio {
            let sh = shared.clone();
            std::thread::Builder::new()
                .name("driftcord-audio".into())
                .spawn(move || {
                    if let Err(e) = audio_loop(sh.clone(), audio_target.0, audio_target.1) {
                        if !sh.stop.load(Ordering::Relaxed) {
                            sh.warn(&format!("Audio stopped: {e}. Video is still being shared."));
                        }
                    }
                })
                .ok()
        } else {
            None
        };
        let has_audio = audio.is_some();

        set_indicator(&shared.window, true);
        *lock(&state.session) = Some(Session { shared, video: Some(video), audio });
        Ok(StartInfo { audio: has_audio })
    }

    pub fn stop(state: &CaptureState) {
        let _op = lock(&state.op);
        stop_locked(state);
    }

    fn stop_locked(state: &CaptureState) {
        let Some(mut s) = lock(&state.session).take() else { return };
        s.shared.stop.store(true, Ordering::Relaxed);
        if let Some(v) = s.video.take() {
            let _ = v.stop();
        }
        if let Some(a) = s.audio.take() {
            let _ = a.join();
        }
        set_indicator(&s.shared.window, false);
        // Free this session's shared memory on the UI thread (and only this session's).
        let session = s.shared.session;
        let _ = s.shared.window.with_webview(move |_| {
            BUFFERS.with(|b| {
                b.borrow_mut().retain(|(sess, _), buf| {
                    if *sess == session {
                        let _ = unsafe { buf.Close() };
                        false
                    } else {
                        true
                    }
                })
            })
        });
    }

    pub fn ack(state: &CaptureState, acks: &[(u32, u64)]) {
        if let Some(s) = lock(&state.session).as_ref() {
            for &(id, seq) in acks {
                s.shared.ack(id, seq);
            }
        }
    }
}
