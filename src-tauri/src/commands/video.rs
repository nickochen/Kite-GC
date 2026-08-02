// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Marc Hoffmann (b14ckyy)

//! Video commands — the go2rtc RTSP→WebRTC engine + its ffmpeg fallback dependency.
//! See docs/active/RTSP_VIDEO.md.
//!
//! **Threading:** every command here that spawns a helper process, waits on one, or tears one down is
//! marked `#[tauri::command(async)]`. Tauri runs plain `fn` commands on the **main thread**, so a
//! device enumeration behind a wedged capture driver (or a `--version` call on a binary Gatekeeper /
//! Defender is still scanning) would freeze the whole UI. Only trivially-cheap commands stay sync.

use tauri::{AppHandle, Emitter, State};

use std::sync::Arc;

use crate::video::mjpeg_server::{EndedHook, MjpegSource, RtspTranscode};
use crate::video::{ffmpeg, go2rtc, native, Go2Rtc};

/// Build a go2rtc stream name for an instance: `kite-video1` / `kite-video2`.
fn stream_name(instance_id: &str) -> String {
    format!("kite-{instance_id}")
}

/// Emitted when a running feed's source dies (ffmpeg exited, read error) — never on our own stop.
/// The `<img>` sink cannot report this itself on WebKit: measured on 2.52.5, a multipart `<img>`
/// fires one `load` for the whole stream and then **no** `error` and no `abort` when the server
/// closes mid-stream, leaving the element on a dead `src` with `complete` still true. That is the
/// whole reconnect trigger for the image path, so it comes from the backend instead, where the fact
/// is known for certain and identically on every platform.
pub const MJPEG_ENDED_EVENT: &str = "video-mjpeg-ended";

/// Turn the MJPEG server's runtime-agnostic "the source died" callback into an event carrying the
/// instance ID. The server deliberately knows nothing about Tauri — see `EndedHook` for why that
/// module has to stay linkable without the window runtime.
fn ended_hook(app: &AppHandle, instance_id: &str) -> EndedHook {
    let id = instance_id.to_string();
    let app = app.clone();
    Arc::new(move || {
        let _ = app.emit(MJPEG_ENDED_EVENT, serde_json::json!({ "instanceId": &id }));
    })
}

/// How long the MJPEG endpoint gets to produce its first byte before the stream copy is judged
/// unusable. Generous — it covers spawning ffmpeg and the RTSP handshake — because it is paid once,
/// at connect, and never touches a frame afterwards.
const COPY_PROBE_BUDGET: std::time::Duration = std::time::Duration::from_secs(4);

