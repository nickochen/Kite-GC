<script lang="ts">
  // V5 flight-monitor right column: tilt-rotor & VTOL status panel.
  import { telemetry } from '$lib/stores/telemetry';
  import { MODE_REGISTRY } from '$lib/helpers/flightModeRegistry';
  import { t } from 'svelte-i18n';
  import { invoke } from '@tauri-apps/api/core';

  const ATT_SIZE = 200;      // CSS px
  const PX_PER_DEG = 3;      // pitch ladder scale
  const STRIP_H = 52;        // compass strip CSS height
  const STRIP_PX_PER_DEG = 4;

  let attitudeEl: HTMLCanvasElement | null = $state(null);
  let compassEl: HTMLCanvasElement | null = $state(null);

  // 16-wind compass rose label for a heading in degrees.
  function compass16(deg: number): string {
    const names = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    return names[Math.round(deg / 22.5) % 16];
  }

  function norm360(deg: number): number {
    return ((deg % 360) + 360) % 360;
  }

  function drawAttitude(): void {
    const canvas = attitudeEl;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const size = ATT_SIZE;
    if (canvas.width !== Math.round(size * dpr)) {
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const tele = $telemetry;
    const roll = tele.roll ?? 0;
    const pitch = tele.pitch ?? 0;
    const r = size / 2;
    const rad = (deg: number): number => (deg * Math.PI) / 180;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    // Circular dial
    ctx.save();
    ctx.beginPath();
    ctx.arc(r, r, r - 2, 0, Math.PI * 2);
    ctx.clip();

    // Rotating/tilting world: horizon rotates opposite to roll, moves down with pitch-up.
    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(-rad(roll));
    ctx.translate(0, pitch * PX_PER_DEG);

    const span = size * 1.5;
    ctx.fillStyle = '#3a7ca5'; // sky
    ctx.fillRect(-span, -span, span * 2, span);
    ctx.fillStyle = '#8b5a2b'; // ground
    ctx.fillRect(-span, 0, span * 2, span);

    // Horizon line
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-span, 0);
    ctx.lineTo(span, 0);
    ctx.stroke();

    // Pitch ladder
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let p = -30; p <= 30; p += 10) {
      if (p === 0) continue;
      const y = -p * PX_PER_DEG;
      const half = p % 20 === 0 ? 28 : 18;
      ctx.beginPath();
      ctx.moveTo(-half, y);
      ctx.lineTo(half, y);
      ctx.stroke();
      ctx.fillText(Math.abs(p).toString(), -half - 12, y);
      ctx.fillText(Math.abs(p).toString(), half + 12, y);
    }
    ctx.restore();

    // Fixed aircraft symbol (does not rotate)
    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-34, 0);
    ctx.lineTo(-10, 0);
    ctx.lineTo(-10, 7);
    ctx.moveTo(34, 0);
    ctx.lineTo(10, 0);
    ctx.lineTo(10, 7);
    ctx.stroke();
    ctx.fillStyle = '#ffd54f';
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Dial bezel
    ctx.beginPath();
    ctx.arc(r, r, r - 2, 0, Math.PI * 2);
    ctx.strokeStyle = '#4fc3f7';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawCompassStrip(): void {
    const canvas = compassEl;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const parent = canvas.parentElement;
    const w = parent ? parent.clientWidth : 240;
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(STRIP_H * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, STRIP_H);

    const yaw = norm360($telemetry.yaw ?? 0);
    const center = w / 2;
    const labels: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

    // Background track
    ctx.fillStyle = 'rgba(10,14,20,0.6)';
    ctx.fillRect(0, 8, w, STRIP_H - 16);

    // Ticks: minor every 15°, major every 45°
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const halfRange = (w / 2) / STRIP_PX_PER_DEG;
    for (let d = -15; d < 360; d += 15) {
      const dd = ((d % 360) + 360) % 360;
      let delta = dd - yaw;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      if (Math.abs(delta) > halfRange) continue;
      const x = center + delta * STRIP_PX_PER_DEG;
      const isMajor = dd % 45 === 0;
      const isCard = dd % 90 === 0;
      ctx.strokeStyle = isCard ? '#e8ecf1' : '#9aa4b2';
      ctx.lineWidth = isMajor ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 12);
      ctx.lineTo(x, isMajor ? 26 : 20);
      ctx.stroke();
      if (isMajor) {
        ctx.fillStyle = isCard ? '#4fc3f7' : '#9aa4b2';
        ctx.font = (isCard ? 'bold 12px' : '11px') + ' sans-serif';
        ctx.fillText(labels[dd], x, 30);
      } else {
        ctx.fillStyle = '#5b6675';
        ctx.font = '9px sans-serif';
        ctx.fillText(dd.toString().padStart(3, '0'), x, 30);
      }
    }

    // Center pointer
    ctx.fillStyle = '#ff6b6b';
    ctx.beginPath();
    ctx.moveTo(center - 6, 4);
    ctx.lineTo(center + 6, 4);
    ctx.lineTo(center, 12);
    ctx.closePath();
    ctx.fill();
  }

  // ── Tilt servo channel mapping ──────────────────────────────────────
  // Angle convention (user-confirmed): 0° = forward flight (motors forward),
  // 90° = hover (motors up). Each channel stores the PWM measured at those two
  // physical positions; swapping the two values == reversing the direction.
  interface ServoCfg {
    ch: number;       // 0 = unset, 1..16 = servo channel
    fwdUs: number;    // PWM at 0°  (level/forward flight)
    hovUs: number;    // PWM at 90° (hover)
  }

  interface ServoLimit {
    channel: number;
    min_us: number | null;
    max_us: number | null;
    reversed: boolean | null;
  }

  const LS_KEY = 'kite-gc-v5-tilt-servo';

  function defaultCfg(): ServoCfg {
    return { ch: 0, fwdUs: 1000, hovUs: 2000 };
  }

  let flCfg: ServoCfg = $state(defaultCfg());
  let frCfg: ServoCfg = $state(defaultCfg());
  let cfgLoaded = $state(false);

  // Load persisted mapping once (client-only; never overwrites user edits).
  // Migrates the old minUs/maxUs/reversed shape to fwdUs/hovUs.
  $effect(() => {
    if (cfgLoaded) return;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as {
          fl?: Partial<ServoCfg> & { minUs?: number; maxUs?: number };
          fr?: Partial<ServoCfg> & { minUs?: number; maxUs?: number };
        };
        const migrate = (s?: typeof saved.fl): ServoCfg => {
          const base = defaultCfg();
          if (!s) return base;
          return {
            ch: s.ch ?? base.ch,
            fwdUs: s.fwdUs ?? s.minUs ?? base.fwdUs,
            hovUs: s.hovUs ?? s.maxUs ?? base.hovUs,
          };
        };
        flCfg = migrate(saved.fl);
        frCfg = migrate(saved.fr);
      }
    } catch {
      // keep defaults
    }
    cfgLoaded = true;
  });

  // Persist the user's final values, including manual edits.
  $effect(() => {
    if (!cfgLoaded) return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ fl: flCfg, fr: frCfg }));
    } catch {
      // storage unavailable — non-fatal
    }
  });

  /** Read back FC-configured SERVOx_MIN/MAX for a channel as the initial guess.
   *  Prefills MIN→forward(0°), MAX→hover(90°); the user swaps them on the ground
   *  if the direction is backwards. Falls back to 1000/2000. */
  async function onChannelChange(side: 'fl' | 'fr', select: HTMLSelectElement): Promise<void> {
    const cfg = side === 'fl' ? flCfg : frCfg;
    cfg.ch = Number(select.value) || 0;
    if (cfg.ch === 0) return;
    try {
      const res = await invoke<ServoLimit[]>('servo_read_limits', { channels: [cfg.ch] });
      const row = Array.isArray(res) ? res[0] : undefined;
      cfg.fwdUs = row?.min_us ?? 1000;
      cfg.hovUs = row?.max_us ?? 2000;
    } catch {
      // Command not (yet) available — degrade gracefully, no throw.
      cfg.fwdUs = 1000;
      cfg.hovUs = 2000;
    }
  }

  /** Tilt angle in degrees from live PWM (0° = forward flight, 90° = hover),
   *  or null when unknown. */
  function servoAngle(cfg: ServoCfg): number | null {
    if (cfg.ch === 0) return null;
    const pwm = Number(($telemetry.servoPwm ?? [])[cfg.ch - 1] ?? 0);
    if (!(pwm > 0)) return null;
    const fwd = Number(cfg.fwdUs);
    const hov = Number(cfg.hovUs);
    const span = Math.abs(hov - fwd);
    if (!(span > 0)) return null;
    const angle = (Math.abs(pwm - fwd) / span) * 90;
    if (!isFinite(angle)) return null;
    return Math.min(90, Math.max(0, angle));
  }

  const flAngle = $derived(servoAngle(flCfg));
  const frAngle = $derived(servoAngle(frCfg));
  /** Transition progress toward forward flight: 0% = hover, 100% = level. */
  const tiltPct = $derived(
    flAngle !== null && frAngle !== null
      ? Math.round(((90 - (flAngle + frAngle) / 2) / 90) * 100)
      : null
  );

  // Redraw both canvases whenever attitude/heading data changes.
  $effect(() => {
    const tele = $telemetry;
    void tele.roll;
    void tele.pitch;
    void tele.yaw;
    drawAttitude();
    drawCompassStrip();
  });
