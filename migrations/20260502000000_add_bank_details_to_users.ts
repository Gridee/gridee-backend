import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.table('users', (table) => {
    table.string('bank_name', 100).nullable();
    table.string('account_number', 20).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.table('users', (table) => {
    table.dropColumn('bank_name');
    table.dropColumn('account_number');
  });
}
