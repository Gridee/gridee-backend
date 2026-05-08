import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  const hasMeterReading = await knex.schema.hasColumn('properties', 'meter_reading');
  if (!hasMeterReading) {
    await knex.schema.alterTable('properties', (table) => {
      table.decimal('meter_reading', 15, 2).defaultTo(0);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('properties', (table) => {
    table.dropColumn('meter_reading');
  });
}
