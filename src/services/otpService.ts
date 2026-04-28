export const otpService = {
  async sendOTP(phone: string): Promise<void> {
    console.log(`Sending OTP to ${phone}`);
    // Real implementation would use Twilio, Termii, etc.
  },
  
  async verifyOTP(phone: string, code: string): Promise<boolean> {
    console.log(`Verifying OTP ${code} for ${phone}`);
    // Mocking successful verification if code is '123456'
    return code === '123456'; 
  }
};
