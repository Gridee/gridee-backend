import { isScreenId } from '../core/screen-id.js';
import { renderScreen } from '../templates/index.js';

export class NotificationService {
  constructor({ provider, logger }) {
    this.provider = provider;
    this.logger = logger;
  }

  async send({ to, screenId, data = {} }) {
    if (!isScreenId(screenId)) throw new Error(`Invalid notification screenId: ${screenId}`);
    const text = renderScreen(screenId, data);
    const result = await this.provider.sendText({ to, text });
    this.logger.info('Notification sent', { to, screenId });
    return result;
  }
}
