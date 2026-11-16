import mongoose, { Schema, type Model } from 'mongoose';

const ShippingAddressSchema = new Schema(
  {
    label: { type: String, required: true, default: 'Home' },
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true }
);

const UserSchema = new Schema(
  {
    role: { type: String, enum: ['BUYER', 'SELLER', 'PROVIDER', 'ADMIN'], default: 'BUYER', index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    avatarUrl: { type: String },
    supabaseUid: { type: String, index: true },
    passwordHash: { type: String, select: false },
    authProvider: { type: String, enum: ['supabase', 'invite', 'demo'], default: 'supabase' },
    oauthAccounts: [
      {
        provider: { type: String, required: true },
        providerAccountId: { type: String, required: true },
      },
    ],
    mobileNumber: { type: String, index: true },
    whatsappNumber: { type: String },
    isWhatsappVerified: { type: Boolean, default: false },
    shippingAddresses: [ShippingAddressSchema],
    sellerProfile: {
      storeName: { type: String },
      description: { type: String },
      trustScore: { type: Number, default: 4.8 },
      isTrustedSeller: { type: Boolean, default: false },
      totalOrders: { type: Number, default: 0 },
      cancelledOrders: { type: Number, default: 0 },
      shippingMarkupPercent: { type: Number, default: 0, min: 0, max: 100 },
    },
  },
  { timestamps: true }
);

const ProductSchema = new Schema(
  {
    sellerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    visibility: { type: String, enum: ['PUBLIC', 'ASSIGNED'], default: 'PUBLIC', index: true },
    assignedCustomerIds: { type: [Schema.Types.ObjectId], ref: 'User', default: [], index: true },
    onlinePaymentRequired: { type: Boolean, default: false },
    codAllowed: { type: Boolean, default: true },
    isReturnable: { type: Boolean, default: true },
    returnWindowDays: { type: Number, default: 7, min: 0, max: 90 },
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    sku: { type: String, required: true, trim: true },
    category: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    subCategory: { type: String, required: true },
    description: { type: String, required: true },
    careInstructions: { type: String, default: '' },
    basePrice: { type: Number, required: true, min: 0 },
    salePrice: { type: Number, required: true, min: 0 },
    discountPercent: { type: Number, default: 0, min: 0, max: 95 },
    totalStock: { type: Number, required: true, min: 0 },
    shippingWeightGrams: { type: Number, required: true, min: 1, max: 100000, default: 500 },
    images: [
      {
        url: { type: String, required: true },
        thumbUrl: { type: String, required: true },
        altText: { type: String, default: '' },
        sortOrder: { type: Number, default: 0 },
      },
    ],
    jewellerySpecs: {
      baseMetal: String,
      plating: String,
      stoneType: String,
      weightGrams: Number,
      dimensions: String,
      closureType: String,
      occasionWear: String,
    },
    clothingSpecs: {
      fabric: String,
      fit: String,
      pattern: String,
      sleeveType: String,
      neckType: String,
      washCare: String,
    },
    variants: [
      {
        variantSku: { type: String, required: true },
        size: { type: String, required: true },
        colorName: { type: String, required: true },
        colorHex: { type: String, required: true },
        stock: { type: Number, default: 0 },
        priceOverride: { type: Number },
        variantImageUrl: { type: String },
      },
    ],
    occasions: {
      type: [String],
      enum: ['Wedding', 'Festive', 'Party', 'Office Wear', 'Casual', 'Daily Wear'],
      index: true,
    },
    seasons: {
      type: [String],
      enum: ['Diwali', 'Christmas', 'New Year', 'Winter', 'Summer'],
      default: [],
      index: true,
    },
    likesCount: { type: Number, default: 0 },
    viewsCount: { type: Number, default: 0 },
    cartAddsCount: { type: Number, default: 0 },
    sharesCount: { type: Number, default: 0 },
    salesCount: { type: Number, default: 0 },
    trendScore: { type: Number, default: 0, index: true },
    averageRating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
    badges: {
      type: [String],
      enum: ['Newly Added', 'Special Offer', 'Fast Selling', 'Most Demanding', 'Seller Trusted'],
      default: ['Newly Added'],
    },
    isProductTrusted: { type: Boolean, default: false },
    isQualityChecked: { type: Boolean, default: false },
    manufacturerWarrantyVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    listingStatus: {
      type: String,
      enum: ['published', 'unpublished', 'discontinued'],
      default: 'published',
      index: true,
    },
    isPublished: { type: Boolean, default: true, index: true },
    isUnlisted: { type: Boolean, default: false, index: true },
    isDiscontinued: { type: Boolean, default: false, index: true },
    isDeleted: { type: Boolean, default: false, index: true },
    disabledAt: { type: Date, default: null },
    providerId: { type: String, default: null, select: false, index: true },
    providerProductId: { type: String, default: null, select: false, index: true },
    providerBasePricePaise: { type: Number, default: null, select: false },
  },
  { timestamps: true }
);

ProductSchema.index({
  isActive: 1,
  isPublished: 1,
  isUnlisted: 1,
  isDiscontinued: 1,
  isDeleted: 1,
});
ProductSchema.index({ category: 1, trendScore: -1, _id: -1 });
ProductSchema.index({ isActive: 1, isPublished: 1, isUnlisted: 1, isDiscontinued: 1, isDeleted: 1, createdAt: -1, _id: -1 });
ProductSchema.index({ isActive: 1, isPublished: 1, isUnlisted: 1, isDiscontinued: 1, isDeleted: 1, salesCount: -1, _id: -1 });
ProductSchema.index({ isActive: 1, isPublished: 1, isUnlisted: 1, isDiscontinued: 1, isDeleted: 1, salePrice: 1, _id: 1 });

const LikeSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    guestToken: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Unique partial indexes preventing duplicate likes for both authenticated users and guests
LikeSchema.index(
  { productId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { userId: { $type: 'objectId' } } }
);
LikeSchema.index(
  { productId: 1, guestToken: 1 },
  { unique: true, partialFilterExpression: { guestToken: { $type: 'string' } } }
);

const ReviewSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: true },
    images: { type: [String], default: [] },
    reviewClasses: {
      type: [String],
      enum: ['Quality', 'Finish & Shine', 'Value for Money', 'Fit & Sizing', 'Packaging'],
      default: ['Quality'],
    },
    sentiment: { type: String, enum: ['Positive', 'Neutral', 'Negative'], default: 'Positive' },
    sentimentScore: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const OrderSchema = new Schema(
  {
    orderNumber: { type: String, required: true, unique: true, index: true },
    buyerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    checkoutIdempotencyKey: { type: String, default: undefined, immutable: true },
    checkoutPayloadHash: { type: String, default: undefined, immutable: true },
    sellerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    items: [
      {
        productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
        variantSku: { type: String, required: true },
        title: { type: String, required: true },
        size: { type: String, required: true },
        colorName: { type: String, required: true },
        imageUrl: { type: String, required: true },
        quantity: { type: Number, required: true, min: 1 },
        unitPrice: { type: Number, required: true, min: 0 },
        isReturnable: { type: Boolean, default: true },
        returnWindowDays: { type: Number, default: 7, min: 0, max: 90 },
      },
    ],
    totalAmount: { type: Number, required: true, min: 0 },
    shipping: {
      actualCarrierCost: { type: Number, default: 0, min: 0 },
      sellerMarkup: { type: Number, default: 0, min: 0 },
      customerCharge: { type: Number, default: 0, min: 0 },
      insuranceAmount: { type: Number, default: 0, min: 0 },
      carrierCode: { type: String, default: null },
      serviceCode: { type: String, default: null },
      estimatedTransitHours: { type: Number, default: null },
      quoteExpiresAt: { type: Date, default: null },
      policy: { type: String, enum: ['SEPARATE'], default: 'SEPARATE' },
    },
    paymentMode: { type: String, enum: ['COD', 'RAZORPAY', 'STRIPE', 'WALLET', 'MIXED'], default: 'COD', index: true },
    paymentStatus: { type: String, enum: ['NOT_REQUIRED', 'PENDING', 'PAID', 'FAILED', 'REFUND_PENDING', 'REFUNDED'], default: 'NOT_REQUIRED', index: true },
    paymentProvider: { type: String, enum: ['razorpay', 'stripe'], default: null },
    paymentReference: { type: String, default: null, index: true },
    paymentIntentRequestKey: { type: String, default: null },
    paymentIntentLeaseUntil: { type: Date, default: null, index: true },
    sellerNotificationSentAt: { type: Date, default: null },
    sellerNotificationLeaseUntil: { type: Date, default: null, index: true },
    paymentCheckoutUrl: { type: String, default: null },
    paymentTransactionId: { type: String, default: null, index: true },
    walletAppliedPaise: { type: Number, default: 0, min: 0 },
    cancellationRequestedAt: { type: Date, default: null },
    cancellationPreviousStatus: { type: String, default: null },
    inventoryRestored: { type: Boolean, default: false },
    deliveredAt: { type: Date, default: null },
    refundStatus: { type: String, enum: ['NONE', 'REQUESTED', 'APPROVED', 'PROCESSING', 'PARTIAL', 'REFUNDED', 'REJECTED'], default: 'NONE' },
    appliedCoupon: {
      couponId: String,
      code: String,
      discountAmount: Number,
    },
    status: {
      type: String,
      enum: ['Pending', 'Confirmed', 'Packed', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled', 'PENDING_SELLER_CONFIRMATION', 'CONFIRMED_AWAITING_PAYMENT', 'PAID_AND_PROCESSING', 'CANCELLATION_REQUESTED', 'RETURN_REQUESTED', 'RETURN_RECEIVED'],
      default: 'Pending',
      index: true,
    },
    shippingAddress: {
      fullName: { type: String, required: true },
      phone: { type: String, required: true },
      street: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      pincode: { type: String, required: true },
    },
    courierTracking: {
      companyName: String,
      trackingId: String,
      trackingUrl: String,
      shippedAt: Date,
    },
    statusTimeline: [
      {
        status: { type: String, required: true },
        note: { type: String, default: '' },
        timestamp: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);
OrderSchema.index(
  { buyerId: 1, checkoutIdempotencyKey: 1, sellerId: 1 },
  { unique: true, partialFilterExpression: { checkoutIdempotencyKey: { $type: 'string' } } }
);

export const ATLAS_SEARCH_INDEX_DEFINITION = {
  name: 'products_hybrid_search',
  definition: {
    mappings: {
      dynamic: false,
      fields: {
        title: [
          { type: 'string', analyzer: 'lucene.standard' },
          { type: 'autocomplete', tokenizers: 'edgeGram', minGrams: 2, maxGrams: 15 },
        ],
        occasions: [
          { type: 'string', analyzer: 'lucene.standard' },
          { type: 'autocomplete', tokenizers: 'edgeGram', minGrams: 2, maxGrams: 15 },
        ],
        category: { type: 'string', analyzer: 'lucene.standard' },
        description: { type: 'string', analyzer: 'lucene.standard' },
        trendScore: { type: 'number' },
      },
    },
  },
};

const SellerInviteSchema = new Schema(
  {
    token: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: false, default: '', lowercase: true, trim: true, index: true },
    storeName: { type: String, default: '' },
    note: { type: String, default: '' },
    invitedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    invitedByName: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'revoked', 'expired'],
      default: 'pending',
      index: true,
    },
    acceptedUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    acceptedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

const AuthSessionSchema = new Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    role: { type: String, enum: ['BUYER', 'SELLER', 'PROVIDER', 'ADMIN'], required: true },
    provider: { type: String, enum: ['supabase', 'invite', 'demo'], default: 'supabase' },
    tokenFingerprint: { type: String, required: true },
    csrfToken: { type: String, required: true },
    tlsSecure: { type: Boolean, default: true },
    protocol: { type: String, default: 'https' },
    userAgent: { type: String, default: '' },
    lastActiveAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const SalesCampaignSchema = new Schema(
  {
    sellerId: { type: String, required: true, index: true },
    sellerName: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    season: {
      type: String,
      enum: ['Diwali', 'Christmas', 'New Year', 'Winter', 'Summer'],
      required: true,
      index: true,
    },
    tagline: { type: String, default: '' },
    discountPercent: { type: Number, required: true, min: 0, max: 90 },
    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, required: true, index: true },
    productIds: { type: [String], default: [] },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

const CouponSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    sellerId: { type: String, required: true, index: true },
    sellerName: { type: String, required: true },
    title: { type: String, required: true },
    discountType: { type: String, enum: ['percentage', 'flat'], required: true },
    discountValue: { type: Number, required: true, min: 1 },
    maxDiscountAmount: { type: Number },
    minOrderAmount: { type: Number, default: 0 },
    scope: {
      type: String,
      enum: ['all_seller_products', 'selected_products'],
      default: 'all_seller_products',
    },
    productIds: { type: [String], default: [] },
    assignedUserIds: { type: [String], default: [] },
    assignedEmails: { type: [String], default: [] },
    usageLimit: { type: Number },
    usedCount: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

const CategoryControlSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    description: { type: String, default: '' },
    sellerId: { type: String, required: true, index: true },
    sellerName: { type: String, required: true },
    isEnabled: { type: Boolean, default: true, index: true },
    isDefault: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 10 },
  },
  { timestamps: true }
);

const ShareEventSchema = new Schema(
  {
    productId: { type: String, required: true, index: true },
    channel: { type: String, enum: ['whatsapp'], default: 'whatsapp', index: true },
    userId: { type: String, default: null },
    guestToken: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);


const PaymentGatewayConfigSchema = new Schema({
  sellerId: { type: String, required: true, index: true },
  provider: { type: String, enum: ['razorpay', 'stripe'], required: true },
  keyId: { type: String, required: true },
  encryptedSecret: { type: String, required: true, select: false },
  encryptedWebhookSecret: { type: String, required: true, select: false },
  enabled: { type: Boolean, default: false, index: true },
  currency: { type: String, enum: ['INR', 'USD'], default: 'INR' },
}, { timestamps: true });
PaymentGatewayConfigSchema.index({ sellerId: 1, provider: 1 }, { unique: true });

const WalletSchema = new Schema({
  userId: { type: String, required: true, unique: true, index: true },
  balancePaise: { type: Number, required: true, default: 0, min: 0 },
  currency: { type: String, default: 'INR' },
  version: { type: Number, default: 0 },
}, { timestamps: true });

const WalletTransactionSchema = new Schema({
  userId: { type: String, required: true, index: true, immutable: true },
  idempotencyKey: { type: String, required: true, unique: true, immutable: true },
  type: { type: String, enum: ['CREDIT_REFUND', 'DEBIT_ORDER_REDEMPTION', 'BONUS', 'ADJUSTMENT'], required: true, immutable: true },
  amountPaise: { type: Number, required: true, min: 1, immutable: true },
  orderId: { type: String, default: null, index: true, immutable: true },
  reference: { type: String, default: null, immutable: true },
  balanceAfterPaise: { type: Number, required: true, min: 0, immutable: true },
  metadata: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true });
WalletTransactionSchema.index({ userId: 1, createdAt: -1 });

const ReturnRequestSchema = new Schema({
  orderId: { type: String, required: true, index: true },
  buyerId: { type: String, required: true, index: true },
  sellerId: { type: String, required: true, index: true },
  productId: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  reason: { type: String, required: true, maxlength: 1000 },
  media: [{ url: { type: String, required: true }, mimeType: { type: String, required: true }, durationSeconds: { type: Number, default: 0 } }],
  selfCourier: { type: Boolean, default: false },
  courierName: String,
  trackingId: String,
  trackingUrl: String,
  status: { type: String, enum: ['REQUESTED', 'APPROVED', 'REJECTED', 'IN_TRANSIT', 'RECEIVED', 'REFUND_PENDING', 'REFUNDED'], default: 'REQUESTED', index: true },
  receivedAt: Date,
  refundDestination: { type: String, enum: ['ORIGINAL_SOURCE', 'WALLET'], default: 'WALLET' },
}, { timestamps: true });
ReturnRequestSchema.index({ orderId: 1, productId: 1, buyerId: 1 }, { unique: true });

const PaymentEventSchema = new Schema({
  provider: { type: String, enum: ['razorpay', 'stripe'], required: true },
  eventId: { type: String, required: true },
  orderId: { type: String, required: true, index: true },
  status: { type: String, enum: ['PROCESSING', 'PROCESSED', 'FAILED'], default: 'PROCESSING', index: true },
  processingLeaseUntil: { type: Date, default: null, index: true },
  attempts: { type: Number, default: 1, min: 1 },
  lastError: { type: String, default: null },
  processedAt: { type: Date, default: null },
  payloadHash: { type: String, required: true },
}, { timestamps: true });
PaymentEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
PaymentEventSchema.index({ status: 1, processingLeaseUntil: 1 });

export const UserModel: Model<any> =
  mongoose.models.User || mongoose.model('User', UserSchema);
export const ProductModel: Model<any> =
  mongoose.models.Product || mongoose.model('Product', ProductSchema);
export const LikeModel: Model<any> =
  mongoose.models.Like || mongoose.model('Like', LikeSchema);
export const ReviewModel: Model<any> =
  mongoose.models.Review || mongoose.model('Review', ReviewSchema);
export const OrderModel: Model<any> =
  mongoose.models.Order || mongoose.model('Order', OrderSchema);
export const SellerInviteModel: Model<any> =
  mongoose.models.SellerInvite || mongoose.model('SellerInvite', SellerInviteSchema);
export const AuthSessionModel: Model<any> =
  mongoose.models.AuthSession || mongoose.model('AuthSession', AuthSessionSchema);
export const SalesCampaignModel: Model<any> =
  mongoose.models.SalesCampaign || mongoose.model('SalesCampaign', SalesCampaignSchema);
export const CouponModel: Model<any> =
  mongoose.models.Coupon || mongoose.model('Coupon', CouponSchema);
export const CategoryControlModel: Model<any> =
  mongoose.models.CategoryControl || mongoose.model('CategoryControl', CategoryControlSchema);
export const ShareEventModel: Model<any> =
  mongoose.models.ShareEvent || mongoose.model('ShareEvent', ShareEventSchema);

export const PaymentGatewayConfigModel: Model<any> =
  mongoose.models.PaymentGatewayConfig || mongoose.model('PaymentGatewayConfig', PaymentGatewayConfigSchema);
export const WalletModel: Model<any> =
  mongoose.models.Wallet || mongoose.model('Wallet', WalletSchema);
export const WalletTransactionModel: Model<any> =
  mongoose.models.WalletTransaction || mongoose.model('WalletTransaction', WalletTransactionSchema);
export const ReturnRequestModel: Model<any> =
  mongoose.models.ReturnRequest || mongoose.model('ReturnRequest', ReturnRequestSchema);
export const PaymentEventModel: Model<any> =
  mongoose.models.PaymentEvent || mongoose.model('PaymentEvent', PaymentEventSchema);
