import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
    const adminPrivateKey = process.argv[2];
    if (!adminPrivateKey) {
        console.error('Please provide the ADMIN_PRIVATE_KEY as an argument');
        console.log('Usage: npx ts-node grant-minter-role.ts <ADMIN_PRIVATE_KEY>');
        process.exit(1);
    }

    const rpcUrl = process.env.CONTRACT_RPC_URL || 'https://lisk-sepolia.drpc.org';
    const tokenAddress = process.env.GRIDEE_TOKEN_ADDRESS || '0x0739F10e1EACC0Bb9192DDA0B2a01AD7eb040353';
    const operatorAddress = '0x6603b62E9bE050ED4B1e47C7f8B3157A7B5F154E';

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const adminWallet = new ethers.Wallet(adminPrivateKey, provider);

    const abi = [
        "function grantRole(bytes32 role, address account) external",
        "function MINTER_ROLE() view returns (bytes32)"
    ];

    const contract = new ethers.Contract(tokenAddress, abi, adminWallet);

    console.log(`Connecting to contract at ${tokenAddress}...`);
    console.log(`Admin address: ${adminWallet.address}`);

    try {
        const minterRole = "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1d6e24f9959ee99e19dca";
        console.log(`MINTER_ROLE hash: ${minterRole}`);

        console.log(`Granting MINTER_ROLE to ${operatorAddress}...`);
        const tx = await contract.grantRole(minterRole, operatorAddress);
        console.log(`Transaction sent: ${tx.hash}`);
        
        const receipt = await tx.wait();
        console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
        console.log('SUCCESS: Role granted!');
    } catch (error: any) {
        console.error('FAILED to grant role:');
        console.error(error.message);
    }
}

main();