</script>

<section class="vtol-panel">
  <h2 class="panel-title">{$t('v5.vtol.title')}</h2>

  <canvas bind:this={attitudeEl} class="attitude" style="width:{ATT_SIZE}px;height:{ATT_SIZE}px" aria-label="attitude"></canvas>

  <p class="attitude-text">
    {$t('v5.vtol.roll')} {($telemetry.roll ?? 0).toFixed(1)}° •
    {$t('v5.vtol.pitch')} {($telemetry.pitch ?? 0).toFixed(1)}°
  </p>

  <p class="heading-text">
    {$t('v5.vtol.heading')}
    {norm360($telemetry.yaw ?? 0).toFixed(0).padStart(3, '0')}°
    {compass16(norm360($telemetry.yaw ?? 0))}
  </p>
  <canvas bind:this={compassEl} class="compass" style="width:100%;height:{STRIP_H}px" aria-label="compass"></canvas>

  <h3 class="group-title">{$t('v5.vtol.tiltTransition')}</h3>
  <div class="rows">
    <div class="row">
      <span class="row-label">{$t('v5.vtol.roll')}</span>
      <span class="row-value">{($telemetry.roll ?? 0).toFixed(1)}°</span>
    </div>
    <div class="row">
      <span class="row-label">{$t('v5.vtol.pitch')}</span>
      <span class="row-value">{($telemetry.pitch ?? 0).toFixed(1)}°</span>
    </div>
    <div class="row">
      <span class="row-label">{$t('v5.vtol.yaw')}</span>
      <span class="row-value">{($telemetry.yaw ?? 0).toFixed(1)}°</span>
    </div>
  </div>

  <h3 class="group-title">{$t('v5.vtol.tiltServoCh')}</h3>

  <div class="servo-side">
    <div class="row">
      <span class="row-label">{$t('v5.vtol.tiltServoFL')}</span>
      <span class="row-value">{flAngle === null ? '—' : flAngle.toFixed(0) + '°'}</span>
    </div>
    <div class="cfg-grid">
      <label class="cfg-item">
        <span>{$t('v5.vtol.channel')}</span>
        <select value={flCfg.ch} onchange={(e) => onChannelChange('fl', e.currentTarget)}>
          <option value={0}>{$t('v5.vtol.unset')}</option>
          {#each Array.from({ length: 16 }, (_, i) => i + 1) as n}
            <option value={n}>{n}</option>
          {/each}
        </select>
      </label>
      <label class="cfg-item">
        <span>{$t('v5.vtol.fwdUs')}</span>
        <input type="number" min="500" max="2500" bind:value={flCfg.fwdUs} />
      </label>
      <label class="cfg-item">
        <span>{$t('v5.vtol.hovUs')}</span>
        <input type="number" min="500" max="2500" bind:value={flCfg.hovUs} />
      </label>
    </div>
  </div>

  <div class="servo-side">
    <div class="row">
      <span class="row-label">{$t('v5.vtol.tiltServoFR')}</span>
      <span class="row-value">{frAngle === null ? '—' : frAngle.toFixed(0) + '°'}</span>
    </div>
    <div class="cfg-grid">
      <label class="cfg-item">
        <span>{$t('v5.vtol.channel')}</span>
        <select value={frCfg.ch} onchange={(e) => onChannelChange('fr', e.currentTarget)}>
          <option value={0}>{$t('v5.vtol.unset')}</option>
          {#each Array.from({ length: 16 }, (_, i) => i + 1) as n}
            <option value={n}>{n}</option>
          {/each}
        </select>
      </label>
      <label class="cfg-item">
        <span>{$t('v5.vtol.fwdUs')}</span>
        <input type="number" min="500" max="2500" bind:value={frCfg.fwdUs} />
      </label>
      <label class="cfg-item">
        <span>{$t('v5.vtol.hovUs')}</span>
        <input type="number" min="500" max="2500" bind:value={frCfg.hovUs} />
      </label>
    </div>
  </div>

  <p class="cal-hint">{$t('v5.vtol.calHint')}</p>

  <div class="progress-block">
    <div class="row">
      <span class="row-label">{$t('v5.vtol.tiltProgress')}</span>
      <span class="row-value dash">{tiltPct === null ? '—' : `${$t('v5.vtol.toLevel')} • ${tiltPct}%`}</span>
    </div>
    {#if tiltPct !== null}
      <div class="progress-track" role="progressbar" aria-valuenow={tiltPct} aria-valuemin="0" aria-valuemax="100">
        <div class="progress-fill" style="width:{tiltPct}%"></div>
      </div>
    {/if}
  </div>

  <div class="mode-row">
    <span class="row-label">{$t('v5.vtol.mode')}</span>
    <span class="mode-value">{MODE_REGISTRY[$telemetry.flightMode.primary]?.label ?? $telemetry.flightMode.primary}</span>
  </div>
</section>

<style>
  .vtol-panel {
    background: rgba(16, 20, 28, 0.88);
    color: #e8ecf1;
    border-radius: 12px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 13px;
  }

  .panel-title {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: #e8ecf1;
  }

  .attitude {
    align-self: center;
    display: block;
    border-radius: 50%;
    background: #11161d;
  }

  .attitude-text {
    margin: 0;
    text-align: center;
    font-size: 14px;
    font-weight: 600;
    color: #e8ecf1;
  }

  .heading-text {
    margin: 4px 0 0;
    text-align: center;
    font-size: 14px;
    font-weight: 700;
    color: #4fc3f7;
  }

  .compass {
    display: block;
    border-radius: 6px;
  }

  .group-title {
    margin: 6px 0 0;
    font-size: 13px;
    font-weight: 700;
    color: #e8ecf1;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }

  .row-label {
    color: #9aa4b2;
  }

  .row-value {
    font-weight: 600;
    color: #e8ecf1;
    font-variant-numeric: tabular-nums;
  }

  .row-value.dash {
    color: #9aa4b2;
  }

  .servo-side {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 8px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
  }

  .cfg-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
    align-items: flex-end;
  }

  .cfg-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 11px;
    color: #9aa4b2;
  }

  .cfg-item select,
  .cfg-item input[type='number'] {
    background: #11161d;
    color: #e8ecf1;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    padding: 3px 6px;
    font-size: 12px;
    width: 64px;
  }

  .cfg-item select {
    width: 92px;
  }

  .cal-hint {
    margin: 2px 0 0;
    font-size: 11px;
    line-height: 1.5;
    color: #8b95a5;
  }

  .progress-block {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .progress-track {
    height: 8px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.08);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    border-radius: 4px;
    background: linear-gradient(90deg, #4fc3f7, #69f0ae);
    transition: width 0.2s ease-out;
  }

  .mode-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    margin-top: 4px;
    padding: 8px 10px;
    background: rgba(79, 195, 247, 0.08);
    border: 1px solid rgba(79, 195, 247, 0.25);
    border-radius: 8px;
  }

  .mode-row .row-label {
    color: #9aa4b2;
  }

  .mode-value {
    font-weight: 700;
    color: #4fc3f7;
    letter-spacing: 0.03em;
  }
</style>
