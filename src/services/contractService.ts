import { ethers, Contract, TransactionReceipt } from "ethers";
import { db } from "../db";
import { privyService } from "./privyService";

interface PropertyRegistryContract {
    registerProperty(
        code: string,
        landlordWallet: string,
        flatCount: number,
        location: string
    ): Promise<ethers.TransactionResponse>;
    getProperty(code: string): Promise<{
        flatCount: number;
        location: string;
        isActive: boolean;
        createdAt: number;
    }>;
    deactivateProperty(code: string): Promise<ethers.TransactionResponse>;
    updateProperty(code: string, newFlatCount: number, newLocation: string): Promise<ethers.TransactionResponse>;
    getPropertiesByLandlord(landlordWallet: string): Promise<
        {
            flatCount: number;
            location: string;
            isActive: boolean;
            createdAt: number;
        }[]
    >;
    getPropertyCodesByLandlord(landlordWallet: string): Promise<string[]>;
    registerTenant(propertyCode: string, tenantWallet: string): Promise<ethers.TransactionResponse>;
    deregisterTenant(propertyCode: string, tenantWallet: string): Promise<ethers.TransactionResponse>;
    getTenantProperty(tenantWallet: string): Promise<string>;
}

interface EnergyLedgerContract {
    mintTokens(tenantWallet: string, amount: bigint): Promise<ethers.TransactionResponse>;
    deductTokens(tenantWallet: string, amount: bigint): Promise<ethers.TransactionResponse>;
    getBalance(tenantWallet: string): Promise<bigint>;
    setCutOff(tenantWallet: string, status: boolean): Promise<ethers.TransactionResponse>;
    isCutOff(tenantWallet: string): Promise<boolean>;
}

function getEnv(key: string): string {
    const value = process.env[key];
    if (!value) throw new Error(`Missing required env var: ${key}`);
    return value;
}

const provider = new ethers.JsonRpcProvider(getEnv("CONTRACT_RPC_URL"));
const signer = new ethers.Wallet(getEnv("OPERATOR_PRIVATE_KEY"), provider);

const GRIDEE_TOKEN_ABI = [
    "function depositUSDC(uint256 amount) external",
    "function purchaseTokens(uint256 usdcAmount, address landlord) external",
    "function balanceOf(address account) view returns (uint256)",
    "function tenantUSDCBalance(address tenant) view returns (uint256)",
    "function totalSupply() view returns (uint256)",
];

const USDC_ABI = [
    "function balanceOf(address account) view returns (uint256)",
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function transfer(address to, uint256 amount) external returns (bool)"
];

const PROPERTY_REGISTRY_ABI = [
    "function registerProperty(bytes32 code, address landlordWallet, uint8 flatCount, string calldata location) external",
    "function getProperty(bytes32 code) view returns (tuple(uint8 flatCount, uint8 occupiedFlats, string location, bool isActive, uint40 createdAt))",
    "function deactivateProperty(bytes32 code) external",
    "function updateProperty(bytes32 code, uint8 newFlatCount, string calldata newLocation) external",
    "function getPropertiesByLandlord(address landlordWallet) view returns (tuple(uint8 flatCount, uint8 occupiedFlats, string location, bool isActive, uint40 createdAt)[])",
    "function getPropertyCodesByLandlord(address landlordWallet) view returns (bytes32[])",
    "function registerTenant(bytes32 propertyCode, address tenantWallet) external",
    "function deregisterTenant(bytes32 propertyCode, address tenantWallet) external",
    "function getTenantProperty(address tenantWallet) view returns (bytes32)",
];

const ENERGY_LEDGER_ABI = [
    "function deductTokens(address tenantWallet, uint256 amount) external",
    "function getBalance(address tenantWallet) view returns (uint256)",
    "function setCutOff(address tenantWallet, bool status) external",
    "function isCutOff(address tenantWallet) view returns (bool)",
];

