import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  const hasAmountNgn = await knex.schema.hasColumn('transactions', 'amount_ngn');
  const hasType = await knex.schema.hasColumn('transactions', 'type');

  await knex.schema.alterTable('transactions', (table) => {
    if (hasAmountNgn) {
      table.decimal('amount_ngn', 15, 2).nullable().alter();
    }
    if (!hasType) {
      table.string('type', 50);
    }
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('transactions', (table) => {
    table.decimal('amount_ngn', 15, 2).notNullable().alter();
    table.dropColumn('type');
  });
}
