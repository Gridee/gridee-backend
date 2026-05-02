import axios from 'axios';
import { ethers } from 'ethers';

const PRIVY_APP_ID = process.env.PRIVY_APP_ID;
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET;

export const privyService = {
  async createEmbeddedWallet(userId: number): Promise<string> {
    // Fallback for local/dev if Privy credentials are not configured.
    if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) {
      return ethers.Wallet.createRandom().address;
    }

    const response = await axios.post(
      'https://auth.privy.io/api/v1/wallets',
      {
        chain_type: 'ethereum',
        metadata: {
          external_user_id: String(userId)
        }
      },
      {
        auth: {
          username: PRIVY_APP_ID,
          password: PRIVY_APP_SECRET
        }
      }
    );

    const walletAddress = response?.data?.wallet?.address as string | undefined;
    if (!walletAddress) {
      throw new Error('Failed to create Privy wallet');
    }

    return walletAddress;
  }
};