/// Register `src` under the named stream `stream_name(instance_id)`. go2rtc patches its config
/// in place, so this also replaces an existing registration.
async fn register_source(
    client: &reqwest::Client,
    port: u16,
    instance_id: &str,
    src: &str,
) -> Result<(), String> {
    let name = stream_name(instance_id);
    let resp = client
        .put(format!("http://127.0.0.1:{port}/api/streams"))
        .query(&[("name", name.as_str()), ("src", src)])
        .send()
        .await
        .map_err(|e| format!("go2rtc add-stream failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("go2rtc add-stream HTTP {}", resp.status()));
    }
    Ok(())
}

/// Whether go2rtc's MJPEG endpoint actually yields frames for the named stream.
async fn mjpeg_endpoint_delivers(client: &reqwest::Client, port: u16, instance_id: &str) -> bool {
    let url = format!("http://127.0.0.1:{port}/api/stream.mjpeg?src={}", stream_name(instance_id));
    let Ok(mut resp) = client.get(&url).send().await else {
        return false;
    };
    if !resp.status().is_success() {
        return false;
    }
    matches!(
        tokio::time::timeout(COPY_PROBE_BUDGET, resp.chunk()).await,
        Ok(Ok(Some(chunk))) if !chunk.is_empty()
    )
}

/// ffmpeg version string (`ffmpeg -version` first line), or null if it isn't installed yet. ffmpeg is
/// the fallback RTSP reader for go2rtc (sources its native client can't read), not always required.
#[tauri::command(async)]
pub fn video_ffmpeg_status() -> Option<String> {
    ffmpeg::version()
}

/// Download ffmpeg into the app-data `bin/` dir (Windows). Emits `ffmpeg-download-progress`
/// (`{ pct, msg }`). Returns the installed path. go2rtc is pointed at this path, so a freshly
/// downloaded ffmpeg is picked up on the next stream start without restarting go2rtc.
#[tauri::command]
pub async fn video_ffmpeg_download(app_handle: AppHandle) -> Result<String, String> {
    let report = |pct: u8, msg: &str| {
        let _ = app_handle.emit(
            "ffmpeg-download-progress",
            serde_json::json!({ "pct": pct, "msg": msg }),
        );
    };
    let path = ffmpeg::download(report).await?;
    Ok(path.to_string_lossy().to_string())
}

// ── go2rtc / WebRTC (the live RTSP path) ─────────────────────────────

/// go2rtc presence string (version/installed), or null if not installed yet.
#[tauri::command(async)]
pub fn video_go2rtc_status() -> Option<String> {
    go2rtc::status()
}

/// Download go2rtc into the app-data `bin/` dir (Windows). Emits `go2rtc-download-progress`
/// (`{ pct, msg }`). Returns the installed path.
#[tauri::command]
pub async fn video_go2rtc_download(app_handle: AppHandle) -> Result<String, String> {
    let report = |pct: u8, msg: &str| {
        let _ = app_handle.emit(
            "go2rtc-download-progress",
            serde_json::json!({ "pct": pct, "msg": msg }),
        );
    };
    let path = go2rtc::download(report).await?;
    Ok(path.to_string_lossy().to_string())
}

/// Start (or refresh) the go2rtc RTSP→WebRTC stream for `url` and `instance_id`.
/// Ensures go2rtc is running, registers the named source, and tracks the stream.
#[tauri::command]
pub async fn video_webrtc_start(
    instance_id: String,
    url: String,
    use_ffmpeg: bool,
    mjpeg: bool,
    allow_hw_decode: Option<bool>,
    engine: State<'_, Go2Rtc>,
) -> Result<String, String> {
    let (hw_v4l2, hw_vaapi) = tauri::async_runtime::spawn_blocking(|| {
        let v4l2 = crate::video::ffmpeg::v4l2_h264_decode_available();
        let vaapi = !v4l2 && crate::video::ffmpeg::vaapi_render_node().is_some();
        (v4l2, vaapi)
    })
    .await
    .unwrap_or((false, false));
    let port = engine.ensure_running()?;
    let hw = mjpeg && allow_hw_decode.unwrap_or(true) && (hw_v4l2 || hw_vaapi);
    let hw_mjpeg_encode = hw_vaapi;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    if mjpeg {
        let copy_src = format!("ffmpeg:{url}#input=rtsp/udp#video=copy");
        register_source(&client, port, &instance_id, &copy_src).await?;
        if mjpeg_endpoint_delivers(&client, port, &instance_id).await {
            log::info!("[video][{}] source already carries MJPEG — stream-copied, no transcode", instance_id);
            engine.track_stream(&stream_name(&instance_id));
            return Ok("copy".to_string());
        }
        log::debug!("[video][{}] no MJPEG track in the source — registering the transcode instead", instance_id);
    }
    let src = if mjpeg && hw {
        let enc = if hw_mjpeg_encode { "kite_hw_mjpeg" } else { "mjpeg" };
        format!("ffmpeg:{url}#input=kite_hw_input#video={enc}")
    } else if mjpeg {
        format!("ffmpeg:{url}#input=rtsp/udp#video=mjpeg")
    } else if use_ffmpeg {
        format!("ffmpeg:{url}#input=rtsp/udp#video=copy")
    } else {
        url.clone()
    };
    register_source(&client, port, &instance_id, &src).await?;
    engine.track_stream(&stream_name(&instance_id));
    Ok(match (mjpeg, hw, hw_mjpeg_encode) {
        (false, _, _) => "none",
        (true, true, true) => "vaapi",
        (true, true, false) => "v4l2m2m",
        (true, false, _) => "software",
    }
    .to_string())
}

/// Exchange a browser WebRTC SDP offer with go2rtc for `instance_id` and return the SDP answer.
#[tauri::command]
pub async fn video_webrtc_offer(
    instance_id: String,
    sdp: String,
    engine: State<'_, Go2Rtc>,
) -> Result<String, String> {
    let port = engine
        .port()
        .ok_or("go2rtc is not running — start the stream first")?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;
    let name = stream_name(&instance_id);
    let resp = client
        .post(format!("http://127.0.0.1:{port}/api/webrtc"))
        .query(&[("src", name.as_str())])
        .json(&serde_json::json!({ "type": "offer", "sdp": sdp }))
        .send()
        .await
        .map_err(|e| format!("go2rtc WebRTC offer failed: {e}"))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("go2rtc WebRTC offer HTTP {status}: {}", body.trim()));
    }
    let answer: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("go2rtc answer parse failed: {e} (body: {body})"))?;
    answer
        .get("sdp")
        .and_then(serde_json::Value::as_str)
        .map(|s| s.to_string())
        .ok_or("go2rtc answer has no SDP".to_string())
}

