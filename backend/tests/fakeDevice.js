// ESP32 gia lap: xu ly lenh giong firmware that va tra ve ack.
function createFakeDevice(numSlots = 4) {
  const state = { slots: Array.from({ length: numSlots }, () => ({ occupied: false, reserved: false })), mode: 'ok', log: [] };

  async function sendCommand(_lotId, cmd) {
    state.log.push(cmd);
    if (state.mode === 'timeout') return null;
    const ack = { type: 'ack', action: cmd.action, requestId: cmd.requestId, ok: true };
    const s = state.slots[(cmd.slot || 0) - 1];
    const fail = (error) => Object.assign(ack, { ok: false, error });
    switch (cmd.action) {
      case 'reserve':
        if (!s) fail('invalid_slot');
        else if (s.occupied || s.reserved) fail('slot_not_free');
        else s.reserved = true;
        break;
      case 'cancel_reservation':
        if (!s || !s.reserved) fail('not_reserved'); else s.reserved = false;
        break;
      case 'extend_reservation':
        if (!s || !s.reserved) fail('not_reserved');
        break;
      case 'open_gate':
      case 'close_gate':
        if (!['entry', 'exit'].includes(cmd.gate)) fail('invalid_gate');
        break;
      default:
        fail('unknown_action');
    }
    return ack;
  }

  return { sendCommand, connected: () => true, state };
}

module.exports = { createFakeDevice };
