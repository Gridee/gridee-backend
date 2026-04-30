import { ActiveCommand, Command } from '../../core/commands.js';
import { ScreenId } from '../../core/screen-id.js';
import { renderScreen } from '../../templates/index.js';
import { reply } from '../flow-result.js';

export class OnboardingFlow {
  constructor({ sessionStore, backend }) {
    this.sessionStore = sessionStore;
    this.backend = backend;
  }

  async start(phone) {
    await this.sessionStore.set(phone, {
      activeCommand: ActiveCommand.ROLE_SELECT,
      step: ScreenId.WELCOME_ROLE_SELECT,
      data: {},
    });
    return reply(renderScreen(ScreenId.WELCOME_ROLE_SELECT));
  }

  async handleRoleSelection({ phone, parsed }) {
    if (parsed.command === Command.ROLE_LANDLORD) {
      await this.backend.setUserRole({ phone, role: 'landlord' });
      await this.sessionStore.set(phone, {
        role: 'landlord',
        activeCommand: ActiveCommand.LANDLORD_REGISTER,
        step: ScreenId.LANDLORD_REG_NAME,
        data: {},
      });
      return reply(renderScreen(ScreenId.LANDLORD_REG_NAME));
    }

    if (parsed.command === Command.ROLE_TENANT) {
      await this.backend.setUserRole({ phone, role: 'tenant' });
      await this.sessionStore.set(phone, {
        role: 'tenant',
        activeCommand: ActiveCommand.TENANT_REGISTER,
        step: ScreenId.TENANT_REG_NAME,
        data: parsed.args.propertyCode ? { propertyCode: parsed.args.propertyCode } : {},
      });
      return reply(renderScreen(ScreenId.TENANT_REG_NAME));
    }

    return reply(renderScreen(ScreenId.WELCOME_ROLE_SELECT));
  }
}
