<!--
  SPDX-License-Identifier: GPL-3.0-or-later
  Copyright (C) 2026 Marc Hoffmann (b14ckyy)
-->

<script lang="ts">
  // V5 flight-monitor bottom mode bar (design mockup v5): the five flight modes the Y3
  // tilt-rotor UI exposes — QLOITER / FBWA / CRUISE / AUTO / RTL — plus a hold-to-confirm
  // emergency disarm button on the right. Mode labels stay uppercase English by design
  // (proper nouns, not translated).
  import { setMode, disarm, activeMode, stickModesUnlocked } from '$lib/controllers/vehicleControl';
  import { modesFor, type MavMode } from '$lib/helpers/mavModes';
  import { autopilotSystem } from '$lib/stores/autopilotContext';
  import { arduVehicleClass } from '$lib/stores/missionArdupilot';
  import HoldToConfirm from '../panel/HoldToConfirm.svelte';
  import { t } from 'svelte-i18n';

  const MODE_KEYS = ['qloiter', 'fbwa', 'cruise', 'auto', 'rtl'] as const;

  /** Hardcoded ArduPlane fallback used when the firmware/vehicle table has no entry for a key. */
  const FALLBACKS: Record<(typeof MODE_KEYS)[number], MavMode> = {
    qloiter: { key: 'qloiter', name: 'QLoiter', main: 19, sub: 0, stick: false },
    fbwa:    { key: 'fbwa',    name: 'FBWA',    main: 5,  sub: 0, stick: true },
    cruise:  { key: 'cruise',  name: 'Cruise',  main: 7,  sub: 0, stick: false },
    auto:    { key: 'auto',    name: 'Auto',    main: 10, sub: 0, stick: false },
    rtl:     { key: 'rtl',     name: 'RTL',     main: 11, sub: 0, stick: false },
  };

  const barModes = $derived(
    MODE_KEYS.map(
      (key) =>
        modesFor($autopilotSystem, $arduVehicleClass).find((m) => m.key === key) ?? FALLBACKS[key],
    ),
  );

  // Same stick-mode safety rule as MavCommandPanel: a stick-flown mode needs a usable RC source
  // (physical transmitter OR Kite's own RC control engaged). Without one the button stays disabled.
  const stickUnlocked = $derived($stickModesUnlocked);
  const activeKey = $derived($activeMode?.key);

  const locked = (m: MavMode): boolean => m.stick && !stickUnlocked;

  function selectMode(m: MavMode): void {
    if (locked(m)) return;
    void setMode(m);
  }
</script>

<div class="v5-modebar">
  <div class="modes">
    {#each barModes as m (m.key)}
      <button
        type="button"
        class="mode"
        class:active={activeKey === m.key}
        disabled={locked(m)}
        title={locked(m) ? $t('control.rcLockHint') : m.name}
        onclick={() => selectMode(m)}
      >
        {m.name.toUpperCase()}
      </button>
    {/each}
  </div>
  <div class="right">
    <span class="safety">{$t('v5.modebar.safety')}</span>
    <span class="emg">
      <HoldToConfirm
        variant="danger"
        duration={1500}
        title={$t('v5.modebar.emergencyHint')}
        onconfirm={() => disarm(true)}
      >
        <svg class="warn" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            d="M12 3 1.8 20.2h20.4L12 3zm0 4.2 6.9 11.6H5.1L12 7.2zM11 10v4h2v-4h-2zm0 5v2h2v-2h-2z"
            fill="currentColor"
          />
        </svg>
        {$t('v5.modebar.emergency')}
      </HoldToConfirm>
    </span>
  </div>
</div>

<style>
  .v5-modebar {
    display: flex;
    align-items: center;
    gap: 16px;
    height: 76px;
    padding: 0 20px;
    background: #14171e;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    flex: none;
  }

  .modes {
    display: flex;
    gap: 14px;
    flex: 1 1 auto;
    min-width: 0;
  }

  .mode {
    flex: 1 1 0;
    max-width: 220px;
    height: 48px;
    border: 1px solid transparent;
    border-radius: 12px;
    background: #262c38;
    color: #c9d2e0;
    font-size: 17px;
    font-weight: 700;
    letter-spacing: 0.06em;
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s, transform 0.1s;
  }
  .mode:hover:not(:disabled) { background: #303848; }
  .mode:active:not(:disabled) { transform: scale(0.98); }
  .mode.active { background: #35b6e8; color: #0b1c26; }
  .mode:disabled { opacity: 0.4; cursor: not-allowed; }

  .right {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-left: auto;
    flex: none;
  }

  .safety {
    color: #8b93a5;
    font-size: 13px;
    white-space: nowrap;
  }

  /* HoldToConfirm exposes its palette through --htc-* custom properties; override them
     here so the emergency button is solid red with white text like the mockup. */
  .emg :global(.htc.danger) {
    --htc-bg: #cf2e2e;
    --htc-border: #cf2e2e;
    --htc-fg: #ffffff;
    --htc-fill: rgba(255, 255, 255, 0.35);
    width: auto;
    min-height: 48px;
    padding: 0 30px;
    border-radius: 12px;
    font-size: 16px;
    font-weight: 700;
  }
  .emg :global(.htc .label) { gap: 8px; }
  .warn { flex: none; }
</style>
