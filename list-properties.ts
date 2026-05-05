import { db } from './src/db';
async function main() {
    const p = await db('properties').select('code', 'label', 'status');
    console.log(JSON.stringify(p, null, 2));
    process.exit(0);
}
main();
