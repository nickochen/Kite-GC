// SPDX-License-Identifier: GPL-3.0-or-later
// V5 flight-monitor telemetry panel ("遥测数据"). Content only — container styling is owned by the
// parent. All strings go through $t('v5.telemetry.*'); all values are real store data.

<script lang="ts">
  import { telemetry } from '$lib/stores/telemetry';
  import { isArmed } from '$lib/controllers/vehicleControl';
  import { statusTexts } from '$lib/stores/statusText';
  import { MODE_REGISTRY } from '$lib/helpers/flightModeRegistry';
  import { t } from 'svelte-i18n';

  const COMPASS16 = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
  ];

  const compassOf = (deg: number) =>
    COMPASS16[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

  /** Most recent 8 messages, newest first. The buffer has no timestamps, so show text only. */
  $: logLines = [...$statusTexts].slice(-8).reverse();
</script>

<div class="v5-telemetry">
  <div class="panel-title">{$t('v5.telemetry.title')}</div>

  <!-- ── Flight state ─────────────────────────────────────────── -->
  <section class="group">
    <div class="group-title">{$t('v5.telemetry.flightState')}</div>
    <span class="state-badge" class:armed={$isArmed}>
      {$isArmed ? $t('v5.telemetry.flying') : $t('v5.telemetry.standby')}
    </span>
    <div class="row">
      <span class="label">{$t('v5.telemetry.curMode')}</span>
      <span class="value mode">
        {MODE_REGISTRY[$telemetry.flightMode.primary]?.label ?? $telemetry.flightMode.primary}
      </span>
    </div>
    <div class="row">
      <span class="label">{$t('v5.telemetry.altitude')}</span>
      <span class="value">{($telemetry.altMsl || $telemetry.altitude).toFixed(1)} m</span>
    </div>
    <div class="row">
      <span class="label">{$t('v5.telemetry.airspeed')}</span>
      <span class="value">{$telemetry.airspeed.toFixed(1)} m/s</span>
    </div>
    <div class="row">
      <span class="label">{$t('v5.telemetry.groundspeed')}</span>
      <span class="value">{$telemetry.groundSpeed.toFixed(1)} m/s</span>
    </div>
  </section>

  <!-- ── Battery ──────────────────────────────────────────────── -->
  <section class="group">
    <div class="group-title">{$t('v5.telemetry.battery')}</div>
    <div class="big">
      {$telemetry.voltage.toFixed(1)}V • {$telemetry.current.toFixed(1)}A
    </div>
    <div class="bar">
      <div
        class="bar-fill batt"
        style="width: {Math.max(0, Math.min(100, $telemetry.batteryPercentage))}%"
      ></div>
    </div>
    <div class="row">
      <span class="label">{$t('v5.telemetry.remaining')}</span>
      <span class="value">{$telemetry.batteryPercentage.toFixed(0)}%</span>
    </div>
    <div class="row">
      <span class="label">{$t('v5.telemetry.used')}</span>
      <span class="value">{$telemetry.mAhDrawn.toFixed(0)} mAh</span>
    </div>
  </section>

  <!-- ── RC link ──────────────────────────────────────────────── -->
  <section class="group">
    <div class="group-title">{$t('v5.telemetry.link')}</div>
    <div class="row">
      <span class="label">{$t('v5.telemetry.linkQuality')}</span>
      <span class="value">
        {$telemetry.link.lq != null ? `${$telemetry.link.lq.toFixed(0)}%` : '—'}
      </span>
    </div>
    <div class="bar">
      {#if $telemetry.link.lq != null}
        <div
          class="bar-fill link"
          style="width: {Math.max(0, Math.min(100, $telemetry.link.lq))}%"
        ></div>
      {/if}
    </div>
  </section>

  <!-- ── Wind ─────────────────────────────────────────────────── -->
  <section class="group">
    <div class="group-title">{$t('v5.telemetry.wind')}</div>
    {#if $telemetry.windSpeedMs > 0}
      <div class="big">
        {$telemetry.windSpeedMs.toFixed(1)} m/s {compassOf($telemetry.windDirFrom)}
      </div>
      <div class="row">
        <span class="label">{$t('v5.telemetry.windDir')}</span>
        <span class="value">{$telemetry.windDirFrom.toFixed(0)}°</span>
      </div>
    {:else}
      <div class="big">—</div>
    {/if}
  </section>

  <!-- ── System log ───────────────────────────────────────────── -->
  <section class="group">
    <div class="group-title">{$t('v5.telemetry.log')}</div>
    {#if logLines.length > 0}
      <ul class="log">
        {#each logLines as msg (msg.id)}
          <li class="log-line level-{msg.level}">{msg.text}</li>
        {/each}
      </ul>
    {:else}
      <div class="no-log">{$t('v5.telemetry.noLog')}</div>
    {/if}
  </section>
</div>

<style>
  .v5-telemetry {
    display: flex;
    flex-direction: column;
    gap: 18px;
    color: #e8edf2;
    font-family: inherit;
  }

  .panel-title {
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }

  .group-title {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.18em;
    color: #8b95a1;
    margin-bottom: 8px;
  }

  .state-badge {
    display: inline-block;
    padding: 4px 16px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 600;
    background: #3a4149;
    color: #c7cfd8;
    margin-bottom: 8px;
  }
  .state-badge.armed {
    background: #2e7d4f;
    color: #ffffff;
  }

  .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 2px 0;
  }

  .label {
    font-size: 14px;
    color: #c7cfd8;
    white-space: nowrap;
  }

  .value {
    font-size: 16px;
    font-variant-numeric: tabular-nums;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    color: #ffffff;
    text-align: right;
  }
  .value.mode {
    color: #7cc7ff;
  }

  .big {
    font-size: 20px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    color: #ffffff;
    margin: 2px 0 6px;
  }

  .bar {
    height: 6px;
    border-radius: 3px;
    background: #2c333b;
    overflow: hidden;
    margin-bottom: 8px;
  }
  .bar-fill {
    height: 100%;
    border-radius: 3px;
  }
  .bar-fill.batt {
    background: linear-gradient(90deg, #f5a623, #f5c542);
  }
  .bar-fill.link {
    background: #34c759;
  }

  .log {
    list-style: none;
    margin: 0;
    padding: 10px 12px;
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid #2c333b;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 220px;
    overflow-y: auto;
  }
  .log-line {
    font-size: 13px;
    line-height: 1.4;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    word-break: break-word;
    color: #9aa4ae;
  }
  .log-line.level-info {
    color: #9aa4ae;
  }
  .log-line.level-warning {
    color: #f5a623;
  }
  .log-line.level-error {
    color: #ff5c5c;
  }
  .no-log {
    font-size: 13px;
    color: #6b7480;
  }
</style>
