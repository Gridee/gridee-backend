import { sendSMS } from './smsService';
import { db } from '../db';
import axios from 'axios';

export const notificationService = {
  async notifyLandlord(propertyId: number, tenantName: string): Promise<void> {
    try {
      const propertyWithLandlord = await db('properties')
        .join('users', 'properties.landlord_id', 'users.id')
        .where('properties.id', propertyId)
        .select('users.phone', 'properties.code', 'users.id as landlord_id')
        .first();

      if (propertyWithLandlord && propertyWithLandlord.phone) {
        const message = `New tenant ${tenantName} has registered under your property ${propertyWithLandlord.code}.`;

        let channelUsed = 'sms';
        let sentSuccessfully = false;

        const waToken = process.env.WHATSAPP_API_TOKEN;
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
            channelUsed = 'whatsapp';
            sentSuccessfully = true;
          } catch {
            // WhatsApp failed, fall through to SMS
          }
        }

        if (!sentSuccessfully) {
          try {
            await sendSMS(propertyWithLandlord.phone, message);
            channelUsed = 'sms';
            sentSuccessfully = true;
          } catch {
            // SMS also failed
          }
        }

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

      let channelUsed = 'sms';
      let sentSuccessfully = false;

      const waToken = process.env.WHATSAPP_API_TOKEN;
      const waPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

      if (waToken && waPhoneId) {
        try {
          await axios.post(
            `https://graph.facebook.com/v17.0/${waPhoneId}/messages`,
            {
              messaging_product: 'whatsapp',
              to: user.phone,
              text: { body: message },
            },
            {
              headers: {
                Authorization: `Bearer ${waToken}`,
                'Content-Type': 'application/json',
              },
            }
          );
          channelUsed = 'whatsapp';
          sentSuccessfully = true;
        } catch {
          // WhatsApp failed, fall through to SMS
        }
      }

      if (!sentSuccessfully) {
        try {
          await sendSMS(user.phone, message);
          channelUsed = 'sms';
          sentSuccessfully = true;
        } catch {
          // SMS also failed
        }
      }

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
