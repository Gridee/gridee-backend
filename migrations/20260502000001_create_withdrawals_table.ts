import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('withdrawals', (table) => {
    table.increments('id').primary();
    table.integer('landlord_id').unsigned().references('id').inTable('users');
    table.decimal('amount', 15, 2).notNullable();
    table.string('bank_name', 100);
    table.string('account_number', 20);
    table.string('status', 50).defaultTo('PENDING');
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('withdrawals');
}
