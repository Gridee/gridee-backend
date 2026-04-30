export class WhatsAppProvider {
  constructor(name) {
    this.name = name;
  }

  verifyWebhook() {
    throw new Error('verifyWebhook must be implemented');
  }

  parseInbound() {
    throw new Error('parseInbound must be implemented');
  }

  sendText() {
    throw new Error('sendText must be implemented');
  }
}
