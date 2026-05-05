import { db } from './src/db';
async function main() {
    const c = await db('transactions').columnInfo();
    console.log(JSON.stringify(c, null, 2));
    process.exit(0);
}
main();
