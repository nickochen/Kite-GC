<!--
  SPDX-License-Identifier: GPL-3.0-or-later
  Copyright (C) 2026 Marc Hoffmann (b14ckyy)
-->

<script lang="ts">
  import { t } from 'svelte-i18n';
  import {
    video1,
    video2,
    type VideoRouter,
    bindVideoEl,
    setFloatPos,
    setFloatSnapped,
    setFloatHeightFrac,
    setMapLocation,
    toggleFloating,
    reportMjpegError,
  } from '$lib/stores/video';
  import { canvasSink, mjpegSink } from '$lib/controllers/mjpegSink';
  import VideoReconnectOverlay from '$lib/components/video/VideoReconnectOverlay.svelte';

  // Which video instance this floating window belongs to ('video1' or 'video2')
  let instanceId = $state<'video1' | 'video2'>('video1');
  const current: VideoRouter = $derived(instanceId === 'video1' ? video1 : video2);
  const videoState = $derived(current.videoState);
  const videoStream = $derived(current.videoStream);

  const mapHere = $derived($videoState.mapLocation === 'floating');

  let vw = $state(typeof window !== 'undefined' ? window.innerWidth : 1280);
  let vh = $state(typeof window !== 'undefined' ? window.innerHeight : 720);

  let videoEl = $state<HTMLVideoElement | null>(null);
  $effect(() => {
    bindVideoEl(videoEl, $videoStream);
  });

  const MARGIN = 8;
  const SNAP_BOTTOM = 30; // align the snapped bottom with the widgets (above the 24px status bar)
  const SNAP_THRESHOLD = 56;
  const FRAC_MIN = 0.1;
  const FRAC_MAX = 0.3;
  const MIN_H_PX = 200;

  let floatWinEl = $state<HTMLDivElement | null>(null);

  const aspect = $derived($videoState.aspect || 16 / 9);
  const height = $derived(
    Math.min(Math.round(FRAC_MAX * vh), Math.max(MIN_H_PX, Math.round($videoState.floatHeightFrac * vh))),
  );
  const width = $derived(Math.min(Math.round(height * aspect), Math.round(vw * 0.7)));
  const left = $derived($videoState.floatSnapped ? MARGIN : $videoState.floatX);
  const top = $derived($videoState.floatSnapped ? vh - height - SNAP_BOTTOM : $videoState.floatY);

  function closeWindow() {
    current.toggleFloating();
  }

  let pendingDrag = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let baseLeft = 0;
  let baseTop = 0;

  function onBodyPointerDown(e: PointerEvent) {
    if ((e.target as HTMLElement).closest('.fw-corner')) return; // let the corner controls handle it
    pendingDrag = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    baseLeft = left;
    baseTop = top;
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragUp);
  }
  function onDragMove(e: PointerEvent) {
    if (!pendingDrag) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    if (!moved) {
      moved = true;
      setFloatSnapped(false); // first real movement detaches from the corner
    }
    const nx = Math.max(0, Math.min(baseLeft + dx, vw - width));
    const ny = Math.max(0, Math.min(baseTop + dy, vh - height));
    current.setFloatPos(nx, ny);
  }
  function onDragUp() {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragUp);
    if (!pendingDrag) return;
    pendingDrag = false;
    if (!moved) return;
    const nearLeft = $videoState.floatX <= MARGIN + SNAP_THRESHOLD;
    const nearBottom = $videoState.floatY + height >= vh - SNAP_BOTTOM - SNAP_THRESHOLD;
    if (nearLeft && nearBottom) current.setFloatSnapped(true);
  }

  let resizing = false;
  let resizeStartY = 0;
  let startFrac = 0;
  let startBottom = 0;
  let startSnapped = false;
  function onResizePointerDown(e: PointerEvent) {
    e.stopPropagation();
    resizing = true;
    resizeStartY = e.clientY;
    startFrac = $videoState.floatHeightFrac;
    startBottom = top + height;
    startSnapped = $videoState.floatSnapped;
    window.addEventListener('pointermove', onResizeMove);
    window.addEventListener('pointerup', onResizeUp);
  }
  function onResizeMove(e: PointerEvent) {
    if (!resizing) return;
    const delta = (resizeStartY - e.clientY) / vh; // drag up → larger
    const fracMin = Math.max(FRAC_MIN, MIN_H_PX / vh); // honour the 4-button px floor
    const newFrac = Math.min(FRAC_MAX, Math.max(fracMin, startFrac + delta));
    current.setFloatHeightFrac(newFrac);
    if (!startSnapped) {
      current.setFloatPos($videoState.floatX, startBottom - newFrac * vh);
    }
  }
  function onResizeUp() {
    resizing = false;
    window.removeEventListener('pointermove', onResizeMove);
    window.removeEventListener('pointerup', onResizeUp);
  }

  let fmActive = false;
  let fmStartX = 0;
  let fmStartY = 0;
  let fmBaseLeft = 0;
  let fmBaseTop = 0;
  let fmMoved = false;

  function pointInFrame(cx: number, cy: number): boolean {
    const r = floatWinEl?.getBoundingClientRect();
    return !!r && cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
  }
  function frameMoveStart(cx: number, cy: number) {
    fmActive = true;
    fmMoved = false;
    fmStartX = cx;
    fmStartY = cy;
    fmBaseLeft = left;
    fmBaseTop = top;
  }
  function frameMoveTo(cx: number, cy: number) {
    if (!fmActive) return;
    const dx = cx - fmStartX;
    const dy = cy - fmStartY;
    if (!fmMoved && Math.hypot(dx, dy) < 4) return;
    if (!fmMoved) {
      fmMoved = true;
      current.setFloatSnapped(false);
    }
    current.setFloatPos(
      Math.max(0, Math.min(fmBaseLeft + dx, vw - width)),
      Math.max(0, Math.min(fmBaseTop + dy, vh - height)),
    );
  }
  function frameMoveEnd() {
    if (!fmActive) return;
    fmActive = false;
    if (!fmMoved) return;
    const nearLeft = $videoState.floatX <= MARGIN + SNAP_THRESHOLD;
    const nearBottom = $videoState.floatY + height >= vh - SNAP_BOTTOM - SNAP_THRESHOLD;
    if (nearLeft && nearBottom) current.setFloatSnapped(true);
  }

  const gestureCapture = $derived($videoState.floating && mapHere);
  $effect(() => {
    if (!gestureCapture) return;
    const mid = (t: TouchList) => ({
      x: (t[0].clientX + t[1].clientX) / 2,
      y: (t[0].clientY + t[1].clientY) / 2,
    });
    const onCtx = (e: MouseEvent) => {
      if (pointInFrame(e.clientX, e.clientY)) e.preventDefault(); // no context menu over the frame
    };
    const onPD = (e: PointerEvent) => {
      if (e.button === 2 && pointInFrame(e.clientX, e.clientY)) {
        e.preventDefault();
        e.stopPropagation();
        frameMoveStart(e.clientX, e.clientY);
      }
    };
    const onPM = (e: PointerEvent) => {
      if (fmActive) frameMoveTo(e.clientX, e.clientY);
    };
    const onPU = () => frameMoveEnd();
    const onTS = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const m = mid(e.touches);
        if (pointInFrame(m.x, m.y)) {
          e.preventDefault();
          e.stopPropagation();
          frameMoveStart(m.x, m.y);
        }
      }
    };
    const onTM = (e: TouchEvent) => {
      if (fmActive && e.touches.length >= 2) {
        e.preventDefault();
        e.stopPropagation();
        const m = mid(e.touches);
        frameMoveTo(m.x, m.y);
      }
    };
    const onTE = (e: TouchEvent) => {
      if (fmActive && e.touches.length < 2) frameMoveEnd();
    };
    window.addEventListener('contextmenu', onCtx, true);
    window.addEventListener('pointerdown', onPD, true);
    window.addEventListener('pointermove', onPM, true);
    window.addEventListener('pointerup', onPU, true);
    window.addEventListener('touchstart', onTS, { capture: true, passive: false });
    window.addEventListener('touchmove', onTM, { capture: true, passive: false });
    window.addEventListener('touchend', onTE, true);
    return () => {
      window.removeEventListener('contextmenu', onCtx, true);
      window.removeEventListener('pointerdown', onPD, true);
      window.removeEventListener('pointermove', onPM, true);
      window.removeEventListener('pointerup', onPU, true);
      window.removeEventListener('touchstart', onTS, true);
      window.removeEventListener('touchmove', onTM, true);
      window.removeEventListener('touchend', onTE, true);
    };
  });
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} />

