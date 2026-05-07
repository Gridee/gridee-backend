import axios from 'axios';

const PRIVY_APP_ID = process.env.PRIVY_APP_ID;
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET;

const authHeader = () => `Basic ${Buffer.from(`${PRIVY_APP_ID}:${PRIVY_APP_SECRET}`).toString('base64')}`;

export class PrivyWalletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrivyWalletError';
  }
}

export const privyService = {
  async createUser(userId: number): Promise<{ id: string }> {
    if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) {
      throw new PrivyWalletError('Privy credentials are not configured');
    }

    try {
      const response = await axios.post(
        'https://auth.privy.io/api/v1/users',
        { create_embedded_wallet: true },
        {
          headers: {
            'Content-Type': 'application/json',
            'privy-app-id': PRIVY_APP_ID,
            Authorization: authHeader(),
          },
        }
      );
      return { id: response.data.id };
    } catch (error: any) {
      const details = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      throw new PrivyWalletError(`Failed to create Privy user: ${details}`);
    }
  },

  async createWallet(userId: number): Promise<{ address: string; walletId: string }> {
    if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) {
      throw new PrivyWalletError('Privy credentials are not configured');
    }

    try {
      const response = await axios.post(
        'https://api.privy.io/v1/wallets',
        {
          chain_type: 'ethereum',
          external_id: `gridee_user_${userId}`,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'privy-app-id': PRIVY_APP_ID,
            Authorization: authHeader(),
          },
        }
      );
      
      const walletAddress = response.data?.address || response.data?.wallet?.address || response.data?.data?.wallet?.address;
      const walletId = response.data?.id || response.data?.wallet?.id || response.data?.data?.wallet?.id;

      if (!walletAddress || !walletId) {
        throw new Error('Wallet data missing in response');
      }

      return { address: walletAddress, walletId };
    } catch (error: any) {
      const details = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      throw new PrivyWalletError(`Failed to create Privy wallet: ${details}`);
    }
  },

  async createEmbeddedWallet(userId: number): Promise<{ address: string; walletId: string }> {
    return await this.createWallet(userId);
  },

  async signTransaction(walletId: string, transaction: any): Promise<{ hash: string }> {
    if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) {
      throw new PrivyWalletError('Privy credentials are not configured');
    }

    try {
      const response = await axios.post(
        `https://api.privy.io/v1/wallets/${walletId}/rpc`,
        {
          method: 'eth_sendTransaction',
          // Privy's server-side RPC expects 'params' as an object for certain methods
          params: {
            transaction
          },
          caip2: 'eip155:84532'
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'privy-app-id': PRIVY_APP_ID,
            Authorization: authHeader(),
          },
        }
      );
      
      const hash = response.data?.data?.hash || response.data?.data || response.data?.result;
      if (!hash) {
        throw new Error('Transaction hash missing in response');
      }
      return { hash };
    } catch (error: any) {
      const details = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      throw new PrivyWalletError(`Failed to sign/send tx: ${details}`);
    }
  },

  async signMessage(walletAddress: string, message: string): Promise<{ signature: string }> {
    if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) {
      throw new PrivyWalletError('Privy credentials are not configured');
    }

    try {
      const response = await axios.post(
        `https://api.privy.io/v1/wallets/${walletAddress}/rpc`,
        {
          method: 'personal_sign',
          params: [message, walletAddress]
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'privy-app-id': PRIVY_APP_ID,
            Authorization: authHeader(),
          },
        }
      );
      
      const signature = response.data?.data || response.data?.result;
      if (!signature) {
        throw new Error('Signature missing in response');
      }
      return { signature };
    } catch (error: any) {
      const details = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      throw new PrivyWalletError(`Failed to sign message: ${details}`);
    }
  }
};
