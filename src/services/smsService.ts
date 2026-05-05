import axios from 'axios';

export async function sendSMS(phone: string, message: string): Promise<void> {
  const data = {
    api_key: process.env.TERMII_API_KEY,
    to: phone,
    from: process.env.TERMII_SENDER_ID || 'N-Alert',
    sms: message,
    type: 'plain',
    channel: 'generic',
  };

  try {
    await axios.post(`${process.env.TERMII_BASE_URL}/api/sms/send`, data);
    process.stdout.write(`\n[SMS SENT] To: ${phone}\n\n`);
  } catch (error: any) {
    console.error('Termii SMS delivery failed:', error.response?.data || error.message);
    throw new Error('SMS delivery failed');
  }
}
