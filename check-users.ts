import { db } from './src/db';
async function check() {
  const users = await db('users').whereIn('phone', ['+2348148915475', '+2347037730398', '+2348000000003']);
  console.log(JSON.stringify(users, null, 2));
  process.exit(0);
}
check();
