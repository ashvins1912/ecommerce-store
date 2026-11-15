import crypto from 'node:crypto';
import mongoose from 'mongoose';
import mongoose from 'mongoose';
import {
  PaymentGatewayConfigModel,
  WalletModel,
  WalletTransactionModel,
  PaymentEventModel,
  OrderModel,
  ProductModel,
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

export async function createGatewayCheckout(input: {
  sellerId: string; provider: GatewayProvider; orderId: string;
  orderNumber: string; amountPaise: number; currency?: string;
}) {
  const gateway = await getGatewaySecrets(input.sellerId, input.provider);
  if (!gateway) throw new Error('ACTIVE_PAYMENT_GATEWAY_NOT_CONFIGURED');
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise < 100) throw new Error('INVALID_PAYMENT_AMOUNT');
  if (input.provider === 'razorpay') {
    const auth = Buffer.from(gateway.keyId + ':' + gateway.secret).toString('base64');
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST', headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: input.amountPaise, currency: input.currency || 'INR', receipt: input.orderNumber.slice(0, 40), notes: { orderId: input.orderId } }),
    });
    const body = await response.json() as any;
    if (!response.ok) throw new Error(body.error?.description || 'RAZORPAY_ORDER_CREATE_FAILED');
    return { provider: 'razorpay' as const, reference: String(body.id), keyId: gateway.keyId, amountPaise: body.amount, currency: body.currency };
  }
  const appUrl = process.env.APP_URL;
  if (!appUrl || !/^https:\/\//i.test(appUrl)) throw new Error('APP_URL must be configured as HTTPS before creating Stripe Checkout Sessions.');
  const params = new URLSearchParams({
    mode: 'payment',
    'line_items[0][price_data][currency]': (input.currency || 'INR').toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(input.amountPaise),
    'line_items[0][price_data][product_data][name]': 'Order ' + input.orderNumber,
    'line_items[0][quantity]': '1',
    success_url: appUrl.replace(/\/$/, '') + '/orders?payment=success',
    cancel_url: appUrl.replace(/\/$/, '') + '/orders?payment=cancelled',
    'metadata[orderId]': input.orderId,
    'metadata[orderNumber]': input.orderNumber,
  });
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + gateway.secret, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const body = await response.json() as any;
  if (!response.ok) throw new Error(body.error?.message || 'STRIPE_CHECKOUT_CREATE_FAILED');
  return { provider: 'stripe' as const, reference: String(body.id), url: String(body.url), publishableKey: gateway.keyId, amountPaise: input.amountPaise, currency: input.currency || 'INR' };
}

export async function verifyPaymentWebhook(input: {
  sellerId: string; provider: GatewayProvider; signature: string; rawBody: Buffer;
}) {
  const gateway = await getGatewaySecrets(input.sellerId, input.provider);
  if (!gateway) return false;
  let expected = '';
  if (input.provider === 'razorpay') {
    expected = crypto.createHmac('sha256', gateway.webhookSecret).update(input.rawBody).digest('hex');
  } else {
    const parts = input.signature.split(',').map((part) => part.split('='));
    const timestamp = parts.find((part) => part[0] === 't')?.[1];
    const signatures = parts.filter((part) => part[0] === 'v1').map((part) => part[1]);
    if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
    expected = crypto.createHmac('sha256', gateway.webhookSecret).update(timestamp + '.' + input.rawBody.toString('utf8')).digest('hex');
    return signatures.some((sig) => {
      const a = Buffer.from(sig || ''); const b = Buffer.from(expected);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    });
  }
  const a = Buffer.from(input.signature || ''); const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function claimPaymentEvent(provider: GatewayProvider, eventId: string, orderId: string, payloadHash: string) {
  try {
    await PaymentEventModel.create({ provider, eventId, orderId, payloadHash, processedAt: new Date() });
    return true;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false;
    throw err;
  }
}

export async function refundGatewayPayment(input: {
  sellerId: string; provider: GatewayProvider; paymentReference: string;
  amountPaise: number; idempotencyKey: string;
}) {
  const gateway = await getGatewaySecrets(input.sellerId, input.provider);
  if (!gateway) throw new Error('ACTIVE_PAYMENT_GATEWAY_NOT_CONFIGURED');
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) throw new Error('INVALID_REFUND_AMOUNT');
  if (input.provider === 'razorpay') {
    const auth = Buffer.from(gateway.keyId + ':' + gateway.secret).toString('base64');
    const response = await fetch('https://api.razorpay.com/v1/payments/' + encodeURIComponent(input.paymentReference) + '/refund', {
      method: 'POST', headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: input.amountPaise, notes: { idempotencyKey: input.idempotencyKey } }),
    });
    const body = await response.json() as any;
    if (!response.ok) throw new Error(body.error?.description || 'RAZORPAY_REFUND_FAILED');
    return { provider: 'razorpay' as const, refundId: String(body.id), status: String(body.status || 'pending') };
  }
  const params = new URLSearchParams({ payment_intent: input.paymentReference, amount: String(input.amountPaise) });
  const response = await fetch('https://api.stripe.com/v1/refunds', {
    method: 'POST', headers: { Authorization: 'Bearer ' + gateway.secret, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': input.idempotencyKey },
    body: params,
  });
  const body = await response.json() as any;
  if (!response.ok) throw new Error(body.error?.message || 'STRIPE_REFUND_FAILED');
  return { provider: 'stripe' as const, refundId: String(body.id), status: String(body.status || 'pending') };
}

export async function restoreCancelledOrderInventory(orderId: string) {
  if (!mongoose.isValidObjectId(orderId)) return false;
  const session = await mongoose.startSession();
  let restored = false;
  try {
    await session.withTransaction(async () => {
      const order = await OrderModel.findOneAndUpdate(
        { _id: orderId, status: 'Cancelled', inventoryRestored: { $ne: true } },
        { $set: { inventoryRestored: true } },
        { new: true, session }
      );
      if (!order) return;
      for (const item of order.items || []) {
        await ProductModel.updateOne(
          { _id: item.productId },
          { $inc: { totalStock: item.quantity, 'variants.$[variant].stock': item.quantity } },
          { arrayFilters: [{ 'variant.variantSku': item.variantSku }], session }
        );
      }
      restored = true;
    });
  } finally {
    await session.endSession();
  }
  return restored;
}
