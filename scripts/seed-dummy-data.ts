import { db } from '../src/db';

async function seed(): Promise<void> {
  const landlordPhone = '2348011111111';
  const tenantPhone = '2348022222222';

  let landlord = await db('users').where({ phone: landlordPhone }).first();
  if (!landlord) {
    [landlord] = await db('users')
      .insert({
        name: 'Demo Landlord',
        phone: landlordPhone,
        role: 'landlord',
        wallet_address: '0x1111111111111111111111111111111111111111',
      })
      .returning('*');
  }

  let property = await db('properties').where({ code: 'GRD-LAG-0042' }).first();
  if (!property) {
    [property] = await db('properties')
      .insert({
        landlord_id: landlord.id,
        code: 'GRD-LAG-0042',
        label: 'Demo Compound',
        address: '42 Allen Avenue, Ikeja',
        state: 'Lagos',
        flat_count: 8,
        status: 'ACTIVE',
      })
      .returning('*');
  }

  let tenantUser = await db('users').where({ phone: tenantPhone }).first();
  if (!tenantUser) {
    [tenantUser] = await db('users')
      .insert({
        name: 'Demo Tenant',
        phone: tenantPhone,
        role: 'tenant',
        wallet_address: '0x2222222222222222222222222222222222222222',
      })
      .returning('*');
  }

  let tenant = await db('tenants').where({ user_id: tenantUser.id }).first();
  if (!tenant) {
    [tenant] = await db('tenants')
      .insert({
        user_id: tenantUser.id,
        property_id: property.id,
        status: 'CONNECTED',
      })
      .returning('*');
  }

  const existingTx = await db('transactions').where({ tenant_id: tenant.id }).first();
  if (!existingTx) {
    await db('transactions').insert([
      {
        tenant_id: tenant.id,
        property_id: property.id,
        usdc_amount: 20,
        grd_amount: 20,
        type: 'buy',
        tx_hash: `0x_seed_${Date.now()}_1`,
        status: 'COMPLETED',
      },
      {
        tenant_id: tenant.id,
        property_id: property.id,
        usdc_amount: 35,
        grd_amount: 35,
        type: 'buy',
        tx_hash: `0x_seed_${Date.now()}_2`,
        status: 'COMPLETED',
      },
      {
        tenant_id: tenant.id,
        property_id: property.id,
        usdc_amount: 50,
        grd_amount: 50,
        type: 'buy',
        tx_hash: `0x_seed_${Date.now()}_3`,
        status: 'PENDING',
      },
    ]);
  }

  const existingMeter = await db('meters').where({ tenant_id: tenant.id }).first();
  if (!existingMeter) {
    await db('meters').insert({
      tenant_id: tenant.id,
      device_id: `MTR-${tenant.id}`,
    });
  }

  console.log('Dummy seed complete.');
  console.log({ landlordPhone, tenantPhone, propertyCode: property.code });
}

seed()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await db.destroy();
  });
