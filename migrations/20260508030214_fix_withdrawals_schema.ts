import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  const hasWithdrawals = await knex.schema.hasTable('withdrawals');
  if (hasWithdrawals) {
    const hasLandlordId = await knex.schema.hasColumn('withdrawals', 'landlord_id');
    const hasUserId = await knex.schema.hasColumn('withdrawals', 'user_id');
    const hasAmountNgn = await knex.schema.hasColumn('withdrawals', 'amount_ngn');
    const hasAmount = await knex.schema.hasColumn('withdrawals', 'amount');
    const hasDest = await knex.schema.hasColumn('withdrawals', 'destination_address');
    const hasTxHash = await knex.schema.hasColumn('withdrawals', 'tx_hash');
    const hasTransferRef = await knex.schema.hasColumn('withdrawals', 'transfer_ref');

    await knex.schema.alterTable('withdrawals', (table) => {
      if (hasLandlordId && !hasUserId) {
        table.renameColumn('landlord_id', 'user_id');
      } else if (!hasLandlordId && !hasUserId) {
        table.integer('user_id').unsigned().references('id').inTable('users');
      }

      if (hasAmountNgn && !hasAmount) {
        table.renameColumn('amount_ngn', 'amount');
      } else if (!hasAmountNgn && !hasAmount) {
        table.decimal('amount', 15, 6);
      }

      if (!hasDest) {
        table.string('destination_address', 255).defaultTo('unknown');
      }

      if (hasTransferRef && !hasTxHash) {
        table.renameColumn('transfer_ref', 'tx_hash');
      } else if (!hasTransferRef && !hasTxHash) {
        table.string('tx_hash', 255);
      }
    });
  }
}

export async function down(knex: Knex): Promise<void> {
}
