import axios from 'axios';
import { db } from '../db';
import { contractService } from './contractService';
import { notificationService } from './notificationService';

type PaymentMethod = 'bank_transfer' | 'mobile_money' | 'crypto';

type InitiatePaymentInput = {
  tenantUserId: number;
  amountNGN: number;
  method: PaymentMethod;
};

type FlutterwaveWebhookPayload = {
  data?: {
    status?: string;
    tx_ref?: string;
  };
};

const FLW_SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY as string;
const GRD_PRICE_PER_NGN = Number(process.env.GRD_PRICE_PER_NGN || '0');

function getFlutterwavePaymentOption(method: PaymentMethod): string {
  if (method === 'bank_transfer') return 'banktransfer';
  if (method === 'mobile_money') return 'mobilemoney';
  return 'barter';
}

export const paymentService = {
  async initiatePayment(input: InitiatePaymentInput): Promise<{
    transactionId: number;
    paymentRef: string;
    amountNGN: number;
    grdAmount: number;
    rate: number;
    paymentInstructions: Record<string, unknown>;
  }> {
    if (GRD_PRICE_PER_NGN <= 0) {
      throw new Error('Invalid GRD_PRICE_PER_NGN configuration');
    }

    const tenant = await db('tenants').where({ user_id: input.tenantUserId }).first();
    if (!tenant) {
      throw new Error('Tenant profile not found');
    }

    const grdAmount = Number((input.amountNGN * GRD_PRICE_PER_NGN).toFixed(4));
    const paymentRef = `grd_tx_${Date.now()}_${tenant.id}`;

    const [transaction] = await db('transactions')
      .insert({
        tenant_id: tenant.id,
        amount_ngn: input.amountNGN,
        grd_amount: grdAmount,
        payment_method: input.method,
        payment_ref: paymentRef,
        status: 'PENDING'
      })
      .returning(['id', 'payment_ref']);

    const flwResponse = await axios.post(
      'https://api.flutterwave.com/v3/payments',
      {
        tx_ref: paymentRef,
        amount: input.amountNGN,
        currency: 'NGN',
        payment_options: getFlutterwavePaymentOption(input.method),
        redirect_url: 'https://example.com/payments/redirect',
        customer: {
          name: `Tenant ${tenant.id}`,
          email: `tenant-${tenant.id}@gridee.local`
        },
        customizations: {
          title: 'Gridee Token Top-up',
          description: `${grdAmount} GRD token purchase`
        }
      },
      {
        headers: {
          Authorization: `Bearer ${FLW_SECRET_KEY}`
        }
      }
    );

    const paymentLink = flwResponse?.data?.data?.link as string | undefined;

    return {
      transactionId: Number(transaction.id),
      paymentRef: String(transaction.payment_ref),
      amountNGN: input.amountNGN,
      grdAmount,
      rate: GRD_PRICE_PER_NGN,
      paymentInstructions: {
        method: input.method,
        checkoutUrl: paymentLink || null,
        message:
          paymentLink
            ? 'Complete this payment from the Flutterwave checkout link.'
            : 'Payment initialized. Follow your Flutterwave flow to complete payment.'
      }
    };
  },

  async processFlutterwaveWebhook(payload: FlutterwaveWebhookPayload): Promise<{ processed: boolean }> {
    const status = payload?.data?.status;
    const txRef = payload?.data?.tx_ref;

    if (status !== 'successful' || !txRef) {
      return { processed: false };
    }

    const transaction = await db('transactions').where({ payment_ref: txRef }).first();
    if (!transaction) {
      return { processed: false };
    }

    if (transaction.status === 'COMPLETED') {
      return { processed: true };
    }

    const tenant = await db('tenants')
      .join('users', 'tenants.user_id', 'users.id')
      .select(
        'tenants.id as tenant_id',
        'tenants.user_id',
        'users.id as user_id',
        'users.name',
        'users.phone',
        'users.wallet_address'
      )
      .where('tenants.id', transaction.tenant_id)
      .first();

    if (!tenant?.wallet_address) {
      throw new Error('Tenant wallet not found');
    }

    await contractService.mintTokens(tenant.wallet_address, Number(transaction.grd_amount));

    await db('transactions').where({ id: transaction.id }).update({ status: 'COMPLETED' });

    const completedRows = await db('transactions')
      .where({ tenant_id: transaction.tenant_id, status: 'COMPLETED' })
      .select('grd_amount');

    const newBalance = completedRows.reduce((sum, row) => sum + Number(row.grd_amount), 0);

    await notificationService.sendPurchaseConfirmed(
      {
        id: Number(tenant.user_id),
        name: tenant.name,
        phone: tenant.phone
      },
      Number(transaction.grd_amount),
      Number(newBalance.toFixed(4))
    );

    return { processed: true };
  }
};
