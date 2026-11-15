export type UserRole = 'GUEST' | 'BUYER' | 'SELLER' | 'ADMIN';

export type BuiltinProductCategory = 'Artificial Jewellery' | 'Clothing' | 'Accessories';

export type ProductCategory = BuiltinProductCategory | (string & {});

export interface CategoryControl {
  _id: string;
  name: string;
  slug: string;
  description: string;
  sellerId: string;
  sellerName: string;
  isEnabled: boolean;
  isDefault: boolean;
  sortOrder: number;
  productCount?: number;
  createdAt: string;
  updatedAt: string;
}

export type SeasonType = 'Diwali' | 'Christmas' | 'New Year' | 'Winter' | 'Summer';

export type OccasionType =
  | 'Wedding'
  | 'Festive'
  | 'Party'
  | 'Office Wear'
  | 'Casual'
  | 'Daily Wear';

export type ProductBadge =
  | 'Newly Added'
  | 'Special Offer'
  | 'Fast Selling'
  | 'Most Demanding'
  | 'Seller Trusted';

export type ReviewClass =
  | 'Quality'
  | 'Finish & Shine'
  | 'Value for Money'
  | 'Fit & Sizing'
  | 'Packaging';

export type SentimentLabel = 'Positive' | 'Neutral' | 'Negative';

export type OrderStatus =
  | 'Pending'
  | 'Confirmed'
  | 'Packed'
  | 'Shipped'
  | 'Out for Delivery'
  | 'Delivered'
  | 'Cancelled'
  | 'PENDING_SELLER_CONFIRMATION'
  | 'CONFIRMED_AWAITING_PAYMENT'
  | 'PAID_AND_PROCESSING'
  | 'CANCELLATION_REQUESTED'
  | 'RETURN_REQUESTED'
  | 'RETURN_RECEIVED';

export type OrderTab = 'Current' | 'Past' | 'Completed';

export type TimeGranularity = 'day' | 'week' | 'month' | 'year';

export type SortOption =
  | 'most_demanding'
  | 'newly_added'
  | 'special_offers'
  | 'fast_selling'
  | 'occasion_favorites'
  | 'price_asc'
  | 'price_desc'
  | 'highest_rated';

export interface ShippingAddress {
  _id?: string;
  label: string;
  fullName: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}

export interface SellerProfile {
  storeName: string;
  description: string;
  trustScore: number;
  isTrustedSeller: boolean;
  totalOrders: number;
  cancelledOrders: number;
}

export interface OAuthAccount {
  provider: 'google' | 'meta';
  providerAccountId: string;
}

export interface User {
  _id: string;
  role: Exclude<UserRole, 'GUEST'>;
  name: string;
  email: string;
  avatarUrl?: string;
  supabaseUid?: string;
  authProvider?: 'supabase' | 'invite' | 'demo';
  oauthAccounts: OAuthAccount[];
  mobileNumber?: string;
  whatsappNumber?: string;
  isWhatsappVerified: boolean;
  shippingAddresses: ShippingAddress[];
  sellerProfile?: SellerProfile;
  createdAt: string;
  updatedAt: string;
}

export interface ProductImage {
  url: string;
  thumbUrl: string;
  altText: string;
  sortOrder: number;
}

export interface JewellerySpecs {
  baseMetal: string;
  plating: string;
  stoneType: string;
  weightGrams: number;
  dimensions: string;
  closureType: string;
  occasionWear: string;
}

export interface ClothingSpecs {
  fabric: string;
  fit: string;
  pattern: string;
  sleeveType: string;
  neckType: string;
  washCare: string;
}

export interface ProductVariant {
  variantSku: string;
  size: string;
  colorName: string;
  colorHex: string;
  stock: number;
  priceOverride?: number;
  variantImageUrl?: string;
}

export type ProductListingStatus = 'published' | 'unpublished' | 'discontinued';

export type ProductControlAction =
  | 'publish'
  | 'unpublish'
  | 'unlist'
  | 'relist'
  | 'mark_out_of_stock'
  | 'restock'
  | 'discontinue';

