import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
    const rpcUrl = process.env.CONTRACT_RPC_URL || 'https://lisk-sepolia.drpc.org';
    const tokenAddress = process.env.GRIDEE_TOKEN_ADDRESS || '0x0739F10e1EACC0Bb9192DDA0B2a01AD7eb040353';
    const operatorAddress = '0x6603b62E9bE050ED4B1e47C7f8B3157A7B5F154E';

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const abi = [
        "function hasRole(bytes32 role, address account) view returns (bool)",
        "function MINTER_ROLE() view returns (bytes32)"
    ];

    const contract = new ethers.Contract(tokenAddress, abi, provider);

    try {
        const minterRole = "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1d6e24f9959ee99e19dca";
        const has = await contract.hasRole(minterRole, operatorAddress);
        console.log(`Address ${operatorAddress} has MINTER_ROLE: ${has}`);
        process.exit(0);
    } catch (error: any) {
        console.error('Check failed:', error.message);
        process.exit(1);
    }
}

main();
