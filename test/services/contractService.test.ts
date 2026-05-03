import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
    mockMint: vi.fn(),
    mockBurn: vi.fn(),
    mockBalanceOf: vi.fn(),
    mockRegisterProperty: vi.fn(),
    mockGetProperty: vi.fn(),
    mockDeactivateProperty: vi.fn(),
    mockUpdateProperty: vi.fn(),
    mockGetPropertiesByLandlord: vi.fn(),
    mockGetPropertyCodesByLandlord: vi.fn(),
    mockRegisterLandlord: vi.fn(),
    mockRegisterTenant: vi.fn(),
    mockGetLandlordWallet: vi.fn(),
    mockGetTenantWallet: vi.fn(),
    mockGetTenantProperty: vi.fn(),
    mockIsWalletRegistered: vi.fn(),
    mockMintTokens: vi.fn(),
    mockDeductTokens: vi.fn(),
    mockGetEnergyBalance: vi.fn(),
    mockSetCutOff: vi.fn(),
    mockIsCutOff: vi.fn(),
    mockDistributeRevenue: vi.fn(),
    mockWithdraw: vi.fn(),
    mockPendingWithdrawals: vi.fn(),
}));

const mockTxResponse = {
    wait: vi.fn(),
};

vi.mock("ethers", async (importOriginal) => {
    const actual = await importOriginal<typeof import("ethers")>();
    const mockContract = {
        mint: mocks.mockMint,
        burn: mocks.mockBurn,
        balanceOf: mocks.mockBalanceOf,
        registerProperty: mocks.mockRegisterProperty,
        getProperty: mocks.mockGetProperty,
        deactivateProperty: mocks.mockDeactivateProperty,
        updateProperty: mocks.mockUpdateProperty,
        getPropertiesByLandlord: mocks.mockGetPropertiesByLandlord,
        getPropertyCodesByLandlord: mocks.mockGetPropertyCodesByLandlord,
        registerLandlord: mocks.mockRegisterLandlord,
        registerTenant: mocks.mockRegisterTenant,
        getLandlordWallet: mocks.mockGetLandlordWallet,
        getTenantWallet: mocks.mockGetTenantWallet,
        getTenantProperty: mocks.mockGetTenantProperty,
        isWalletRegistered: mocks.mockIsWalletRegistered,
        mintTokens: mocks.mockMintTokens,
        deductTokens: mocks.mockDeductTokens,
        getBalance: mocks.mockGetEnergyBalance,
        setCutOff: mocks.mockSetCutOff,
        isCutOff: mocks.mockIsCutOff,
        distributeRevenue: mocks.mockDistributeRevenue,
        withdraw: mocks.mockWithdraw,
        pendingWithdrawals: mocks.mockPendingWithdrawals,
    };
    return {
        ...actual,
        ethers: {
            ...actual.ethers,
            JsonRpcProvider: vi.fn(function () { return {}; }),
            Wallet: vi.fn(function () { return {}; }),
            Contract: vi.fn(function (_address: string, _abi: string[], _signer: object) {
                return mockContract;
            }),
            id: vi.fn(() => "0xhash"),
            keccak256: vi.fn(() => "0xphonehash"),
            toUtf8Bytes: vi.fn((s: string) => s),
            parseUnits: vi.fn((v: string) => BigInt(v) * 10n ** 18n),
            formatUnits: vi.fn((v: bigint) => Number(v) / 1e18 + ""),
        },
        JsonRpcProvider: vi.fn(function () { return {}; }),
        Wallet: vi.fn(function () { return {}; }),
        Contract: vi.fn(function (_address: string, _abi: string[], _signer: object) {
            return mockContract;
        }),
    };
});

vi.mock("dotenv/config", () => ({}));

process.env.CONTRACT_RPC_URL = "http://localhost:8545";
process.env.OPERATOR_PRIVATE_KEY = "0xtest";
process.env.GRIDEE_TOKEN_ADDRESS = "0xToken";
process.env.PROPERTY_REGISTRY_ADDRESS = "0xRegistry";
process.env.WALLET_FACTORY_ADDRESS = "0xFactory";
process.env.ENERGY_LEDGER_ADDRESS = "0xLedger";
process.env.REVENUE_DISTRIBUTOR_ADDRESS = "0xDistributor";

