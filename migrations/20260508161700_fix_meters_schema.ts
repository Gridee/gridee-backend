import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('meters', (table) => {
    table.renameColumn('device_id', 'serial_number');
    table.integer('property_id').unsigned().references('id').inTable('properties');
    table.decimal('cumulative_reading', 15, 2).defaultTo(0);
    table.string('status', 50).defaultTo('ACTIVE');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('meters', (table) => {
    table.renameColumn('serial_number', 'device_id');
    table.dropColumn('property_id');
    table.dropColumn('cumulative_reading');
    table.dropColumn('status');
  });
}

