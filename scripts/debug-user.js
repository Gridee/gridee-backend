const knex = require('knex');
const config = require('./knexfile');
const db = knex(config.development);

async function checkUser() {
  const phone = 'whatsapp:+2348000000000';
  const user = await db('users').where({ phone }).first();
  console.log('User:', user);
  if (user) {
    const tenant = await db('tenants').where({ user_id: user.id }).first();
    console.log('Tenant:', tenant);
  }
  await db.destroy();
  process.exit(0);
}

checkUser();