import {
    mintTokens,
    registerProperty,
    registerLandlordWallet,
    registerTenantWallet,
    getLandlordWallet,
    getTenantWallet,
    checkWalletExists,
    getProperty,
    getPropertiesByLandlord,
    getPropertyCodesByLandlord,
    getTokenBalance,
    getEnergyBalance,
    mintEnergyTokens,
    deductEnergyTokens,
    distributeRevenue,
    getPendingWithdrawals,
} from "../../src/services/contractService";

beforeEach(() => {
    vi.clearAllMocks();
});

describe("mintTokens", () => {
    it("calls contract mint with parsed units and waits for receipt", async () => {
        const fakeReceipt = { status: 1, hash: "0xabc" };
        mocks.mockMint.mockResolvedValue(mockTxResponse);
        mockTxResponse.wait.mockResolvedValue(fakeReceipt);

        const result = await mintTokens("0xRecipient", "1000");

        expect(mocks.mockMint).toHaveBeenCalledWith("0xRecipient", expect.any(BigInt));
        expect(mockTxResponse.wait).toHaveBeenCalled();
        expect(result).toBe(fakeReceipt);
    });

    it("throws when transaction receipt is null", async () => {
        mocks.mockMint.mockResolvedValue(mockTxResponse);
        mockTxResponse.wait.mockResolvedValue(null);

        await expect(mintTokens("0xRecipient", "500")).rejects.toThrow("Mint transaction failed");
    });
});

describe("registerProperty", () => {
    it("hashes the code and calls registerProperty on-chain", async () => {
        const fakeReceipt = { status: 1, hash: "0xdef" };
        mocks.mockRegisterProperty.mockResolvedValue(mockTxResponse);
        mockTxResponse.wait.mockResolvedValue(fakeReceipt);

        const result = await registerProperty("GRD-LAG-0042", "0xLandlord", 10, "Surulere, Lagos");

        expect(mocks.mockRegisterProperty).toHaveBeenCalledWith(
            expect.any(String),
            "0xLandlord",
            10,
            "Surulere, Lagos"
        );
        expect(result).toBe(fakeReceipt);
    });
});

describe("registerLandlordWallet", () => {
    it("hashes phone and calls registerLandlord on-chain", async () => {
        const fakeReceipt = { status: 1, hash: "0xghi" };
        mocks.mockRegisterLandlord.mockResolvedValue(mockTxResponse);
        mockTxResponse.wait.mockResolvedValue(fakeReceipt);

        const result = await registerLandlordWallet("+2348000000000", "0xWallet");

        expect(mocks.mockRegisterLandlord).toHaveBeenCalledWith(expect.any(String), "0xWallet");
        expect(result).toBe(fakeReceipt);
    });
});

describe("registerTenantWallet", () => {
    it("hashes phone and property code, calls registerTenant", async () => {
        const fakeReceipt = { status: 1, hash: "0xjkl" };
        mocks.mockRegisterTenant.mockResolvedValue(mockTxResponse);
        mockTxResponse.wait.mockResolvedValue(fakeReceipt);

        const result = await registerTenantWallet("+2348000000000", "0xWallet", "GRD-LAG-0042");

        expect(mocks.mockRegisterTenant).toHaveBeenCalledWith(
            expect.any(String),
            "0xWallet",
            expect.any(String)
        );
        expect(result).toBe(fakeReceipt);
    });
});

describe("getLandlordWallet", () => {
    it("returns the landlord wallet address for a phone", async () => {
        mocks.mockGetLandlordWallet.mockResolvedValue("0xLandlordWallet");

        const result = await getLandlordWallet("+2348000000000");

        expect(mocks.mockGetLandlordWallet).toHaveBeenCalledWith(expect.any(String));
        expect(result).toBe("0xLandlordWallet");
    });
});

describe("getTenantWallet", () => {
    it("returns the tenant wallet address for a phone", async () => {
        mocks.mockGetTenantWallet.mockResolvedValue("0xTenantWallet");

        const result = await getTenantWallet("+2348000000000");

        expect(mocks.mockGetTenantWallet).toHaveBeenCalledWith(expect.any(String));
        expect(result).toBe("0xTenantWallet");
    });
});

