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
    const bankDetails = await this.backend.getBankDetails({ phone });
    const earnings = await this.backend.getLandlordEarnings({ phone });

    if (!bankDetails.accountNumber) {
      await this.sessionStore.set(phone, {
        role: 'landlord',
        activeCommand: ActiveCommand.WITHDRAW,
        step: ScreenId.WITHDRAW_BANK_INPUT,
        data: { totalEarnings: earnings.total },
      });
      return reply(renderScreen(ScreenId.WITHDRAW_BANK_INPUT));
    }

    await this.sessionStore.set(phone, {
      role: 'landlord',
      activeCommand: ActiveCommand.WITHDRAW,
      step: ScreenId.WITHDRAW_CONFIRM,
      data: {
        totalEarnings: earnings.total,
        bankName: bankDetails.bankName,
        accountNumber: bankDetails.accountNumber,
      },
    });

    return reply(renderScreen(ScreenId.WITHDRAW_CONFIRM, {
      amount: earnings.total,
      bankName: bankDetails.bankName,
      last4: bankDetails.accountNumber.slice(-4),
    }));
  }

  async continue({ phone, text, session }) {
    const data = { ...(session.data ?? {}) };

    if (session.step === ScreenId.WITHDRAW_BANK_INPUT) {
      const channel = CHANNELS[String(text).trim()];
      if (!channel) return reply(renderScreen(ScreenId.WITHDRAW_BANK_INPUT));
      data.bankName = channel;
      await this.sessionStore.set(phone, { ...session, step: ScreenId.WITHDRAW_ACCOUNT_INPUT, data });
      return reply(renderScreen(ScreenId.WITHDRAW_ACCOUNT_INPUT));
    }

    if (session.step === ScreenId.WITHDRAW_ACCOUNT_INPUT) {
      const accountNumber = String(text).trim();
      if (!/^\d{10}$/.test(accountNumber)) return reply('Please enter a valid 10-digit account number.');
      data.accountNumber = accountNumber;

      // Save details for next time
      await this.backend.saveBankDetails({ phone, bankName: data.bankName, accountNumber });

      await this.sessionStore.set(phone, { ...session, step: ScreenId.WITHDRAW_CONFIRM, data });
      return reply(renderScreen(ScreenId.WITHDRAW_CONFIRM, {
        amount: data.totalEarnings,
        bankName: data.bankName,
        last4: accountNumber.slice(-4),
      }));
    }

    if (session.step === ScreenId.WITHDRAW_CONFIRM) {
      if (String(text).trim().toUpperCase() !== 'CONFIRM') {
        return reply('Type *CONFIRM* to proceed with your withdrawal, or *CANCEL* to stop.');
      }

      const result = await this.backend.requestWithdrawal({ phone, amount: data.totalEarnings });
      await this.sessionStore.clear(phone);
      return reply(renderScreen(ScreenId.WITHDRAWAL_INITIATED, {
        amount: result.amount,
        bankName: result.bankName,
        last4: result.bankLast4,
      }));
    }

    await this.sessionStore.clear(phone);
    return reply(renderScreen(ScreenId.SESSION_EXPIRED));
  }
}
