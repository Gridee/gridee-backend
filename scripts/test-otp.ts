import * as dotenv from 'dotenv';
dotenv.config();

import { otpService } from '../src/services/otpService';
import { redis } from '../src/redis';

async function runTest() {
  const testPhone = process.argv[2];
  
  if (!testPhone) {
    console.error('Please provide a phone number as an argument: npx ts-node scripts/test-otp.ts 08148915475');
    process.exit(1);
  }

  console.log(`--- Testing sendOTP for ${testPhone} ---`);
  try {
    await otpService.sendOTP(testPhone);
    console.log('OTP sent (check simulator or phone)');

    const key = `otp:${testPhone}`;
    const stored = await redis.get(key);
    console.log('Redis content:', stored);

    if (stored) {
      const { code } = JSON.parse(stored);
      
      console.log('\n--- Testing verifyOTP (Wrong Code) ---');
      const wrong = await otpService.verifyOTP(testPhone, '000000');
      console.log('Verification with 000000 (Expect False):', wrong);
      const afterWrong = await redis.get(key);
      console.log('Redis content after 1st fail:', afterWrong);

      console.log('\n--- Testing verifyOTP (Correct Code) ---');
      const correct = await otpService.verifyOTP(testPhone, code);
      console.log(`Verification with ${code} (Expect True):`, correct);
      const afterCorrect = await redis.get(key);
      console.log('Redis content after success (Expect null):', afterCorrect);
    }

  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await redis.quit();
  }
}

runTest();
