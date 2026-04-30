import { sendSMS } from './smsService';
import { db } from '../db';
import axios from 'axios';

export const notificationService = {
  async notifyLandlord(propertyId: number, tenantName: string): Promise<void> {
    try {
      // Find the landlord and property details
      const propertyWithLandlord = await db('properties')
        .join('users', 'properties.landlord_id', 'users.id')
        .where('properties.id', propertyId)
        .select('users.phone', 'properties.code', 'users.id as landlord_id')
        .first();

      if (propertyWithLandlord && propertyWithLandlord.phone) {
        const message = `New tenant ${tenantName} has registered under your property ${propertyWithLandlord.code}.`;

        let channelUsed = 'sms';
        let sentSuccessfully = false;

        // 1. Try WhatsApp first
        const waToken = process.env.WHATSAPP_TOKEN;
        const waPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

        if (waToken && waPhoneId) {
          try {
            await axios.post(
              `https://graph.facebook.com/v17.0/${waPhoneId}/messages`,
              {
                messaging_product: 'whatsapp',
                to: propertyWithLandlord.phone,
                text: { body: message },
              },
              {
                headers: {
                  Authorization: `Bearer ${waToken}`,
                  'Content-Type': 'application/json',
                },
              }
            );
            console.log(`WhatsApp Notification sent to landlord: ${propertyWithLandlord.phone}`);
            channelUsed = 'whatsapp';
            sentSuccessfully = true;
          } catch (waError: any) {
            console.warn('WhatsApp delivery failed, falling back to SMS:', waError.response?.data || waError.message);
          }
        }

        // 2. Fallback to SMS if WhatsApp failed or credentials are missing
        if (!sentSuccessfully) {
          try {
            await sendSMS(propertyWithLandlord.phone, message);
            console.log(`SMS Notification sent to landlord: ${propertyWithLandlord.phone}`);
            channelUsed = 'sms';
            sentSuccessfully = true;
          } catch (smsError: any) {
            console.error('SMS fallback delivery failed:', smsError);
          }
        }

        // 3. Store in notifications table for history
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
  }
};
