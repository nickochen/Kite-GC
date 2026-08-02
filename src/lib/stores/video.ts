// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Marc Hoffmann (b14ckyy)

// Embedded video — source router with three kinds:
//   • camera — local webcam / USB capture via getUserMedia (the zero-dependency default).
//   • rtsp   — network stream via the go2rtc engine (WebRTC, MJPEG fallback).
//   • native — the OS hardware capture layer via ffmpeg (Linux V4L2 / Windows DirectShow / macOS
//              AVFoundation) → embedded MJPEG server, rendered in an <img>. The "Advanced" tier with
//              device-verified codec/resolution/framerate control (see helpers/videoCapabilities.ts).
//
// The router opens a source once and exposes its MediaStream; multiple sinks
// (the NavRail panel preview, the dock widget, the floating window, the
// map-swap view) bind the *same* stream to their own <video> element — a
// MediaStream attaches to many elements at once, so one decode feeds them all.
// (native is the exception: an MJPEG multipart feed rendered per-<img>.)
//
// `getUserMedia` works in WebView2 (Windows) and WebKitGTK (Linux) and, with the camera entitlement,
// WKWebView (macOS), so the camera path needs no backend. rtsp + native use the Rust backend.
//
// DUAL-VIDEO: This module now exports TWO independent video routers (video1 and video2).
// Each has its own state, stream, settings, and persistence. They share the same backend
// (go2rtc, ffmpeg) but operate on independent sources.

