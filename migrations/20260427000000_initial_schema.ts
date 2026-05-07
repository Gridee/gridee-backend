import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema
    .createTable('users', (table) => {
      table.increments('id').primary();
      table.string('name', 255).notNullable();
      table.string('phone', 20).notNullable();
      table.string('role', 50).notNullable();
      table.string('wallet_address', 255);
      table.string('bank_name', 100);
      table.string('account_number', 20);
      table.string('privy_user_id', 255);
      table.timestamp('created_at').defaultTo(knex.fn.now());
    })
    .createTable('properties', (table) => {
      table.increments('id').primary();
      table.integer('landlord_id').unsigned().references('id').inTable('users').notNullable();
      table.string('code', 50).unique().notNullable();
      table.string('label', 255);
      table.text('address');
      table.string('state', 100);
      table.integer('flat_count').defaultTo(1);
      table.string('status', 50).notNullable().defaultTo('ACTIVE');
      table.timestamp('created_at').defaultTo(knex.fn.now());
    })
    .createTable('tenants', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().references('id').inTable('users');
      table.integer('property_id').unsigned().references('id').inTable('properties');
      table.string('status', 50).notNullable().defaultTo('CONNECTED').checkIn(['CONNECTED', 'DISCONNECTED']);
      table.timestamp('created_at').defaultTo(knex.fn.now());
    })
    .createTable('transactions', (table) => {
      table.increments('id').primary();
      table.integer('tenant_id').unsigned().references('id').inTable('tenants');
      table.integer('property_id').unsigned().references('id').inTable('properties');
      table.decimal('grd_amount', 15, 2).notNullable();
      table.decimal('usdc_amount', 15, 6);
      table.string('tx_hash', 255);
      table.string('type', 50); // fund, buy, withdraw
      table.string('status', 50).notNullable().defaultTo('PENDING');
      table.timestamp('created_at').defaultTo(knex.fn.now());
    })
    .createTable('meters', (table) => {
      table.increments('id').primary();
      table.integer('tenant_id').unsigned().references('id').inTable('tenants').notNullable();
      table.string('device_id', 255).notNullable().unique();
      table.timestamp('registered_at').defaultTo(knex.fn.now());
    })
    .createTable('notifications', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().references('id').inTable('users');
      table.string('channel', 50);
      table.text('message').notNullable();
      table.string('status', 50);
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema
    .dropTableIfExists('notifications')
    .dropTableIfExists('meters')
    .dropTableIfExists('transactions')
    .dropTableIfExists('tenants')
    .dropTableIfExists('properties')
    .dropTableIfExists('users');
}
