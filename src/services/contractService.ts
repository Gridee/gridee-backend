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
}

interface WalletFactoryContract {
    registerLandlord(phoneHash: string, wallet: string): Promise<ethers.TransactionResponse>;
    registerTenant(phoneHash: string, wallet: string, propertyCode: string): Promise<ethers.TransactionResponse>;
    getLandlordWallet(phoneHash: string): Promise<string>;
    getTenantWallet(phoneHash: string): Promise<string>;
    getTenantProperty(phoneHash: string): Promise<string>;
    isWalletRegistered(wallet: string): Promise<boolean>;
}

interface EnergyLedgerContract {
    mintTokens(tenantWallet: string, amount: bigint): Promise<ethers.TransactionResponse>;
    deductTokens(tenantWallet: string, amount: bigint): Promise<ethers.TransactionResponse>;
    getBalance(tenantWallet: string): Promise<bigint>;
    setCutOff(tenantWallet: string, status: boolean): Promise<ethers.TransactionResponse>;
    isCutOff(tenantWallet: string): Promise<boolean>;
}

interface RevenueDistributorContract {
    distributeRevenue(propertyCode: string, landlordWallet: string, totalAmount: bigint): Promise<ethers.TransactionResponse>;
    withdraw(): Promise<ethers.TransactionResponse>;
    updateShares(newLandlordBPS: number, newPlatformBPS: number): Promise<ethers.TransactionResponse>;
    updateWallets(newPlatformWallet: string, newOpsWallet: string): Promise<ethers.TransactionResponse>;
    pendingWithdrawals(landlord: string): Promise<bigint>;
}

function getEnv(key: string): string {
    const value = process.env[key];
    if (!value) throw new Error(`Missing required env var: ${key}`);
    return value;
}

const provider = new ethers.JsonRpcProvider(getEnv("CONTRACT_RPC_URL"));
const signer = new ethers.Wallet(getEnv("OPERATOR_PRIVATE_KEY"), provider);

const GRIDEE_TOKEN_ABI = [
    "function mint(address to, uint256 amount) external",
    "function burn(address account, uint256 amount) external",
    "function balanceOf(address account) view returns (uint256)",
];

const PROPERTY_REGISTRY_ABI = [
    "function registerProperty(bytes32 code, address landlordWallet, uint8 flatCount, string calldata location) external",
    "function getProperty(bytes32 code) view returns (tuple(uint8 flatCount, string location, bool isActive, uint40 createdAt))",
    "function deactivateProperty(bytes32 code) external",
    "function updateProperty(bytes32 code, uint8 newFlatCount, string calldata newLocation) external",
    "function getPropertiesByLandlord(address landlordWallet) view returns (tuple(uint8 flatCount, string location, bool isActive, uint40 createdAt)[])",
    "function getPropertyCodesByLandlord(address landlordWallet) view returns (bytes32[])",
];

const WALLET_FACTORY_ABI = [
    "function registerLandlord(bytes32 phoneHash, address wallet) external",
    "function registerTenant(bytes32 phoneHash, address wallet, bytes32 propertyCode) external",
    "function getLandlordWallet(bytes32 phoneHash) view returns (address)",
    "function getTenantWallet(bytes32 phoneHash) view returns (address)",
    "function getTenantProperty(bytes32 phoneHash) view returns (bytes32)",
    "function isWalletRegistered(address wallet) view returns (bool)",
];

const ENERGY_LEDGER_ABI = [
    "function mintTokens(address tenantWallet, uint256 amount) external",
    "function deductTokens(address tenantWallet, uint256 amount) external",
    "function getBalance(address tenantWallet) view returns (uint256)",
    "function setCutOff(address tenantWallet, bool status) external",
    "function isCutOff(address tenantWallet) view returns (bool)",
];

const REVENUE_DISTRIBUTOR_ABI = [
    "function distributeRevenue(bytes32 propertyCode, address landlordWallet, uint256 totalAmount) external",
    "function withdraw() external",
    "function updateShares(uint256 newLandlordBPS, uint256 newPlatformBPS) external",
    "function updateWallets(address newPlatformWallet, address newOpsWallet) external",
    "function pendingWithdrawals(address landlord) view returns (uint256)",
];