import { writable, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { t } from 'svelte-i18n';
import { isLinux } from '$lib/platform';
import {
  type NativeDevice,
  type CaptureMode,
  type NativeSelection,
  validateSelection,
} from '$lib/helpers/videoCapabilities';
import { setMjpegSinkHandlers, startMjpegSink, stopMjpegSink } from '$lib/controllers/mjpegSink';

export interface VideoDevice {
  deviceId: string;
  label: string;
}

export type VideoStatus = 'off' | 'starting' | 'live' | 'error';
export type VideoResolution = 'auto' | '480p' | '720p' | '1080p';
/** getUserMedia framerate wish (the camera path can't enumerate modes, only hint a rate). */
export type CameraFps = 'auto' | '30' | '60';
/** Source kind: local camera (getUserMedia MediaStream), RTSP bridge (go2rtc), or native hardware
 *  capture (V4L2 / DirectShow / AVFoundation → embedded MJPEG server). */
export type VideoKind = 'camera' | 'rtsp' | 'native';
/** Which go2rtc reader served the live RTSP feed: native client or the ffmpeg fallback. */
export type RtspEngine = 'native' | 'ffmpeg' | null;
/** RTSP transport for a connection. 'udp' → ffmpeg reader (reads UDP-only servers like the UAV-Link
 *  Pi); 'tcp' → go2rtc's native RTP-over-TCP client; 'auto' → native first, then the ffmpeg fallback. */
export type RtspTransport = 'udp' | 'tcp' | 'auto';
/** A saved, named RTSP connection the user can recall from the connection list (see VideoPanel). */
export interface RtspConnection {
  id: string;
  name: string;
  url: string;
  transport: RtspTransport;
}
/** Where the single map instance currently lives (the inverse of which surfaces show video). */
export type MapLocation = 'main' | 'floating' | 'widget' | 'floating2' | 'widget2';

export interface VideoState {
  /** Active source kind. `camera` → getUserMedia MediaStream; `rtsp` → go2rtc (WebRTC or MJPEG);
   *  `native` → embedded MJPEG server rendered in an `<img>`. */
  kind: VideoKind;
  /** User wants video on (source open). */
  enabled: boolean;
  status: VideoStatus;
  devices: VideoDevice[];
  /** Selected video input device (null = system default). */
  deviceId: string | null;
  resolution: VideoResolution;
  /** getUserMedia framerate wish (camera path). */
  cameraFps: CameraFps;
  // ── Native capture (Advanced) ────────────────────────────────────
  /** Native capture devices (V4L2/DirectShow/AVFoundation) — enumerated by the Rust backend. */
  nativeDevices: NativeDevice[];
  /** Selected native device id (V4L2 path / DirectShow name / AVFoundation index), null if none. */
  nativeDevice: string | null;
  /** Name of the selected native device — the tie-breaker when the id turns out to be unstable
   *  (AVFoundation index / `/dev/videoN` both renumber on re-plug). See `resolveNativeDevice`. */
  nativeDeviceName: string | null;
  /** Probed modes for the selected native device (drives the format→resolution→framerate cascade). */
  nativeModes: CaptureMode[];
  /** Chosen native capture config (format/resolution/framerate). */
  nativeSel: NativeSelection;
  // ── RTSP source ──────────────────────────────────────────────────
  /** RTSP URL (e.g. rtsp://192.168.1.10:554/live) — the active/direct-connect URL. */
  rtspUrl: string;
  /** Transport for the active RTSP connection (udp/tcp/auto). */
  rtspTransport: RtspTransport;
  /** Saved, named RTSP connections the user can recall (explicit save — never auto-added). */
  rtspConnections: RtspConnection[];
  /** Active RTSP reader once live (native go2rtc client vs ffmpeg fallback); runtime-only. */
  rtspEngine: RtspEngine;
  /** Runtime-only: true while the infinite RTSP auto-reconnect loop is running (link dropped/stalled). */
  reconnecting: boolean;
  /** Runtime-only: current reconnect attempt number, shown in the on-video overlay. */
  reconnectAttempt: number;
  /** go2rtc MJPEG HTTP URL for systems where RTCPeerConnection is unavailable. */
  mjpegUrl: string | null;
  /** What the RUNNING feed actually does, as reported by the backend: 'copy' (stream-copied, nothing
   *  to accelerate), 'software', 'vaapi', 'v4l2m2m', 'none' (no transcode at all — WebRTC), or null
   *  when nothing is live. Runtime-only. Reported rather than inferred: whether this host *can* do
   *  hardware and whether this feed *is* using it are different questions. */
  activeTranscode: string | null;
  /** User veto on hardware transcoding: force the software path even where the backend's probe says
   *  hardware works. An escape hatch for driver/hardware combinations we can't anticipate — hardware
   *  stays the default, this is the opt-out. */
  disableHwAccel: boolean;
  /** Mirror horizontally (front-facing cams) — applied by the display sinks. */
  mirror: boolean;
  /** Source aspect ratio (w/h); drives the widget / floating-window sizing. */
  aspect: number;
  /** Negotiated track settings (for the info line); null until live. */
  width: number | null;
  height: number | null;
  frameRate: number | null;
  /** Max frame rate the camera *reports* it can do at the chosen mode (diagnostic). */
  capFrameRate: number | null;
  error: string | null;

  // ── Floating window ──────────────────────────────────────────────
  /** Floating video window visible. */
  floating: boolean;
  /** Snapped to the bottom-left corner (displaces the dock) vs free-floating. */
  floatSnapped: boolean;
  /** Free position (px from top-left of the app window), used when not snapped. */
  floatX: number;
  floatY: number;
  /** Window height as a fraction of the viewport height (0.1…0.3); width = height·aspect. */
  floatHeightFrac: number;
  /** Where the single map instance currently lives (transient, not persisted). `main` = the normal
   *  full-screen map; `floating`/`widget` = the map jumped into that video surface (which double-
   *  clicked), and every other surface shows video. Double-clicking a video moves the map there. */
  mapLocation: MapLocation;
  /** Screen rect (px) of the video widget tile, published by the widget — used to overlay the map
   *  onto it when `mapLocation === 'widget'`. Null until measured. */
  widgetRect: { x: number; y: number; w: number; h: number } | null;
  /** Screen rect (px) of the second video widget tile. */
  widgetRect2: { x: number; y: number; w: number; h: number } | null;
}

/** Per-second snapshot of the WebRTC inbound video pipeline, published by the RTSP stall monitor
 *  (which polls `getStats()` once a second anyway). Splits an unstable picture into its stages:
 *  `recvFps` (frames arriving from go2rtc — a shortfall here is upstream of the WebView),
 *  `decodeFps`/`framesDropped` (decoder keeping up or not), and the engine's own playout counters
 *  (`freezeCount`, `playoutDelayMs`). Consumed by the Debug Monitor's Video tab; null when no
 *  WebRTC feed is running. */
export interface VideoRtcStats {
  /** framesReceived per second over the last poll interval. */
  recvFps: number;
  /** framesDecoded per second over the last poll interval. */
  decodeFps: number;
  /** The decoder's own frames-per-second estimate, when the engine reports one. */
  engineFps: number | null;
  /** Cumulative frames dropped before presentation (received but never shown). */
  framesDropped: number;
  /** Cumulative RTP packets lost on the (loopback) transport — anything but 0 is remarkable. */
  packetsLost: number;
  /** Cumulative playout freezes counted by the engine, if reported. */
  freezeCount: number | null;
  /** Total frozen time in ms, if reported. */
  freezeMs: number | null;
  /** RFC 3550 interarrival jitter in ms, if reported. */
  jitterMs: number | null;
  /** Average jitter-buffer (playout) delay per emitted frame in ms, if reported. */
  playoutDelayMs: number | null;
  /** Received bitrate over the last poll interval, in kbit/s. */
  kbps: number;
  /** The negotiated video codec, prettified from the codec report's mime type (e.g. `H.264`). */
  codec: string | null;
}

/** A complete, independent video router instance with its own state and control functions. */
export interface VideoRouter {
  // Stores
  videoState: ReturnType<typeof writable<VideoState>>;
  videoStream: ReturnType<typeof writable<MediaStream | null>>;
  videoRtcStats: ReturnType<typeof writable<VideoRtcStats | null>>;
  // Control functions
  initVideo: () => Promise<void>;
  startVideo: () => Promise<void>;
  startRtsp: (opts?: { reconnect?: boolean }) => Promise<void>;
  startNative: () => Promise<void>;
  startActive: () => Promise<void>;
  stopVideo: () => void;
  toggleVideo: () => void;
  setVideoKind: (kind: VideoKind) => Promise<void>;
  setRtspUrl: (url: string) => void;
  setRtspTransport: (transport: RtspTransport) => Promise<void>;
  saveRtspConnection: () => void;
  updateRtspConnection: (id: string, p: Partial<Omit<RtspConnection, 'id'>>) => void;
  removeRtspConnection: (id: string) => void;
  selectRtspConnection: (id: string) => Promise<void>;
  setNativeDevice: (id: string | null) => Promise<void>;
  setNativeResolution: (width: number, height: number) => Promise<void>;
  setNativeCodec: (codec: string) => Promise<void>;
  setNativeFramerate: (fps: number) => Promise<void>;
  setCameraFps: (cameraFps: CameraFps) => Promise<void>;
  setVideoDevice: (deviceId: string | null) => Promise<void>;
  setVideoResolution: (resolution: VideoResolution) => Promise<void>;
  setVideoMirror: (mirror: boolean) => void;
  setDisableHwAccel: (disableHwAccel: boolean) => Promise<void>;
  // Floating window
  toggleFloating: () => void;
  setFloatSnapped: (floatSnapped: boolean) => void;
  setFloatPos: (floatX: number, floatY: number) => void;
  setFloatHeightFrac: (frac: number) => void;
  // Map ⇄ video placement
  setMapLocation: (loc: MapLocation) => void;
  setWidgetRect: (rect: { x: number; y: number; w: number; h: number } | null) => void;
  setWidgetRect2: (rect: { x: number; y: number; w: number; h: number } | null) => void;
  // PiP
  registerPiPElement: (el: HTMLVideoElement | null) => void;
  enterPiP: () => Promise<void>;
  // Shared helpers (re-exported for convenience)
  bindVideoEl: (el: HTMLVideoElement | null, stream: MediaStream | null) => void;
  reportVideoSize: (width: number, height: number) => void;
  reportMjpegError: () => void;
  enumerateVideoDevices: () => Promise<void>;
  enumerateNativeDevices: () => Promise<void>;
  probeNativeDevice: (id: string) => Promise<void>;
}

/** Factory: create a complete, independent video router instance.
 * Each instance has its own state, stream, stats, persistence, and control functions.
 * Usage: const video1 = createVideoRouter('video1'); const video2 = createVideoRouter('video2'); */
export function createVideoRouter(instanceId: 'video1' | 'video2'): VideoRouter {
  const STORAGE_KEY = `kite-gc-${instanceId}`;
  const instanceLabel = instanceId === 'video1' ? 'Video 1' : 'Video 2';

  // ── Persistence ─────────────────────────────────────────────────────
  interface VideoPrefs {
    kind: VideoKind;
    enabled: boolean;
    deviceId: string | null;
    resolution: VideoResolution;
    cameraFps: CameraFps;
    rtspUrl: string;
    rtspTransport: RtspTransport;
    rtspConnections: RtspConnection[];
    nativeDevice: string | null;
    nativeCodec: string;
    nativeDeviceName: string | null;
    nativeWidth: number;
    nativeHeight: number;
    nativeFps: number;
    disableHwAccel: boolean;
    mirror: boolean;
    floating: boolean;
    floatSnapped: boolean;
    floatX: number;
    floatY: number;
    floatHeightFrac: number;
  }

  const PREF_DEFAULTS: VideoPrefs = {
    kind: 'camera',
    enabled: false,
    deviceId: null,
    resolution: 'auto',
    cameraFps: 'auto',
    rtspUrl: '',
    rtspTransport: 'auto',
    rtspConnections: [],
    nativeDevice: null,
    nativeCodec: 'mjpeg',
    nativeDeviceName: null,
    nativeWidth: 1280,
    nativeHeight: 720,
    nativeFps: 30,
    disableHwAccel: false,
    mirror: false,
    floating: false,
    floatSnapped: true,
    floatX: 16,
    floatY: 80,
    floatHeightFrac: 0.2,
  };

  function loadPrefs(): VideoPrefs {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (raw) {
        const p = JSON.parse(raw) as Partial<VideoPrefs> & { v4l2Device?: string | null };
        const kind = ((p.kind as string) === 'v4l2' ? 'native' : p.kind ?? 'camera') as VideoKind;
        return {
          ...PREF_DEFAULTS,
          ...p,
          kind,
          deviceId: p.deviceId ?? null,
          resolution: p.resolution ?? 'auto',
          cameraFps: p.cameraFps ?? 'auto',
          rtspUrl: p.rtspUrl ?? '',
          rtspTransport: p.rtspTransport ?? 'auto',
          rtspConnections: Array.isArray(p.rtspConnections) ? p.rtspConnections : [],
          nativeDevice: p.nativeDevice ?? p.v4l2Device ?? null,
          nativeCodec: p.nativeCodec ?? 'mjpeg',
          nativeDeviceName: p.nativeDeviceName ?? null,
          nativeWidth: p.nativeWidth ?? 1280,
          nativeHeight: p.nativeHeight ?? 720,
          nativeFps: p.nativeFps ?? 30,
          disableHwAccel: p.disableHwAccel ?? false,
        };
      }
    } catch {
      /* ignore */
    }
    return { ...PREF_DEFAULTS };
  }

  function savePrefs(state: VideoState): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          kind: state.kind,
          enabled: state.enabled,
          deviceId: state.deviceId,
          resolution: state.resolution,
          cameraFps: state.cameraFps,
          rtspUrl: state.rtspUrl,
          rtspTransport: state.rtspTransport,
          rtspConnections: state.rtspConnections,
          nativeDevice: state.nativeDevice,
          nativeCodec: state.nativeSel.codec,
          nativeDeviceName: state.nativeDeviceName,
          nativeWidth: state.nativeSel.width,
          nativeHeight: state.nativeSel.height,
          nativeFps: state.nativeSel.fps,
          disableHwAccel: state.disableHwAccel,
          mirror: state.mirror,
          floating: state.floating,
          floatSnapped: state.floatSnapped,
          floatX: state.floatX,
          floatY: state.floatY,
          floatHeightFrac: state.floatHeightFrac,
        }),
      );
    } catch {
      /* ignore */
    }
  }

  const boot = loadPrefs();

  const INITIAL: VideoState = {
    kind: boot.kind,
    enabled: false,
    status: 'off',
    devices: [],
    deviceId: boot.deviceId,
    resolution: boot.resolution,
    cameraFps: boot.cameraFps,
    nativeDevices: [],
    nativeDevice: boot.nativeDevice,
    nativeDeviceName: boot.nativeDeviceName,
    nativeModes: [],
    nativeSel: {
      codec: boot.nativeCodec,
      width: boot.nativeWidth,
      height: boot.nativeHeight,
      fps: boot.nativeFps,
    },
    rtspUrl: boot.rtspUrl,
    rtspTransport: boot.rtspTransport,
    rtspConnections: boot.rtspConnections,
    rtspEngine: null,
    reconnecting: false,
    reconnectAttempt: 0,
    mjpegUrl: null,
    activeTranscode: null,
    disableHwAccel: boot.disableHwAccel,
    mirror: boot.mirror,
    aspect: 16 / 9,
    width: null,
    height: null,
    frameRate: null,
    capFrameRate: null,
    error: null,
    floating: boot.floating,
    floatSnapped: boot.floatSnapped,
    floatX: boot.floatX,
    floatY: boot.floatY,
    floatHeightFrac: boot.floatHeightFrac,
    mapLocation: 'main',
    widgetRect: null,
    widgetRect2: null,
  };

  const videoState = writable<VideoState>({ ...INITIAL });
  const videoStream = writable<MediaStream | null>(null);
  const videoRtcStats = writable<VideoRtcStats | null>(null);

  function patch(p: Partial<VideoState>): void {
    videoState.update((s) => ({ ...s, ...p }));
  }

  function logVideo(level: 'warn' | 'info' | 'debug', message: string): void {
    if (level === 'warn') console.warn(`[${instanceId}] ${message}`);
    else console.log(`[${instanceId}] ${message}`);
    void invoke('log_frontend', { level, area: 'video', message }).catch(() => {});
  }

  /** Bind a sink's `<video>` element to the shared MediaStream (camera or rtsp). */
  function bindVideoEl(el: HTMLVideoElement | null, stream: MediaStream | null): void {
    if (!el) return;
    el.srcObject = stream;
  }

  /** Report the natural size of the live source (from a sink's `loadedmetadata`) so the
   *  floating window / widget can size to the real aspect ratio (RTSP has no upfront caps). */
  function reportVideoSize(width: number, height: number): void {
    if (!width || !height) return;
    const s = get(videoState);
    if (s.width === width && s.height === height) return;
    patch({ width, height, aspect: width / height });
  }

  const RES_DIMS: Record<VideoResolution, MediaTrackConstraints> = {
    auto: {},
    '480p': { width: { ideal: 640 }, height: { ideal: 480 } },
    '720p': { width: { ideal: 1280 }, height: { ideal: 720 } },
    '1080p': { width: { ideal: 1920 }, height: { ideal: 1080 } },
  };

  function cameraConstraints(res: VideoResolution, fps: CameraFps): MediaTrackConstraints {
    const ideal = fps === '30' ? 30 : 60;
    return { ...RES_DIMS[res], frameRate: { ideal } };
  }

  function mediaDevicesAvailable(): boolean {
    return typeof navigator !== 'undefined' && 'mediaDevices' in navigator && 'getUserMedia' in navigator.mediaDevices;
  }

  let rtspDriver: HTMLVideoElement | null = null;
  let rtspMjpegFailures = 0;
  const RTSP_MJPEG_MAX_FAILS = 5;

  // ── Native MJPEG sink setup ──────────────────────────────────────────
  // We do NOT set MJPEG sink handlers here — the sink (canvas / <img>) is owned by the UI.
  // The handlers below just forward the backend's async push to the component callbacks.
  let mjpegOnFrame: ((url: string) => void) | null = null;
  let mjpegOnError: (() => void) | null = null;
  let mjpegOnEnd: (() => void) | null = null;
  let mjpegOnTranscode: ((method: string) => void) | null = null;

  // Re-exported so components can register their sinks once at mount.
  function setMjpegSinkHandlers(handlers: {
    onFrame?: (url: string) => void;
    onError?: () => void;
    onEnd?: () => void;
    onTranscode?: (method: string) => void;
  }): void {
    mjpegOnFrame = handlers.onFrame ?? null;
    mjpegOnError = handlers.onError ?? null;
    mjpegOnEnd = handlers.onEnd ?? null;
    mjpegOnTranscode = handlers.onTranscode ?? null;
  }

  function stopTracks(): void {
    const stream = get(videoStream);
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
    videoStream.set(null);
    patch({ status: 'off', mjpegUrl: null, activeTranscode: null, rtspEngine: null });
  }

  // ── Camera (getUserMedia) ────────────────────────────────────────────
  async function startVideo(): Promise<void> {
    if (!mediaDevicesAvailable()) {
      patch({ status: 'error', error: $t('video.noGetUserMedia') });
      return;
    }
    const st = get(videoState);
    patch({ status: 'starting', error: null });
    try {
      const constraints: MediaStreamConstraints = {
        video: cameraConstraints(st.resolution, st.cameraFps),
        audio: false,
      };
      if (st.deviceId) {
        (constraints.video as MediaTrackConstraints).deviceId = { exact: st.deviceId };
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();
      patch({
        status: 'live',
        width: settings.width ?? null,
        height: settings.height ?? null,
        frameRate: settings.frameRate ?? null,
        capFrameRate: null,
        aspect: settings.width && settings.height ? settings.width / settings.height : 16 / 9,
        error: null,
      });
      videoStream.set(stream);
      savePrefs(st);
    } catch (e) {
      patch({ status: 'error', error: String(e) });
    }
  }

  // ── RTSP (go2rtc) ────────────────────────────────────────────────────
  // We reuse the same MJPEG sink handlers pattern; the driver <video> is created on demand.

  async function startRtsp(opts?: { reconnect?: boolean }): Promise<void> {
    const st = get(videoState);
    const url = st.rtspUrl.trim();
    if (!url) {
      patch({ status: 'error', error: $t('video.noRtspUrl') });
      return;
    }
    if (!opts?.reconnect) patch({ status: 'starting', error: null });
    else patch({ reconnecting: true, reconnectAttempt: st.reconnectAttempt + 1 });

    try {
      // Create hidden driver video element for WebRTC → captureStream()
      if (!rtspDriver) {
        rtspDriver = document.createElement('video');
        rtspDriver.muted = true;
        rtspDriver.playsInline = true;
        rtspDriver.style.display = 'none';
        document.body.appendChild(rtspDriver);
      }

      const mjpegUrl = await invoke<string>('rtsp_start', {
        url,
        transport: st.rtspTransport,
        disableHwAccel: st.disableHwAccel,
        driverId: rtspDriver.dataset['driverId'] ?? (rtspDriver.dataset['driverId'] = crypto.randomUUID()),
      });

      // Start the driver video to produce a captureStream()
      rtspDriver.src = mjpegUrl;
      await rtspDriver.play();

      const stream = rtspDriver.captureStream();
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();

      patch({
        status: 'live',
        mjpegUrl,
        width: settings.width ?? null,
        height: settings.height ?? null,
        frameRate: settings.frameRate ?? null,
        capFrameRate: null,
        aspect: settings.width && settings.height ? settings.width / settings.height : 16 / 9,
        error: null,
        reconnecting: false,
        reconnectAttempt: 0,
      });
      videoStream.set(stream);
      savePrefs(st);
      startRtspStallMonitor();
    } catch (e) {
      patch({ status: 'error', error: String(e), reconnecting: false, reconnectAttempt: 0 });
      if (opts?.reconnect) startRtspReconnect();
    }
  }

  // ── RTSP stall monitor / auto-reconnect ──────────────────────────────
  let rtspStallTimer: ReturnType<typeof setTimeout> | null = null;
  let rtspReconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function startRtspStallMonitor(): void {
    if (rtspStallTimer) clearTimeout(rtspStallTimer);
    rtspStallTimer = setTimeout(async () => {
      const st = get(videoState);
      if (!st.enabled || st.kind !== 'rtsp' || st.status !== 'live') return;
      // Check stats for stall
      const stats = get(videoRtcStats);
      if (stats && stats.recvFps === 0) {
        logVideo('warn', 'RTSP stall detected (recvFps=0) → reconnect');
        stopVideo();
        startRtsp({ reconnect: true });
        return;
      }
      startRtspStallMonitor();
    }, 5000);
  }

  function startRtspReconnect(): void {
    if (rtspReconnectTimer) clearTimeout(rtspReconnectTimer);
    rtspReconnectTimer = setTimeout(async () => {
      const st = get(videoState);
      if (!st.enabled || st.kind !== 'rtsp') return;
      logVideo('info', `RTSP reconnect attempt ${st.reconnectAttempt + 1}`);
      await startRtsp({ reconnect: true });
    }, 3000);
  }

  // ── Native (embedded MJPEG server) ───────────────────────────────────
  async function startNative(): Promise<void> {
    const st = get(videoState);
    if (!st.nativeDevice) {
      patch({ status: 'error', error: $t('video.noNativeDevice') });
      return;
    }
    patch({ status: 'starting', error: null });
    try {
      const { mjpegUrl } = await invoke<{ mjpegUrl: string }>('native_start', {
        device: st.nativeDevice,
        codec: st.nativeSel.codec,
        width: st.nativeSel.width,
        height: st.nativeSel.height,
        fps: st.nativeSel.fps,
        disableHwAccel: st.disableHwAccel,
      });
      patch({ status: 'live', mjpegUrl, error: null });
      savePrefs(st);
    } catch (e) {
      patch({ status: 'error', error: String(e) });
    }
  }

  async function stopNativeMjpeg(): Promise<void> {
    try {
      await invoke('native_stop');
    } catch {
      /* ignore */
    }
  }

  // ── Entry point: start the currently-selected kind ───────────────────
  async function startActive(): Promise<void> {
    const st = get(videoState);
    if (st.kind === 'camera') await startVideo();
    else if (st.kind === 'rtsp') await startRtsp();
    else if (st.kind === 'native') await startNative();
  }

  function stopVideo(): void {
    const st = get(videoState);
    if (st.kind === 'native') stopNativeMjpeg();
    if (st.kind === 'rtsp') {
      if (rtspStallTimer) clearTimeout(rtspStallTimer);
      if (rtspReconnectTimer) clearTimeout(rtspReconnectTimer);
      try { invoke('rtsp_stop'); } catch {}
      if (rtspDriver) {
        rtspDriver.src = '';
        rtspDriver.remove();
        rtspDriver = null;
      }
    }
    stopTracks();
    patch({ status: 'off' });
  }

  // ── Enumeration / helpers ────────────────────────────────────────────
  async function enumerateVideoDevices(): Promise<void> {
    if (!mediaDevicesAvailable()) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices
        .filter((d) => d.kind === 'videoinput')
        .map((d) => ({ deviceId: d.deviceId, label: d.label || `Camera ${d.deviceId.slice(0, 8)}` }));
      patch({ devices: videoDevices });
    } catch {
      patch({ devices: [] });
    }
  }

  function resolveNativeDevice(st: VideoState): { id: string; name: string } | null {
    if (!st.nativeDevice) return null;
    const d = st.nativeDevices.find((x) => x.id === st.nativeDevice);
    if (d) return { id: d.id, name: d.name };
    // Fallback by name (id may have shifted: AVFoundation index / /dev/videoN)
    const d2 = st.nativeDevices.find((x) => x.name === st.nativeDeviceName);
    if (d2) return { id: d2.id, name: d2.name };
    return null;
  }

  async function enumerateNativeDevices(): Promise<void> {
    try {
      const devices = await invoke<NativeDevice[]>('native_enumerate_devices');
      patch({ nativeDevices: devices });
      // Auto-repair if our stored id shifted
      const r = resolveNativeDevice(get(videoState));
      if (r && r.id !== get(videoState).nativeDevice) {
        patch({ nativeDevice: r.id, nativeDeviceName: r.name });
      }
    } catch {
      patch({ nativeDevices: [] });
    }
  }

  async function probeNativeDevice(id: string): Promise<void> {
    try {
      const modes = await invoke<CaptureMode[]>('native_probe_device', { id });
      const st = get(videoState);
      const currentSel = st.nativeSel;
      const sel = validateSelection(modes, currentSel);
      patch({ nativeModes: modes, nativeSel: sel });
    } catch {
      patch({ nativeModes: [] });
    }
  }

  // ── Public API ───────────────────────────────────────────────────────
  async function setVideoKind(kind: VideoKind): Promise<void> {
    const st = get(videoState);
    if (st.kind === kind) return;
    const wasEnabled = st.enabled;
    if (wasEnabled) stopVideo();
    patch({ kind, status: 'off', error: null });
    savePrefs(get(videoState));
    if (wasEnabled) await startActive();
  }

  function setRtspUrl(rtspUrl: string): void {
    patch({ rtspUrl });
    savePrefs(get(videoState));
  }

  async function setRtspTransport(transport: RtspTransport): Promise<void> {
    patch({ rtspTransport: transport });
    savePrefs(get(videoState));
    const st = get(videoState);
    if (st.enabled && st.kind === 'rtsp') await startRtsp();
  }

  function genRtspId(): string {
    try {
      return crypto.randomUUID();
    } catch {
      return `rtsp-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    }
  }

  function saveRtspConnection(): void {
    const st = get(videoState);
    const url = st.rtspUrl.trim();
    if (!url) return;
    let host = url;
    try {
      host = new URL(url).host || url;
    } catch {
      /* keep the raw url as the name */
    }
    const list = st.rtspConnections.slice();
    const i = list.findIndex((c) => c.url === url);
    if (i >= 0) {
      list[i] = { ...list[i], transport: st.rtspTransport };
    } else {
      list.push({ id: genRtspId(), name: host, url, transport: st.rtspTransport });
    }
    patch({ rtspConnections: list });
    savePrefs(get(videoState));
  }

  function updateRtspConnection(id: string, p: Partial<Omit<RtspConnection, 'id'>>): void {
    const list = get(videoState).rtspConnections.map((c) => (c.id === id ? { ...c, ...p } : c));
    patch({ rtspConnections: list });
    savePrefs(get(videoState));
  }

  function removeRtspConnection(id: string): void {
    const list = get(videoState).rtspConnections.filter((c) => c.id !== id);
    patch({ rtspConnections: list });
    savePrefs(get(videoState));
  }

  async function selectRtspConnection(id: string): Promise<void> {
    const c = get(videoState).rtspConnections.find((x) => x.id === id);
    if (!c) return;
    const st = get(videoState);
    if (st.kind !== 'rtsp' && st.enabled) stopVideo();
    patch({ kind: 'rtsp', rtspUrl: c.url, rtspTransport: c.transport });
    savePrefs(get(videoState));
    await startRtsp();
  }

  async function setNativeDevice(id: string | null): Promise<void> {
    const st = get(videoState);
    const name = id ? (st.nativeDevices.find((d) => d.id === id)?.name ?? null) : null;
    patch({ nativeDevice: id, nativeDeviceName: name });
    if (id) await probeNativeDevice(id);
    else patch({ nativeModes: [] });
    savePrefs(get(videoState));
    if (id && get(videoState).enabled && get(videoState).kind === 'native') await startNative();
  }

  async function setNativeResolution(width: number, height: number): Promise<void> {
    const st = get(videoState);
    const sel = validateSelection(st.nativeModes, { ...st.nativeSel, width, height });
    patch({ nativeSel: sel });
    savePrefs(get(videoState));
    if (st.enabled && st.kind === 'native') await startNative();
  }

  async function setNativeCodec(codec: string): Promise<void> {
    const st = get(videoState);
    const sel = validateSelection(st.nativeModes, { ...st.nativeSel, codec });
    patch({ nativeSel: sel });
    savePrefs(get(videoState));
    if (st.enabled && st.kind === 'native') await startNative();
  }

  async function setNativeFramerate(fps: number): Promise<void> {
    const st = get(videoState);
    patch({ nativeSel: { ...st.nativeSel, fps } });
    savePrefs(get(videoState));
    if (st.enabled && st.kind === 'native') await startNative();
  }

  async function setCameraFps(cameraFps: CameraFps): Promise<void> {
    patch({ cameraFps });
    savePrefs(get(videoState));
    if (get(videoState).enabled && get(videoState).kind === 'camera') await startVideo();
  }

  async function setVideoDevice(deviceId: string | null): Promise<void> {
    patch({ deviceId });
    savePrefs(get(videoState));
    if (get(videoState).enabled) await startVideo();
  }

  async function setVideoResolution(resolution: VideoResolution): Promise<void> {
    patch({ resolution });
    savePrefs(get(videoState));
    if (get(videoState).enabled) await startVideo();
  }

  function setVideoMirror(mirror: boolean): void {
    patch({ mirror });
    savePrefs(get(videoState));
  }

  async function setDisableHwAccel(disableHwAccel: boolean): Promise<void> {
    const st = get(videoState);
    if (st.disableHwAccel === disableHwAccel) return;
    patch({ disableHwAccel });
    savePrefs(st);
    if (st.enabled && st.kind === 'rtsp') await startRtsp();
  }

  // ── Floating window ──────────────────────────────────────────────────
  function toggleFloating(): void {
    patch({ floating: !get(videoState).floating });
    savePrefs(get(videoState));
  }

  function setFloatSnapped(floatSnapped: boolean): void {
    patch({ floatSnapped });
    savePrefs(get(videoState));
  }

  function setFloatPos(floatX: number, floatY: number): void {
    patch({ floatX, floatY });
    savePrefs(get(videoState));
  }

  const FLOAT_MIN = 0.1;
  const FLOAT_MAX = 0.3;
  function setFloatHeightFrac(frac: number): void {
    patch({ floatHeightFrac: Math.min(FLOAT_MAX, Math.max(FLOAT_MIN, frac)) });
    savePrefs(get(videoState));
  }

  // ── Map ⇄ video placement ────────────────────────────────────────────
  function setMapLocation(loc: MapLocation): void {
    patch({ mapLocation: loc });
    if (typeof window !== 'undefined') {
      setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
    }
  }

  function setWidgetRect(rect: { x: number; y: number; w: number; h: number } | null): void {
    const cur = get(videoState).widgetRect;
    if (cur === rect) return;
    if (cur && rect && cur.x === rect.x && cur.y === rect.y && cur.w === rect.w && cur.h === rect.h) {
      return;
    }
    patch({ widgetRect: rect });
  }

  function setWidgetRect2(rect: { x: number; y: number; w: number; h: number } | null): void {
    const cur = get(videoState).widgetRect2;
    if (cur === rect) return;
    if (cur && rect && cur.x === rect.x && cur.y === rect.y && cur.w === rect.w && cur.h === rect.h) {
      return;
    }
    patch({ widgetRect2: rect });
  }

  // ── Native Picture-in-Picture ────────────────────────────────────────
  const pipSupported = typeof document !== 'undefined' && !!document.pictureInPictureEnabled;

  let pipEl: HTMLVideoElement | null = null;
  function registerPiPElement(el: HTMLVideoElement | null): void {
    pipEl = el;
  }

  async function enterPiP(): Promise<void> {
    const el = pipEl as (HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> }) | null;
    try {
      if (
        el?.requestPictureInPicture &&
        typeof document !== 'undefined' &&
        document.pictureInPictureEnabled &&
        document.pictureInPictureElement !== el
      ) {
        await el.requestPictureInPicture();
      }
    } catch (e) {
      console.warn(`[${instanceId}] Picture-in-Picture failed`, e);
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────
  const LINUX_CAMERA_AUTOSTART_DELAY_MS = 1200;

  function logWebViewMediaSupport(): void {
    const has = (name: string) => name in globalThis;
    logVideo(
      'info',
      `WebView media support: RTCPeerConnection=${has('RTCPeerConnection')} ` +
        `webkitRTCPeerConnection=${has('webkitRTCPeerConnection')} ` +
        `MediaSource=${has('MediaSource')} ManagedMediaSource=${has('ManagedMediaSource')} ` +
        `captureStream=${typeof document !== 'undefined' && 'captureStream' in document.createElement('video')}`,
    );
  }

  async function initVideo(): Promise<void> {
    logWebViewMediaSupport();
    void listen('video-mjpeg-ended', () => reportMjpegError()).catch(() => {});
    if (mediaDevicesAvailable() && !isLinux) await enumerateVideoDevices();
    if (!boot.enabled) return;
    if (isLinux && get(videoState).kind === 'camera') {
      setTimeout(() => void startActive(), LINUX_CAMERA_AUTOSTART_DELAY_MS);
      return;
    }
    await startActive();
  }

  function reportMjpegError(): void {
    const st = get(videoState);
    if (!st.enabled || st.kind !== 'rtsp') return;
    rtspMjpegFailures++;
    if (rtspMjpegFailures >= RTSP_MJPEG_MAX_FAILS) {
      logVideo('warn', 'MJPEG fallback failed repeatedly → reconnect');
      rtspMjpegFailures = 0;
      stopVideo();
      startRtsp({ reconnect: true });
    }
  }

  async function isWebrtcAvailable(): Promise<boolean> {
    return typeof window !== 'undefined' && ('RTCPeerConnection' in window || 'webkitRTCPeerConnection' in window);
  }

  function toggleVideo(): void {
    const st = get(videoState);
    if (st.enabled) {
      stopVideo();
    } else {
      patch({ enabled: true });
      savePrefs(get(videoState));
      startActive();
    }
  }

  return {
    videoState,
    videoStream,
    videoRtcStats,
    initVideo,
    startVideo,
    startRtsp,
    startNative,
    startActive,
    stopVideo,
    toggleVideo,
    setVideoKind,
    setRtspUrl,
    setRtspTransport,
    saveRtspConnection,
    updateRtspConnection,
    removeRtspConnection,
    selectRtspConnection,
    setNativeDevice,
    setNativeResolution,
    setNativeCodec,
    setNativeFramerate,
    setCameraFps,
    setVideoDevice,
    setVideoResolution,
    setVideoMirror,
    setDisableHwAccel,
    toggleFloating,
    setFloatSnapped,
    setFloatPos,
    setFloatHeightFrac,
    setMapLocation,
    setWidgetRect,
    setWidgetRect2,
    registerPiPElement,
    enterPiP,
    bindVideoEl,
    reportVideoSize,
    reportMjpegError,
    enumerateVideoDevices,
    enumerateNativeDevices,
    probeNativeDevice,
  };
}

// Create the two independent video router instances
export const video1 = createVideoRouter('video1');
export const video2 = createVideoRouter('video2');

// Backwards-compatible default exports (point to video1)
export const {
  videoState,
  videoStream,
  videoRtcStats,
  initVideo,
  startVideo,
  startRtsp,
  startNative,
  startActive,
  stopVideo,
  toggleVideo,
  setVideoKind,
  setRtspUrl,
  setRtspTransport,
  saveRtspConnection,
  updateRtspConnection,
  removeRtspConnection,
  selectRtspConnection,
  setNativeDevice,
  setNativeResolution,
  setNativeCodec,
  setNativeFramerate,
  setCameraFps,
  setVideoDevice,
  setVideoResolution,
  setVideoMirror,
  setDisableHwAccel,
  toggleFloating,
  setFloatSnapped,
  setFloatPos,
  setFloatHeightFrac,
  setMapLocation,
  setWidgetRect,
  setWidgetRect2,
  registerPiPElement,
  enterPiP,
  bindVideoEl,
  reportVideoSize,
  reportMjpegError,
  enumerateVideoDevices,
  enumerateNativeDevices,
  probeNativeDevice,
} = video1;