import { db } from './src/db';
async function main() {
    const t = await db('transactions').where({status: 'SUCCESSFUL'}).sum('grd_amount as total').first();
    console.log(JSON.stringify(t, null, 2));
    process.exit(0);
}
main();
