import "dotenv/config";
import { ethers, Contract, TransactionReceipt } from "ethers";

interface GrideeTokenContract {
    mint(to: string, amount: bigint): Promise<ethers.TransactionResponse>;
    burn(account: string, amount: bigint): Promise<ethers.TransactionResponse>;
    balanceOf(account: string): Promise<bigint>;
}

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
    getPropertiesByLandlord(landlordWallet: string): Promise<
        {
            flatCount: number;
            location: string;
            isActive: boolean;
            createdAt: number;
        }[]
    >;
    getPropertyCodesByLandlord(landlordWallet: string): Promise<string[]>;
}

interface WalletFactoryContract {
    assignWallet(userId: number, wallet: string): Promise<ethers.TransactionResponse>;
    getWallet(userId: number): Promise<string>;
    walletExists(userId: number): Promise<boolean>;
}

interface EnergyLedgerContract {
    credit(tenant: string, amount: bigint): Promise<ethers.TransactionResponse>;
    deduct(tenant: string, amount: bigint): Promise<ethers.TransactionResponse>;
    getBalance(tenant: string): Promise<bigint>;
}

const provider = new ethers.JsonRpcProvider(process.env.CONTRACT_RPC_URL as string);
const signer = new ethers.Wallet(process.env.OPERATOR_PRIVATE_KEY as string, provider);

const GRIDEE_TOKEN_ABI = [
    "function mint(address to, uint256 amount) external",
    "function burn(address account, uint256 amount) external",
    "function balanceOf(address account) view returns (uint256)",
];

const PROPERTY_REGISTRY_ABI = [
    "function registerProperty(bytes32 code, address landlordWallet, uint8 flatCount, string calldata location) external",
    "function getProperty(bytes32 code) view returns (tuple(uint8 flatCount, string location, bool isActive, uint40 createdAt))",
    "function deactivateProperty(bytes32 code) external",
    "function getPropertiesByLandlord(address landlordWallet) view returns (tuple(uint8 flatCount, string location, bool isActive, uint40 createdAt)[])",
    "function getPropertyCodesByLandlord(address landlordWallet) view returns (bytes32[])",
];

const WALLET_FACTORY_ABI = [
    "function assignWallet(uint256 userId, address wallet) external",
    "function getWallet(uint256 userId) view returns (address)",
    "function walletExists(uint256 userId) view returns (bool)",
];

const ENERGY_LEDGER_ABI = [
    "function credit(address tenant, uint256 amount) external",
    "function deduct(address tenant, uint256 amount) external",
    "function getBalance(address tenant) view returns (uint256)",
];

const grideeToken = new Contract(
    process.env.GRIDEE_TOKEN_ADDRESS as string,
    GRIDEE_TOKEN_ABI,
    signer
) as object as GrideeTokenContract;

const propertyRegistry = new Contract(
    process.env.PROPERTY_REGISTRY_ADDRESS as string,
    PROPERTY_REGISTRY_ABI,
    signer
) as object as PropertyRegistryContract;

const walletFactory = new Contract(
    process.env.WALLET_FACTORY_ADDRESS as string,
    WALLET_FACTORY_ABI,
    signer
) as object as WalletFactoryContract;

const energyLedger = new Contract(
    process.env.ENERGY_LEDGER_ADDRESS as string,
    ENERGY_LEDGER_ABI,
    signer
) as object as EnergyLedgerContract;

export async function mintTokens(to: string, amount: string): Promise<TransactionReceipt> {
    const tx = await grideeToken.mint(to, ethers.parseUnits(amount, 18));
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Mint transaction failed");
    return receipt;
}

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

export async function assignWallet(
    userId: number,
    walletAddress: string
): Promise<TransactionReceipt> {
    const tx = await walletFactory.assignWallet(userId, walletAddress);
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Assign wallet transaction failed");
    return receipt;
}

export async function getWallet(userId: number): Promise<string> {
    return await walletFactory.getWallet(userId);
}

export async function checkWalletExists(userId: number): Promise<boolean> {
    return await walletFactory.walletExists(userId);
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

export async function getTokenBalance(address: string): Promise<string> {
    const balance = await grideeToken.balanceOf(address);
    return ethers.formatUnits(balance, 18);
}

export async function getEnergyBalance(address: string): Promise<string> {
    const balance = await energyLedger.getBalance(address);
    return ethers.formatUnits(balance, 18);
}

export async function creditEnergy(tenant: string, amount: string): Promise<TransactionReceipt> {
    const tx = await energyLedger.credit(tenant, ethers.parseUnits(amount, 18));
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Credit energy transaction failed");
    return receipt;
}

export async function deductEnergy(tenant: string, amount: string): Promise<TransactionReceipt> {
    const tx = await energyLedger.deduct(tenant, ethers.parseUnits(amount, 18));
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Deduct energy transaction failed");
    return receipt;
}

export const contractService = {
    async assignWallet(userId: number, walletAddress: string): Promise<TransactionReceipt> {
        return assignWallet(userId, walletAddress);
    },

    async mintTokens(walletAddress: string, grdAmount: number): Promise<{ txHash: string }> {
        const receipt = await creditEnergy(walletAddress, grdAmount.toString());
        return { txHash: receipt.hash };
    },

    async deductTokens(walletAddress: string, kwhUsed: number): Promise<void> {
        await deductEnergy(walletAddress, kwhUsed.toString());
    },

    async getMeterBalance(walletAddress: string): Promise<number> {
        const balance = await getEnergyBalance(walletAddress);
        return Number(balance);
    },

    async registerProperty(
        code: string,
        flatCount: number,
        location = "N/A",
        landlordWallet = process.env.PLATFORM_WALLET_ADDRESS as string
    ): Promise<TransactionReceipt> {
        return registerProperty(code, landlordWallet, flatCount, location);
    },

    async getLandlordEarnings(
        landlordWallet: string,
        propertyCodes: string[]
    ): Promise<{
        totalNGN: number;
        perProperty: Array<{ code: string; amountNGN: number }>;
    }> {
        // Placeholder until RevenueDistributor contract integration is available.
        const perProperty = propertyCodes.map((code) => ({
            code,
            amountNGN: 0
        }));
        const totalNGN = Number(perProperty.reduce((sum, p) => sum + p.amountNGN, 0).toFixed(2));
        console.log(`Computed earnings placeholder for landlord ${landlordWallet}`);
        return { totalNGN, perProperty };
    },

    async getPropertyEarnings(
        landlordWallet: string,
        propertyCode: string
    ): Promise<{ code: string; amountNGN: number }> {
        console.log(`Computed property earnings placeholder for ${landlordWallet}/${propertyCode}`);
        return { code: propertyCode, amountNGN: 0 };
    }
};
