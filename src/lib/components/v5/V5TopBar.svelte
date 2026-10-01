<!-- V5TopBar — v5 飞行监控顶栏：品牌 + 状态 chips + 右侧操作按钮 -->
<script lang="ts">
  import { t } from 'svelte-i18n';
  import { connection } from '$lib/stores/connection';
  import { telemetry } from '$lib/stores/telemetry';
  import { isArmed } from '$lib/controllers/vehicleControl';
  import { version } from '../../../../package.json';

  interface Props {
    onOpenPanel: (tab: string) => void;
    onToggleClassic: () => void;
    onTogglePanels: () => void;
  }

  let { onOpenPanel, onToggleClassic, onTogglePanels }: Props = $props();

  // 飞行计时：解锁上升沿开始计时，上锁清零
  let flightSeconds = $state(0);
  let timer: ReturnType<typeof setInterval> | null = null;

  $effect(() => {
    if ($isArmed) {
      if (timer === null) timer = setInterval(() => flightSeconds++, 1000);
    } else {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      flightSeconds = 0;
    }
  });

  function fmtTime(s: number): string {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':');
  }

  const linked = $derived($connection.status === 'connected');

  const gpsChip = $derived.by(() => {
    const t2 = $telemetry;
    if (t2.fixType >= 3) return { text: `GPS 3D Fix • ${t2.numSat}星 • HDOP ${t2.gpsHdop.toFixed(1)}`, ok: true };
    if (t2.fixType === 2) return { text: `GPS 2D Fix • ${t2.numSat}星`, ok: true };
    return { text: $t('v5.topbar.gpsNoFix'), ok: false };
  });

  const lowBatt = $derived($telemetry.batteryPercentage < 25);
</script>

