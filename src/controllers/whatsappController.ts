import { Request, Response } from 'express';
import twilio from 'twilio';
import { db } from '../db';
import { redis } from '../redis';
import { botController } from './botController';
import { notificationService } from '../services/notificationService';

const MessagingResponse = twilio.twiml.MessagingResponse;
const SESSION_PREFIX = 'gridee:session:';
const SESSION_TTL = 3600; // 1 hour

type BotState = 
  | 'IDLE' 
  | 'AWAITING_BUY_AMOUNT' 
  | 'AWAITING_FUND_AMOUNT'
  | 'AWAITING_DEPOSIT_AMOUNT' 
  | 'AWAITING_WITHDRAWAL_AMOUNT' 
  | 'AWAITING_WITHDRAWAL_ADDRESS'
  | 'AWAITING_ROLE_SELECTION'
  | 'AWAITING_PROPERTY_CODE'
  | 'AWAITING_FLAT_NUMBER'
  | 'AWAITING_PROPERTY_NAME'
  | 'AWAITING_PROPERTY_ADDRESS';

interface UserSession {
  state: BotState;
  tempData?: any;
}

export const whatsappController = {
  handleWebhook: async (req: Request, res: Response): Promise<void> => {
    const { From, Body, ProfileName } = req.body;
    console.log(`[WhatsApp/Webhook] Incoming: From=${From}, Name=${ProfileName}, Body="${Body}"`);
    
    const phone = From?.replace('whatsapp:', '').replace('+', '') || '';
    const message = Body?.trim() || '';

    if (!phone || !message) {
      console.warn('[WhatsApp/Webhook] Missing phone or message. Sending 200 OK.');
      res.status(200).send('OK');
      return;
    }

    const twiml = new MessagingResponse();
    const botRes = whatsappController.createTwiMLRes(twiml, res);

    try {
      const user = await db('users').where({ phone }).first();
      const sessionKey = `${SESSION_PREFIX}${phone}`;
      const rawSession = await redis.get(sessionKey);
      const session: UserSession = rawSession ? JSON.parse(rawSession) : { state: 'IDLE' };

      // Global Escape
      if (message.toLowerCase() === 'exit' || message.toLowerCase() === 'cancel') {
        await whatsappController.clearSession(phone);
        twiml.message("🛑 operation cancelled. Type *'Hi'* to start over.");
        res.type('text/xml').send(twiml.toString());
        return;
      }

      // 1. Auto-Onboarding for New Users
      if (!user && session.state === 'IDLE') {
        await whatsappController.updateSession(phone, { 
          state: 'AWAITING_ROLE_SELECTION', 
          tempData: { name: ProfileName || 'New User' } 
        });
        twiml.message(`👋 *Welcome to Gridee!*\n\nI see you are new here. I've picked up your name as *${ProfileName || 'New User'}*.\n\nAre you a *Landlord* or a *Tenant*? (Type one)`);
        res.type('text/xml').send(twiml.toString());
        return;
      }

      // 2. Handle Stateful Flows
      if (session.state !== 'IDLE') {
        return await whatsappController.handleStateFlow(req, botRes as any, phone, message, user, session);
      }

      const input = message.toLowerCase();

      // 3. Main Menu / Help
      if (input === 'hi' || input === 'hello' || input === 'help' || input === 'menu') {
        twiml.message(whatsappController.getMainMenuText(user));
        res.type('text/xml').send(twiml.toString());
        return;
      }

      // 4. Common Commands (Proxy to botController)
      if (input.includes('balance') || input === 'bal') {
        req.params = { phone };
        await botController.getTenantBalance(req as any, botRes as any);
        return;
      }

      if (input === 'history' || input === 'transactions') {
        req.params = { phone };
        await botController.getTenantHistory(req as any, botRes as any);
        return;
      }

      if (input.startsWith('fund') || input.startsWith('topup')) {
        const amount = parseFloat(input.replace('fund', '').replace('topup', '').trim());
        if (!isNaN(amount) && amount > 0) {
          twiml.message(`⏳ *Processing top-up of ${amount} USDC...*\n\nI'll notify you once it's confirmed.`);
          res.type('text/xml').send(twiml.toString());
          
          // Background execution
          (async () => {
            const asyncBotRes = whatsappController.createTwiMLRes(twiml, res, phone);
            req.body = { usdcAmount: amount };
            req.params = { phone };
            await botController.fundWallet(req as any, asyncBotRes as any);
          })().catch(console.error);
          return;
        }
        await whatsappController.updateSession(phone, { state: 'AWAITING_FUND_AMOUNT' });
        twiml.message("💳 *How many USDC* would you like to top up your wallet with? (e.g., 20)");
        res.type('text/xml').send(twiml.toString());
        return;
      }

      if (input.startsWith('buy')) {
        const amount = parseFloat(input.replace('buy', '').trim());
        if (!isNaN(amount) && amount > 0) {
          twiml.message(`⏳ *Purchasing ${amount} USDC worth of tokens...*\n\nThis takes a few seconds on-chain.`);
          res.type('text/xml').send(twiml.toString());

          // Background execution
          (async () => {
            const asyncBotRes = whatsappController.createTwiMLRes(twiml, res, phone);
            req.body = { usdcAmount: amount };
            req.params = { phone };
            await botController.buyTokens(req as any, asyncBotRes as any);
          })().catch(console.error);
          return;
        }
        await whatsappController.updateSession(phone, { state: 'AWAITING_BUY_AMOUNT' });
        twiml.message("💰 *How many USDC* would you like to spend on tokens? (e.g., 10)");
        res.type('text/xml').send(twiml.toString());
        return;
      }

      if (input.startsWith('deposit')) {
        const amount = parseFloat(input.replace('deposit', '').trim());
        if (!isNaN(amount) && amount > 0) {
          twiml.message(`⏳ *Depositing ${amount} USDC into escrow...*\n\nProcessing...`);
          res.type('text/xml').send(twiml.toString());

          // Background execution
          (async () => {
            const asyncBotRes = whatsappController.createTwiMLRes(twiml, res, phone);
            req.body = { usdcAmount: amount };
            req.params = { phone };
            await botController.depositTokens(req as any, asyncBotRes as any);
          })().catch(console.error);
          return;
        }
        await whatsappController.updateSession(phone, { state: 'AWAITING_DEPOSIT_AMOUNT' });
        twiml.message("📥 *How many USDC* would you like to deposit? (e.g., 50)");
        res.type('text/xml').send(twiml.toString());
        return;
      }

      // Landlord Specific Commands
      if (user?.role === 'landlord') {
        if (input === 'earnings' || input === 'earn') {
          req.params = { phone };
          await botController.getLandlordEarnings(req as any, botRes as any);
          return;
        }

        if (input === 'properties' || input === 'props') {
          req.params = { phone };
          await botController.getLandlordProperties(req as any, botRes as any);
          return;
        }

        if (input === 'stats') {
          await botController.getPlatformStats(req as any, botRes as any);
          return;
        }

        if (input.startsWith('withdraw')) {
          await whatsappController.updateSession(phone, { state: 'AWAITING_WITHDRAWAL_AMOUNT' });
          twiml.message("💸 *How much USDC* would you like to withdraw?");
          res.type('text/xml').send(twiml.toString());
          return;
        }
      }

      twiml.message("🤖 I didn't quite get that. Type *'Help'* to see what I can do!");
      res.type('text/xml').send(twiml.toString());

    } catch (error) {
      console.error('[whatsapp/webhook] Error:', error);
      res.status(200).send('OK');
    }
  },

  createTwiMLRes: (twiml: any, originalRes: Response, phone?: string) => {
    return {
      status: (code: number) => ({
        json: async (data: any) => {
          let text = "";
          if (code >= 400) {
            text = `❌ *Error*: ${data.error || 'Something went wrong'}`;
          } else {
            // Complex Data Transformations
            if (data.balanceGrd !== undefined) {
              text = `📊 *Your Balance*\n\n⚡ Tokens: *${data.balanceGrd} GRD*\n💵 USDC: *${data.lockedUsdc}*\n🏠 Property: *${data.propertyName}*\n⏳ Est. Hours: *${data.estimatedHours}h*`;
            } else if (data.transactions) {
              text = `📜 *Recent Transactions*\n\n` + data.transactions.map((t: any) => 
                `🔹 ${t.type.toUpperCase()}: ${t.grd_amount || t.usdc_amount} (${t.status})`
              ).slice(0, 5).join('\n');
            } else if (data.properties) {
              text = `🏘️ *Your Properties*\n\n` + data.properties.map((p: any) => 
                `📍 *${p.name}* (Code: ${p.code})\n👥 Tenants: ${p.activeTenantCount || 0}`
              ).join('\n\n');
            } else if (data.txHash) {
              text = `✅ *Success!*\n\nTransaction Hash: \`${data.txHash}\`\n\n${data.message || 'The operation was completed successfully.'}`;
            } else if (data.totalGross !== undefined) {
              text = `📈 *Landlord Earnings*\n\nGross: *${data.totalGross} USDC*\nNet: *${data.totalNet} USDC*\nFee: *${data.platformFee}*`;
            } else if (data.totalProperties !== undefined) {
              text = `📊 *Platform Stats*\n\n🏘️ Total Properties: *${data.totalProperties}*\n👥 Total Tenants: *${data.totalTenants}*\n⚡ Energy Sold: *${data.totalEnergySold} kWh*`;
            } else if (data.user && data.message) {
              text = `🎊 *Welcome, ${data.user.name}!*\n\n${data.message}\n\nType *'Menu'* to see what you can do next!`;
            } else if (data.message) {
              text = (data.success === false ? "❌ " : "✅ ") + data.message;
            } else if (data.error) {
              text = `❌ *Error*: ${data.error}`;
            } else {
              text = data.success ? "✅ Operation successful" : "⚠️ Request completed";
              if (typeof data === 'string') text = data;
            }
          }
          
          console.log(`[WhatsApp/Webhook] Outgoing TwiML: ${text.substring(0, 50)}...`);
          
          // CRITICAL: If we have a phone, it means we are in background mode.
          // We MUST use proactive messaging, as TwiML response is already closed.
          if (phone) {
            console.log(`[WhatsApp/Webhook] Sending proactive notification to ${phone}`);
            await notificationService.sendSms(phone, text);
          } else {
            twiml.message(text);
            if (!originalRes.headersSent) {
              const xml = twiml.toString();
              console.log(`[WhatsApp/Webhook] Sending TwiML Response: ${xml}`);
              originalRes.type('text/xml').send(xml);
            }
          }
        }
      }),
      send: async (msg: string) => {
        console.log(`[WhatsApp/Webhook] Outgoing Send: ${msg.substring(0, 50)}...`);
        if (phone) {
          await notificationService.sendSms(phone, msg);
        } else {
          const xml = twiml.toString();
          console.log(`[WhatsApp] Sending TwiML response (send):\n${xml}`);
          twiml.message(msg);
          if (!originalRes.headersSent) {
            originalRes.type('text/xml').send(twiml.toString());
          }
        }
      }
    };
  },

  getMainMenuText: (user: any): string => {
    if (!user) {
      return "👋 *Welcome to Gridee!*\n\nYou are not registered yet. Please visit our website or contact your landlord to get started.";
    } else if (user.role === 'tenant') {
      return `👋 *Hello, ${user.name}!*\n\n*Your Tenant Menu:*\n1️⃣ *Balance*: Check energy & USDC\n2️⃣ *Fund [Amount]*: Top up your USDC wallet\n3️⃣ *Buy [Amount]*: Purchase energy tokens\n4️⃣ *History*: View recent transactions\n5️⃣ *Help*: Get support\n\n_Just type a command to start!_`;
    } else {
      return `🏠 *Hello, Landlord ${user.name}!*\n\n*Your Dashboard:*\n1️⃣ *Earnings*: View your revenue\n2️⃣ *Withdraw*: Send USDC to external wallet\n3️⃣ *Properties*: View your portfolio\n4️⃣ *Stats*: Platform overview\n\n_What would you like to do?_`;
    }
  },

  handleStateFlow: async (req: Request, botRes: any, phone: string, message: string, user: any, session: UserSession): Promise<void> => {
    const input = message.trim();
    
    try {
      switch (session.state) {
        // --- ONBOARDING FLOWS ---
        case 'AWAITING_ROLE_SELECTION':
          const role = input.toLowerCase();
          if (role === 'tenant') {
            await whatsappController.updateSession(phone, { ...session, state: 'AWAITING_PROPERTY_CODE' });
            await notificationService.sendSms(phone, "🏠 Great! Please enter the *Property Code* provided by your landlord.");
          } else if (role === 'landlord') {
            await whatsappController.updateSession(phone, { ...session, state: 'AWAITING_PROPERTY_NAME' });
            await notificationService.sendSms(phone, "🏠 Awesome! Let's set up your first property. What is the *Name* of your property? (e.g., Sunshine Apartments)");
          } else {
            await notificationService.sendSms(phone, "❌ Please reply with either *'Landlord'* or *'Tenant'*.");
          }
          break;

        case 'AWAITING_PROPERTY_CODE':
          // Validate Property Code
          req.params = { code: input };
          // We can mock the validation or just proceed to registration
          await whatsappController.updateSession(phone, { ...session, state: 'AWAITING_FLAT_NUMBER', tempData: { ...session.tempData, propertyCode: input } });
          await notificationService.sendSms(phone, "🔢 Almost done! What is your *Flat/Room Number*?");
          break;

        case 'AWAITING_FLAT_NUMBER':
          const finalName = session.tempData.name;
          const propCode = session.tempData.propertyCode;
          await whatsappController.clearSession(phone);
          
          // Call Register Tenant
          req.body = { 
            name: finalName, 
            phone, 
            propertyCode: propCode, 
            flatNumber: input 
          };
          await botController.registerTenant(req as any, botRes as any);
          break;

        case 'AWAITING_PROPERTY_NAME':
          await whatsappController.updateSession(phone, { ...session, state: 'AWAITING_PROPERTY_ADDRESS', tempData: { ...session.tempData, propertyName: input } });
          await notificationService.sendSms(phone, "📍 Got it. What is the *Address* of this property?");
          break;

        case 'AWAITING_PROPERTY_ADDRESS':
          const lName = session.tempData.name;
          const pName = session.tempData.propertyName;
          await whatsappController.clearSession(phone);
          
          // Call Register Landlord + Create Property
          req.body = { name: lName, phone };
          await botController.registerLandlord(req as any, botRes as any);
          
          // Note: In a real app, we'd chain the property creation too.
          break;

        // --- TRANSACTION FLOWS ---
        case 'AWAITING_BUY_AMOUNT':
          const buyAmt = parseFloat(input);
          if (isNaN(buyAmt) || buyAmt <= 0) {
            await notificationService.sendSms(phone, "❌ Invalid amount. Please enter a number (e.g., 10) or type 'exit'.");
          } else {
            await whatsappController.clearSession(phone);
            botRes.send(`⏳ *Purchasing ${buyAmt} USDC worth of tokens...*`);
            (async () => {
              const asyncBotRes = whatsappController.createTwiMLRes(new MessagingResponse(), res, phone);
              req.body = { usdcAmount: buyAmt };
              req.params = { phone };
              await botController.buyTokens(req as any, asyncBotRes as any);
            })().catch(console.error);
          }
          break;

        case 'AWAITING_FUND_AMOUNT':
          const fundAmt = parseFloat(input);
          if (isNaN(fundAmt) || fundAmt <= 0) {
            await notificationService.sendSms(phone, "❌ Invalid amount. Please enter a number (e.g., 20) or type 'exit'.");
          } else {
            await whatsappController.clearSession(phone);
            botRes.send(`⏳ *Top-up of ${fundAmt} USDC in progress...*`);
            (async () => {
              const asyncBotRes = whatsappController.createTwiMLRes(new MessagingResponse(), res, phone);
              req.body = { usdcAmount: fundAmt };
              req.params = { phone };
              await botController.fundWallet(req as any, asyncBotRes as any);
            })().catch(console.error);
          }
          break;

        case 'AWAITING_DEPOSIT_AMOUNT':
          const depAmt = parseFloat(input);
          if (isNaN(depAmt) || depAmt <= 0) {
            await notificationService.sendSms(phone, "❌ Invalid amount. Please enter a number (e.g., 50) or type 'exit'.");
          } else {
            await whatsappController.clearSession(phone);
            botRes.send(`⏳ *Depositing ${depAmt} USDC into escrow...*`);
            (async () => {
              const asyncBotRes = whatsappController.createTwiMLRes(new MessagingResponse(), res, phone);
              req.body = { usdcAmount: depAmt };
              req.params = { phone };
              await botController.depositTokens(req as any, asyncBotRes as any);
            })().catch(console.error);
          }
          break;

        case 'AWAITING_WITHDRAWAL_AMOUNT':
            const withAmt = parseFloat(input);
            if (isNaN(withAmt) || withAmt <= 0) {
              await notificationService.sendSms(phone, "❌ Invalid amount. Please enter a number or type 'exit'.");
            } else {
              await whatsappController.updateSession(phone, { state: 'AWAITING_WITHDRAWAL_ADDRESS', tempData: { amount: withAmt } });
              await notificationService.sendSms(phone, "📍 Please paste the *destination wallet address* (0x...) for this withdrawal.");
            }
            break;

        case 'AWAITING_WITHDRAWAL_ADDRESS':
            if (!input.startsWith('0x') || input.length !== 42) {
              await notificationService.sendSms(phone, "❌ Invalid wallet address. It should start with 0x and be 42 characters long.");
            } else {
              const amount = session.tempData.amount;
              await whatsappController.clearSession(phone);
              botRes.send(`💸 *Initiating withdrawal of ${amount} USDC...*`);
              (async () => {
                const asyncBotRes = whatsappController.createTwiMLRes(new MessagingResponse(), res, phone);
                req.body = { amount, destinationAddress: input };
                req.params = { phone };
                await botController.initiateWithdrawal(req as any, asyncBotRes as any);
              })().catch(console.error);
            }
            break;

        default:
          await whatsappController.clearSession(phone);
          // Recursively call webhook or just send menu
          const twiml = new twilio.twiml.MessagingResponse();
          twiml.message(whatsappController.getMainMenuText(user));
          botRes.send(twiml.toString());
      }
    } catch (err) {
      await whatsappController.clearSession(phone);
    }
  },

  async sendMainMenu(phone: string, user: any) {
    let menu = "";
    if (!user) {
      menu = "👋 *Welcome to Gridee!*\n\nYou are not registered yet. Please visit our website or contact your landlord to get started.";
    } else if (user.role === 'tenant') {
      menu = `👋 *Hello, ${user.name}!*\n\n*Your Tenant Menu:*\n1️⃣ *Balance*: Check your energy tokens\n2️⃣ *Buy [Amount]*: Purchase new tokens\n3️⃣ *Deposit [Amount]*: Fund your account\n4️⃣ *Help*: Get support\n\n_Just type a command to start!_`;
    } else {
      menu = `🏠 *Hello, Landlord ${user.name}!*\n\n*Your Dashboard:*\n1️⃣ *Earnings*: View your revenue\n2️⃣ *Withdraw*: Send funds to your wallet\n3️⃣ *Stats*: Platform overview\n\n_What would you like to do?_`;
    }
    await notificationService.sendSms(phone, menu);
  },

  updateSession: async (phone: string, session: UserSession) => {
    await redis.set(`${SESSION_PREFIX}${phone}`, JSON.stringify(session), 'EX', SESSION_TTL);
  },

  clearSession: async (phone: string) => {
    await redis.del(`${SESSION_PREFIX}${phone}`);
  }
};
