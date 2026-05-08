import { db } from '../src/db';
  
async function fixMissingMeters() {
  console.log('🔍 Checking for tenants without meters...');
  
  const tenantsWithoutMeters = await db('tenants')
    .leftJoin('meters', 'tenants.id', 'meters.tenant_id')
    .whereNull('meters.id')
    .select('tenants.id as tenant_id_pk', 'tenants.user_id', 'tenants.property_id');

  console.log(`📝 Found ${tenantsWithoutMeters.length} tenants needing meters.`);

  for (const tenant of tenantsWithoutMeters) {
    const property = await db('properties').where({ id: tenant.property_id }).first();
    const propertyCode = property ? property.code.toUpperCase() : 'UNK';
    const meterSerial = `MTR-${propertyCode}-${tenant.tenant_id_pk}`;

    console.log(`🚀 Creating meter ${meterSerial} for tenant ID ${tenant.tenant_id_pk}...`);
    
    await db('meters').insert({
      serial_number: meterSerial,
      tenant_id: tenant.tenant_id_pk,
      property_id: tenant.property_id,
      cumulative_reading: 0.0,
      status: 'ACTIVE'
    });
  }

  console.log('✅ Done! All tenants now have meters.');
  process.exit(0);
}

fixMissingMeters().catch(err => {
  console.error('❌ Error fixing meters:', err);
  process.exit(1);
});