{#if $videoState.floating}
  <!-- No z-index on the wrapper → no stacking context; layers compose with the top-level map. -->
  <div bind:this={floatWinEl} class="float-win" style="left:{left}px; top:{top}px; width:{width}px; height:{height}px;">
    <!-- Instance indicator badge -->
    <div class="fw-instance-badge">{instanceId === 'video1' ? 'Video 1' : 'Video 2'}</div>

    <!-- frame background (behind) — border + shadow only; the video/map covers it (object-fit: cover) -->
    <div class="fw-bg"></div>

    <!-- content: the video. When the map is in this frame, it's rendered (top-level) by +page here
         instead, and the body is omitted. Double-click the video → the map jumps into this frame. -->
    {#if !mapHere}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="fw-body" onpointerdown={onBodyPointerDown} ondblclick={() => current.setMapLocation('floating')}>
        {#if $videoState.status === 'live' && $videoState.mjpegUrl}
          <!-- Native / MJPEG feed (no MediaStream): drawn by the off-thread reader where the WebView
               allows it, otherwise the plain <img> multipart stream. -->
          {#if $canvasSink}
            <canvas use:mjpegSink class:mirror={$videoState.mirror}></canvas>
          {:else}
            <!-- svelte-ignore a11y_missing_attribute -->
            <img src={$videoState.mjpegUrl} class:mirror={$videoState.mirror} onerror={current.reportMjpegError} />
          {/if}
        {:else if $videoState.status === 'live'}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video bind:this={videoEl} autoplay muted playsinline class:mirror={$videoState.mirror}></video>
        {:else}
          <div class="fw-ph">{$videoState.status === 'starting' ? $t('video.starting') : $t('video.off')}</div>
        {/if}
        <VideoReconnectOverlay />
      </div>
    {/if}

    <!-- Corner controls (video mode only). When the map fills this frame, the map (a separate unzoomed
         top-level layer) covers these, so +page renders the equivalents above it. -->
    {#if !mapHere}
      <!-- close (top-left) — overlay, touch-sized -->
      <button class="fw-corner fw-close" onclick={closeWindow} title={$t('video.close')}>✕</button>

      <!-- resize grip (top-right) — visible, touch-sized -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="fw-corner fw-resize" onpointerdown={onResizePointerDown} title="Resize"></div>
    {/if}
  </div>
{/if}

<style>
  .float-win {
    position: absolute;
  }
  .fw-instance-badge {
    position: absolute;
    top: 4px;
    left: 8px;
    z-index: 65;
    background: rgba(0, 0, 0, 0.6);
    color: #e0e0e0;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
    pointer-events: none;
  }
  .fw-bg {
    position: absolute;
    inset: 0;
    z-index: 60;
    pointer-events: none;
    background: rgba(46, 46, 46, 0.92);
    border: 1px solid rgba(55, 168, 219, 0.35);
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  }
  .fw-body {
    position: absolute;
    inset: 0;
    z-index: 61;
    pointer-events: auto;
    background: #000;
    overflow: hidden;
    border-radius: 8px;
    cursor: grab;
  }
  .fw-body:active {
    cursor: grabbing;
  }
  .fw-body video,
  .fw-body img,
  .fw-body canvas {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    will-change: transform;
  }
  .fw-body video.mirror,
  .fw-body img.mirror,
  .fw-body canvas.mirror {
    transform: scaleX(-1);
  }
  .fw-ph {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #888;
    font-size: 12px;
  }

  .fw-corner {
    position: absolute;
    top: 0;
    width: 26px;
    height: 26px;
    z-index: 62;
    pointer-events: auto;
    box-sizing: border-box;
    touch-action: none;
  }
  .fw-close {
    left: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    line-height: 1;
    color: #e0e0e0;
    background: rgba(0, 0, 0, 0.45);
    border: none;
    border-radius: 8px 0 8px 0;
    cursor: pointer;
  }
  .fw-close:hover {
    background: rgba(212, 0, 0, 0.7);
    color: #fff;
  }
  .fw-resize {
    right: 0;
    cursor: nesw-resize;
    border-radius: 0 8px 0 8px;
    background: linear-gradient(225deg, rgba(55, 168, 219, 0.85) 42%, transparent 42%);
  }
  .fw-resize:hover {
    background: linear-gradient(225deg, rgba(55, 168, 219, 1) 50%, transparent 50%);
  }
</style>