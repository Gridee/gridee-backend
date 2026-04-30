import test from 'node:test';
import assert from 'node:assert/strict';
import { BotRouter } from '../bot/bot-router.js';
import { InMemoryIdempotencyStore, InMemorySessionStore } from '../session/session-store.js';
import { MockBackendClient } from '../backend/mock-backend-client.js';

function createHarness() {
  const business = { kwhRateNaira: 48, minTopupNaira: 2000, mockOtpCode: '123456' };
  const sessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });
  const idempotencyStore = new InMemoryIdempotencyStore({ ttlSeconds: 86400 });
  const backend = new MockBackendClient({ business });
  const logger = { debug() {}, info() {}, warn() {}, error() {} };
  const router = new BotRouter({ sessionStore, idempotencyStore, backend, business, logger });
  let counter = 0;
  async function send(phone, text) {
    counter += 1;
    return router.handleInbound({
      provider: 'test',
      providerMessageId: `${phone}-${counter}`,
      phone,
      text,
      profileName: null,
      raw: {},
    });
  }
  return { send };
}

test('landlord can register and add a property', async () => {
  const { send } = createHarness();
  const phone = '+2348030000001';

  assert.match((await send(phone, 'Hi')).text, /Welcome to Gridee/);
  assert.match((await send(phone, '1')).text, /full name/i);
  assert.match((await send(phone, 'John Landlord')).text, /phone number/i);
  assert.match((await send(phone, '08030000001')).text, /OTP/i);
  assert.match((await send(phone, '123456')).text, /Registration successful/i);
  assert.match((await send(phone, 'ADD PROPERTY')).text, /property address/i);
  assert.match((await send(phone, 'No 5 Balogun Street, Yaba, Lagos')).text, /rentable flats/i);
  assert.match((await send(phone, '8')).text, /short name/i);
  const final = await send(phone, 'Surulere Block A');
  assert.match(final.text, /Property registered/i);
  assert.match(final.text, /GRD-LAG-0001/);
});

test('tenant can register under property and buy energy', async () => {
  const { send } = createHarness();
  const landlord = '+2348030000001';
  const tenant = '+2348030000002';

  await send(landlord, 'Hi');
  await send(landlord, '1');
  await send(landlord, 'John Landlord');
  await send(landlord, '08030000001');
  await send(landlord, '123456');
  await send(landlord, 'ADD PROPERTY');
  await send(landlord, 'No 5 Balogun Street, Yaba, Lagos');
  await send(landlord, '8');
  await send(landlord, 'Surulere Block A');

  assert.match((await send(tenant, 'Hi')).text, /Welcome to Gridee/);
  assert.match((await send(tenant, '2')).text, /full name/i);
  assert.match((await send(tenant, 'Bisi Tenant')).text, /phone number/i);
  assert.match((await send(tenant, '08030000002')).text, /OTP/i);
  assert.match((await send(tenant, '123456')).text, /Property Code/i);
  assert.match((await send(tenant, 'GRD-LAG-0001')).text, /Registration successful/i);
  assert.match((await send(tenant, 'BUY 2000')).text, /Choose a payment method/i);
  assert.match((await send(tenant, '1')).text, /Transfer/);
  assert.match((await send(tenant, 'CANCEL')).text, /cancelled/i);
  assert.match((await send(tenant, 'BALANCE')).text, /Your Gridee balance/i);
});