describe("checkWalletExists", () => {
    it("returns true when wallet is registered", async () => {
        mocks.mockIsWalletRegistered.mockResolvedValue(true);

        const result = await checkWalletExists("0xWallet");

        expect(mocks.mockIsWalletRegistered).toHaveBeenCalledWith("0xWallet");
        expect(result).toBe(true);
    });

    it("returns false when wallet is not registered", async () => {
        mocks.mockIsWalletRegistered.mockResolvedValue(false);

        const result = await checkWalletExists("0xUnknown");

        expect(result).toBe(false);
    });
});

describe("getProperty", () => {
    it("hashes the code and fetches property data", async () => {
        const fakeProperty = {
            flatCount: 12,
            location: "Ikeja",
            isActive: true,
            createdAt: 1700000000,
        };
        mocks.mockGetProperty.mockResolvedValue(fakeProperty);

        const result = await getProperty("GRD-LAG-0001");

        expect(mocks.mockGetProperty).toHaveBeenCalledWith(expect.any(String));
        expect(result).toEqual(fakeProperty);
    });
});

describe("getTokenBalance", () => {
    it("returns formatted token balance", async () => {
        mocks.mockBalanceOf.mockResolvedValue(1000000000000000000n);

        const result = await getTokenBalance("0xUser");

        expect(mocks.mockBalanceOf).toHaveBeenCalledWith("0xUser");
        expect(result).toBe("1.0");
    });
});

describe("getEnergyBalance", () => {
    it("returns formatted energy balance", async () => {
        mocks.mockGetEnergyBalance.mockResolvedValue(4500000000000000000n);

        const result = await getEnergyBalance("0xTenant");

        expect(mocks.mockGetEnergyBalance).toHaveBeenCalledWith("0xTenant");
        expect(result).toBe("4.5");
    });
});

describe("mintEnergyTokens", () => {
    it("calls mintTokens on EnergyLedger", async () => {
        const fakeReceipt = { status: 1 };
        mocks.mockMintTokens.mockResolvedValue(mockTxResponse);
        mockTxResponse.wait.mockResolvedValue(fakeReceipt);

        const result = await mintEnergyTokens("0xTenant", "100");

        expect(mocks.mockMintTokens).toHaveBeenCalledWith("0xTenant", expect.any(BigInt));
        expect(result).toBe(fakeReceipt);
    });
});

describe("deductEnergyTokens", () => {
    it("calls deductTokens on EnergyLedger", async () => {
        const fakeReceipt = { status: 1 };
        mocks.mockDeductTokens.mockResolvedValue(mockTxResponse);
        mockTxResponse.wait.mockResolvedValue(fakeReceipt);

        const result = await deductEnergyTokens("0xTenant", "50");

        expect(mocks.mockDeductTokens).toHaveBeenCalledWith("0xTenant", expect.any(BigInt));
        expect(result).toBe(fakeReceipt);
    });
});

describe("distributeRevenue", () => {
    it("calls distributeRevenue on RevenueDistributor", async () => {
        const fakeReceipt = { status: 1 };
        mocks.mockDistributeRevenue.mockResolvedValue(mockTxResponse);
        mockTxResponse.wait.mockResolvedValue(fakeReceipt);

        const result = await distributeRevenue("GRD-LAG-0042", "0xLandlord", "1000");

        expect(mocks.mockDistributeRevenue).toHaveBeenCalledWith(
            expect.any(String),
            "0xLandlord",
            expect.any(BigInt)
        );
        expect(result).toBe(fakeReceipt);
    });
});

describe("getPendingWithdrawals", () => {
    it("returns formatted pending withdrawal amount", async () => {
        mocks.mockPendingWithdrawals.mockResolvedValue(5000000000000000000n);

        const result = await getPendingWithdrawals("0xLandlord");

        expect(mocks.mockPendingWithdrawals).toHaveBeenCalledWith("0xLandlord");
        expect(result).toBe("5.0");
    });
});
