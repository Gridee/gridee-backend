import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  const hasTxHash = await knex.schema.hasColumn('transactions', 'tx_hash');
  const hasUsdcAmount = await knex.schema.hasColumn('transactions', 'usdc_amount');

  await knex.schema.alterTable('transactions', (table) => {
    if (!hasTxHash) {
      table.string('tx_hash', 255);
    }
    if (!hasUsdcAmount) {
      table.decimal('usdc_amount', 15, 6);
    }
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('transactions', (table) => {
    table.dropColumn('tx_hash');
    table.dropColumn('usdc_amount');
  });
}
