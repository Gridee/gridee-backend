import { ethers } from 'ethers';
async function main() {
    const p = new ethers.JsonRpcProvider("https://lisk-sepolia.drpc.org");
    const c = await p.getCode("0x0739F10e1EACC0Bb9192DDA0B2a01AD7eb040353");
    console.log(`Code: ${c}`);
    process.exit(0);
}
main();
