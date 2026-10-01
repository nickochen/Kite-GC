// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Marc Hoffmann (b14ckyy)

//! GStreamer H.265 ingest for RTSP sources.
//!
//! The WebView cannot play H.265 — no HEVC in WebRTC on WebView2, and the ffmpeg transcode
//! templates in `mjpeg_server` only decode H.264 — so an H.265-only link (the FPV case this was
//! written for) used to show nothing at all: WebRTC negotiation failed, the MJPEG stream-copy was
//! rejected by the mpjpeg muxer, and every transcode template choked on the codec.
//!
//! This module reads such a source the way Mission Planner does: GStreamer owns the RTSP session
//! and the H.265 decode (hardware where the host offers it — D3D11/NVDEC on Windows, VAAPI/NVDEC
//! on Linux, VideoToolbox on macOS), and only the decoded pictures are re-encoded — to JPEG, never
//! back to H.264 — and handed to `mjpeg_server` as a multipart stream on the child's stdout. The
//! bytes are deliberately compatible with what ffmpeg's mpjpeg muxer emits (boundary `ffmpeg` +
//! a `Content-Length` on every part), which is what the broadcast loop frames on, so the whole HTTP
//! fan-out and the frontend need no changes.
//!
//! Deliberately `gst-launch-1.0` as a child process rather than the Rust bindings: no new
//! build-time dependency, and the running pipeline stays a readable one-liner in the log. The H.264
//! path is untouched — GStreamer is only ever attempted for sources the MJPEG stream-copy rejected
//! and that probe (or turn out to be) H.265.

use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;
use std::time::Duration;

/// Best H.265 decoder element on this machine, probed once per process via `gst-inspect-1.0`.
static DECODER: OnceLock<Option<&'static str>> = OnceLock::new();

/// H.265 decoder candidates, best first. Hardware before software: on an FPV link the decode runs
/// for the whole flight, and a 1080p software HEVC decode is a core or more by itself.
#[cfg(windows)]
const H265_DECODERS: &[&str] = &["d3d11h265dec", "nvh265dec", "openh265dec", "avdec_h265"];
#[cfg(target_os = "linux")]
const H265_DECODERS: &[&str] = &["vah265dec", "nvh265dec", "openh265dec", "avdec_h265"];
#[cfg(target_os = "macos")]
const H265_DECODERS: &[&str] = &["vtdec", "avdec_h265"];
#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
const H265_DECODERS: &[&str] = &["avdec_h265"];

fn exe_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

