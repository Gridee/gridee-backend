import { redis } from '../redis';
import { sendSMS } from './smsService';
import crypto from 'crypto';

const USE_TEST_OTP = process.env.USE_TEST_OTP === 'true';
const TEST_PHONE_PATTERNS = (process.env.TEST_PHONE_PATTERNS || '8000000000,8000000001').split(',');
const TEST_OTP_CODE = process.env.TEST_OTP_CODE || '123456';

export const otpService = {
  async generateOTP(phone?: string): Promise<string> {
    if (USE_TEST_OTP && phone && TEST_PHONE_PATTERNS.some(pattern => phone.includes(pattern))) {
      return TEST_OTP_CODE;
    }
    return crypto.randomInt(100000, 999999).toString();
  },

  async sendOTP(phone: string): Promise<void> {
    const code = await this.generateOTP(phone);
    const key = `otp:${phone}`;
    const value = JSON.stringify({ code, attempts: 0 });

    await redis.set(key, value, 'EX', 300);

    const message = `Your Gridee verification code is: ${code}. Valid for 5 minutes.`;
    await sendSMS(phone, message);
  },

  async verifyOTP(phone: string, code: string): Promise<boolean> {
    const key = `otp:${phone}`;
    const data = await redis.get(key);

    if (!data) {
      return false;
    }

    const { code: storedCode, attempts } = JSON.parse(data);

    if (attempts >= 3) {
      await redis.del(key);
      return false;
    }

    if (storedCode === code) {
      await redis.del(key);
      return true;
    } else {
      const newAttempts = attempts + 1;
      if (newAttempts >= 3) {
        await redis.del(key);
      } else {
        const newValue = JSON.stringify({ code: storedCode, attempts: newAttempts });
        const ttl = await redis.ttl(key);
        if (ttl > 0) {
          await redis.set(key, newValue, 'EX', ttl);
        }
      }
      return false;
    }
  }
};
