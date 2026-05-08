import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // 1. Add flat_number to tenants
  const hasFlatNumber = await knex.schema.hasColumn('tenants', 'flat_number');
  if (!hasFlatNumber) {
    await knex.schema.alterTable('tenants', (table) => {
      table.string('flat_number', 50);
    });
  }

  // 2. Ensure withdrawals table exists (for detailed tracking if needed)
  const hasWithdrawalsTable = await knex.schema.hasTable('withdrawals');
  if (!hasWithdrawalsTable) {
    await knex.schema.createTable('withdrawals', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().references('id').inTable('users').notNullable();
      table.decimal('amount', 15, 6).notNullable();
      table.string('destination_address', 255).notNullable();
      table.string('tx_hash', 255);
      table.string('status', 50).defaultTo('PENDING');
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('tenants', (table) => {
    table.dropColumn('flat_number');
  });
  await knex.schema.dropTableIfExists('withdrawals');
}
