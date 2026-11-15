import mongoose from 'mongoose';
import {
  PaymentGatewayConfigModel,
  WalletModel,
  WalletTransactionModel,
} from '../models/schemas.js';
import { decryptField, encryptField, maskSecret } from './fieldEncryption.js';

export type GatewayProvider = 'razorpay' | 'stripe';

export async function saveGatewayConfiguration(input: {
  sellerId: string; provider: GatewayProvider; keyId: string;
  secret: string; webhookSecret: string; enabled: boolean;
}) {
  const update: Record<string, unknown> = {
    keyId: input.keyId.trim(),
    enabled: input.enabled,
  };
  if (input.secret) update.encryptedSecret = encryptField(input.secret);
  if (input.webhookSecret) update.encryptedWebhookSecret = encryptField(input.webhookSecret);
  if (!input.secret || !input.webhookSecret) {
    const existing = await PaymentGatewayConfigModel.findOne({
      sellerId: input.sellerId, provider: input.provider,
    }).select('+encryptedSecret +encryptedWebhookSecret').lean();
    if (!existing && (!input.secret || !input.webhookSecret)) {
      throw new Error('Both API secret and webhook secret are required for initial setup.');
    }
    if (existing) {
      if (!input.secret) update.encryptedSecret = existing.encryptedSecret;
      if (!input.webhookSecret) update.encryptedWebhookSecret = existing.encryptedWebhookSecret;
    }
  }
  const doc = await PaymentGatewayConfigModel.findOneAndUpdate(
    { sellerId: input.sellerId, provider: input.provider },
    { $set: update, $setOnInsert: { sellerId: input.sellerId, provider: input.provider } },
    { upsert: true, new: true, runValidators: true }
  ).select('+encryptedSecret +encryptedWebhookSecret').lean();
  return {
    provider: doc.provider as GatewayProvider,
    keyId: doc.keyId as string,
    enabled: Boolean(doc.enabled),
    secretMasked: maskSecret(input.secret || decryptField(doc.encryptedSecret)),
    webhookSecretConfigured: Boolean(doc.encryptedWebhookSecret),
    updatedAt: doc.updatedAt,
  };
}

export async function listGatewayConfigurations(sellerId: string) {
  const docs = await PaymentGatewayConfigModel.find({ sellerId })
    .select('+encryptedSecret -encryptedWebhookSecret').lean();
  return docs.map((doc: any) => ({
    provider: doc.provider,
    keyId: doc.keyId,
    enabled: Boolean(doc.enabled),
    secretMasked: maskSecret(decryptField(doc.encryptedSecret)),
    webhookSecretConfigured: true,
    updatedAt: doc.updatedAt,
  }));
}

export async function getGatewaySecrets(sellerId: string, provider: GatewayProvider) {
  const doc = await PaymentGatewayConfigModel.findOne({ sellerId, provider })
    .select('+encryptedSecret +encryptedWebhookSecret').lean();
  if (!doc || !doc.enabled) return null;
  return {
    provider,
    keyId: String(doc.keyId),
    secret: decryptField(String(doc.encryptedSecret)),
    webhookSecret: decryptField(String(doc.encryptedWebhookSecret)),
  };
}

export async function applyWalletTransaction(input: {
  userId: string; idempotencyKey: string;
  type: 'CREDIT_REFUND' | 'DEBIT_ORDER_REDEMPTION' | 'BONUS' | 'ADJUSTMENT';
  amountPaise: number; orderId?: string; reference?: string; metadata?: Record<string, unknown>;
}) {
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new Error('Wallet amount must be a positive integer in paise.');
  }
  const existing = await WalletTransactionModel.findOne({ idempotencyKey: input.idempotencyKey }).lean();
  if (existing) {
    if (String(existing.userId) !== input.userId || existing.amountPaise !== input.amountPaise || existing.type !== input.type) {
      throw new Error('IDEMPOTENCY_KEY_CONFLICT');
    }
    return { balancePaise: existing.balanceAfterPaise, transactionId: String(existing._id), replayed: true };
  }

  const session = await mongoose.startSession();
  let result: { balancePaise: number; transactionId: string; replayed: boolean } | null = null;
  try {
    await session.withTransaction(async () => {
      const wallet = await WalletModel.findOneAndUpdate(
        { userId: input.userId, ...(input.type === 'DEBIT_ORDER_REDEMPTION' ? { balancePaise: { $gte: input.amountPaise } } : {}) },
        { $inc: { balancePaise: input.type === 'DEBIT_ORDER_REDEMPTION' ? -input.amountPaise : input.amountPaise, version: 1 }, $setOnInsert: { userId: input.userId, currency: 'INR' } },
        { new: true, upsert: input.type !== 'DEBIT_ORDER_REDEMPTION', session, setDefaultsOnInsert: true }
      );
      if (!wallet) throw new Error('INSUFFICIENT_WALLET_BALANCE');
      const [entry] = await WalletTransactionModel.create([{
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
        type: input.type,
        amountPaise: input.amountPaise,
        orderId: input.orderId || null,
        reference: input.reference || null,
        balanceAfterPaise: wallet.balancePaise,
        metadata: input.metadata || {},
      }], { session });
      result = { balancePaise: wallet.balancePaise, transactionId: String(entry._id), replayed: false };
    });
  } finally {
    await session.endSession();
  }
  if (!result) throw new Error('WALLET_TRANSACTION_FAILED');
  return result;
}

export async function getWalletSummary(userId: string) {
  const wallet = await WalletModel.findOne({ userId }).lean();
  const transactions = await WalletTransactionModel.find({ userId }).sort({ createdAt: -1 }).limit(50).lean();
  return {
    balancePaise: wallet?.balancePaise || 0,
    currency: 'INR',
    transactions: transactions.map((t: any) => ({
      id: String(t._id), type: t.type, amountPaise: t.amountPaise,
      orderId: t.orderId, reference: t.reference, createdAt: t.createdAt,
    })),
  };
}
