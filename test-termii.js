const axios = require('axios');

const data = {
  api_key: "TLnoraevPvdqXhwFowDRulQZdbXbWaImhPbPcBMqiDGlLPSJzAhCrLBXeZgrAN",
  to: "2348000000000",
  from: "N-Alert",
  sms: "Test message",
  type: "plain",
  channel: "dnd"
};

axios.post("https://v3.api.termii.com/api/sms/send", data)
  .then(res => console.log('SUCCESS:', res.data))
  .catch(err => console.error('FAILED:', err.response ? err.response.data : err.message));
