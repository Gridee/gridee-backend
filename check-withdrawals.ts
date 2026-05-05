import { db } from './src/db';
async function main() {
    const t = await db('withdrawals').orderBy('created_at', 'desc').limit(5);
    console.log(JSON.stringify(t, null, 2));
    process.exit(0);
}
main();
