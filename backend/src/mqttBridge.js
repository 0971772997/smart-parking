// Cau noi MQTT <-> server: nhan status/event tu ESP32, gui lenh va cho ack.
const mqtt = require('mqtt');
const crypto = require('crypto');

// connect: tiem client MQTT gia khi unit test (mac dinh mqtt.connect)
function createMqttBridge({ url, username, password, topicPrefix }, sync, { timeoutMs = 8000, connect = mqtt.connect } = {}) {
  const pending = new Map(); // requestId -> { resolve, timer }
  const client = connect(url, {
    username,
    password,
    clientId: 'api-' + crypto.randomBytes(4).toString('hex'),
    reconnectPeriod: 3000,
    connectTimeout: 10000,
  });

  client.on('connect', () => {
    console.log('[MQTT] Da ket noi', url);
    client.subscribe(`${topicPrefix}/+/status`);
    client.subscribe(`${topicPrefix}/+/event`);
    client.subscribe(`${topicPrefix}/+/online`);
  });
  client.on('error', (e) => console.error('[MQTT] loi:', e.message));
  client.on('reconnect', () => console.log('[MQTT] Dang ket noi lai...'));

  client.on('message', async (topic, buf) => {
    const parts = topic.split('/');
    const lotId = parts[parts.length - 2];
    const kind = parts[parts.length - 1];
    try {
      if (kind === 'online') return await sync.handleOnline(lotId, buf.toString());
      let data;
      try { data = JSON.parse(buf.toString()); } catch { return; } // bo qua tin khong phai JSON (broker cong khai)
      if (kind === 'status') await sync.handleStatus(lotId, data);
      else if (kind === 'event') {
        if (data.type === 'ack' && data.requestId && pending.has(data.requestId)) {
          const p = pending.get(data.requestId);
          clearTimeout(p.timer);
          pending.delete(data.requestId);
          p.resolve(data);
        }
        await sync.handleEvent(lotId, data);
      }
    } catch (e) {
      console.error(`[MQTT] Loi xu ly ${topic}:`, e.message);
    }
  });

  // Gui lenh toi ESP32, tra ve ack (hoac null neu het thoi gian cho)
  // Server dang mat ket noi broker -> tra null NGAY (khong bat nguoi dung cho het timeoutMs)
  function sendCommand(lotId, cmd) {
    const requestId = cmd.requestId || crypto.randomUUID();
    if (!client.connected) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => { pending.delete(requestId); resolve(null); }, timeoutMs);
      pending.set(requestId, { resolve, timer });
      client.publish(`${topicPrefix}/${lotId}/cmd`, JSON.stringify({ ...cmd, requestId }), { qos: 1 });
    });
  }

  return {
    sendCommand,
    connected: () => client.connected,
    close: () => new Promise((r) => client.end(false, {}, r)),
  };
}

module.exports = { createMqttBridge };