/// Stop the WebRTC stream for `instance_id`. Idempotent. Async: graceful teardown does
/// a blocking DELETE + settle delay before the kill (~1 s worst case).
#[tauri::command(async)]
pub fn video_webrtc_stop(
    instance_id: String,
    engine: State<'_, Go2Rtc>,
) -> Result<(), String> {
    engine.unregister_stream(&stream_name(&instance_id));
    Ok(())
}

/// Return the go2rtc API port if the engine is running, or null.
#[tauri::command]
pub fn video_go2rtc_port(engine: State<'_, Go2Rtc>) -> Option<u16> {
    engine.port()
}

// ── Native capture (V4L2 / DirectShow / AVFoundation) ─────────────────

#[tauri::command(async)]
pub fn video_list_native_devices() -> Vec<native::NativeDevice> {
    native::list_devices()
}

#[tauri::command(async)]
pub fn video_probe_device(id: String) -> Vec<native::CaptureMode> {
    native::probe(&id)
}

#[tauri::command(async)]
pub fn video_native_mjpeg_start(
    app: AppHandle,
    instance_id: String,
    id: String,
    codec: String,
    width: u32,
    height: u32,
    fps: u32,
    mjpeg: State<'_, crate::video::MjpegServer>,
) -> Result<serde_json::Value, String> {
    let spec = native::CaptureSpec { id, codec, width, height, fps };
    let transcode = if native::needs_transcode(&spec.codec) { "software" } else { "copy" };
    let port = mjpeg.start(&instance_id, ended_hook(&app, &instance_id), &MjpegSource::Device(&spec))?;
    Ok(serde_json::json!({ "url": format!("http://127.0.0.1:{port}/"), "transcode": transcode }))
}

/// Start the embedded MJPEG server on an RTSP source for `instance_id` — the image path,
/// without go2rtc.
#[tauri::command(async)]
pub fn video_rtsp_mjpeg_start(
    app: AppHandle,
    instance_id: String,
    url: String,
    require_copy: bool,
    allow_hw_decode: Option<bool>,
    mjpeg: State<'_, crate::video::MjpegServer>,
) -> Result<serde_json::Value, String> {
    let reply = |port: u16, t: RtspTranscode| {
        serde_json::json!({ "url": format!("http://127.0.0.1:{port}/"), "transcode": t.label() })
    };
    let copy = MjpegSource::Rtsp { url: &url, transcode: RtspTranscode::Copy };
    match mjpeg.start(&instance_id, ended_hook(&app, &instance_id), &copy) {
        Ok(port) => {
            log::info!("[video][{}] RTSP source already carries MJPEG — stream-copied, no transcode", instance_id);
            return Ok(reply(port, RtspTranscode::Copy));
        }
        Err(e) if require_copy => return Err(format!("source does not carry MJPEG: {e}")),
        Err(e) => log::debug!("[video][{}] no MJPEG track in the source ({e}) — transcoding instead", instance_id),
    }
    let transcode = if !allow_hw_decode.unwrap_or(true) {
        RtspTranscode::Software
    } else if crate::video::ffmpeg::v4l2_h264_decode_available() {
        RtspTranscode::V4l2m2m
    } else if let Some(node) = crate::video::ffmpeg::vaapi_render_node() {
        RtspTranscode::Vaapi(node)
    } else {
        RtspTranscode::Software
    };
    let port = mjpeg.start(&instance_id, ended_hook(&app, &instance_id), &MjpegSource::Rtsp { url: &url, transcode })?;
    log::info!("[video][{}] RTSP MJPEG transcode running ({})", instance_id, transcode.label());
    Ok(reply(port, transcode))
}

#[tauri::command(async)]
pub fn video_native_mjpeg_stop(instance_id: String, mjpeg: State<'_, crate::video::MjpegServer>) -> Result<(), String> {
    mjpeg.stop(&instance_id);
    Ok(())
}
