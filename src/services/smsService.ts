import AfricasTalking from 'africastalking';

const AT = AfricasTalking({
  apiKey: process.env.AT_API_KEY as string,
  username: process.env.AT_USERNAME as string,
});

const sms = AT.SMS;

export async function sendSMS(phone: string, message: string): Promise<void> {
  try {
    const options: any = {
      to: [phone],
      message: message,
    };

    if (process.env.AT_SENDER_ID) {
      options.from = process.env.AT_SENDER_ID;
    }

    const response = await sms.send(options);
  } catch (error) {
    console.error('Failed to send SMS:', error);
    throw new Error('SMS delivery failed');
  }
}
