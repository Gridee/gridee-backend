import axios from 'axios';

<<<<<<< Updated upstream
const AT_API_KEY = process.env.AFRICAS_TALKING_API_KEY;
const AT_USERNAME = process.env.AFRICAS_TALKING_USERNAME;
const AT_SENDER_ID = process.env.AT_SENDER_ID || 'Gridee';

export async function sendSMS(phone: string, message: string): Promise<void> {
  if (!AT_API_KEY || !AT_USERNAME) {
    throw new Error('Africa\'s Talking credentials not configured');
=======
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
    const response = await axios.post(`${process.env.TERMII_BASE_URL}/api/sms/send`, data);
    console.log('Termii SMS sent successfully:', response.data);
  } catch (error: any) {
    console.error('Termii SMS delivery failed:', error.response?.data || error.message);
    throw new Error('SMS delivery failed');
>>>>>>> Stashed changes
  }

  const data = new URLSearchParams({
    username: AT_USERNAME,
    to: phone,
    message: message,
    from: AT_SENDER_ID,
  });

  const response = await axios.post(
    'https://api.africastalking.com/version1/messaging',
    data,
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'ApiKey': AT_API_KEY,
        'Accept': 'application/json',
      },
    }
  );

  const result = response.data;
  if (result.SMSMessageData?.Recipients?.[0]?.status !== 'Success') {
    throw new Error(`SMS delivery failed: ${JSON.stringify(result)}`);
  }
}
