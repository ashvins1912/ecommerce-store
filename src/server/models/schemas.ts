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
    role: { type: String, enum: ['BUYER', 'SELLER', 'ADMIN'], default: 'BUYER', index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    avatarUrl: { type: String },
    oauthAccounts: [
      {
        provider: { type: String, enum: ['google', 'meta'], required: true },
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
    },
  },
  { timestamps: true }
);

const ProductSchema = new Schema(
  {
    sellerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
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
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

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
      },
    ],
    totalAmount: { type: Number, required: true, min: 0 },
    appliedCoupon: {
      couponId: String,
      code: String,
      discountAmount: Number,
    },
    status: {
      type: String,
      enum: ['Pending', 'Confirmed', 'Packed', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled'],
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
    role: { type: String, enum: ['BUYER', 'SELLER', 'ADMIN'], required: true },
    provider: { type: String, enum: ['google', 'meta', 'invite', 'demo'], default: 'google' },
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
