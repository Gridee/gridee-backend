import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema
    .alterTable('users', (table) => {
      table.string('bank_name', 100);
      table.string('account_number', 20);
    })
    .alterTable('properties', (table) => {
      table.string('status', 50).notNullable().defaultTo('ACTIVE').alter();
    })
    .alterTable('tenants', (table) => {
      table.string('status', 50).notNullable().defaultTo('CONNECTED').checkIn(['CONNECTED', 'DISCONNECTED']).alter();
    })
    .alterTable('transactions', (table) => {
      table.integer('property_id').unsigned().references('id').inTable('properties');
      table.string('status', 50).notNullable().defaultTo('PENDING').alter();
    })
    .createTable('withdrawals', (table) => {
      table.increments('id').primary();
      table.integer('landlord_id').unsigned().notNullable().references('id').inTable('users');
      table.decimal('amount', 15, 2).notNullable();
      table.string('bank_name', 100).notNullable();
      table.string('account_number', 20).notNullable();
      table.string('status', 50).notNullable().defaultTo('PENDING');
      table.timestamp('created_at').defaultTo(knex.raw('CURRENT_TIMESTAMP'));
    })
    .createTable('meters', (table) => {
      table.increments('id').primary();
      table.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants');
      table.string('device_id', 255).notNullable();
      table.timestamp('registered_at').defaultTo(knex.raw('CURRENT_TIMESTAMP'));
    });

  const nullPhones = await knex('users').whereNull('phone').select('id');
  if (nullPhones.length > 0) {
    await knex('users').whereIn('id', nullPhones.map(r => r.id)).update({ phone: 'unknown' });
  }

  await knex.schema.alterTable('users', (table) => {
    table.string('phone', 20).notNullable().alter();
  });

  const nullLandlords = await knex('properties').whereNull('landlord_id').select('id');
  if (nullLandlords.length > 0) {
    await knex('properties').whereIn('id', nullLandlords.map(r => r.id)).update({ landlord_id: 0 });
  }

  await knex.schema.alterTable('properties', (table) => {
    table.integer('landlord_id').unsigned().notNullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema
    .dropTableIfExists('meters')
    .dropTableIfExists('withdrawals')
    .alterTable('transactions', (table) => {
      table.dropColumn('property_id');
    })
    .alterTable('users', (table) => {
      table.dropColumn('bank_name');
      table.dropColumn('account_number');
    });
}
