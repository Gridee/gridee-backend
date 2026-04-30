import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema
    .createTable('users', (table) => {
      table.increments('id').primary();
      table.string('name', 255).notNullable();
      table.string('phone', 20);
      table.string('role', 50).notNullable();
      table.string('wallet_address', 255);
      table.timestamp('created_at').defaultTo(knex.fn.now());
    })
    .createTable('properties', (table) => {
      table.increments('id').primary();
      table.integer('landlord_id').unsigned().references('id').inTable('users');
      table.string('code', 50).unique().notNullable();
      table.string('label', 255);
      table.text('address');
      table.string('state', 100);
      table.integer('flat_count').defaultTo(1);
      table.string('status', 50);
      table.timestamp('created_at').defaultTo(knex.fn.now());
    })
    .createTable('tenants', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().references('id').inTable('users');
      table.integer('property_id').unsigned().references('id').inTable('properties');
      table.string('status', 50).checkIn(['CONNECTED', 'DISCONNECTED']);
      table.timestamp('created_at').defaultTo(knex.fn.now());
    })
    .createTable('transactions', (table) => {
      table.increments('id').primary();
      table.integer('tenant_id').unsigned().references('id').inTable('tenants');
      table.decimal('amount_ngn', 15, 2).notNullable();
      table.decimal('grd_amount', 15, 2).notNullable();
      table.string('payment_method', 50);
      table.string('payment_ref', 255).unique();
      table.string('status', 50);
      table.timestamp('created_at').defaultTo(knex.fn.now());
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
    .dropTableIfExists('transactions')
    .dropTableIfExists('tenants')
    .dropTableIfExists('properties')
    .dropTableIfExists('users');
}