const grideeToken = new Contract(
    getEnv("GRIDEE_TOKEN_ADDRESS"),
    GRIDEE_TOKEN_ABI,
    signer
) as unknown as GrideeTokenContract;

const propertyRegistry = new Contract(
    getEnv("PROPERTY_REGISTRY_ADDRESS"),
    PROPERTY_REGISTRY_ABI,
    signer
) as unknown as PropertyRegistryContract;

const walletFactory = new Contract(
    getEnv("WALLET_FACTORY_ADDRESS"),
    WALLET_FACTORY_ABI,
    signer
) as unknown as WalletFactoryContract;

const energyLedger = new Contract(
    getEnv("ENERGY_LEDGER_ADDRESS"),
    ENERGY_LEDGER_ABI,
    signer
) as unknown as EnergyLedgerContract;

const revenueDistributor = new Contract(
    getEnv("REVENUE_DISTRIBUTOR_ADDRESS"),
    REVENUE_DISTRIBUTOR_ABI,
    signer
) as unknown as RevenueDistributorContract;

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

export async function registerLandlordWallet(
    phone: string,
    walletAddress: string
): Promise<TransactionReceipt> {
    const phoneHash = ethers.keccak256(ethers.toUtf8Bytes(phone));
    const tx = await walletFactory.registerLandlord(phoneHash, walletAddress);
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Register landlord wallet transaction failed");
    return receipt;
}

export async function registerTenantWallet(
    phone: string,
    walletAddress: string,
    propertyCode: string
): Promise<TransactionReceipt> {
    const phoneHash = ethers.keccak256(ethers.toUtf8Bytes(phone));
    const propertyCodeHash = ethers.id(propertyCode);
    const tx = await walletFactory.registerTenant(phoneHash, walletAddress, propertyCodeHash);
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Register tenant wallet transaction failed");
    return receipt;
}

export async function getLandlordWallet(phone: string): Promise<string> {
    const phoneHash = ethers.keccak256(ethers.toUtf8Bytes(phone));
    return await walletFactory.getLandlordWallet(phoneHash);
}

export async function getTenantWallet(phone: string): Promise<string> {
    const phoneHash = ethers.keccak256(ethers.toUtf8Bytes(phone));
    return await walletFactory.getTenantWallet(phoneHash);
}

export async function getTenantProperty(phone: string): Promise<string> {
    const phoneHash = ethers.keccak256(ethers.toUtf8Bytes(phone));
    return await walletFactory.getTenantProperty(phoneHash);
}

export async function checkWalletExists(walletAddress: string): Promise<boolean> {
    return await walletFactory.isWalletRegistered(walletAddress);
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

export async function getTokenBalance(address: string): Promise<string> {
    const balance = await grideeToken.balanceOf(address);
    return ethers.formatUnits(balance, 18);
}

export async function getEnergyBalance(address: string): Promise<string> {
    const balance = await energyLedger.getBalance(address);
    return ethers.formatUnits(balance, 18);
}

export async function mintEnergyTokens(tenant: string, amount: string): Promise<TransactionReceipt> {
    const tx = await energyLedger.mintTokens(tenant, ethers.parseUnits(amount, 18));
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Mint energy tokens transaction failed");
    return receipt;
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

export async function distributeRevenue(
    propertyCode: string,
    landlordWallet: string,
    totalAmount: string
): Promise<TransactionReceipt> {
    const propertyCodeHash = ethers.id(propertyCode);
    const tx = await revenueDistributor.distributeRevenue(
        propertyCodeHash,
        landlordWallet,
        ethers.parseUnits(totalAmount, 18)
    );
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Distribute revenue transaction failed");
    return receipt;
}

export async function withdrawRevenue(): Promise<TransactionReceipt> {
    const tx = await revenueDistributor.withdraw();
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Withdraw revenue transaction failed");
    return receipt;
}

export async function getPendingWithdrawals(landlord: string): Promise<string> {
    const balance = await revenueDistributor.pendingWithdrawals(landlord);
    return ethers.formatUnits(balance, 18);
}
