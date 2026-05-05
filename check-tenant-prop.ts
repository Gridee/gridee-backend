import { db } from './src/db';
async function main() {
    const t = await db('tenants')
        .join('users', 'tenants.user_id', 'users.id')
        .join('properties', 'tenants.property_id', 'properties.id')
        .where('users.phone', 'like', '%7037730398')
        .select('users.name', 'properties.code', 'properties.label');
    console.log(JSON.stringify(t, null, 2));
    process.exit(0);
}
main();
