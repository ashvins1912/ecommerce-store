import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { z } from 'zod';
import { PlatformConfigModel } from '../models/schemas.js';
import type { CheckoutPaymentMode, PlatformServiceFlags } from '../../shared/types.js';

export const DEFAULT_PLATFORM_FLAGS: PlatformServiceFlags = {
  shippingQuotesEnabled: false,
  flatFallbackShippingInr: 0,
  backgroundWorkerEnabled: false,
  onlinePaymentEnabled: false,
  codEnabled: true,
  codMaxOrderValueInr: 25000,
  sellerDirectCollectEnabled: true,
  posMachineEnabled: true,
  posDemandCartThresholdInr: 5000,
  posTerminalLabel: 'Portable Card / UPI POS',
  updatedAt: new Date().toISOString(),
  updatedByName: null,
};

const PLATFORM_FLAGS_CACHE_TTL_MS = 15_000;
let cachedFlags: { value: PlatformServiceFlags; expiresAt: number } | null = null;
const LOCAL_FLAGS_FILE = path.resolve(process.cwd(), 'data/platform-flags.json');

export const platformFlagsPatchSchema = z
  .object({
    shippingQuotesEnabled: z.boolean().optional(),
    flatFallbackShippingInr: z.number().min(0).max(50000).optional(),
    backgroundWorkerEnabled: z.boolean().optional(),
    onlinePaymentEnabled: z.boolean().optional(),
    codEnabled: z.boolean().optional(),
    codMaxOrderValueInr: z.number().min(0).max(1000000).optional(),
    sellerDirectCollectEnabled: z.boolean().optional(),
    posMachineEnabled: z.boolean().optional(),
    posDemandCartThresholdInr: z.number().min(0).max(1000000).optional(),
    posTerminalLabel: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export function normalizePlatformFlags(raw?: Partial<PlatformServiceFlags> | null): PlatformServiceFlags {
  return {
    shippingQuotesEnabled: Boolean(raw?.shippingQuotesEnabled ?? DEFAULT_PLATFORM_FLAGS.shippingQuotesEnabled),
    flatFallbackShippingInr: Math.max(0, Number(raw?.flatFallbackShippingInr ?? DEFAULT_PLATFORM_FLAGS.flatFallbackShippingInr) || 0),
    backgroundWorkerEnabled: Boolean(raw?.backgroundWorkerEnabled ?? DEFAULT_PLATFORM_FLAGS.backgroundWorkerEnabled),
    onlinePaymentEnabled: Boolean(raw?.onlinePaymentEnabled ?? DEFAULT_PLATFORM_FLAGS.onlinePaymentEnabled),
    codEnabled: raw?.codEnabled === undefined ? DEFAULT_PLATFORM_FLAGS.codEnabled : Boolean(raw.codEnabled),
    codMaxOrderValueInr: Math.max(0, Number(raw?.codMaxOrderValueInr ?? DEFAULT_PLATFORM_FLAGS.codMaxOrderValueInr) || 0),
    sellerDirectCollectEnabled:
      raw?.sellerDirectCollectEnabled === undefined
        ? DEFAULT_PLATFORM_FLAGS.sellerDirectCollectEnabled
        : Boolean(raw.sellerDirectCollectEnabled),
    posMachineEnabled:
      raw?.posMachineEnabled === undefined ? DEFAULT_PLATFORM_FLAGS.posMachineEnabled : Boolean(raw.posMachineEnabled),
    posDemandCartThresholdInr: Math.max(
      0,
      Number(raw?.posDemandCartThresholdInr ?? DEFAULT_PLATFORM_FLAGS.posDemandCartThresholdInr) || 0
    ),
    posTerminalLabel: String(raw?.posTerminalLabel || DEFAULT_PLATFORM_FLAGS.posTerminalLabel).trim() || DEFAULT_PLATFORM_FLAGS.posTerminalLabel,
    updatedAt: raw?.updatedAt ? new Date(raw.updatedAt).toISOString() : DEFAULT_PLATFORM_FLAGS.updatedAt,
    updatedByName: raw?.updatedByName ?? null,
  };
}

function readLocalFlags(): PlatformServiceFlags {
  try {
    if (fs.existsSync(LOCAL_FLAGS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(LOCAL_FLAGS_FILE, 'utf-8')) as Partial<PlatformServiceFlags>;
      return normalizePlatformFlags(parsed);
    }
  } catch {
    // Fall back to safe defaults if local file cannot be parsed
  }
  return { ...DEFAULT_PLATFORM_FLAGS };
}

function writeLocalFlags(flags: PlatformServiceFlags) {
  try {
    const dir = path.dirname(LOCAL_FLAGS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LOCAL_FLAGS_FILE, JSON.stringify(flags, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not persist local platform flags:', (err as Error).message);
  }
}

export function invalidatePlatformFlagsCache() {
  cachedFlags = null;
}

export async function getPlatformFlags(): Promise<PlatformServiceFlags> {
  if (cachedFlags && Date.now() < cachedFlags.expiresAt) {
    return cachedFlags.value;
  }

  let loaded: PlatformServiceFlags;
  if (mongoose.connection.readyState === 1) {
    const doc = (await PlatformConfigModel.findOne({ singletonKey: 'default' }).lean()) as
      | (Partial<PlatformServiceFlags> & { updatedAt?: Date })
      | null;
    if (doc) {
      loaded = normalizePlatformFlags(doc);
    } else {
      loaded = normalizePlatformFlags(DEFAULT_PLATFORM_FLAGS);
      await PlatformConfigModel.updateOne(
        { singletonKey: 'default' },
        { $setOnInsert: { singletonKey: 'default', ...loaded } },
        { upsert: true }
      ).catch(() => {});
    }
  } else {
    loaded = readLocalFlags();
  }

  cachedFlags = {
    value: loaded,
    expiresAt: Date.now() + PLATFORM_FLAGS_CACHE_TTL_MS,
  };
  return loaded;
}

export async function updatePlatformFlags(
  patch: z.infer<typeof platformFlagsPatchSchema>,
  actor: { _id: string; name: string }
): Promise<PlatformServiceFlags> {
  const current = await getPlatformFlags();
  const next = normalizePlatformFlags({
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
    updatedByName: actor.name,
  });

  if (mongoose.connection.readyState === 1) {
    const updated = (await PlatformConfigModel.findOneAndUpdate(
      { singletonKey: 'default' },
      {
        $set: {
          shippingQuotesEnabled: next.shippingQuotesEnabled,
          flatFallbackShippingInr: next.flatFallbackShippingInr,
          backgroundWorkerEnabled: next.backgroundWorkerEnabled,
          onlinePaymentEnabled: next.onlinePaymentEnabled,
          codEnabled: next.codEnabled,
          codMaxOrderValueInr: next.codMaxOrderValueInr,
          sellerDirectCollectEnabled: next.sellerDirectCollectEnabled,
          posMachineEnabled: next.posMachineEnabled,
          posDemandCartThresholdInr: next.posDemandCartThresholdInr,
          posTerminalLabel: next.posTerminalLabel,
          updatedByUserId: actor._id,
          updatedByName: actor.name,
        },
      },
      { upsert: true, returnDocument: 'after' }
    ).lean()) as Partial<PlatformServiceFlags> | null;
    const resolved = normalizePlatformFlags(updated || next);
    cachedFlags = { value: resolved, expiresAt: Date.now() + PLATFORM_FLAGS_CACHE_TTL_MS };
    return resolved;
  }

  writeLocalFlags(next);
  cachedFlags = { value: next, expiresAt: Date.now() + PLATFORM_FLAGS_CACHE_TTL_MS };
  return next;
}

export interface CheckoutResolutionInput {
  flags: PlatformServiceFlags;
  cartValueInr: number;
  requestedPaymentMode?: CheckoutPaymentMode;
  requestedProvider?: 'razorpay' | 'stripe';
  requiresPrepaidByProduct?: boolean;
}

export interface CheckoutResolutionPlan {
  shippingPolicy: 'SEPARATE' | 'FREE_FLAGGED_OFF' | 'FLAT_FALLBACK';
  shippingChargeInr: number;
  skipCarrierRateQuotes: boolean;
  effectivePaymentMode: CheckoutPaymentMode;
  initialPaymentStatus: 'NOT_REQUIRED' | 'PENDING';
  posRequested: boolean;
  posDemandTriggered: boolean;
  codEligible: boolean;
  availableOfflineModes: Array<'COD' | 'SELLER_COLLECT' | 'POS_ON_DELIVERY'>;
}

export function resolveCheckoutPlan(input: CheckoutResolutionInput): CheckoutResolutionPlan {
  const { flags, cartValueInr, requestedPaymentMode, requestedProvider, requiresPrepaidByProduct } = input;

  const shippingPolicy: CheckoutResolutionPlan['shippingPolicy'] = flags.shippingQuotesEnabled
    ? 'SEPARATE'
    : flags.flatFallbackShippingInr > 0
      ? 'FLAT_FALLBACK'
      : 'FREE_FLAGGED_OFF';
  const shippingChargeInr = flags.shippingQuotesEnabled ? 0 : Math.max(0, flags.flatFallbackShippingInr);
  const skipCarrierRateQuotes = !flags.shippingQuotesEnabled;

  const codEligible =
    flags.codEnabled && (flags.codMaxOrderValueInr <= 0 || cartValueInr <= flags.codMaxOrderValueInr);
  const posDemandTriggered =
    flags.posMachineEnabled &&
    ((flags.posDemandCartThresholdInr > 0 && cartValueInr >= flags.posDemandCartThresholdInr) ||
      (flags.codMaxOrderValueInr > 0 && cartValueInr > flags.codMaxOrderValueInr));

  const availableOfflineModes: Array<'COD' | 'SELLER_COLLECT' | 'POS_ON_DELIVERY'> = [];
  if (codEligible) availableOfflineModes.push('COD');
  if (flags.sellerDirectCollectEnabled) availableOfflineModes.push('SELLER_COLLECT');
  if (flags.posMachineEnabled) availableOfflineModes.push('POS_ON_DELIVERY');

  let effectivePaymentMode: CheckoutPaymentMode;
  if (flags.onlinePaymentEnabled && (requestedPaymentMode === 'RAZORPAY' || requestedPaymentMode === 'STRIPE' || requiresPrepaidByProduct)) {
    const gatewayMode = requestedPaymentMode === 'STRIPE' || requestedProvider === 'stripe' ? 'STRIPE' : 'RAZORPAY';
    effectivePaymentMode = gatewayMode;
  } else if (requestedPaymentMode === 'POS_ON_DELIVERY' && flags.posMachineEnabled) {
    effectivePaymentMode = 'POS_ON_DELIVERY';
  } else if (requestedPaymentMode === 'SELLER_COLLECT' && flags.sellerDirectCollectEnabled) {
    effectivePaymentMode = 'SELLER_COLLECT';
  } else if (requestedPaymentMode === 'COD' && codEligible) {
    effectivePaymentMode = 'COD';
  } else if (posDemandTriggered && flags.posMachineEnabled && !codEligible) {
    effectivePaymentMode = 'POS_ON_DELIVERY';
  } else if (codEligible) {
    effectivePaymentMode = 'COD';
  } else if (flags.sellerDirectCollectEnabled) {
    effectivePaymentMode = 'SELLER_COLLECT';
  } else if (flags.posMachineEnabled) {
    effectivePaymentMode = 'POS_ON_DELIVERY';
  } else {
    effectivePaymentMode = 'SELLER_COLLECT';
  }

  const posRequested = effectivePaymentMode === 'POS_ON_DELIVERY';
  const initialPaymentStatus: 'NOT_REQUIRED' | 'PENDING' =
    effectivePaymentMode === 'COD' ? 'NOT_REQUIRED' : 'PENDING';

  return {
    shippingPolicy,
    shippingChargeInr,
    skipCarrierRateQuotes,
    effectivePaymentMode,
    initialPaymentStatus,
    posRequested,
    posDemandTriggered,
    codEligible,
    availableOfflineModes,
  };
}
