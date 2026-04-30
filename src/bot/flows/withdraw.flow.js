import { ActiveCommand } from '../../core/commands.js';
import { ScreenId } from '../../core/screen-id.js';
import { renderScreen } from '../../templates/index.js';
import { reply } from '../flow-result.js';

const CHANNELS = Object.freeze({
  '1': 'bank',
  '2': 'opay',
  '3': 'palmpay',
});

export class WithdrawFlow {
  constructor({ sessionStore, backend }) {
    this.sessionStore = sessionStore;
    this.backend = backend;
  }

  async begin(phone) {
    await this.sessionStore.set(phone, {
      role: 'landlord',
      activeCommand: ActiveCommand.WITHDRAW,
      step: ScreenId.WITHDRAW_BANK_INPUT,
      data: {},
    });
    return reply(renderScreen(ScreenId.WITHDRAW_BANK_INPUT));
  }

  async continue({ phone, text, session }) {
    const data = { ...(session.data ?? {}) };
    if (session.step === ScreenId.WITHDRAW_BANK_INPUT) {
      const channel = CHANNELS[String(text).trim()];
      if (!channel) return reply(renderScreen(ScreenId.WITHDRAW_BANK_INPUT));
      const result = await this.backend.requestWithdrawal({ phone, channel, amount: data.amount ?? 0 });
      await this.sessionStore.clear(phone);
      return reply(renderScreen(ScreenId.WITHDRAWAL_INITIATED, {
        amount: result.withdrawal.amount,
        bankName: result.withdrawal.bankName,
        last4: result.withdrawal.last4,
      }));
    }

    await this.sessionStore.clear(phone);
    return reply(renderScreen(ScreenId.SESSION_EXPIRED));
  }
}
