import axios from 'axios';
import { db } from '../db';
import { TRANSACTION_STATUS } from '../constants/transactionStatus';

type BankDetails = {
  accountNumber: string;
  bankCode: string;
  accountName: string;
};

const FLW_SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY as string;

export const transferService = {
  async withdraw(
    landlordId: number,
    amountNGN: number,
    bankDetails: BankDetails
  ): Promise<{ transferReference: string }> {
    const landlord = await db('users').where({ id: landlordId, role: 'landlord' }).first();
    if (!landlord) {
      throw new Error('Landlord not found');
    }

    const transferRef = `wd_${landlordId}_${Date.now()}`;

    await axios.post(
      'https://api.flutterwave.com/v3/transfers',
      {
        account_bank: bankDetails.bankCode,
        account_number: bankDetails.accountNumber,
        amount: amountNGN,
        narration: `Gridee payout for landlord ${landlordId}`,
        currency: 'NGN',
        reference: transferRef,
        callback_url: 'https://example.com/transfers/callback',
        debit_currency: 'NGN',
        beneficiary_name: bankDetails.accountName
      },
      {
        headers: {
          Authorization: `Bearer ${FLW_SECRET_KEY}`
        }
      }
    );

    await db('withdrawals').insert({
      landlord_id: landlordId,
      amount_ngn: amountNGN,
      transfer_ref: transferRef,
      status: TRANSACTION_STATUS.PENDING
    });

    return { transferReference: transferRef };
  }
};
