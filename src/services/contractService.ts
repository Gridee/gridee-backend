export const contractService = {
  async assignWallet(userId: number): Promise<string> {
    console.log(`Assigning wallet to user ${userId}`);
    // Mocking wallet creation / assignment
    return '0x' + Math.random().toString(16).slice(2, 42).padEnd(40, '0');
  },

  async mintTokens(walletAddress: string, grdAmount: number): Promise<{ txHash: string }> {
    console.log(`Minting ${grdAmount} GRD to wallet ${walletAddress}`);
    // MVP mock implementation until on-chain integration is wired.
    return {
      txHash: '0x' + Math.random().toString(16).slice(2).padEnd(64, '0').slice(0, 64)
    };
  },

  async getMeterBalance(walletAddress: string): Promise<number> {
    console.log(`Reading meter balance for wallet ${walletAddress}`);
    // MVP mock implementation.
    return Number((Math.random() * 100).toFixed(4));
  },

  async deductTokens(walletAddress: string, kwhUsed: number): Promise<void> {
    console.log(`Deducting ${kwhUsed} kWh worth of tokens from wallet ${walletAddress}`);
    // MVP mock implementation.
  },

  async getLandlordEarnings(
    landlordWallet: string,
    propertyCodes: string[]
  ): Promise<{
    totalNGN: number;
    perProperty: Array<{ code: string; amountNGN: number }>;
  }> {
    console.log(`Reading earnings from RevenueDistributor for wallet ${landlordWallet}`);
    // MVP mock implementation until RevenueDistributor contract integration is wired.
    const perProperty = propertyCodes.map((code, index) => ({
      code,
      amountNGN: Number((5000 + index * 1250).toFixed(2))
    }));

    const totalNGN = Number(
      perProperty.reduce((sum, item) => sum + item.amountNGN, 0).toFixed(2)
    );

    return { totalNGN, perProperty };
  },

  async getPropertyEarnings(
    landlordWallet: string,
    propertyCode: string
  ): Promise<{ code: string; amountNGN: number }> {
    console.log(
      `Reading property earnings from RevenueDistributor for wallet ${landlordWallet}, property ${propertyCode}`
    );
    // MVP mock implementation.
    return { code: propertyCode, amountNGN: 5000 };
  }
};
