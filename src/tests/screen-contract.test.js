import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_SCREEN_IDS } from '../core/screen-id.js';
import { getMissingTemplateScreenIds, renderScreen } from '../templates/index.js';

test('screen IDs are unique', () => {
  const unique = new Set(ALL_SCREEN_IDS);
  assert.equal(unique.size, ALL_SCREEN_IDS.length);
});

test('all user-facing screen IDs have templates', () => {
  assert.deepEqual(getMissingTemplateScreenIds(), []);
});

test('templates render non-empty WhatsApp-safe messages', () => {
  const sampleData = {
    amountNaira: 2000,
    grdAmount: 41.67,
    kwhAmount: 41.67,
    bankName: 'Mock Bank',
    accountNumber: '0123456789',
    accountName: 'Gridee Payments Ltd',
    reference: 'GRD-TXN-00001',
    network: 'OPay',
    usdtAmount: '1.25',
    walletAddress: '0x0000000000000000000000000000000000000000',
    balanceGrd: 41.67,
    newBalance: 41.67,
    estimatedHours: 13,
    propertyName: 'Surulere Block A',
    lastTopupDate: '2026-04-30',
    transactions: [{ date: '2026-04-30', amountNaira: 2000, grdAmount: 41.67 }],
    label: 'Surulere Block A',
    address: 'No 5 Balogun Street',
    landlordName: 'John Landlord',
    status: 'Connected',
    properties: [{ label: 'Surulere Block A', code: 'GRD-LAG-0001', flatCount: 8, activeTenantCount: 1 }],
    code: 'GRD-LAG-0001',
    flatCount: 8,
    activeTenantCount: 1,
    solarStatus: 'Online',
    tenants: [{ name: 'Bisi', flatNumber: 'Flat 1', status: 'active' }],
    totalEarnings: 5000,
    propertyCount: 1,
    breakdown: [{ code: 'GRD-LAG-0001', amount: 5000 }],
    amount: 5000,
    purchases: 2,
    last4: '7891',
    name: 'Bisi',
    property: 'Surulere Block A',
    balance: '0.8',
    propertyName: 'Surulere Block A',
    code: '123456',
    role: 'tenant',
    reason: 'Network error',
  };

  for (const screenId of ALL_SCREEN_IDS) {
    if (['LANDLORD_AUTHENTICATED', 'TENANT_AUTHENTICATED', 'AWAITING_PAYMENT'].includes(screenId)) continue;
    const output = renderScreen(screenId, sampleData);
    assert.equal(typeof output, 'string', screenId);
    assert.ok(output.trim().length > 0, screenId);
    assert.ok(output.length <= 4096, screenId);
  }
});
