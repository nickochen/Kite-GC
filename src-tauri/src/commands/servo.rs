// Servo channel limits readback (ArduPilot `SERVOx_MIN/MAX/REVERSED`, MAVLink-only).
// Used by the frontend to draw per-channel PWM bars and to flag reversed servos.

use serde::Serialize;
use tauri::State;

use crate::mavlink_proto::params_rt;
use crate::state::{ActiveProtocol, AppState};

/// Resolve the MAVLink command sender + sysid (servo limits are MAVLink-only).
fn mav_handle(state: &State<'_, AppState>) -> Result<Option<(std::sync::mpsc::Sender<crate::mavlink_proto::handler::MavlinkCommand>, u8)>, String> {
    let proto = state.protocol.lock().map_err(|e| e.to_string())?;
    match proto.as_ref() {
        Some(ActiveProtocol::Mavlink(h)) => Ok(Some((h.cmd_tx_clone(), h.fc_sysid))),
        _ => Ok(None), // MSP / passive / disconnected → no servo limits
    }
}

/// One channel's limits. Fields are `None` when the FC did not report the param.
#[derive(Debug, Clone, Serialize)]
pub struct ServoLimits {
    pub channel: u8,
    pub min_us: Option<f32>,
    pub max_us: Option<f32>,
    pub reversed: Option<bool>,
}

/// Read `SERVOx_MIN/MAX/REVERSED` for the given 1-based channels. Returns an empty vec when not on a
/// MAVLink link, so the frontend can always call it on connect. Missing params map to `None` fields.
#[tauri::command(async)]
pub fn servo_read_limits(state: State<'_, AppState>, channels: Vec<u8>) -> Result<Vec<ServoLimits>, String> {
    let Some((cmd_tx, fc_sysid)) = mav_handle(&state)? else {
        return Ok(vec![]);
    };
    let names: Vec<String> = channels.iter().flat_map(|ch| {
        [
            format!("SERVO{ch}_MIN"),
            format!("SERVO{ch}_MAX"),
            format!("SERVO{ch}_REVERSED"),
        ]
    }).collect();
    let name_refs: Vec<&str> = names.iter().map(|s| s.as_str()).collect();
    let pmap = params_rt::read_params(&cmd_tx, fc_sysid, &name_refs);
    let limits = channels.iter().map(|&ch| ServoLimits {
        channel: ch,
        min_us: pmap.get(&format!("SERVO{ch}_MIN")).copied(),
        max_us: pmap.get(&format!("SERVO{ch}_MAX")).copied(),
        reversed: pmap.get(&format!("SERVO{ch}_REVERSED")).map(|v| *v != 0.0),
    }).collect();
    eprintln!("[SERVO] read limits for {} channel(s)", channels.len());
    Ok(limits)
}