const grideeTokenAddress = getEnv("GRIDEE_TOKEN_ADDRESS");
// Fallback to a dummy address if not set so the server starts, but fail on action
const usdcAddress = process.env.USDC_ADDRESS || "0x0000000000000000000000000000000000000000";

const grideeToken = new Contract(grideeTokenAddress, GRIDEE_TOKEN_ABI, signer);
const usdcContract = new Contract(usdcAddress, USDC_ABI, signer);

const propertyRegistry = new Contract(
    getEnv("PROPERTY_REGISTRY_ADDRESS"),
    PROPERTY_REGISTRY_ABI,
    signer
) as unknown as PropertyRegistryContract;

const energyLedger = new Contract(
    getEnv("ENERGY_LEDGER_ADDRESS"),
    ENERGY_LEDGER_ABI,
    signer
) as unknown as EnergyLedgerContract;

export async function registerProperty(
    code: string,
    landlordWallet: string,
    flatCount: number,
    location: string
): Promise<TransactionReceipt> {
    const codeHash = ethers.id(code);
    const tx = await propertyRegistry.registerProperty(
        codeHash,
        landlordWallet,
        flatCount,
        location
    );
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Register property transaction failed");
    return receipt;
}

export async function getProperty(code: string) {
    const codeHash = ethers.id(code);
    return await propertyRegistry.getProperty(codeHash);
}

export async function getPropertiesByLandlord(landlordWallet: string) {
    return await propertyRegistry.getPropertiesByLandlord(landlordWallet);
}

export async function getPropertyCodesByLandlord(landlordWallet: string): Promise<string[]> {
    return await propertyRegistry.getPropertyCodesByLandlord(landlordWallet);
}

export async function deactivateProperty(code: string): Promise<TransactionReceipt> {
    const codeHash = ethers.id(code);
    const tx = await propertyRegistry.deactivateProperty(codeHash);
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Deactivate property transaction failed");
    return receipt;
}

export async function updateProperty(
    code: string,
    newFlatCount: number,
    newLocation: string
): Promise<TransactionReceipt> {
    const codeHash = ethers.id(code);
    const tx = await propertyRegistry.updateProperty(codeHash, newFlatCount, newLocation);
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Update property transaction failed");
    return receipt;
}

export async function registerTenant(propertyCode: string, tenantWallet: string): Promise<TransactionReceipt> {
    const codeHash = ethers.id(propertyCode);
    const tx = await propertyRegistry.registerTenant(codeHash, tenantWallet);
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Register tenant on-chain failed");
    return receipt;
}

export async function getTenantProperty(tenantWallet: string): Promise<string> {
    const codeHash = await propertyRegistry.getTenantProperty(tenantWallet);
    return codeHash;
}

export async function getTokenBalance(address: string): Promise<string> {
    const balance = await grideeToken.balanceOf(address);
    return ethers.formatUnits(balance, 18);
}

export async function getUsdcBalance(address: string): Promise<string> {
    const balance = await usdcContract.balanceOf(address);
    // Assuming USDC has 6 decimals
    return ethers.formatUnits(balance, 6);
}

export async function getEnergyBalance(address: string): Promise<string> {
    const balance = await energyLedger.getBalance(address);
    return ethers.formatUnits(balance, 18);
}

export async function getTenantUsdcBalance(address: string): Promise<string> {
    const balance = await grideeToken.tenantUSDCBalance(address);
    return ethers.formatUnits(balance, 6);
}

export async function deductEnergyTokens(tenant: string, amount: string): Promise<TransactionReceipt> {
    const tx = await energyLedger.deductTokens(tenant, ethers.parseUnits(amount, 18));
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Deduct energy tokens transaction failed");
    return receipt;
}

export async function setCutOff(tenant: string, status: boolean): Promise<TransactionReceipt> {
    const tx = await energyLedger.setCutOff(tenant, status);
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Set cut-off transaction failed");
    return receipt;
}

