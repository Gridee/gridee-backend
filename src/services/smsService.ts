import axios from 'axios';

export async function sendSMS(phone: string, message: string): Promise<void> {
  const data = {
    api_key: process.env.TERMII_API_KEY,
    message_type: 'ALPHANUMERIC',
    to: phone,
    from: process.env.TERMII_SENDER_ID || 'N-Alert',
    channel: 'generic',
    pin_attempts: 3,
    pin_time_to_live: 5,
    pin_length: 6,
    pin_placeholder: '< 123456 >',
    message_text: message,
    pin_type: 'NUMERIC',
  };

  try {
    const response = await axios.post(`${process.env.TERMII_BASE_URL}/api/sms/otp/send`, data);
    console.log('Termii Token sent successfully:', response.data);
  } catch (error: any) {
    console.error('Termii Token delivery failed:', error.response?.data || error.message);
    throw new Error('SMS delivery failed');
  }
}