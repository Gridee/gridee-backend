require('dotenv').config();
const axios = require('axios');

async function testTermii() {
  const data = {
    api_key: process.env.TERMII_API_KEY,
    to: "2347037730398",
    from: process.env.TERMII_SENDER_ID || "N-Alert",
    sms: "Test Gridee Message",
    type: "plain",
    channel: "generic"
  };

  try {
    const response = await axios.post(`${process.env.TERMII_BASE_URL}/api/sms/send`, data);
    console.log("Success:", response.data);
  } catch (error) {
    console.error("Termii Error:", error.response?.data || error.message);
  }
}

testTermii();