export async function isCutOff(tenant: string): Promise<boolean> {
    return await energyLedger.isCutOff(tenant);
}

export const contractService = {
    async depositUsdc(walletId: string, usdcAmountStr: string): Promise<{ txHash: string }> {
        const usdcAmount = ethers.parseUnits(usdcAmountStr, 6);
        
        // 1. Approve USDC
        const approveData = usdcContract.interface.encodeFunctionData("approve", [grideeTokenAddress, usdcAmount]);
        const approveTx = { to: usdcAddress, data: approveData, value: "0x0" };
        
        const { hash: approveHash } = await privyService.signTransaction(walletId, approveTx);
        console.log(`[deposit] Approve TX sent: ${approveHash}. Waiting for mining...`);
        await provider.waitForTransaction(approveHash);
        
        // 2. Deposit USDC
        const depositData = grideeToken.interface.encodeFunctionData("depositUSDC", [usdcAmount]);
        const depositTx = { to: grideeTokenAddress, data: depositData, value: "0x0" };

        const { hash: depositHash } = await privyService.signTransaction(walletId, depositTx);
        
        return { txHash: depositHash };
    },

    async purchaseTokens(walletId: string, usdcAmountStr: string, landlordWallet: string): Promise<{ txHash: string }> {
        const usdcAmount = ethers.parseUnits(usdcAmountStr, 6);
        const purchaseData = grideeToken.interface.encodeFunctionData("purchaseTokens", [usdcAmount, landlordWallet]);
        
        const purchaseTx = {
            to: grideeTokenAddress,
            data: purchaseData,
            value: "0x0"
        };

        const result = await privyService.signTransaction(walletId, purchaseTx);
        return { txHash: result.hash };
    },

    async transferUsdc(walletId: string, toAddress: string, amountStr: string): Promise<{ txHash: string }> {
        const usdcAmount = ethers.parseUnits(amountStr, 6);
        const transferData = usdcContract.interface.encodeFunctionData("transfer", [toAddress, usdcAmount]);
        
        const transferTx = {
            to: usdcAddress,
            data: transferData,
            value: "0x0"
        };
        
        const result = await privyService.signTransaction(walletId, transferTx);
        return { txHash: result.hash };
    },

    async getUsdcBalance(address: string): Promise<number> {
        const balance = await getUsdcBalance(address);
        return Number(balance);
    },

    async deductTokens(walletAddress: string, kwhUsed: number): Promise<void> {
        await deductEnergyTokens(walletAddress, kwhUsed.toString());
    },

    async getMeterBalance(walletAddress: string): Promise<number> {
        const balance = await getEnergyBalance(walletAddress);
        return Number(balance);
    },

    async registerProperty(
        code: string,
        landlordWallet: string,
        flatCount: number,
        location = "N/A"
    ): Promise<TransactionReceipt> {
        return registerProperty(code, landlordWallet, flatCount, location);
    },

    async registerTenant(propertyCode: string, tenantWallet: string): Promise<TransactionReceipt> {
        return registerTenant(propertyCode, tenantWallet);
    },

    async getTenantUsdcBalance(address: string): Promise<number> {
        const balance = await getTenantUsdcBalance(address);
        return Number(balance);
    },

    async getPlatformStats(): Promise<{
        platformBalance: string;
        opsBalance: string;
        totalGrdSupply: string;
    }> {
        const platformWallet = process.env.PLATFORM_WALLET || "0x0000000000000000000000000000000000000000";
        const opsWallet = process.env.OPS_WALLET || "0x0000000000000000000000000000000000000000";

        const pBal = await getUsdcBalance(platformWallet);
        const oBal = await getUsdcBalance(opsWallet);
        const supply = await grideeToken.totalSupply();

        return {
            platformBalance: pBal,
            opsBalance: oBal,
            totalGrdSupply: ethers.formatUnits(supply, 18)
        };
    }
};
