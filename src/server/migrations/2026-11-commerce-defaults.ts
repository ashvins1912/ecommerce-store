import { ProductModel, OrderModel, PaymentGatewayConfigModel, WalletModel, WalletTransactionModel, ReturnRequestModel, PaymentEventModel } from '../models/schemas.js';

/**
 * Idempotent, additive migration for existing documents.
 * Legacy products remain public, COD-enabled and returnable by default;
 * legacy orders are not reclassified as prepaid.
 */
export async function migrateCommerceDefaults(): Promise<void> {
  await Promise.all([PaymentGatewayConfigModel.syncIndexes(), WalletModel.syncIndexes(), WalletTransactionModel.syncIndexes(), ReturnRequestModel.syncIndexes(), PaymentEventModel.syncIndexes()]);
  await ProductModel.updateMany(
    { visibility: { $exists: false } },
    { $set: { visibility: 'PUBLIC', assignedCustomerIds: [], onlinePaymentRequired: false, codAllowed: true, isReturnable: true, returnWindowDays: 7 } }
  );
  await ProductModel.updateMany(
    { isReturnable: { $exists: false } },
    { $set: { isReturnable: true, returnWindowDays: 7 } }
  );
  await ProductModel.updateMany(
    { codAllowed: { $exists: false } },
    { $set: { codAllowed: true, onlinePaymentRequired: false } }
  );
  await OrderModel.updateMany(
    { paymentMode: { $exists: false } },
    { $set: { paymentMode: 'COD', paymentStatus: 'NOT_REQUIRED', walletAppliedPaise: 0, refundStatus: 'NONE' } }
  );
}
