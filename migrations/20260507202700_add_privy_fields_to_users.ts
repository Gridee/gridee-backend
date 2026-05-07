import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  const hasPrivyUserId = await knex.schema.hasColumn('users', 'privy_user_id');
  const hasWalletAddress = await knex.schema.hasColumn('users', 'wallet_address');

  await knex.schema.alterTable('users', (table) => {
    if (!hasPrivyUserId) {
      table.string('privy_user_id', 255);
    }
    if (!hasWalletAddress) {
      table.string('wallet_address', 255);
    }
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('privy_user_id');
    table.dropColumn('wallet_address');
  });
}