fn path_lookup(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Locate `gst-launch-1.0`: PATH first, then where the official Windows installer puts it
/// (`GSTREAMER_1_0_ROOT_MSVC_X86_64`, falling back to the default `C:\gstreamer\…` tree).
/// `None` means GStreamer is not installed — the caller falls back to the ffmpeg templates.
pub fn find_gst_launch() -> Option<PathBuf> {
    let exe = exe_name("gst-launch-1.0");
    if let Some(p) = path_lookup(&exe) {
        return Some(p);
    }
    #[cfg(windows)]
    {
        if let Ok(root) = std::env::var("GSTREAMER_1_0_ROOT_MSVC_X86_64") {
            let p = PathBuf::from(root).join("bin").join(&exe);
            if p.is_file() {
                return Some(p);
            }
        }
        let p = PathBuf::from(r"C:\gstreamer\1.0\msvc_x86_64\bin").join(&exe);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

/// `gst-inspect-1.0` next to the `gst-launch-1.0` we found (same `bin/` dir), else PATH.
fn find_gst_inspect() -> Option<PathBuf> {
    if let Some(launch) = find_gst_launch() {
        if let Some(dir) = launch.parent() {
            let p = dir.join(exe_name("gst-inspect-1.0"));
            if p.is_file() {
                return Some(p);
            }
        }
    }
    path_lookup(&exe_name("gst-inspect-1.0"))
}

/// The H.265 decoder element to use, best available first (`None` = no decoder on this machine).
/// Probed by asking `gst-inspect-1.0` about each candidate: listing proves nothing on its own, but
/// an element that is not even registered cannot be in the pipeline, and `gst-launch-1.0` fails the
/// whole launch on one missing element — so the probe is what keeps a half-installed GStreamer
/// from producing a cryptic launch error instead of a clean fallback.
pub fn best_h265_decoder() -> Option<&'static str> {
    *DECODER.get_or_init(|| {
        let inspect = find_gst_inspect()?;
        for elem in H265_DECODERS {
            let mut cmd = Command::new(&inspect);
            crate::child_env::sanitize(&mut cmd);
            cmd.arg(elem);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW — don't flash a console
            }
            let ok = cmd
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
            if ok {
                log::info!("[video] GStreamer H.265 decoder: {elem}");
                return Some(*elem);
            }
        }
        log::warn!("[video] GStreamer found but no H.265 decoder element is registered");
        None
    })
}

/// Whether the GStreamer H.265 path can run here: launcher present and a decoder registered.
pub fn is_available() -> bool {
    find_gst_launch().is_some() && best_h265_decoder().is_some()
}

/// `gst-launch-1.0` argv for `rtspsrc → H.265 decode → JPEG → multipart → stdout`.
///
/// `rtspsrc` is left to negotiate its own transport (forcing one is what stops a UDP-only server
/// from opening at all — the same reason the ffmpeg path sets no `-rtsp_transport`). `latency` is
/// the jitterbuffer in ms and `drop-on-latency` keeps a late network from turning into a growing
/// delay on a live FPV feed; `tcp-timeout` (µs) bounds a dead host so the start still fails inside
/// the MJPEG server's first-frame window instead of hanging on connect.
///
/// No `videoscale`: the source's own resolution reaches the screen, exactly like the ffmpeg path.
pub fn pipeline_args(url: &str) -> Option<Vec<String>> {
    let dec = best_h265_decoder()?;
    Some(vec![
        "-q".into(),
        "rtspsrc".into(),
        format!("location={url}"),
        "latency=200".into(),
        "drop-on-latency=true".into(),
        "tcp-timeout=5000000".into(),
        "!".into(),
        "rtph265depay".into(),
        "!".into(),
        "h265parse".into(),
        "!".into(),
        dec.into(),
        "!".into(),
        // Hardware decoders hand back GPU-memory frames; videoconvert brings them down for jpegenc.
        "videoconvert".into(),
        "!".into(),
        "jpegenc".into(),
        // Roughly the quality the ffmpeg path's `-q:v 5` produces.
        "quality=85".into(),
        "!".into(),
        // Boundary + per-part Content-Length: byte-compatible with ffmpeg's mpjpeg muxer, which is
        // what mjpeg_server's framing and HTTP preamble expect.
        "multipartmux".into(),
        "boundary=ffmpeg".into(),
        "!".into(),
        // fd 1 = stdout on every platform the official builds target (≥ 1.20); the parent reads it
        // exactly like ffmpeg's `-f mpjpeg -`.
        "fdsink".into(),
        "fd=1".into(),
    ])
}

/// The video codec of the RTSP source's first video stream (`"hevc"`, `"h264"`, …), or `None` when
/// it cannot be determined. A DESCRIBE-only probe — no frames are decoded — so it answers in about
/// a round trip; the RTSP I/O timeout bounds a silent server.
///
/// Used to try GStreamer only for sources that actually are H.265: on anything else the depay
/// element would produce no data and the attempt would burn the whole first-frame window before
/// falling through to the ffmpeg templates.
pub fn probe_video_codec(url: &str) -> Option<String> {
    let ffprobe = super::ffmpeg::find_ffprobe()?;
    let mut cmd = Command::new(&ffprobe);
    crate::child_env::sanitize(&mut cmd);
    cmd.args([
        "-v",
        "error",
        "-timeout",
        "5000000",
        "-i",
        url,
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW — don't flash a console
    }
    // ffprobe has no "give up after N" of its own for a hanging connect beyond the I/O timeout, so
    // bound it from the outside: spawn, wait on a thread, kill past the deadline.
    let child = cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .stdin(std::process::Stdio::null())
        .spawn()
        .ok()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let out = child.wait_with_output().ok();
        let _ = tx.send(out);
    });
    let out = rx.recv_timeout(Duration::from_secs(8)).ok()??;
    if !out.status.success() {
        return None;
    }
    let codec = String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .to_ascii_lowercase();
    (!codec.is_empty()).then_some(codec)
}

/// True when the probed codec name is H.265/HEVC in any of ffprobe's spellings.
pub fn is_h265(codec: &str) -> bool {
    matches!(codec, "hevc" | "h265" | "h.265")
}