<header class="v5-topbar">
  <!-- 左：品牌 -->
  <div class="brand">
    <svg class="logo" viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
      <g stroke="#4fc3f7" stroke-width="1.8" fill="none" stroke-linecap="round">
        <line x1="9" y1="9" x2="23" y2="23" />
        <line x1="23" y1="9" x2="9" y2="23" />
        <circle cx="8" cy="8" r="3.6" />
        <circle cx="24" cy="8" r="3.6" />
        <circle cx="8" cy="24" r="3.6" />
        <circle cx="24" cy="24" r="3.6" />
        <circle cx="16" cy="16" r="2.6" fill="#4fc3f7" stroke="none" />
      </g>
    </svg>
    <span class="brand-text">ArduPlane GCS v{version}</span>
    <span class="brand-sep">—</span>
    <span class="brand-title">{$t('v5.topbar.title')}</span>
  </div>

  <!-- 中：状态 chips -->
  <div class="chips">
    <span class="chip" class:ok={linked} title={$t('v5.topbar.linkConnected')}>
      <span class="dot" class:on={linked}></span>
      {linked ? $t('v5.topbar.linkConnected') : $t('v5.topbar.linkDown')}
    </span>
    <span class="chip" class:ok={gpsChip.ok}>
      {#if gpsChip.ok}<span class="gps-badge">GPS</span>{/if}
      {gpsChip.text}
    </span>
    <span class="chip neutral">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          d="M8 1.5 13.5 3.5v4c0 3.2-2.4 5.4-5.5 6.5C4.9 12.9 2.5 10.7 2.5 7.5v-4L8 1.5z"
          fill="none"
          stroke="#9aa4b2"
          stroke-width="1.4"
        />
      </svg>
      {$t('v5.topbar.paramProtect')}·{$t('v5.topbar.unknown')}
    </span>
    <span class="chip">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle cx="8" cy="8" r="6.4" fill="none" stroke="#9aa4b2" stroke-width="1.4" />
        <path d="M8 4.5V8l2.4 1.6" fill="none" stroke="#9aa4b2" stroke-width="1.4" stroke-linecap="round" />
      </svg>
      {$t('v5.topbar.flightTime')} {fmtTime(flightSeconds)}
    </span>
    <span class="chip" class:warn={lowBatt}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <rect x="1.5" y="4.5" width="11" height="7" rx="1.6" fill="none" stroke={lowBatt ? '#ffb020' : '#9aa4b2'} stroke-width="1.4" />
        <rect x="13.2" y="6.8" width="1.8" height="2.4" rx="0.8" fill={lowBatt ? '#ffb020' : '#9aa4b2'} />
      </svg>
      {$t('v5.topbar.onboard')} {$telemetry.voltage.toFixed(1)}V {$telemetry.batteryPercentage}%
    </span>
  </div>

  <!-- 右：操作按钮 -->
  <div class="actions">
    <button class="btn text-btn" onclick={onTogglePanels} title={$t('v5.topbar.panels')}>
      {$t('v5.topbar.panels')}
    </button>
    <button class="btn icon-btn" onclick={() => onOpenPanel('settings')} aria-label="settings">
      <svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true">
        <path
          d="M8 10.2A2.2 2.2 0 1 0 8 5.8a2.2 2.2 0 0 0 0 4.4zM14 9.9l-.7 1.6.5 1-1.4 1.4-1-.5-1.6.7-.3 1.1h-2L7.2 14l-1.6-.7-1 .5-1.4-1.4.5-1L3 9.9l-1.1-.3v-2L3 7.2 3.7 5.6l-.5-1 1.4-1.4 1 .5 1.6-.7L7.5.9h2l.3 1.1 1.6.7 1-.5 1.4 1.4-.5 1 .7 1.6 1.1.3v2l-1.1.3z"
          fill="none"
          stroke="#e8ecf1"
          stroke-width="1.1"
          transform="scale(0.94) translate(0.5 0.5)"
        />
      </svg>
    </button>
    <button class="btn icon-btn" onclick={() => onOpenPanel('uav-info')} aria-label="notifications">
      <svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true">
        <path
          d="M8 1.8a4.2 4.2 0 0 0-4.2 4.2v2.3L2.4 10a.6.6 0 0 0 .5 1h10.2a.6.6 0 0 0 .5-1l-1.4-1.7V6A4.2 4.2 0 0 0 8 1.8zM6.4 12.4a1.7 1.7 0 0 0 3.2 0H6.4z"
          fill="none"
          stroke="#e8ecf1"
          stroke-width="1.3"
          stroke-linejoin="round"
        />
      </svg>
    </button>
    <button class="btn text-btn" onclick={onToggleClassic} title={$t('v5.topbar.classicUi')}>
      {$t('v5.topbar.classicUi')}
    </button>
  </div>
</header>

<style>
  .v5-topbar {
    height: 56px;
    flex: 0 0 56px;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 14px;
    background: rgba(13, 17, 24, 0.92);
    border-bottom: 1px solid rgba(255, 255, 255, 0.09);
    color: #e8ecf1;
    user-select: none;
    overflow: hidden;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 0 0 auto;
    white-space: nowrap;
  }

  .logo {
    flex: 0 0 auto;
  }

  .brand-text {
    font-size: 15px;
    font-weight: 600;
    color: #e8ecf1;
    letter-spacing: 0.2px;
  }

  .brand-sep {
    color: #9aa4b2;
  }

  .brand-title {
    font-size: 14px;
    color: #9aa4b2;
  }

  .chips {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-width: 0;
    overflow: hidden;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 6px 13px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.09);
    font-size: 13px;
    color: #9aa4b2;
    white-space: nowrap;
  }

  .chip.ok {
    color: #3ddc84;
  }

  .chip.warn {
    color: #ffb020;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #9aa4b2;
    flex: 0 0 auto;
  }

  .dot.on {
    background: #3ddc84;
    box-shadow: 0 0 6px rgba(61, 220, 132, 0.8);
  }

  .gps-badge {
    font-size: 10px;
    font-weight: 700;
    padding: 2px 5px;
    border-radius: 4px;
    background: rgba(79, 195, 247, 0.16);
    color: #4fc3f7;
    letter-spacing: 0.4px;
  }

  .actions {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.05);
    color: #e8ecf1;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .btn:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.18);
  }

  .text-btn {
    height: 36px;
    padding: 0 14px;
    font-size: 13px;
    white-space: nowrap;
  }

  .icon-btn {
    width: 36px;
    height: 36px;
    padding: 0;
  }
</style>
