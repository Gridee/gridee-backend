export const notificationService = {
  async sendPurchaseConfirmed(
    tenant: { id: number; name?: string | null; phone?: string | null },
    grdAmount: number,
    newBalance: number
  ): Promise<void> {
    // MVP placeholder. Replace with WhatsApp/SMS channel in a later integration.
    console.log(
      `Purchase confirmed for tenant ${tenant.id}: +${grdAmount} GRD, new balance ${newBalance} GRD`
    );
  }
};
