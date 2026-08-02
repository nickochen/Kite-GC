<!--
  SPDX-License-Identifier: GPL-3.0-or-later
  Copyright (C) 2026 Marc Hoffmann (b14ckyy)
-->

<script lang="ts">
  import { t } from 'svelte-i18n';
  import { onMount, onDestroy } from 'svelte';
  import {
    video1,
    video2,
    type VideoRouter,
    bindVideoEl,
    setMapLocation,
    setWidgetRect,
    reportMjpegError,
  } from '$lib/stores/video';
  import { canvasSink, mjpegSink } from '$lib/controllers/mjpegSink';
  import VideoReconnectOverlay from '$lib/components/video/VideoReconnectOverlay.svelte';

  // Which video instance this widget displays ('video1' or 'video2')
  let {
    instanceId = 'video1',
    width = 300,
    height = 150,
  }: { instanceId?: 'video1' | 'video2'; width?: number; height?: number } = $props();
  const current: VideoRouter = $derived(instanceId === 'video1' ? video1 : video2);
  const videoState = $derived(current.videoState);
  const videoStream = $derived(current.videoStream);

  const mapHere = $derived(
    instanceId === 'video1' ? $videoState.mapLocation === 'widget' : $videoState.mapLocation === 'widget2',
  );

  let cardEl = $state<HTMLDivElement | null>(null);
  let videoEl = $state<HTMLVideoElement | null>(null);
  $effect(() => {
    bindVideoEl(videoEl, $videoStream);
  });

  function measure() {
    if (!cardEl) return;
    const r = cardEl.getBoundingClientRect();
    const rect = { x: r.left, y: r.top, w: r.width, h: r.height };
    if (instanceId === 'video1') current.setWidgetRect(rect);
    else current.setWidgetRect2(rect);
  }
  $effect(() => {
    void width;
    void height;
    measure();
  });
  onMount(() => {
    measure();
    let ro: ResizeObserver | undefined;
    if (cardEl && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure());
      ro.observe(cardEl);
    }
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  });
  onDestroy(() => {
    if (instanceId === 'video1') current.setWidgetRect(null);
    else current.setWidgetRect2(null);
    if (mapHere) current.setMapLocation('main'); // tile gone → don't strand the map
  });

  function swapHere() {
    if ($videoState.status !== 'live' || mapHere) return;
    current.setMapLocation(instanceId === 'video1' ? 'widget' : 'widget2');
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div bind:this={cardEl} class="widget-card" style="width:{width}px; height:{height}px;" ondblclick={swapHere}>
  {#if mapHere}
    <!-- The map is overlaid here by +page (top-level). Keep an empty sized tile underneath. -->
    <div class="placeholder map-here"></div>
  {:else if $videoState.status === 'live' && $videoState.mjpegUrl}
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
    <video
      bind:this={videoEl}
      autoplay
      muted
      playsinline
      class:mirror={$videoState.mirror}
    ></video>
  {:else}
    <div class="placeholder">
      {$videoState.status === 'starting' ? $t('video.starting') : $t('video.off')}
    </div>
  {/if}
  <VideoReconnectOverlay />
</div>

<style>
  .widget-card {
    box-sizing: border-box;
    background: rgba(30, 30, 30, 0.75);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    padding: 3px;
    overflow: hidden;
    position: relative;
  }
  video,
  img,
  canvas,
  .placeholder {
    width: 100%;
    height: 100%;
    border-radius: 5px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: #000;
    display: block;
    box-sizing: border-box;
  }
  video,
  img,
  canvas {
    will-change: transform;
  }
  video.mirror,
  img.mirror,
  canvas.mirror {
    transform: scaleX(-1);
  }
  .placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #888;
    font-size: 12px;
  }
  .placeholder.map-here {
  }
</style>