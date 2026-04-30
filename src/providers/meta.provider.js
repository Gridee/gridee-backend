import { createHmac, timingSafeEqual } from 'crypto';
import { WhatsAppProvider } from './whatsapp.provider.js';
import { normalisePhone } from '../services/phone.js';

export class MetaProvider extends WhatsAppProvider {
  constructor({ config }) {
    super('meta');
    this.config = config;
  }

  verifyWebhook({ query }) {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    if (mode === 'subscribe' && token === this.config.verifyToken) {
      return { ok: true, challenge };
    }
    return { ok: false };
  }

  verifySignature({ rawBody, headers }) {
    if (!this.config.appSecret) return true;
    const signature = headers['x-hub-signature-256'];
    if (!signature) return false;
    const expected = `sha256=${createHmac('sha256', this.config.appSecret).update(rawBody).digest('hex')}`;
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  parseInbound({ body }) {
    const messages = [];
    const entries = body.entry ?? [];
    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};
        for (const message of value.messages ?? []) {
          const text = message.text?.body;
          if (!text) continue;
          const profile = value.contacts?.find((contact) => contact.wa_id === message.from)?.profile;
          messages.push({
            provider: this.name,
            providerMessageId: message.id,
            phone: normalisePhone(message.from),
            text: String(text).trim(),
            profileName: profile?.name ?? null,
            raw: message,
          });
        }
      }
    }
    return messages;
  }

  async sendText({ to, text }) {
    if (!this.config.accessToken || !this.config.phoneNumberId) {
      throw new Error('Meta WhatsApp access token and phone number ID are required');
    }
    const url = `https://graph.facebook.com/${this.config.graphApiVersion}/${this.config.phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: normalisePhone(to).replace(/^\+/, ''),
        type: 'text',
        text: { preview_url: false, body: text },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || `Meta send failed with ${response.status}`);
    return payload;
  }
}
