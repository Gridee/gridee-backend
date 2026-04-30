import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
    mockMint: vi.fn(),
    mockBalanceOf: vi.fn(),
    mockRegisterProperty: vi.fn(),
    mockGetProperty: vi.fn(),
    mockAssignWallet: vi.fn(),
    mockGetWallet: vi.fn(),
    mockWalletExists: vi.fn(),
    mockCredit: vi.fn(),
    mockDeduct: vi.fn(),
    mockGetEnergyBalance: vi.fn(),
}));

const mockTxResponse = {
    wait: vi.fn(),
};

vi.mock("ethers", async (importOriginal) => {
    const actual = await importOriginal<typeof import("ethers")>();
    return {
        ...actual,
        ethers: {
            ...actual.ethers,
            JsonRpcProvider: vi.fn(function () { return {}; }),
            Wallet: vi.fn(function () { return {}; }),
            Contract: vi.fn(function (_address: string, _abi: string[], _signer: object) {
                return {
                    mint: mocks.mockMint,
                    balanceOf: mocks.mockBalanceOf,
                    registerProperty: mocks.mockRegisterProperty,
                    getProperty: mocks.mockGetProperty,
                    assignWallet: mocks.mockAssignWallet,
                    getWallet: mocks.mockGetWallet,
                    walletExists: mocks.mockWalletExists,
                    credit: mocks.mockCredit,
                    deduct: mocks.mockDeduct,
                    getBalance: mocks.mockGetEnergyBalance,
                };
            }),
        },
        JsonRpcProvider: vi.fn(function () { return {}; }),
        Wallet: vi.fn(function () { return {}; }),
        Contract: vi.fn(function (_address: string, _abi: string[], _signer: object) {
            return {
                mint: mocks.mockMint,
                balanceOf: mocks.mockBalanceOf,
                registerProperty: mocks.mockRegisterProperty,
                getProperty: mocks.mockGetProperty,
                assignWallet: mocks.mockAssignWallet,
                getWallet: mocks.mockGetWallet,
                walletExists: mocks.mockWalletExists,
                credit: mocks.mockCredit,
                deduct: mocks.mockDeduct,
                getBalance: mocks.mockGetEnergyBalance,
            };
        }),
    };
});

import {
    mintTokens,
    registerProperty,
    assignWallet,
    getWallet,
    checkWalletExists,
    getProperty,
    getPropertiesByLandlord,
    getPropertyCodesByLandlord,
    getTokenBalance,
    getEnergyBalance,
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

    it("throws when transaction receipt is null", async () => {
        mocks.mockRegisterProperty.mockResolvedValue(mockTxResponse);
        mockTxResponse.wait.mockResolvedValue(null);

        await expect(registerProperty("GRD-X", "0xL", 1, "Loc")).rejects.toThrow(
            "Register property transaction failed"
        );
    });
});

describe("assignWallet", () => {
    it("calls assignWallet on the contract and returns receipt", async () => {
        const fakeReceipt = { status: 1, hash: "0xghi" };
        mocks.mockAssignWallet.mockResolvedValue(mockTxResponse);
        mockTxResponse.wait.mockResolvedValue(fakeReceipt);

        const result = await assignWallet(42, "0xWallet");

        expect(mocks.mockAssignWallet).toHaveBeenCalledWith(42, "0xWallet");
        expect(result).toBe(fakeReceipt);
    });

    it("throws when transaction receipt is null", async () => {
        mocks.mockAssignWallet.mockResolvedValue(mockTxResponse);
        mockTxResponse.wait.mockResolvedValue(null);

        await expect(assignWallet(1, "0xW")).rejects.toThrow("Assign wallet transaction failed");
    });
});

describe("getWallet", () => {
    it("returns the wallet address for a user id", async () => {
        mocks.mockGetWallet.mockResolvedValue("0xWallet123");

        const result = await getWallet(7);

        expect(mocks.mockGetWallet).toHaveBeenCalledWith(7);
        expect(result).toBe("0xWallet123");
    });
});

describe("checkWalletExists", () => {
    it("returns true when wallet exists", async () => {
        mocks.mockWalletExists.mockResolvedValue(true);

        const result = await checkWalletExists(5);

        expect(mocks.mockWalletExists).toHaveBeenCalledWith(5);
        expect(result).toBe(true);
    });

    it("returns false when wallet does not exist", async () => {
        mocks.mockWalletExists.mockResolvedValue(false);

        const result = await checkWalletExists(99);

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
