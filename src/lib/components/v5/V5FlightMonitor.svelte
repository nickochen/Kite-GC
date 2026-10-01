<!--
  SPDX-License-Identifier: GPL-3.0-or-later
  v5 flight-monitor layout: top bar / left telemetry / center (map shows through) /
  right VTOL / bottom mode bar. Rendered inside .ui-scale (pointer-events:none),
  so interactive children opt back in.
-->
<script lang="ts">
  import V5TopBar from './V5TopBar.svelte';
  import V5TelemetryPanel from './V5TelemetryPanel.svelte';
  import V5VtolPanel from './V5VtolPanel.svelte';
  import V5ModeBar from './V5ModeBar.svelte';

  let {
    onOpenPanel,
    onToggleClassic,
    onTogglePanels,
  }: {
    onOpenPanel: (tab: string) => void;
    onToggleClassic: () => void;
    onTogglePanels: () => void;
  } = $props();
</script>

<div class="v5-root">
  <header class="v5-top v5-hit">
    <V5TopBar {onOpenPanel} {onToggleClassic} {onTogglePanels} />
  </header>
  <aside class="v5-left v5-panel v5-hit">
    <V5TelemetryPanel />
  </aside>
  <!-- center cell stays transparent: the Leaflet map in .layer-map shows through -->
  <div class="v5-center"></div>
  <aside class="v5-right v5-panel v5-hit">
    <V5VtolPanel />
  </aside>
  <footer class="v5-bottom v5-hit">
    <V5ModeBar />
  </footer>
</div>

<style>
  .v5-root {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-rows: 56px 1fr 76px;
    grid-template-columns: 320px 1fr 320px;
    grid-template-areas:
      'top top top'
      'left center right'
      'bottom bottom bottom';
    gap: 12px;
    padding: 12px;
    pointer-events: none;
  }
  .v5-hit {
    pointer-events: auto;
    min-width: 0;
    min-height: 0;
  }
  .v5-top { grid-area: top; }
  .v5-left { grid-area: left; }
  .v5-center { grid-area: center; pointer-events: none; }
  .v5-right { grid-area: right; }
  .v5-bottom { grid-area: bottom; }
  .v5-panel {
    background: rgba(16, 20, 28, 0.88);
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 12px;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 14px 16px;
  }
  .v5-panel::-webkit-scrollbar { width: 6px; }
  .v5-panel::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 3px;
  }
</style>
