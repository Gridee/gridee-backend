import twilio from 'twilio';
import { db } from '../db';
import { sendSMS } from './smsService';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = accountSid && authToken ? twilio(accountSid, authToken) : null;

export const notificationService = {
  async sendViaPreferredChannels(
    phone: string,
    message: string
  ): Promise<{ sentSuccessfully: boolean; channelUsed: 'whatsapp' | 'sms' }> {
    let channelUsed: 'whatsapp' | 'sms' = 'whatsapp';
    let sentSuccessfully = false;

    // 1. Try Twilio WhatsApp
    if (client) {
      try {
        await client.messages.create({
          from: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
          to: phone.includes('whatsapp:') ? phone : `whatsapp:+${phone.replace('+', '')}`,
          body: message,
        });
        sentSuccessfully = true;
        channelUsed = 'whatsapp';
      } catch (error: any) {
        console.warn(`[Twilio] Failed (Code: ${error.code}): ${error.message}`);
        // If account is limited, don't try Twilio SMS either, just fall through to Termii
      }
    }

    // 2. Fallback to Termii SMS
    if (!sentSuccessfully) {
      try {
        const rawPhone = phone.replace('whatsapp:', '').replace('+', '');
        console.log(`[Termii] Attempting SMS fallback to ${rawPhone}`);
        await sendSMS(rawPhone, message);
        sentSuccessfully = true;
        channelUsed = 'sms';
      } catch (smsError: any) {
        console.error('[Termii] SMS fallback failed:', smsError.message);
      }
    }

    return { sentSuccessfully, channelUsed };
  },

  async sendSms(phone: string, message: string): Promise<void> {
    await this.sendViaPreferredChannels(phone, message);
  },

  async notifyLandlord(propertyId: number, tenantName: string): Promise<void> {
    try {
      const propertyWithLandlord = await db('properties')
        .join('users', 'properties.landlord_id', 'users.id')
        .where('properties.id', propertyId)
        .select('users.phone', 'properties.code', 'users.id as landlord_id')
        .first();

      if (propertyWithLandlord && propertyWithLandlord.phone) {
        const message = `New tenant ${tenantName} has registered under your property ${propertyWithLandlord.code}.`;
        const { sentSuccessfully, channelUsed } = await notificationService.sendViaPreferredChannels(
          propertyWithLandlord.phone,
          message
        );

        if (sentSuccessfully) {
          await db('notifications').insert({
            user_id: propertyWithLandlord.landlord_id,
            channel: channelUsed,
            message: message,
            status: 'sent'
          });
        }
      }
    } catch (error) {
      console.error('Failed to notify landlord:', error);
    }
  },

  async sendPurchaseConfirmed(
    user: { id: number; name: string; phone: string },
    grdAmount: number,
    newBalance: number
  ): Promise<void> {
    try {
      const message = `Payment successful! ${grdAmount} GRD added. New balance: ${newBalance} GRD.`;
      const { sentSuccessfully, channelUsed } = await notificationService.sendViaPreferredChannels(user.phone, message);

      if (sentSuccessfully) {
        await db('notifications').insert({
          user_id: user.id,
          channel: channelUsed,
          message,
          status: 'sent'
        });
      }
    } catch (error) {
      console.error('Failed to send purchase confirmation:', error);
    }
  }
};