export interface Product {
  _id: string;
  sellerId: string;
  sellerName?: string;
  sellerTrusted?: boolean;
  visibility?: 'PUBLIC' | 'ASSIGNED';
  assignedCustomerIds?: string[];
  onlinePaymentRequired?: boolean;
  codAllowed?: boolean;
  isReturnable?: boolean;
  returnWindowDays?: number;
  title: string;
  slug: string;
  sku: string;
  category: ProductCategory;
  subCategory: string;
  description: string;
  careInstructions: string;
  basePrice: number;
  salePrice: number;
  discountPercent: number;
  totalStock: number;
  images: ProductImage[];
  jewellerySpecs?: JewellerySpecs;
  clothingSpecs?: ClothingSpecs;
  variants: ProductVariant[];
  occasions: OccasionType[];
  seasons?: SeasonType[];
  likesCount: number;
  viewsCount: number;
  cartAddsCount: number;
  sharesCount?: number;
  salesCount: number;
  trendScore: number;
  averageRating: number;
  reviewCount: number;
  badges: ProductBadge[];
  isProductTrusted: boolean;
  isActive: boolean;
  listingStatus?: ProductListingStatus;
  isPublished?: boolean;
  isUnlisted?: boolean;
  isDiscontinued?: boolean;
  isDeleted?: boolean;
  disabledAt?: string | null;
  activeOrderCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface LikeRecord {
  _id: string;
  productId: string;
  userId?: string | null;
  guestToken?: string | null;
  createdAt: string;
}

export interface ShareEventRecord {
  _id: string;
  productId: string;
  channel: 'whatsapp';
  userId?: string | null;
  guestToken?: string | null;
  createdAt: string;
}

export interface Review {
  _id: string;
  productId: string;
  userId: string;
  userName: string;
  orderId: string;
  rating: number;
  comment: string;
  images: string[];
  reviewClasses: ReviewClass[];
  sentiment: SentimentLabel;
  sentimentScore: number;
  createdAt: string;
}

export interface OrderItem {
  productId: string;
  variantSku: string;
  title: string;
  size: string;
  colorName: string;
  imageUrl: string;
  quantity: number;
  unitPrice: number;
  isReturnable?: boolean;
  returnWindowDays?: number;
  catalogStatus?: 'active' | 'unpublished' | 'discontinued' | 'removed';
}

export interface CourierTracking {
  companyName: string;
  trackingId: string;
  trackingUrl: string;
  shippedAt: string;
}

export interface StatusTimelineEntry {
  status: OrderStatus;
  note: string;
  timestamp: string;
}

export interface Order {
  _id: string;
  orderNumber: string;
  buyerId: string;
  buyerName?: string;
  sellerId: string;
  items: OrderItem[];
  totalAmount: number;
  paymentMode?: 'COD' | 'RAZORPAY' | 'STRIPE' | 'WALLET' | 'MIXED';
  paymentStatus?: 'NOT_REQUIRED' | 'PENDING' | 'PAID' | 'FAILED' | 'REFUND_PENDING' | 'REFUNDED';
  paymentProvider?: 'razorpay' | 'stripe';
  paymentReference?: string | null;
  paymentTransactionId?: string | null;
  walletAppliedPaise?: number;
  refundStatus?: 'NONE' | 'REQUESTED' | 'APPROVED' | 'PROCESSING' | 'PARTIAL' | 'REFUNDED' | 'REJECTED';
  appliedCoupon?: {
    couponId: string;
    code: string;
    discountAmount: number;
  };
  status: OrderStatus;
  shippingAddress: Omit<ShippingAddress, 'label' | 'isDefault' | '_id'>;
  courierTracking?: CourierTracking;
  statusTimeline: StatusTimelineEntry[];
  whatsappDispatch?: {
    delivered: boolean;
    channel: 'meta_cloud' | 'evolution_api' | 'wa_me_fallback';
    waLink: string;
    messagePreview: string;
    sentAt: string;
  };
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string | null;
}

export interface CartItem {
  productId: string;
  variantSku: string;
  title: string;
  slug: string;
  category: ProductCategory;
  size: string;
  colorName: string;
  colorHex: string;
  imageUrl: string;
  unitPrice: number;
  basePrice: number;
  quantity: number;
  sellerId: string;
}

export interface AuthSessionSummary {
  sessionId: string;
  tokenFingerprint: string;
  tlsSecure: boolean;
  protocol: string;
  provider: 'supabase' | 'invite' | 'demo';
  userAgent: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  revokedAt?: string | null;
  isCurrent?: boolean;
}

export interface AuthSessionResponse {
  authenticated: boolean;
  role: UserRole;
  user: User | null;
  guestToken: string;
  accessToken?: string;
  csrfToken?: string;
  sessionInfo?: AuthSessionSummary | null;
  likedProductIds: string[];
  cart: CartItem[];
  authConfig: {
    supabaseConfigured: boolean;
  };
}

export type SellerInviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface SellerInvite {
  _id: string;
  token: string;
  email?: string;
  storeName?: string;
  note?: string;
  invitedByUserId: string;
  invitedByName: string;
  status: SellerInviteStatus;
  acceptedUserId?: string | null;
  acceptedAt?: string | null;
  revokedAt?: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface SalesCampaign {
  _id: string;
  sellerId: string;
  sellerName: string;
  name: string;
  season: SeasonType;
  tagline: string;
  discountPercent: number;
  startsAt: string;
  endsAt: string;
  productIds: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StorefrontCampaign extends SalesCampaign {
  phase: 'upcoming' | 'live' | 'ended';
  products: Product[];
}

export type CouponDiscountType = 'percentage' | 'flat';
export type CouponScope = 'all_seller_products' | 'selected_products';

export interface Coupon {
  _id: string;
  code: string;
  sellerId: string;
  sellerName: string;
  title: string;
  discountType: CouponDiscountType;
  discountValue: number;
  maxDiscountAmount?: number;
  minOrderAmount: number;
  scope: CouponScope;
  productIds: string[];
  assignedUserIds: string[];
  assignedEmails: string[];
  usageLimit?: number;
  usedCount: number;
  expiresAt: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CouponValidationResult {
  valid: boolean;
  reason?: string;
  coupon?: Coupon;
  discountAmount: number;
  eligibleSubtotal: number;
  applicableProductIds: string[];
}

export interface ProductListResponse {
  products: Product[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  didYouMean?: string | null;
  categoryTop10Thresholds?: Record<string, number>;
}

export interface OrderListResponse {
  orders: Order[];
  total: number;
  hasMore: boolean;
  nextSkip: number;
}

export interface OrderTimeBucket {
  period: string;
  ordersCount: number;
  revenue: number;
  unitsSold: number;
}

export interface SellerAnalyticsResponse {
  overview: {
    totalRevenue: number;
    totalOrders: number;
    totalViews: number;
    totalLikes: number;
    totalCartAdds: number;
    totalShares: number;
    conversionRate: number;
    trustScore: number;
  };
  funnel: Array<{ stage: string; count: number }>;
  timeSeries: OrderTimeBucket[];
  occasionBreakdown: Array<{ occasion: string; interestScore: number; sales: number }>;
  attributeBreakdown: Array<{ attribute: string; count: number }>;
  sentimentSummary: {
    Positive: number;
    Neutral: number;
    Negative: number;
    aspectRatings: Record<ReviewClass, { avg: number; count: number }>;
  };
  topProducts: Array<{
    _id: string;
    title: string;
    viewsCount: number;
    likesCount: number;
    cartAddsCount: number;
    sharesCount: number;
    salesCount: number;
    revenue: number;
    conversionRate: number;
  }>;
  mostSharedProducts: Array<{
    _id: string;
    title: string;
    category: ProductCategory;
    sharesCount: number;
    viewsCount: number;
    salesCount: number;
  }>;
}
