import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  Ban,
  Calendar,
  Check,
  CheckCircle2,
  Compass,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Flame,
  FolderCog,
  Globe,
  Image as ImageIcon,
  Link2,
  Lock,
  LogOut,
  Mail,
  Menu,
  Package,
  PackageX,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Share2,
  ShieldCheck,
  Store,
  Tag,
  Trash2,
  Truck,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  CartItem,
  CategoryControl,
  Coupon,
  CouponDiscountType,
  CouponScope,
  OccasionType,
  Order,
  OrderListResponse,
  OrderStatus,
  OrderTab,
  PlatformServiceFlags,
  Product,
  ProductCategory,
  ProductControlAction,
  ReviewClass,
  SeasonType,
  SellerAnalyticsResponse,
  SellerInvite,
  StorefrontCampaign,
  TimeGranularity,
  User,
} from '../shared/types';
import { apiFetch, compressAndUploadImage, formatINR, setClientSessionTokens } from '../lib/api';
import { useI18n, type Language } from '../lib/i18n';
import { useI18nTutorial } from '../hooks/useI18nTutorial';
import { ActionButton } from './ActionButton';
import { CustomerSearchModal, type AssignableCustomer } from './CustomerSearchModal';
import { DashboardKPI } from './DashboardKPI';
import { ProviderManagementPanel } from './ProviderManagementPanel';
import { LogisticsManagementPanel } from './LogisticsManagementPanel';
import { RootSuperuserPanel } from './RootSuperuserPanel';

const OCCASIONS: OccasionType[] = [
  'Wedding',
  'Festive',
  'Party',
  'Office Wear',
  'Casual',
  'Daily Wear',
];

const SEASONS: SeasonType[] = ['Diwali', 'Christmas', 'New Year', 'Winter', 'Summer'];

const REVIEW_CLASSES: ReviewClass[] = [
  'Quality',
  'Finish & Shine',
  'Value for Money',
  'Fit & Sizing',
  'Packaging',
];

type SellerTab =
  | 'invites'
  | 'platform'
  | 'analytics'
  | 'catalog'
  | 'categories'
  | 'campaigns'
  | 'coupons'
  | 'payments'
  | 'returns'
  | 'providers'
  | 'logistics'
  | 'orders';

interface AdminInviteRow extends SellerInvite {
  inviteUrl: string;
}

interface ValidatedInviteInfo {
  _id: string;
  email: string;
  hasEmail?: boolean;
  storeName?: string;
  note?: string;
  invitedByName: string;
  status: string;
  expiresAt: string;
}

interface SellerHubViewProps {
  user: User | null;
  onUserUpdated: (user: User) => void;
  onAuthSynced?: (payload: {
    user: User | null;
    likedProductIds?: string[];
    cart?: CartItem[];
  }) => void;
  onOpenAuth: () => void;
  onCatalogMutated: () => void;
  inviteToken?: string | null;
  onInviteConsumed?: () => void;
  onReturnToStore?: () => void;
  onLogout: () => Promise<void>;
  platformFlags?: PlatformServiceFlags | null;
  onPlatformFlagsUpdated?: (flags: PlatformServiceFlags) => void;
}

function CatalogThumb({ src, alt }: { src?: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-[#E8E6E1] bg-[#FAF9F6] text-[#A8A29E]">
        <Package className="h-4 w-4" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className="h-10 w-10 shrink-0 rounded object-cover border border-[#E8E6E1] bg-[#F2EFE9]"
    />
  );
}

export function SellerHubView({
  user,
  onUserUpdated,
  onAuthSynced,
  onOpenAuth,
  onCatalogMutated,
  inviteToken,
  onInviteConsumed,
  onReturnToStore,
  onLogout,
  platformFlags,
  onPlatformFlagsUpdated,
}: SellerHubViewProps) {
  const { t, tc, to, tseason, tr, ts, totab, locale, lang, setLang } = useI18n();
  const { t: i18nT } = useTranslation();
  const isAdmin = user?.role === 'ADMIN';
  const tutorialRole = isAdmin ? 'ADMIN' : 'SELLER';
  const { startRoleTour } = useI18nTutorial(tutorialRole);

  const [loggingOut, setLoggingOut] = useState(false);
  const [sellerTab, setSellerTab] = useState<SellerTab>(isAdmin ? 'invites' : 'analytics');
  const [navDrawerOpen, setNavDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerCloseRef = useRef<HTMLButtonElement | null>(null);
  const prevDrawerOpenRef = useRef(false);

  useEffect(() => {
    if (user?.role === 'ADMIN') {
      setSellerTab('invites');
    } else if (sellerTab === 'invites') {
      setSellerTab('analytics');
    }
  }, [user?.role]);

  useEffect(() => {
    if (navDrawerOpen) {
      prevDrawerOpenRef.current = true;
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      window.requestAnimationFrame(() => drawerCloseRef.current?.focus());
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          setNavDrawerOpen(false);
        }
      };
      window.addEventListener('keydown', onKeyDown);
      return () => {
        document.body.style.overflow = previousOverflow;
        window.removeEventListener('keydown', onKeyDown);
      };
    } else if (prevDrawerOpenRef.current) {
      prevDrawerOpenRef.current = false;
      menuButtonRef.current?.focus();
    }
  }, [navDrawerOpen]);

  // Invited Seller Onboarding state (strictly requires Admin-issued ?sellerInvite=<token>)
  const [inviteCheckLoading, setInviteCheckLoading] = useState(false);
  const [validatedInvite, setValidatedInvite] = useState<ValidatedInviteInfo | null>(null);
  const [inviteInvalid, setInviteInvalid] = useState(false);
  const [sellerFullName, setSellerFullName] = useState('');
  const [joinEmail, setJoinEmail] = useState('');
  const [waNumber, setWaNumber] = useState('+91');
  const [storeName, setStoreName] = useState('');
  const [storeDesc, setStoreDesc] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [sandboxOtp, setSandboxOtp] = useState<string | null>(null);
  const [onboardError, setOnboardError] = useState<string | null>(null);
  const [onboardBusy, setOnboardBusy] = useState(false);

  // Admin Invite Management state
  const [adminInvites, setAdminInvites] = useState<AdminInviteRow[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteStoreName, setInviteStoreName] = useState('');
  const [inviteNote, setInviteNote] = useState('');
  const [inviteDays, setInviteDays] = useState(14);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [inviteCreateError, setInviteCreateError] = useState<string | null>(null);
  const [latestCreatedInvite, setLatestCreatedInvite] = useState<{
    invite: AdminInviteRow;
    mailtoUrl?: string;
  } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Analytics state
  const [granularity, setGranularity] = useState<TimeGranularity>('month');
  const [analytics, setAnalytics] = useState<SellerAnalyticsResponse | null>(null);
  const [analyticsRefreshing, setAnalyticsRefreshing] = useState(false);
  const [analyticsProdSort, setAnalyticsProdSort] = useState<'sales' | 'shares' | 'views'>('sales');
  const [cronNotice, setCronNotice] = useState<string | null>(null);

  // Seller Catalog & Dynamic Offers / Lifecycle Control state
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogStatusFilter, setCatalogStatusFilter] = useState<
    'all' | 'published' | 'unpublished' | 'unlisted' | 'out_of_stock' | 'discontinued'
  >('all');
  const [sellerProducts, setSellerProducts] = useState<Product[]>([]);
  const [discountEdits, setDiscountEdits] = useState<
    Record<string, { discount: number; stock: number; shippingWeightGrams: number }>
  >({});
  const [savingProdId, setSavingProdId] = useState<string | null>(null);
  const [controllingProdId, setControllingProdId] = useState<string | null>(null);
  const [controlNotice, setControlNotice] = useState<string | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Product | null>(null);
  const [removingProduct, setRemovingProduct] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newVisibility, setNewVisibility] = useState<'PUBLIC' | 'ASSIGNED'>('PUBLIC');
  const [newAssignedCustomers, setNewAssignedCustomers] = useState<AssignableCustomer[]>([]);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [newOnlineRequired, setNewOnlineRequired] = useState(false);
  const [newCodAllowed, setNewCodAllowed] = useState(true);
  const [newReturnable, setNewReturnable] = useState(true);
  const [newReturnWindow, setNewReturnWindow] = useState(7);

  // Seller Category Control Panel state
  const [categories, setCategories] = useState<CategoryControl[]>([]);
  const [catName, setCatName] = useState('');
  const [catDesc, setCatDesc] = useState('');
  const [catBusy, setCatBusy] = useState(false);
  const [catError, setCatError] = useState<string | null>(null);
  const [togglingCatId, setTogglingCatId] = useState<string | null>(null);

  // Seller Seasonal Campaigns state
  const [sellerCampaigns, setSellerCampaigns] = useState<StorefrontCampaign[]>([]);
  const [cmpName, setCmpName] = useState('');
  const [cmpSeason, setCmpSeason] = useState<SeasonType>('Diwali');
  const [cmpTagline, setCmpTagline] = useState('');
  const [cmpDiscount, setCmpDiscount] = useState(25);
  const [cmpStartsAt, setCmpStartsAt] = useState(() =>
    new Date(Date.now() + 3600_000).toISOString().slice(0, 16)
  );
  const [cmpEndsAt, setCmpEndsAt] = useState(() =>
    new Date(Date.now() + 72 * 3600_000).toISOString().slice(0, 16)
  );
  const [cmpProductIds, setCmpProductIds] = useState<string[]>([]);
  const [cmpBusy, setCmpBusy] = useState(false);
  const [cmpError, setCmpError] = useState<string | null>(null);

  // Seller Coupons state
  const [returnRequests, setReturnRequests] = useState<Array<any>>([]);
  const [returnNotice, setReturnNotice] = useState('');
  const [returnForwardTarget, setReturnForwardTarget] = useState<any>(null);
  const [returnSharePickupAddress, setReturnSharePickupAddress] = useState(true);
  const [returnPickupTarget, setReturnPickupTarget] = useState<any>(null);
  const [returnPickupDraft, setReturnPickupDraft] = useState({ carrierName: '', trackingId: '', trackingUrl: '' });
  const [gatewaySettings, setGatewaySettings] = useState<Array<{ provider: 'razorpay' | 'stripe'; keyId: string; enabled: boolean; secretMasked: string }>>([]);
  const [gatewayDrafts, setGatewayDrafts] = useState({
    razorpay: { keyId: '', secret: '', webhookSecret: '', enabled: false },
    stripe: { keyId: '', secret: '', webhookSecret: '', enabled: false },
  });
  const [gatewayNotice, setGatewayNotice] = useState('');
  const [gatewayBusy, setGatewayBusy] = useState(false);

  // Admin Platform Service Flags state
  const [platformDraft, setPlatformDraft] = useState<PlatformServiceFlags>({
    shippingQuotesEnabled: platformFlags?.shippingQuotesEnabled ?? false,
    flatFallbackShippingInr: platformFlags?.flatFallbackShippingInr ?? 0,
    backgroundWorkerEnabled: platformFlags?.backgroundWorkerEnabled ?? false,
    onlinePaymentEnabled: platformFlags?.onlinePaymentEnabled ?? false,
    codEnabled: platformFlags?.codEnabled ?? true,
    codMaxOrderValueInr: platformFlags?.codMaxOrderValueInr ?? 25000,
    sellerDirectCollectEnabled: platformFlags?.sellerDirectCollectEnabled ?? true,
    posMachineEnabled: platformFlags?.posMachineEnabled ?? true,
    posDemandCartThresholdInr: platformFlags?.posDemandCartThresholdInr ?? 5000,
    posTerminalLabel: platformFlags?.posTerminalLabel || 'Portable Card / UPI POS',
  });
  const [platformBusy, setPlatformBusy] = useState(false);
  const [platformNotice, setPlatformNotice] = useState<string | null>(null);

  // Manual Payment & POS confirmation state on Seller Orders
  const [paymentConfirmOrderId, setPaymentConfirmOrderId] = useState<string | null>(null);
  const [paymentConfirmDraft, setPaymentConfirmDraft] = useState<{
    method: 'CASH' | 'UPI' | 'POS_CARD' | 'BANK_TRANSFER';
    referenceNumber: string;
    posTerminalId: string;
    notes: string;
  }>({
    method: 'UPI',
    referenceNumber: '',
    posTerminalId: '',
    notes: '',
  });
  const [paymentConfirmBusy, setPaymentConfirmBusy] = useState(false);
  const [paymentConfirmNotice, setPaymentConfirmNotice] = useState<string | null>(null);

  const [sellerCoupons, setSellerCoupons] = useState<Coupon[]>([]);
  const [knownCustomers, setKnownCustomers] = useState<
    Array<{ _id: string; name: string; email: string }>
  >([]);
  const [cpnCode, setCpnCode] = useState('');
  const [cpnTitle, setCpnTitle] = useState('');
  const [cpnType, setCpnType] = useState<CouponDiscountType>('percentage');
  const [cpnValue, setCpnValue] = useState(15);
  const [cpnMinOrder, setCpnMinOrder] = useState(999);
  const [cpnMaxCap, setCpnMaxCap] = useState<string>('1200');
  const [cpnScope, setCpnScope] = useState<CouponScope>('all_seller_products');
  const [cpnProductIds, setCpnProductIds] = useState<string[]>([]);
  const [cpnAssignedUserIds, setCpnAssignedUserIds] = useState<string[]>([]);
  const [cpnExtraEmails, setCpnExtraEmails] = useState('');
  const [cpnUsageLimit, setCpnUsageLimit] = useState(100);
  const [cpnExpiresDays, setCpnExpiresDays] = useState(30);
  const [cpnBusy, setCpnBusy] = useState(false);
  const [cpnError, setCpnError] = useState<string | null>(null);

  // Seller Orders state (limit 5)
  const [orderTab, setOrderTab] = useState<OrderTab>('Current');
  const [sellerOrders, setSellerOrders] = useState<Order[]>([]);
  const [ordersHasMore, setOrdersHasMore] = useState(false);
  const [ordersNextSkip, setOrdersNextSkip] = useState(0);
  const [shipOrderTarget, setShipOrderTarget] = useState<Order | null>(null);
  const [courierCompany, setCourierCompany] = useState('BlueDart Express');
  const [trackingId, setTrackingId] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');

  // New Product Modal Form State
  const [newTitle, setNewTitle] = useState('');
  const [newSku, setNewSku] = useState('KK-NEW-101');
  const [newCat, setNewCat] = useState<ProductCategory>('Artificial Jewellery');
  const [newSubCat, setNewSubCat] = useState('Choker Necklaces');
  const [newDesc, setNewDesc] = useState('');
  const [newBasePrice, setNewBasePrice] = useState(2499);
  const [newDiscount, setNewDiscount] = useState(15);
  const [newStock, setNewStock] = useState(25);
  const [newShippingWeightGrams, setNewShippingWeightGrams] = useState(500);
  const [newOccasions, setNewOccasions] = useState<OccasionType[]>(['Festive', 'Wedding']);
  const [newSeasons, setNewSeasons] = useState<SeasonType[]>(['Diwali']);
  const [newColorName, setNewColorName] = useState('Antique Gold');
  const [newColorHex, setNewColorHex] = useState('#A16207');
  const [newSizes, setNewSizes] = useState('Free Size');
  const [uploadedImages, setUploadedImages] = useState<
    Array<{ url: string; thumbUrl: string; byteSize: number; storage: string }>
  >([]);
  const [newImageUrlInput, setNewImageUrlInput] = useState('');
  const [uploadingImg, setUploadingImg] = useState(false);
  const [editImagesTarget, setEditImagesTarget] = useState<Product | null>(null);
  const [editImagesList, setEditImagesList] = useState<
    Array<{ url: string; thumbUrl: string; altText: string; sortOrder: number }>
  >([]);
  const [editImageUrlInput, setEditImageUrlInput] = useState('');
  const [savingImages, setSavingImages] = useState(false);
  const [baseMetal, setBaseMetal] = useState('Brass Alloy');
  const [plating, setPlating] = useState('22k Antique Gold');
  const [stoneType, setStoneType] = useState('Glass Kundan & Pearl');
  const [weightGrams, setWeightGrams] = useState(45);
  const [fabric, setFabric] = useState('Chanderi Silk Blend');
  const [fit, setFit] = useState('Tailored Straight');
  const [pattern, setPattern] = useState('Handloom Zari');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creatingProduct, setCreatingProduct] = useState(false);

  const isVerifiedSellerOrAdmin = Boolean(
    user && ((user.role === 'SELLER' && user.isWhatsappVerified) || user.role === 'ADMIN')
  );

  // Validate invite token from URL (?sellerInvite=...) when present and actor is not already seller/admin
  useEffect(() => {
    if (!inviteToken || isVerifiedSellerOrAdmin) {
      setValidatedInvite(null);
      setInviteInvalid(false);
      return;
    }
    let active = true;
    (async () => {
      setInviteCheckLoading(true);
      setInviteInvalid(false);
      try {
        const res = await apiFetch<{ valid: boolean; invite?: ValidatedInviteInfo }>(
          `/api/seller/invites/validate?token=${encodeURIComponent(inviteToken)}`
        );
        if (!active) return;
        if (res.valid && res.invite) {
          setValidatedInvite(res.invite);
          setStoreName(res.invite.storeName || '');
          setJoinEmail(res.invite.email || user?.email || '');
          setSellerFullName(user?.name || '');
        } else {
          setValidatedInvite(null);
          setInviteInvalid(true);
        }
      } catch {
        if (active) {
          setValidatedInvite(null);
          setInviteInvalid(true);
        }
      } finally {
        if (active) setInviteCheckLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [inviteToken, isVerifiedSellerOrAdmin, user?.name, user?.email]);

  const loadAdminInvites = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const data = await apiFetch<{ invites: AdminInviteRow[] }>('/api/admin/seller-invites');
      setAdminInvites(data.invites);
    } catch {
      // Ignore unauthorized
    }
  }, [isAdmin]);

  const loadAnalytics = useCallback(async () => {
    if (!isVerifiedSellerOrAdmin) return;
    setAnalyticsRefreshing(true);
    try {
      const data = await apiFetch<SellerAnalyticsResponse>(
        `/api/seller/analytics?granularity=${granularity}`
      );
      setAnalytics(data);
    } finally {
      setAnalyticsRefreshing(false);
    }
  }, [isVerifiedSellerOrAdmin, granularity]);

  const loadSellerCatalog = useCallback(async () => {
    if (!isVerifiedSellerOrAdmin || !user) return;
    const params = new URLSearchParams({
      status: catalogStatusFilter,
      ...(catalogSearch.trim() ? { q: catalogSearch.trim() } : {}),
    });
    const res = await apiFetch<{ products: Product[] }>(`/api/seller/products?${params}`);
    setSellerProducts(res.products);
    const edits: Record<string, { discount: number; stock: number; shippingWeightGrams: number }> = {};
    for (const p of res.products) {
      edits[p._id] = { discount: p.discountPercent, stock: p.totalStock, shippingWeightGrams: p.shippingWeightGrams || 500 };
    }
    setDiscountEdits(edits);
  }, [isVerifiedSellerOrAdmin, user, catalogSearch, catalogStatusFilter]);

  const loadSellerCategories = useCallback(async () => {
    if (!isVerifiedSellerOrAdmin) return;
    try {
      const data = await apiFetch<{ categories: CategoryControl[] }>('/api/seller/categories');
      setCategories(data.categories || []);
    } catch {
      // Ignore
    }
  }, [isVerifiedSellerOrAdmin]);

  const loadSellerCampaigns = useCallback(async () => {
    if (!isVerifiedSellerOrAdmin) return;
    try {
      const data = await apiFetch<{ campaigns: StorefrontCampaign[] }>('/api/seller/campaigns');
      setSellerCampaigns(data.campaigns || []);
    } catch {
      // Ignore
    }
  }, [isVerifiedSellerOrAdmin]);

  const loadSellerCoupons = useCallback(async () => {
    if (!isVerifiedSellerOrAdmin) return;
    try {
      const [cpnRes, custRes] = await Promise.all([
        apiFetch<{ coupons: Coupon[] }>('/api/seller/coupons'),
        apiFetch<{ customers: Array<{ _id: string; name: string; email: string }> }>(
          '/api/seller/customers'
        ),
      ]);
      setSellerCoupons(cpnRes.coupons || []);
      setKnownCustomers(custRes.customers || []);
    } catch {
      // Ignore
    }
  }, [isVerifiedSellerOrAdmin]);

  const loadSellerOrders = useCallback(
    async (tab: OrderTab, skipVal: number, append: boolean) => {
      if (!isVerifiedSellerOrAdmin) return;
      const res = await apiFetch<OrderListResponse>(
        `/api/orders?scope=seller&tab=${tab}&skip=${skipVal}`
      );
      setSellerOrders((prev) => (append ? [...prev, ...res.orders] : res.orders));
      setOrdersHasMore(res.hasMore);
      setOrdersNextSkip(res.nextSkip);
    },
    [isVerifiedSellerOrAdmin]
  );

  useEffect(() => {
    if (isVerifiedSellerOrAdmin) {
      loadAnalytics();
      loadSellerCatalog();
      loadSellerCategories();
    }
  }, [isVerifiedSellerOrAdmin, loadAnalytics, loadSellerCatalog, loadSellerCategories]);

  const loadReturnRequests = useCallback(async () => {
    if (!isVerifiedSellerOrAdmin) return;
    try {
      const data = await apiFetch<{ returns: Array<any> }>('/api/seller/returns');
      setReturnRequests(data.returns || []);
    } catch {
      setReturnNotice('Unable to load return requests.');
    }
  }, [isVerifiedSellerOrAdmin]);

  const handleForwardReturnToProvider = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!returnForwardTarget) return;
    try {
      await apiFetch('/api/seller/returns/' + encodeURIComponent(returnForwardTarget._id) + '/forward-provider', {
        method: 'POST', body: JSON.stringify({ sharePickupAddress: returnSharePickupAddress }),
      });
      setReturnNotice(returnSharePickupAddress
        ? 'Return sent to the linked provider. The buyer pickup address was shared for return collection.'
        : 'Return sent to the linked provider. The buyer pickup address remains private; provider can approve and share its return address.');
      setReturnForwardTarget(null);
      await loadReturnRequests();
    } catch (err) { setReturnNotice((err as Error).message); }
  };

  const handleRecordReturnPickup = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!returnPickupTarget) return;
    try {
      await apiFetch('/api/seller/returns/' + encodeURIComponent(returnPickupTarget._id) + '/pickup', {
        method: 'POST', body: JSON.stringify(returnPickupDraft),
      });
      setReturnNotice('Return courier pickup details saved. Tracking is now visible to the provider and seller.');
      setReturnPickupTarget(null);
      setReturnPickupDraft({ carrierName: '', trackingId: '', trackingUrl: '' });
      await loadReturnRequests();
    } catch (err) { setReturnNotice((err as Error).message); }
  };

  const handleReturnAction = async (id: string, action: 'approve' | 'reject' | 'mark_received') => {
    setReturnNotice('');
    try {
      await apiFetch('/api/seller/returns/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: JSON.stringify({ action, refundDestination: 'WALLET' }),
      });
      setReturnNotice(action === 'mark_received' ? 'Return received and wallet refund credited.' : 'Return request updated.');
      await loadReturnRequests();
    } catch (err) {
      setReturnNotice((err as Error).message);
    }
  };

  const loadPaymentSettings = useCallback(async () => {
    if (!isVerifiedSellerOrAdmin) return;
    try {
      const data = await apiFetch<{ gateways: Array<{ provider: 'razorpay' | 'stripe'; keyId: string; enabled: boolean; secretMasked: string }> }>('/api/seller/payment-settings');
      setGatewaySettings(data.gateways || []);
      setGatewayDrafts((prev) => {
        const next = { ...prev };
        for (const gateway of data.gateways || []) {
          next[gateway.provider] = { ...next[gateway.provider], keyId: gateway.keyId, enabled: gateway.enabled };
        }
        return next;
      });
    } catch {
      setGatewayNotice('Unable to load payment settings.');
    }
  }, [isVerifiedSellerOrAdmin]);

  const savePaymentSettings = async (provider: 'razorpay' | 'stripe') => {
    setGatewayBusy(true);
    setGatewayNotice('');
    try {
      const data = gatewayDrafts[provider];
      await apiFetch('/api/seller/payment-settings/' + provider, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      setGatewayDrafts((prev) => ({ ...prev, [provider]: { ...prev[provider], secret: '', webhookSecret: '' } }));
      setGatewayNotice(provider.toUpperCase() + ' settings saved. Secret values are stored encrypted.');
      await loadPaymentSettings();
    } catch (err) {
      setGatewayNotice((err as Error).message);
    } finally {
      setGatewayBusy(false);
    }
  };

  const loadPlatformFlags = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const data = await apiFetch<{ flags: PlatformServiceFlags }>('/api/admin/platform-flags');
      if (data.flags) {
        setPlatformDraft(data.flags);
        onPlatformFlagsUpdated?.(data.flags);
      }
    } catch {
      setPlatformNotice('Unable to load service flags.');
    }
  }, [isAdmin, onPlatformFlagsUpdated]);

  const savePlatformFlags = async (e: React.FormEvent) => {
    e.preventDefault();
    setPlatformBusy(true);
    setPlatformNotice(null);
    try {
      const data = await apiFetch<{ flags: PlatformServiceFlags }>('/api/admin/platform-flags', {
        method: 'PUT',
        body: JSON.stringify({
          shippingQuotesEnabled: platformDraft.shippingQuotesEnabled,
          flatFallbackShippingInr: Number(platformDraft.flatFallbackShippingInr) || 0,
          backgroundWorkerEnabled: platformDraft.backgroundWorkerEnabled,
          onlinePaymentEnabled: platformDraft.onlinePaymentEnabled,
          codEnabled: platformDraft.codEnabled,
          codMaxOrderValueInr: Number(platformDraft.codMaxOrderValueInr) || 0,
          sellerDirectCollectEnabled: platformDraft.sellerDirectCollectEnabled,
          posMachineEnabled: platformDraft.posMachineEnabled,
          posDemandCartThresholdInr: Number(platformDraft.posDemandCartThresholdInr) || 0,
          posTerminalLabel: platformDraft.posTerminalLabel.trim() || 'Portable Card / UPI POS',
        }),
      });
      setPlatformDraft(data.flags);
      onPlatformFlagsUpdated?.(data.flags);
      setPlatformNotice('Service flags updated and live across checkout & order workflows.');
    } catch (err) {
      setPlatformNotice((err as Error).message);
    } finally {
      setPlatformBusy(false);
    }
  };

  useEffect(() => {
    if (isAdmin && sellerTab === 'invites') {
      loadAdminInvites();
    }
    if (isAdmin && sellerTab === 'platform') {
      loadPlatformFlags();
    }
    if (isVerifiedSellerOrAdmin && sellerTab === 'analytics') {
      loadAnalytics();
    }
    if (isVerifiedSellerOrAdmin && sellerTab === 'categories') {
      loadSellerCategories();
    }
    if (isVerifiedSellerOrAdmin && sellerTab === 'campaigns') {
      loadSellerCampaigns();
    }
    if (isVerifiedSellerOrAdmin && sellerTab === 'coupons') {
      loadSellerCoupons();
    }
    if (isVerifiedSellerOrAdmin && sellerTab === 'payments') {
      loadPaymentSettings();
    }
    if (isVerifiedSellerOrAdmin && sellerTab === 'returns') {
      loadReturnRequests();
    }
    if (isVerifiedSellerOrAdmin && sellerTab === 'orders') {
      loadSellerOrders(orderTab, 0, false);
    }
  }, [
    isAdmin,
    isVerifiedSellerOrAdmin,
    sellerTab,
    orderTab,
    loadAdminInvites,
    loadPlatformFlags,
    loadAnalytics,
    loadSellerCategories,
    loadSellerCampaigns,
    loadSellerCoupons,
    loadPaymentSettings,
    loadReturnRequests,
    loadSellerOrders,
  ]);

  // --- Invite Link Redemption Screen (ONLY when opened with ?sellerInvite=<token>) ---
  if (!isVerifiedSellerOrAdmin && inviteToken) {
    if (inviteCheckLoading) {
      return (
        <section className="min-h-dvh w-full overflow-x-clip mx-auto max-w-lg px-4 py-16 text-center text-sm text-[#6B6A65]">
          {t('detail.loadingProduct')}
        </section>
      );
    }

    if (inviteInvalid || !validatedInvite) {
      return (
        <section className="min-h-dvh w-full overflow-x-clip mx-auto max-w-lg px-4 py-14">
          <div className="rounded-lg border border-[#E8E6E1] bg-white p-6 sm:p-8 text-center space-y-4">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#FAF9F6] text-[#881337]">
              <Lock className="h-5 w-5" />
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[#141413]">
              {t('seller.invitedInvalidTitle')}
            </h1>
            <p className="text-xs leading-relaxed text-[#6B6A65]">
              {t('seller.invitedInvalidDesc')}
            </p>
            <button
              type="button"
              onClick={() => {
                onInviteConsumed?.();
                onReturnToStore?.();
              }}
              className="min-h-[44px] rounded-md bg-[#141413] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#292524] cursor-pointer"
            >
              {t('seller.backToStore')}
            </button>
          </div>
        </section>
      );
    }

    const handleRequestInviteOtp = async (e: React.FormEvent) => {
      e.preventDefault();
      setOnboardError(null);
      setOnboardBusy(true);
      try {
        const res = await apiFetch<{ ok: boolean; sandboxOtpPreview?: string }>(
          '/api/seller/whatsapp/request-otp',
          {
            method: 'POST',
            body: JSON.stringify({
              whatsappNumber: waNumber.trim(),
              inviteToken,
            }),
          }
        );
        setOtpSent(true);
        setSandboxOtp(res.sandboxOtpPreview || null);
      } catch (err) {
        setOnboardError((err as Error).message);
      } finally {
        setOnboardBusy(false);
      }
    };

    const handleAcceptInvite = async (e: React.FormEvent) => {
      e.preventDefault();
      setOnboardError(null);
      setOnboardBusy(true);
      try {
        const res = await apiFetch<{
          user: User;
          accessToken?: string;
          csrfToken?: string;
          likedProductIds: string[];
          cart: CartItem[];
        }>('/api/seller/invites/accept', {
          method: 'POST',
          body: JSON.stringify({
            inviteToken,
            name: sellerFullName.trim(),
            email: (validatedInvite.email || joinEmail).trim(),
            whatsappNumber: waNumber.trim(),
            otpCode: otpCode.trim(),
            storeName: storeName.trim(),
            description: storeDesc.trim() || 'Handcrafted jewellery and apparel atelier.',
          }),
        });
        if (res.accessToken) {
          setClientSessionTokens(res.accessToken, res.csrfToken);
        }
        onUserUpdated(res.user);
        onAuthSynced?.({
          user: res.user,
          likedProductIds: res.likedProductIds,
          cart: res.cart,
        });
        onInviteConsumed?.();
      } catch (err) {
        setOnboardError((err as Error).message);
      } finally {
        setOnboardBusy(false);
      }
    };

    return (
      <section className="mx-auto max-w-lg px-4 py-12">
        <div className="rounded-lg border border-[#E8E6E1] bg-white p-8 space-y-5">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-[#881337]">
              {t('seller.joinTitle')}
            </div>
            <h1 className="mt-1 font-display text-3xl font-semibold text-[#141413]">
              {validatedInvite.storeName || validatedInvite.email || t('seller.joinTitle')}
            </h1>
            <p className="mt-1 text-xs leading-relaxed text-[#6B6A65]">
              {validatedInvite.hasEmail
                ? t('seller.invitedSub', {
                    admin: validatedInvite.invitedByName,
                    email: validatedInvite.email,
                  })
                : t('seller.joinSub')}
            </p>
            {validatedInvite.note && (
              <div className="mt-3 rounded-md border border-[#E8E6E1] bg-[#FAF9F6] px-3 py-2 text-xs text-[#44403C]">
                “{validatedInvite.note}”
              </div>
            )}
          </div>

          {onboardError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {onboardError}
            </div>
          )}

          {!otpSent ? (
            <form onSubmit={handleRequestInviteOtp} className="space-y-4">
              {!validatedInvite.hasEmail && (
                <div>
                  <label className="block text-xs font-medium text-[#44403C] mb-1">
                    {t('seller.joinWorkEmail')}
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="founder@youratelier.in"
                    value={joinEmail}
                    onChange={(e) => setJoinEmail(e.target.value)}
                    className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm focus:border-[#881337] focus:outline-none"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-[#44403C] mb-1">
                  {t('seller.invitedYourName')}
                </label>
                <input
                  type="text"
                  required
                  value={sellerFullName}
                  onChange={(e) => setSellerFullName(e.target.value)}
                  className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm focus:border-[#881337] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#44403C] mb-1">
                  {t('seller.invitedStoreName')}
                </label>
                <input
                  type="text"
                  required
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm focus:border-[#881337] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#44403C] mb-1">
                  {t('seller.invitedStoreDesc')}
                </label>
                <input
                  type="text"
                  value={storeDesc}
                  onChange={(e) => setStoreDesc(e.target.value)}
                  className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm focus:border-[#881337] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#44403C] mb-1">
                  {t('seller.invitedWa')}
                </label>
                <input
                  type="tel"
                  required
                  placeholder="+919820112233"
                  value={waNumber}
                  onChange={(e) => setWaNumber(e.target.value)}
                  className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm tabular-nums focus:border-[#881337] focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={onboardBusy}
                className="w-full rounded-md bg-[#881337] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#9F1239] cursor-pointer"
              >
                {onboardBusy ? t('seller.invitedSendingOtp') : t('seller.invitedSendOtp')}
              </button>
            </form>
          ) : (
            <form onSubmit={handleAcceptInvite} className="space-y-4">
              {sandboxOtp && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900">
                  {t('seller.invitedSandboxCode')}{' '}
                  <span className="font-mono font-bold">{sandboxOtp}</span>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-[#44403C] mb-1">
                  {t('seller.invitedEnterOtp')}
                </label>
                <input
                  type="text"
                  required
                  maxLength={6}
                  placeholder={t('seller.otpPlaceholder')}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm font-mono tracking-widest focus:border-[#881337] focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={onboardBusy}
                className="w-full rounded-md bg-[#881337] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#9F1239] cursor-pointer"
              >
                {onboardBusy ? t('seller.invitedVerifying') : t('seller.invitedVerifyAccept')}
              </button>
            </form>
          )}
        </div>
      </section>
    );
  }

  // --- Non-Seller & Non-Admin Gate: Strictly Invite-Only (NO Self-Onboarding Option) ---
  if (!user) {
    return (
      <section className="min-h-dvh w-full overflow-x-clip mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16 text-center">
        <div className="mx-auto max-w-md rounded-lg border border-[#E8E6E1] bg-white p-6 sm:p-8 space-y-4">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#FAF9F6] text-[#881337]">
            <Lock className="h-5 w-5" />
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[#141413]">
            {t('seller.title')}
          </h1>
          <p className="text-sm leading-relaxed text-[#6B6A65]">{t('seller.guestDesc')}</p>
          <button
            type="button"
            onClick={onOpenAuth}
            className="min-h-[44px] w-full sm:w-auto rounded-md bg-[#881337] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#9F1239] cursor-pointer"
          >
            {t('seller.signInCta')}
          </button>
        </div>
      </section>
    );
  }

  if (!isVerifiedSellerOrAdmin) {
    return (
      <section className="min-h-dvh w-full overflow-x-clip mx-auto max-w-lg px-4 py-14">
        <div className="rounded-lg border border-[#E8E6E1] bg-white p-6 sm:p-8 text-center space-y-4">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#FAF9F6] text-[#881337]">
            <Lock className="h-5 w-5" />
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[#141413]">
            {t('seller.inviteOnlyTitle')}
          </h1>
          <p className="text-xs leading-relaxed text-[#57534E]">{t('seller.inviteOnlyDesc')}</p>
          <div className="rounded-md border border-[#F0EEE9] bg-[#FAF9F6] px-4 py-3 text-xs text-[#44403C] space-y-1">
            <div className="font-medium">
              {t('seller.inviteOnlyCurrentRole', { email: user.email, role: user.role })}
            </div>
            <div className="text-[#6B6A65]">{t('seller.inviteOnlyAction')}</div>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
            {onReturnToStore && (
              <button
                type="button"
                onClick={onReturnToStore}
                className="min-h-[44px] w-full sm:w-auto rounded-md bg-[#141413] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#292524] cursor-pointer"
              >
                {t('seller.backToStore')}
              </button>
            )}
            <button
              type="button"
              onClick={onOpenAuth}
              className="min-h-[44px] w-full sm:w-auto rounded-md border border-[#D6D3CD] bg-white px-4 py-2.5 text-xs font-medium text-[#141413] hover:border-[#881337] cursor-pointer"
            >
              {t('seller.signInCta')}
            </button>
          </div>
        </div>
      </section>
    );
  }

  // --- Admin Invite Handlers ---
  const handleCreateAdminInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteCreateError(null);
    setCreatingInvite(true);
    try {
      const res = await apiFetch<{ invite: AdminInviteRow; mailtoUrl?: string }>(
        '/api/admin/seller-invites',
        {
          method: 'POST',
          body: JSON.stringify({
            email: inviteEmail.trim() || undefined,
            storeName: inviteStoreName.trim() || undefined,
            note: inviteNote.trim() || undefined,
            expiresInDays: inviteDays,
          }),
        }
      );
      setLatestCreatedInvite(res);
      setInviteEmail('');
      setInviteStoreName('');
      setInviteNote('');
      await loadAdminInvites();
    } catch (err) {
      setInviteCreateError((err as Error).message);
    } finally {
      setCreatingInvite(false);
    }
  };

  const handleCopyInviteUrl = async (id: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
    } catch {
      // Fallback ignored
    }
  };

  const handleRevokeInvite = async (id: string) => {
    await apiFetch(`/api/admin/seller-invites/${id}/revoke`, { method: 'POST' });
    await loadAdminInvites();
  };

  const buildMailtoForInvite = (inv: AdminInviteRow) => {
    const subject = encodeURIComponent(
      `Invitation to join Kala & Karat as a Seller${inv.storeName ? ` — ${inv.storeName}` : ''}`
    );
    const body = encodeURIComponent(
      `Hello,

You have been invited by ${inv.invitedByName} (Kala & Karat Admin) to onboard your atelier${inv.storeName ? ` (${inv.storeName})` : ''} on Kala & Karat.

Open your private onboarding link:
${inv.inviteUrl}

${inv.note ? `Admin note: ${inv.note}

` : ''}Expires: ${new Date(inv.expiresAt).toLocaleDateString('en-IN')}`
    );
    return `mailto:${encodeURIComponent(inv.email || '')}?subject=${subject}&body=${body}`;
  };

  // --- Category Control Panel Handlers ---
  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setCatError(null);
    setCatBusy(true);
    try {
      await apiFetch('/api/seller/categories', {
        method: 'POST',
        body: JSON.stringify({
          name: catName.trim(),
          description: catDesc.trim(),
        }),
      });
      setCatName('');
      setCatDesc('');
      await loadSellerCategories();
      onCatalogMutated();
    } catch (err) {
      setCatError((err as Error).message);
    } finally {
      setCatBusy(false);
    }
  };

  const handleToggleCategoryStatus = async (cat: CategoryControl) => {
    setCatError(null);
    setTogglingCatId(cat._id);
    try {
      await apiFetch(`/api/seller/categories/${cat._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isEnabled: !cat.isEnabled }),
      });
      await loadSellerCategories();
      onCatalogMutated();
    } catch (err) {
      setCatError((err as Error).message);
    } finally {
      setTogglingCatId(null);
    }
  };

  const handleDeleteCategory = async (categoryId: string) => {
    setCatError(null);
    try {
      await apiFetch(`/api/seller/categories/${categoryId}`, { method: 'DELETE' });
      await loadSellerCategories();
      onCatalogMutated();
    } catch (err) {
      setCatError((err as Error).message);
    }
  };

  // --- Seasonal Campaigns Handlers ---
  const applyCampaignPreset = (preset: 'live_now' | 'in_2h' | 'tomorrow') => {
    const now = Date.now();
    if (preset === 'live_now') {
      setCmpStartsAt(new Date(now - 600_000).toISOString().slice(0, 16));
      setCmpEndsAt(new Date(now + 48 * 3600_000).toISOString().slice(0, 16));
    } else if (preset === 'in_2h') {
      setCmpStartsAt(new Date(now + 2 * 3600_000).toISOString().slice(0, 16));
      setCmpEndsAt(new Date(now + 74 * 3600_000).toISOString().slice(0, 16));
    } else {
      setCmpStartsAt(new Date(now + 24 * 3600_000).toISOString().slice(0, 16));
      setCmpEndsAt(new Date(now + 96 * 3600_000).toISOString().slice(0, 16));
    }
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    setCmpError(null);
    if (cmpProductIds.length === 0) {
      setCmpError('Select at least one product for this seasonal campaign.');
      return;
    }
    setCmpBusy(true);
    try {
      await apiFetch('/api/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name: cmpName.trim(),
          season: cmpSeason,
          tagline: cmpTagline.trim() || `${cmpSeason} curated flash drop.`,
          discountPercent: Number(cmpDiscount),
          productIds: cmpProductIds,
          startsAt: new Date(cmpStartsAt).toISOString(),
          endsAt: new Date(cmpEndsAt).toISOString(),
          isActive: true,
        }),
      });
      setCmpName('');
      setCmpTagline('');
      setCmpProductIds([]);
      await loadSellerCampaigns();
      await loadSellerCatalog();
      onCatalogMutated();
    } catch (err) {
      setCmpError((err as Error).message);
    } finally {
      setCmpBusy(false);
    }
  };

  const handleToggleCampaignActive = async (cmp: StorefrontCampaign) => {
    await apiFetch(`/api/campaigns/${cmp._id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !cmp.isActive }),
    });
    await loadSellerCampaigns();
    onCatalogMutated();
  };

  const handleDeleteCampaign = async (id: string) => {
    await apiFetch(`/api/campaigns/${id}`, { method: 'DELETE' });
    await loadSellerCampaigns();
    onCatalogMutated();
  };

  // --- Coupons Handlers ---
  const handleCreateCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    setCpnError(null);
    if (cpnScope === 'selected_products' && cpnProductIds.length === 0) {
      setCpnError('Select at least one product for product-specific coupon scope.');
      return;
    }
    setCpnBusy(true);
    try {
      const extraEmails = cpnExtraEmails
        .split(',')
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean);
      const expiresAt = new Date(Date.now() + Math.max(1, cpnExpiresDays) * 86400_000).toISOString();
      await apiFetch('/api/seller/coupons', {
        method: 'POST',
        body: JSON.stringify({
          code: cpnCode.trim().toUpperCase(),
          title: cpnTitle.trim() || `${cpnCode.trim().toUpperCase()} Offer`,
          discountType: cpnType,
          discountValue: Number(cpnValue),
          maxDiscountAmount: cpnMaxCap ? Number(cpnMaxCap) : undefined,
          minOrderAmount: Number(cpnMinOrder) || 0,
          scope: cpnScope,
          productIds: cpnScope === 'selected_products' ? cpnProductIds : [],
          assignedUserIds: cpnAssignedUserIds,
          assignedEmails: extraEmails,
          usageLimit: Number(cpnUsageLimit) || 100,
          expiresAt,
        }),
      });
      setCpnCode('');
      setCpnTitle('');
      setCpnProductIds([]);
      setCpnAssignedUserIds([]);
      setCpnExtraEmails('');
      await loadSellerCoupons();
      onCatalogMutated();
    } catch (err) {
      setCpnError((err as Error).message);
    } finally {
      setCpnBusy(false);
    }
  };

  const handleToggleCouponActive = async (cpn: Coupon) => {
    await apiFetch(`/api/seller/coupons/${cpn._id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !cpn.isActive }),
    });
    await loadSellerCoupons();
    onCatalogMutated();
  };

  const handleDeleteCoupon = async (id: string) => {
    await apiFetch(`/api/seller/coupons/${id}`, { method: 'DELETE' });
    await loadSellerCoupons();
    onCatalogMutated();
  };

  // --- Seller Catalog & Order Handlers ---
  const handleSaveInlineOffer = async (productId: string) => {
    const edit = discountEdits[productId];
    if (!edit) return;
    setSavingProdId(productId);
    setControlError(null);
    try {
      await apiFetch(`/api/products/${productId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          discountPercent: edit.discount,
          totalStock: edit.stock,
          shippingWeightGrams: edit.shippingWeightGrams,
        }),
      });
      await loadSellerCatalog();
      onCatalogMutated();
    } catch (err) {
      setControlError((err as Error).message);
    } finally {
      setSavingProdId(null);
    }
  };

  const handleProductControlAction = async (
    product: Product,
    action: ProductControlAction,
    stock?: number
  ) => {
    setControllingProdId(product._id);
    setControlError(null);
    setControlNotice(null);
    try {
      await apiFetch<{ product: Product }>(`/api/products/${product._id}/control`, {
        method: 'PATCH',
        body: JSON.stringify({ action, ...(stock ? { stock } : {}) }),
      });
      setControlNotice(t('seller.controlUpdated', { title: product.title }));
      setRemoveTarget(null);
      await loadSellerCatalog();
      onCatalogMutated();
    } catch (err) {
      setControlError((err as Error).message);
    } finally {
      setControllingProdId(null);
    }
  };

  const handleConfirmRemoveProduct = async (product: Product) => {
    setRemovingProduct(true);
    setControlError(null);
    setControlNotice(null);
    try {
      const res = await apiFetch<{
        ok: boolean;
        removedProductId: string;
        purgedImages: string[];
      }>(`/api/products/${product._id}`, {
        method: 'DELETE',
      });
      setRemoveTarget(null);
      setControlNotice(
        t('seller.removedNotice', {
          title: product.title,
          count: res.purgedImages?.length || 0,
        })
      );
      await Promise.all([loadSellerCatalog(), loadSellerCampaigns(), loadSellerCoupons()]);
      onCatalogMutated();
    } catch (err) {
      const typedErr = err as Error & { status?: number };
      if (typedErr.status === 409) {
        setControlError(typedErr.message);
        await loadSellerCatalog();
      } else {
        setControlError(typedErr.message);
      }
    } finally {
      setRemovingProduct(false);
    }
  };

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploadingImg(true);
    setCreateError(null);
    try {
      const results = await Promise.all(files.map((file) => compressAndUploadImage(file)));
      setUploadedImages((prev) => [...prev, ...results]);
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setUploadingImg(false);
      e.target.value = '';
    }
  };

  const handleEditImagesFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !editImagesTarget) return;
    setUploadingImg(true);
    try {
      const results = await Promise.all(files.map((file) => compressAndUploadImage(file)));
      setEditImagesList((prev) => [
        ...prev,
        ...results.map((r, i) => ({
          url: r.url,
          thumbUrl: r.thumbUrl,
          altText: editImagesTarget.title,
          sortOrder: prev.length + i,
        })),
      ]);
    } finally {
      setUploadingImg(false);
      e.target.value = '';
    }
  };

  const handleSaveProductImages = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editImagesTarget || editImagesList.length === 0) return;
    setSavingImages(true);
    try {
      await apiFetch(`/api/products/${editImagesTarget._id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          images: editImagesList.map((img, idx) => ({ ...img, sortOrder: idx })),
        }),
      });
      setEditImagesTarget(null);
      await loadSellerCatalog();
      onCatalogMutated();
    } finally {
      setSavingImages(false);
    }
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreatingProduct(true);
    try {
      const fallbackImg = '/src/assets/images/jewellery_kundan_choker_1794740131002.jpg';
      const imgs =
        uploadedImages.length > 0
          ? uploadedImages.map((u, idx) => ({
              url: u.url,
              thumbUrl: u.thumbUrl,
              altText: newTitle,
              sortOrder: idx,
            }))
          : [{ url: fallbackImg, thumbUrl: fallbackImg, altText: newTitle, sortOrder: 0 }];

      const sizeList = newSizes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      await apiFetch('/api/products', {
        method: 'POST',
        body: JSON.stringify({
          title: newTitle,
          sku: newSku,
          category: newCat,
          subCategory: newSubCat,
          description: newDesc,
          basePrice: Number(newBasePrice),
          discountPercent: Number(newDiscount),
          totalStock: Number(newStock),
          shippingWeightGrams: Number(newShippingWeightGrams),
          visibility: newVisibility,
          assignedCustomerIds: newVisibility === 'ASSIGNED' ? newAssignedCustomers.map((customer) => customer._id) : [],
          onlinePaymentRequired: newOnlineRequired,
          codAllowed: newCodAllowed,
          isReturnable: newReturnable,
          returnWindowDays: newReturnable ? Number(newReturnWindow) : 0,
          images: imgs,
          occasions: newOccasions,
          seasons: newSeasons,
          variants: (sizeList.length > 0 ? sizeList : ['Free Size']).map((sz, i) => ({
            variantSku: `${newSku}-${i + 1}`,
            size: sz,
            colorName: newColorName,
            colorHex: newColorHex,
            stock: Math.max(1, Math.floor(newStock / Math.max(1, sizeList.length))),
            variantImageUrl: imgs[0].url,
          })),
          ...(newCat === 'Artificial Jewellery'
            ? {
                jewellerySpecs: {
                  baseMetal,
                  plating,
                  stoneType,
                  weightGrams: Number(weightGrams),
                  dimensions: 'Standard Atelier Fit',
                  closureType: 'Secure Lock / Dori',
                  occasionWear: newOccasions.join(', '),
                },
              }
            : {}),
          ...(newCat === 'Clothing'
            ? {
                clothingSpecs: {
                  fabric,
                  fit,
                  pattern,
                  sleeveType: 'Three-Quarter',
                  neckType: 'Mandarin / V-Neck',
                  washCare: 'Dry Clean Recommended',
                },
              }
            : {}),
        }),
      });
      setShowNewModal(false);
      setNewTitle('');
      setNewDesc('');
      setUploadedImages([]);
      await loadSellerCatalog();
      onCatalogMutated();
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreatingProduct(false);
    }
  };

  const handleCancellationForward = async (orderId: string) => {
    try {
      await apiFetch('/api/seller/orders/' + encodeURIComponent(orderId) + '/cancellation-forward-provider', { method: 'POST', body: JSON.stringify({}) });
      setReturnNotice('Cancellation forwarded to the linked provider for a second-level decision.');
      await loadSellerOrders(orderTab, 0, false);
    } catch (err) { setReturnNotice((err as Error).message); }
  };

  const handleCancellationReview = async (orderId: string, action: 'approve' | 'reject') => {
    try {
      await apiFetch('/api/seller/orders/' + encodeURIComponent(orderId) + '/cancellation-review', {
        method: 'PATCH',
        body: JSON.stringify({ action, refundDestination: 'WALLET' }),
      });
      await loadSellerOrders(orderTab, 0, false);
      setReturnNotice(action === 'approve' ? 'Cancellation approved and refund initiated.' : 'Cancellation request rejected.');
    } catch (err) {
      setReturnNotice((err as Error).message);
    }
  };

  const handleProductRuleChange = async (product: Product, patch: Partial<Pick<Product, 'onlinePaymentRequired' | 'codAllowed' | 'isReturnable' | 'returnWindowDays'>>) => {
    try {
      await apiFetch('/api/products/' + encodeURIComponent(product._id), {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      await loadSellerCatalog();
    } catch (err) {
      setCreateError((err as Error).message);
    }
  };

  const handleOrderStatusChange = async (
    order: Order,
    status: OrderStatus,
    tracking?: { companyName: string; trackingId: string; trackingUrl: string }
  ) => {
    const res = status === 'Confirmed' && ['Pending', 'PENDING_SELLER_CONFIRMATION'].includes(order.status)
      ? await apiFetch<{ order: Order }>(`/api/seller/orders/${order._id}/confirm`, { method: 'POST', body: JSON.stringify({}) })
      : await apiFetch<{ order: Order }>(`/api/orders/${order._id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status, courierTracking: tracking }),
        });
    setSellerOrders((prev) => prev.map((o) => (o._id === order._id ? res.order : o)));
    setShipOrderTarget(null);
  };

  const handleConfirmManualPayment = async (orderId: string) => {
    setPaymentConfirmBusy(true);
    setPaymentConfirmNotice(null);
    try {
      const res = await apiFetch<{ order: Order }>(
        `/api/seller/orders/${encodeURIComponent(orderId)}/confirm-payment`,
        {
          method: 'POST',
          body: JSON.stringify({
            method: paymentConfirmDraft.method,
            referenceNumber: paymentConfirmDraft.referenceNumber.trim() || undefined,
            posTerminalId: paymentConfirmDraft.posTerminalId.trim() || undefined,
            notes: paymentConfirmDraft.notes.trim() || undefined,
          }),
        }
      );
      setSellerOrders((prev) => prev.map((o) => (o._id === orderId ? res.order : o)));
      setPaymentConfirmOrderId(null);
      setPaymentConfirmDraft({ method: 'UPI', referenceNumber: '', posTerminalId: '', notes: '' });
      setPaymentConfirmNotice(`Payment confirmed for ${res.order.orderNumber}.`);
    } catch (err) {
      setPaymentConfirmNotice((err as Error).message);
    } finally {
      setPaymentConfirmBusy(false);
    }
  };

  const handleRunTrendingCron = async () => {
    const res = await apiFetch<{ updatedCount: number; recalculatedAt: string }>(
      '/api/cron/trending',
      { method: 'POST' }
    );
    setCronNotice(
      `Recalculated trendScore & badges for ${res.updatedCount} products at ${new Date(
        res.recalculatedAt
      ).toLocaleTimeString()}`
    );
    onCatalogMutated();
    loadSellerCatalog();
  };

  const tabOptions: Array<{ id: SellerTab; label: string }> = [
    ...(isAdmin
      ? [
          { id: 'invites' as const, label: t('admin.invitesTab') },
          { id: 'platform' as const, label: 'Service flags' },
        ]
      : []),
    { id: 'analytics', label: t('seller.tabAnalytics') },
    { id: 'catalog', label: t('seller.tabCatalog') },
    { id: 'categories', label: t('seller.tabCategories') },
    { id: 'campaigns', label: t('seller.tabCampaigns') },
    { id: 'coupons', label: t('seller.tabCoupons') },
    { id: 'payments', label: 'Payments' },
    { id: 'returns', label: 'Returns' },
    { id: 'providers', label: 'Providers & payouts' },
    { id: 'logistics', label: 'Shipping & logistics' },
    { id: 'orders', label: t('seller.tabOrders') },
  ];

  const handleTriggerSignOut = () => {
    if (loggingOut) return;
    setLoggingOut(true);
    void onLogout().catch(() => setLoggingOut(false));
  };

  return (
    <div className="min-h-dvh w-full overflow-x-clip flex flex-col md:flex-row bg-[#FAF9F6]">
      {/* Desktop Persistent / Collapsible Sidebar (md: to 2xl:) */}
      <aside
        aria-label={isAdmin ? 'Administrator navigation' : 'Seller workspace navigation'}
        className={`hidden md:flex ${
          sidebarCollapsed ? 'md:w-20' : 'md:w-64 lg:w-72'
        } shrink-0 flex-col border-r border-[#E8E6E1] bg-white sticky top-0 h-dvh transition-[width] duration-200`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[#E8E6E1] px-4 py-4">
          {!sidebarCollapsed && (
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#881337] truncate">
                {user?.isRootSuperuser === true
                  ? 'Root Super Admin · L0'
                  : isAdmin
                    ? 'Platform Admin · L1'
                    : 'Seller Workspace'}
              </div>
              <div className="mt-0.5 truncate font-display text-lg font-semibold text-[#141413]">
                {user.sellerProfile?.storeName || user.name}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((v) => !v)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md border border-[#E8E6E1] bg-white text-[#44403C] hover:border-[#881337] hover:text-[#881337] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#881337] cursor-pointer"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {user?.role === 'SELLER' && onReturnToStore && (
            <button
              type="button"
              onClick={onReturnToStore}
              title="Storefront"
              className="w-full min-h-[44px] inline-flex items-center gap-3 rounded-md bg-[#FAF9F6] border border-[#E8E6E1] px-3 py-2 text-xs font-semibold text-[#881337] hover:border-[#881337] transition-colors cursor-pointer mb-2"
            >
              <Store className="h-4 w-4 shrink-0" aria-hidden="true" />
              {!sidebarCollapsed && <span className="truncate">Storefront</span>}
            </button>
          )}

          {tabOptions.map((tabItem) => {
            const active = sellerTab === tabItem.id;
            return (
              <button
                key={tabItem.id}
                type="button"
                onClick={() => setSellerTab(tabItem.id)}
                title={tabItem.label}
                aria-current={active ? 'page' : undefined}
                className={`w-full min-h-[44px] inline-flex items-center ${
                  sidebarCollapsed ? 'justify-center px-2' : 'justify-between px-3'
                } gap-2 rounded-md py-2 text-xs font-medium transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#881337] text-white shadow-xs'
                    : 'text-[#44403C] hover:bg-[#FAF9F6] hover:text-[#141413]'
                }`}
              >
                {sidebarCollapsed ? (
                  <span className="font-semibold uppercase">
                    {tabItem.label.slice(0, 2)}
                  </span>
                ) : (
                  <span className="truncate text-left">{tabItem.label}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-[#E8E6E1] p-3 space-y-2.5">
          {!sidebarCollapsed && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#6B6A65] px-1">
                <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t('nav.language')}</span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { code: 'en', label: 'EN' },
                    { code: 'hi', label: 'हिन्दी' },
                    { code: 'bn', label: 'বাংলা' },
                  ] as Array<{ code: Language; label: string }>
                ).map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => setLang(item.code)}
                    className={`min-h-[36px] rounded border text-[11px] font-medium cursor-pointer ${
                      lang === item.code
                        ? 'border-[#881337] bg-[#881337] text-white'
                        : 'border-[#E8E6E1] text-[#44403C] hover:border-[#881337]'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleTriggerSignOut}
            disabled={loggingOut}
            aria-label={loggingOut ? 'Signing out' : 'Sign out'}
            className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-md border border-[#D6D3CD] bg-white px-3 py-2 text-xs font-semibold text-[#57534E] hover:border-red-300 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#881337] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
            {!sidebarCollapsed && <span>{loggingOut ? 'Signing out…' : 'Sign out'}</span>}
          </button>
        </div>
      </aside>

      {/* Mobile Header (< 768px) */}
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-[#E8E6E1] bg-white px-4 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setNavDrawerOpen(true)}
            aria-label={i18nT('a11y.open_menu')}
            aria-expanded={navDrawerOpen}
            className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md border border-[#D6D3CD] bg-white text-[#141413] hover:border-[#881337] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#881337] cursor-pointer"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#881337] truncate">
              {isAdmin ? 'Admin' : 'Seller'}
            </div>
            <div className="text-sm font-semibold text-[#141413] truncate">
              {tabOptions.find((x) => x.id === sellerTab)?.label}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => startRoleTour()}
          aria-label={i18nT('a11y.start_tour')}
          className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1.5 rounded-md border border-[#D6D3CD] bg-white px-3 text-xs font-medium text-[#141413] hover:border-[#881337] cursor-pointer"
        >
          <Compass className="h-4 w-4 text-[#881337]" aria-hidden="true" />
          <span className="hidden xs:inline">{i18nT('actions.start_tour')}</span>
        </button>
      </header>

      {/* Mobile Accessible Slide-Over Drawer */}
      {navDrawerOpen && (
        <div
          className="fixed inset-0 z-50 flex md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={user.sellerProfile?.storeName || user.name}
        >
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-[1px]"
            onClick={() => setNavDrawerOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-10 flex h-dvh w-72 max-w-[85vw] flex-col border-r border-[#E8E6E1] bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-2 border-b border-[#E8E6E1] px-4 py-3">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#881337]">
                  {isAdmin ? 'Platform Admin' : 'Seller Workspace'}
                </div>
                <div className="truncate font-display text-lg font-semibold text-[#141413]">
                  {user.sellerProfile?.storeName || user.name}
                </div>
              </div>
              <button
                ref={drawerCloseRef}
                type="button"
                onClick={() => setNavDrawerOpen(false)}
                aria-label={i18nT('a11y.close_menu')}
                className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md text-[#57534E] hover:bg-[#FAF9F6] hover:text-[#141413] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#881337] cursor-pointer"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
              {user?.role === 'SELLER' && onReturnToStore && (
                <button
                  type="button"
                  onClick={() => {
                    setNavDrawerOpen(false);
                    onReturnToStore();
                  }}
                  className="w-full min-h-[44px] inline-flex items-center gap-2.5 rounded-md border border-[#E8E6E1] bg-[#FAF9F6] px-3.5 py-2 text-sm font-semibold text-[#881337] mb-2 cursor-pointer"
                >
                  <Store className="h-4 w-4" aria-hidden="true" />
                  <span>Storefront</span>
                </button>
              )}

              {tabOptions.map((tabItem) => {
                const active = sellerTab === tabItem.id;
                return (
                  <button
                    key={tabItem.id}
                    type="button"
                    onClick={() => {
                      setSellerTab(tabItem.id);
                      setNavDrawerOpen(false);
                    }}
                    className={`w-full min-h-[44px] flex items-center justify-between rounded-md px-3.5 py-2 text-sm font-medium cursor-pointer ${
                      active
                        ? 'bg-[#881337] text-white'
                        : 'text-[#141413] hover:bg-[#FAF9F6]'
                    }`}
                  >
                    <span>{tabItem.label}</span>
                  </button>
                );
              })}

              <div className="pt-4 mt-4 border-t border-[#E8E6E1] space-y-2">
                <div className="px-1 text-xs font-medium text-[#6B6A65]">{t('nav.language')}</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      { code: 'en', label: 'EN' },
                      { code: 'hi', label: 'हिन्दी' },
                      { code: 'bn', label: 'বাংলা' },
                    ] as Array<{ code: Language; label: string }>
                  ).map((item) => (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() => setLang(item.code)}
                      className={`min-h-[44px] rounded-md border text-xs font-medium cursor-pointer ${
                        lang === item.code
                          ? 'border-[#881337] bg-[#881337] text-white'
                          : 'border-[#E8E6E1] text-[#44403C]'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </nav>

            <div className="border-t border-[#E8E6E1] p-3 space-y-2">
              <button
                type="button"
                onClick={() => {
                  setNavDrawerOpen(false);
                  window.setTimeout(() => startRoleTour(), 100);
                }}
                className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-md border border-[#881337]/30 bg-[#FAF9F6] px-4 py-2 text-xs font-semibold text-[#881337] cursor-pointer"
              >
                <Compass className="h-4 w-4" aria-hidden="true" />
                <span>{i18nT('actions.start_tour')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setNavDrawerOpen(false);
                  handleTriggerSignOut();
                }}
                disabled={loggingOut}
                className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-md border border-[#D6D3CD] bg-white px-4 py-2 text-xs font-semibold text-[#57534E] cursor-pointer"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span>{loggingOut ? 'Signing out…' : 'Sign out'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area (min-w-0 prevents wide tables/charts from blowing out flex row) */}
      <main className="flex-1 min-w-0">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-8">
          {user?.isRootSuperuser === true && <RootSuperuserPanel />}

          {/* Workspace Header & Primary Tutorial Action Buttons */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-[#E8E6E1] pb-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-[#6B6A65]">
                <span>
                  {user?.isRootSuperuser === true
                    ? 'Root Super Admin · Level 0'
                    : isAdmin
                      ? 'Platform Administrator · Level 1'
                      : 'Seller workspace'}
                </span>
                <span>/</span>
                <span className="font-medium text-[#141413]">
                  {user.sellerProfile?.storeName || user.name}
                </span>
                {user.whatsappNumber && (
                  <>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('seller.waVerified')} ({user.whatsappNumber})
                    </span>
                  </>
                )}
              </div>
              <h1 className="mt-1 font-display text-2xl sm:text-3xl font-semibold text-[#141413]">
                {isAdmin ? t('seller.adminPerfTitle') : t('seller.perfTitle')}
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
              <ActionButton
                actionKey="start_tour"
                role={tutorialRole}
                variant="outline"
                onClick={() => startRoleTour()}
                icon={<Compass className="h-4 w-4 text-[#881337]" aria-hidden="true" />}
              />

              <ActionButton
                actionKey="sync_trending"
                role={tutorialRole}
                variant="outline"
                showHelpIcon
                onClick={handleRunTrendingCron}
                labelOverride={t('seller.syncTrending')}
                icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
              />

              <ActionButton
                actionKey="add_listing"
                role={tutorialRole}
                variant="primary"
                showHelpIcon
                onClick={() => {
                  setSellerTab('catalog');
                  setShowNewModal(true);
                }}
                labelOverride={t('seller.addListing')}
                icon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
              />
            </div>
          </div>

      {cronNotice && (
        <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-900">
          <span>{cronNotice}</span>
          <button type="button" onClick={() => setCronNotice(null)} className="cursor-pointer">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* TAB 0 (ADMIN ONLY): SELLER ONBOARDING INVITES */}
      {isAdmin && sellerTab === 'invites' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left: Issue Invite Form */}
          <div className="lg:col-span-5 rounded-lg border border-[#E8E6E1] bg-white p-6 space-y-5">
            <div>
              <h2 className="font-display text-2xl font-semibold text-[#141413]">
                {t('admin.invitesTitle')}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-[#6B6A65]">
                {t('admin.invitesSub')}
              </p>
            </div>

            {inviteCreateError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                {inviteCreateError}
              </div>
            )}

            <form onSubmit={handleCreateAdminInvite} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-medium text-[#44403C] mb-1">
                  {t('admin.inviteEmailOptional')}
                </label>
                <input
                  type="email"
                  placeholder="artisan@atelier.in (optional)"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm focus:border-[#881337] focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-medium text-[#44403C] mb-1">
                  {t('admin.inviteStore')}
                </label>
                <input
                  type="text"
                  placeholder="e.g. Banaras Heritage Looms"
                  value={inviteStoreName}
                  onChange={(e) => setInviteStoreName(e.target.value)}
                  className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm focus:border-[#881337] focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-medium text-[#44403C] mb-1">
                  {t('admin.inviteNote')}
                </label>
                <textarea
                  rows={2}
                  value={inviteNote}
                  onChange={(e) => setInviteNote(e.target.value)}
                  className="w-full rounded-md border border-[#D6D3CD] p-2.5 text-xs focus:border-[#881337] focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-medium text-[#44403C] mb-1">
                  {t('admin.inviteExpiry')}
                </label>
                <select
                  value={inviteDays}
                  onChange={(e) => setInviteDays(Number(e.target.value))}
                  className="w-full rounded-md border border-[#D6D3CD] bg-white px-3 py-2 text-xs"
                >
                  <option value={7}>{t('admin.inviteDays', { days: 7 })}</option>
                  <option value={14}>{t('admin.inviteDays', { days: 14 })}</option>
                  <option value={30}>{t('admin.inviteDays', { days: 30 })}</option>
                </select>
              </div>

              <ActionButton
                type="submit"
                actionKey="create_invite"
                role="ADMIN"
                disabled={creatingInvite}
                showHelpIcon
                icon={<Link2 className="h-3.5 w-3.5" aria-hidden="true" />}
                labelOverride={creatingInvite ? t('admin.creatingInvite') : t('admin.generateInviteCta')}
                className="w-full"
              />
            </form>

            {latestCreatedInvite && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50/70 p-4 space-y-3 text-xs">
                <div className="font-semibold text-emerald-900">
                  {t('admin.inviteReadyNotice', {
                    email: latestCreatedInvite.invite.email || t('admin.openInviteLabel'),
                  })}
                </div>
                <div className="rounded border border-emerald-200 bg-white px-2.5 py-2 font-mono text-[11px] text-[#141413] break-all">
                  {latestCreatedInvite.invite.inviteUrl}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      handleCopyInviteUrl(
                        latestCreatedInvite.invite._id,
                        latestCreatedInvite.invite.inviteUrl
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-md border border-[#D6D3CD] bg-white px-3 py-1.5 text-xs font-medium text-[#141413] hover:border-[#141413] cursor-pointer"
                  >
                    {copiedId === latestCreatedInvite.invite._id ? (
                      <Check className="h-3.5 w-3.5 text-emerald-700" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    <span>
                      {copiedId === latestCreatedInvite.invite._id
                        ? t('admin.copiedLink')
                        : t('admin.copyLink')}
                    </span>
                  </button>
                  {latestCreatedInvite.mailtoUrl && (
                    <a
                      href={latestCreatedInvite.mailtoUrl}
                      className="inline-flex items-center gap-1.5 rounded-md bg-[#141413] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#292524]"
                    >
                      <Mail className="h-3.5 w-3.5" />
                      <span>{t('admin.sendEmail')}</span>
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right: Issued Invitations Ledger */}
          <div className="lg:col-span-7 overflow-x-auto rounded-lg border border-[#E8E6E1] bg-white">
            <table className="w-full min-w-[600px] text-left text-xs">
              <thead className="border-b border-[#E8E6E1] bg-[#FAF9F6] text-[#6B6A65]">
                <tr>
                  <th className="px-4 py-3 font-medium">{t('admin.colSellerEmail')}</th>
                  <th className="px-4 py-3 font-medium">{t('admin.colStore')}</th>
                  <th className="px-4 py-3 font-medium">{t('admin.colStatus')}</th>
                  <th className="px-4 py-3 font-medium">{t('admin.colExpires')}</th>
                  <th className="px-4 py-3 font-medium text-right">{t('admin.colActions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EEE9] tabular-nums">
                {adminInvites.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-[#6B6A65]">
                      {t('admin.noInvites')}
                    </td>
                  </tr>
                ) : (
                  adminInvites.map((inv) => (
                    <tr key={inv._id} className="hover:bg-[#FAF9F6]">
                      <td className="px-4 py-3 font-medium text-[#141413]">
                        {inv.email || t('admin.openInviteLabel')}
                      </td>
                      <td className="px-4 py-3 text-[#57534E]">{inv.storeName || '—'}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`font-semibold ${
                            inv.status === 'accepted'
                              ? 'text-emerald-700'
                              : inv.status === 'revoked' || inv.status === 'expired'
                                ? 'text-red-700'
                                : 'text-[#881337]'
                          }`}
                        >
                          {inv.status === 'accepted'
                            ? t('admin.statusAccepted')
                            : inv.status === 'revoked'
                              ? t('admin.statusRevoked')
                              : inv.status === 'expired'
                                ? t('admin.statusExpired')
                                : t('admin.statusPending')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[#6B6A65]">
                        {new Date(inv.expiresAt).toLocaleDateString(locale, {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {inv.status === 'pending' ? (
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleCopyInviteUrl(inv._id, inv.inviteUrl)}
                              className="inline-flex items-center gap-1 rounded border border-[#D6D3CD] px-2 py-1 text-[11px] font-medium text-[#141413] hover:border-[#141413] cursor-pointer"
                            >
                              {copiedId === inv._id ? (
                                <Check className="h-3 w-3 text-emerald-700" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                              <span>
                                {copiedId === inv._id ? t('admin.copiedLink') : t('admin.copyLink')}
                              </span>
                            </button>
                            {inv.email && (
                              <a
                                href={buildMailtoForInvite(inv)}
                                className="inline-flex items-center gap-1 rounded border border-[#D6D3CD] px-2 py-1 text-[11px] font-medium text-[#141413] hover:border-[#881337]"
                              >
                                <Mail className="h-3 w-3" />
                                <span>{t('admin.sendEmail')}</span>
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={() => handleRevokeInvite(inv._id)}
                              className="rounded border border-red-200 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50 cursor-pointer"
                            >
                              {t('admin.revoke')}
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-[#A8A29E]">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 1: RECHARTS SELLER ANALYTICS */}
      {sellerTab === 'analytics' && analytics && (
        <div className="space-y-8 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-[#6B6A65]">{t('seller.mostSharedSub')}</p>
            <button
              type="button"
              disabled={analyticsRefreshing}
              onClick={() => loadAnalytics()}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-md border border-[#D6D3CD] bg-white px-3.5 py-2 text-xs font-medium text-[#141413] hover:border-[#881337] disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${analyticsRefreshing ? 'animate-spin' : ''}`} />
              <span>{analyticsRefreshing ? t('seller.saving') : 'Refresh Analytics'}</span>
            </button>
          </div>

          <DashboardKPI
            analytics={analytics}
            granularity={granularity}
            onGranularityChange={setGranularity}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-4 sm:gap-6">
            <div className="md:col-span-2 xl:col-span-5 min-w-0 rounded-lg border border-[#E8E6E1] bg-white p-4 sm:p-6 space-y-4">
              <div>
                <h2 className="font-display text-xl font-semibold text-[#141413]">
                  {t('seller.funnelTitle')}
                </h2>
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics.funnel} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#F0EEE9" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#6B6A65' }} />
                    <YAxis
                      type="category"
                      dataKey="stage"
                      width={96}
                      tick={{ fontSize: 11, fill: '#141413' }}
                    />
                    <Tooltip contentStyle={{ fontSize: '12px', borderRadius: '6px' }} />
                    <Bar dataKey="count" fill="#A16207" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="md:col-span-2 xl:col-span-7 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 min-w-0">
              <div className="rounded-lg border border-[#E8E6E1] bg-white p-6 space-y-4">
                <h3 className="font-display text-xl font-semibold text-[#141413]">
                  {t('seller.occasionInterest')}
                </h3>
                <div className="space-y-3 text-xs">
                  {analytics.occasionBreakdown.map((occ) => (
                    <div key={occ.occasion} className="flex items-center justify-between">
                      <span className="font-medium text-[#141413]">
                        {to(occ.occasion as OccasionType)}
                      </span>
                      <span className="text-[#6B6A65] tabular-nums">
                        {occ.interestScore.toLocaleString()} pts · {occ.sales}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-[#E8E6E1] bg-white p-6 space-y-4">
                <h3 className="font-display text-xl font-semibold text-[#141413]">
                  {t('seller.colorDemand')}
                </h3>
                <div className="space-y-3 text-xs">
                  {analytics.attributeBreakdown.map((attr) => (
                    <div key={attr.attribute} className="flex items-center justify-between gap-2">
                      <span className="font-medium text-[#141413] truncate">{attr.attribute}</span>
                      <span className="text-[#6B6A65] tabular-nums shrink-0">{attr.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-[#E8E6E1] bg-white p-6 space-y-4">
                <h3 className="font-display text-xl font-semibold text-[#141413]">
                  {t('seller.sentimentTitle')}
                </h3>
                <div className="flex items-center gap-4 text-xs tabular-nums border-b border-[#F0EEE9] pb-3">
                  <span className="text-emerald-700 font-semibold">
                    {analytics.sentimentSummary.Positive} +
                  </span>
                  <span className="text-[#6B6A65]">{analytics.sentimentSummary.Neutral} =</span>
                  <span className="text-red-700">{analytics.sentimentSummary.Negative} -</span>
                </div>
                <div className="space-y-2.5 text-xs">
                  {REVIEW_CLASSES.map((cls) => {
                    const stat = analytics.sentimentSummary.aspectRatings[cls];
                    return (
                      <div key={cls} className="flex items-center justify-between">
                        <span className="text-[#141413]">{tr(cls)}</span>
                        <span className="text-[#6B6A65] tabular-nums">
                          {stat?.count > 0 ? `${stat.avg} / 5 (${stat.count})` : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Most Shared on WhatsApp */}
          <div className="rounded-lg border border-[#E8E6E1] bg-white p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-xl font-semibold text-[#141413]">
                  {t('seller.mostSharedTitle')}
                </h3>
                <p className="text-xs text-[#6B6A65]">{t('seller.mostSharedSub')}</p>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-[#E8E6E1] bg-[#FAF9F6] px-3 py-1 text-xs font-semibold text-[#166534] tabular-nums">
                <Share2 className="h-3.5 w-3.5" />
                {t('seller.sharesCountLabel', { count: analytics.overview.totalShares || 0 })}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(analytics.mostSharedProducts || []).map((sp, idx) => (
                <div
                  key={sp._id}
                  className="flex items-center justify-between gap-3 rounded-md border border-[#E8E6E1] bg-[#FAF9F6]/60 px-3.5 py-2.5 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-[#141413] truncate">
                      #{idx + 1} · {sp.title}
                    </div>
                    <div className="text-[11px] text-[#6B6A65] truncate">
                      {tc(sp.category)} · {sp.viewsCount.toLocaleString()} {t('seller.colViews')}
                    </div>
                  </div>
                  <span className="shrink-0 rounded bg-white border border-[#E8E6E1] px-2 py-1 text-xs font-semibold text-[#166534] tabular-nums">
                    {t('seller.sharesCountLabel', { count: sp.sharesCount })}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-[#E8E6E1] bg-white overflow-hidden">
            <div className="border-b border-[#E8E6E1] px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-xl font-semibold text-[#141413]">
                  {t('seller.prodBreakdown')}
                </h3>
                <p className="text-xs text-[#6B6A65] tabular-nums">
                  {analytics.topProducts.length} products · {(analytics.overview.totalShares || 0).toLocaleString()} total shares
                </p>
              </div>
              <div className="inline-flex items-center gap-1 rounded-md bg-[#F0EEE9] p-1" role="group" aria-label="Sort product breakdown">
                {(
                  [
                    { id: 'sales', label: t('seller.colSales') },
                    { id: 'shares', label: t('seller.colShares') },
                    { id: 'views', label: t('seller.colViews') },
                  ] as const
                ).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    aria-pressed={analyticsProdSort === mode.id}
                    onClick={() => setAnalyticsProdSort(mode.id)}
                    className={`min-h-[44px] min-w-[44px] rounded px-3 py-1 text-[11px] font-medium cursor-pointer ${
                      analyticsProdSort === mode.id
                        ? 'bg-white text-[#141413] shadow-xs font-semibold'
                        : 'text-[#57534E] hover:text-[#141413]'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[660px] text-left text-xs">
                <thead className="bg-[#FAF9F6] border-b border-[#E8E6E1] text-[#6B6A65]">
                  <tr>
                    <th className="px-5 py-3 font-medium">{t('seller.colProduct')}</th>
                    <th className="px-4 py-3 font-medium text-right">{t('seller.colViews')}</th>
                    <th className="px-4 py-3 font-medium text-right">{t('card.likes')}</th>
                    <th className="px-4 py-3 font-medium text-right">{t('seller.colShares')}</th>
                    <th className="px-4 py-3 font-medium text-right">{t('seller.colBag')}</th>
                    <th className="px-4 py-3 font-medium text-right">{t('seller.colSales')}</th>
                    <th className="px-4 py-3 font-medium text-right">{t('seller.colConv')}</th>
                    <th className="px-5 py-3 font-medium text-right">{t('seller.kpiRevenue')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0EEE9] tabular-nums">
                  {[...analytics.topProducts]
                    .sort((a, b) => {
                      if (analyticsProdSort === 'shares') {
                        return (b.sharesCount ?? 0) - (a.sharesCount ?? 0) || b.salesCount - a.salesCount;
                      }
                      if (analyticsProdSort === 'views') {
                        return b.viewsCount - a.viewsCount || (b.sharesCount ?? 0) - (a.sharesCount ?? 0);
                      }
                      return b.salesCount - a.salesCount || (b.sharesCount ?? 0) - (a.sharesCount ?? 0);
                    })
                    .map((tp) => (
                      <tr key={tp._id} className="hover:bg-[#FAF9F6]">
                        <td className="px-5 py-3 font-medium text-[#141413] max-w-[260px] truncate">
                          {tp.title}
                        </td>
                        <td className="px-4 py-3 text-right">{tp.viewsCount.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right">{tp.likesCount}</td>
                        <td className="px-4 py-3 text-right font-semibold text-[#166534]">
                          {tp.sharesCount ?? 0}
                        </td>
                        <td className="px-4 py-3 text-right">{tp.cartAddsCount}</td>
                        <td className="px-4 py-3 text-right font-semibold">{tp.salesCount}</td>
                        <td className="px-4 py-3 text-right">{tp.conversionRate}%</td>
                        <td className="px-5 py-3 text-right font-semibold text-[#141413]">
                          {formatINR(tp.revenue)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: CATALOG, LIFECYCLE CONTROLS & INLINE DYNAMIC OFFERS */}
      {sellerTab === 'catalog' && (
        <div className="space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <input
              type="search"
              value={catalogSearch}
              onChange={(e) => setCatalogSearch(e.target.value)}
              placeholder={t('seller.searchCatalog')}
              className="w-full lg:max-w-sm rounded-md border border-[#D6D3CD] bg-white px-3.5 py-2 text-xs focus:border-[#881337] focus:outline-none"
            />
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex max-w-full overflow-x-auto items-center gap-1 rounded-lg bg-[#F0EEE9] p-1">
                {(
                  [
                    { id: 'all', label: t('seller.filterAll') },
                    { id: 'published', label: t('seller.filterPublished') },
                    { id: 'unpublished', label: t('seller.filterUnpublished') },
                    { id: 'unlisted', label: t('seller.filterUnlisted') },
                    { id: 'out_of_stock', label: t('seller.filterOutOfStock') },
                    { id: 'discontinued', label: t('seller.filterDiscontinued') },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setCatalogStatusFilter(f.id)}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                      catalogStatusFilter === f.id
                        ? 'bg-white text-[#141413] shadow-xs'
                        : 'text-[#57534E] hover:text-[#141413]'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <span className="text-xs text-[#6B6A65] tabular-nums whitespace-nowrap">
                {t('seller.listedPieces', { count: sellerProducts.length })}
              </span>
            </div>
          </div>

          {controlNotice && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-900">
              <span>{controlNotice}</span>
              <button
                type="button"
                onClick={() => setControlNotice(null)}
                className="font-semibold underline cursor-pointer shrink-0"
              >
                {t('detail.close')}
              </button>
            </div>
          )}

          {controlError && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
              <span>{controlError}</span>
              <button
                type="button"
                onClick={() => setControlError(null)}
                className="font-semibold underline cursor-pointer shrink-0"
              >
                {t('detail.close')}
              </button>
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-[#E8E6E1] bg-white">
            <table className="w-full min-w-[920px] text-left text-xs">
              <thead className="border-b border-[#E8E6E1] bg-[#FAF9F6] text-[#6B6A65]">
                <tr>
                  <th className="px-4 py-3 font-medium">{t('seller.colPiece')}</th>
                  <th className="px-4 py-3 font-medium">{t('admin.colStatus')}</th>
                  <th className="px-4 py-3 font-medium">{t('seller.colBase')}</th>
                  <th className="px-4 py-3 font-medium">{t('seller.colSale')}</th>
                  <th className="px-4 py-3 font-medium">{t('seller.colDiscount')}</th>
                  <th className="px-4 py-3 font-medium">{t('seller.colStock')}</th>
                  <th className="px-4 py-3 font-medium text-right">{t('seller.colAction')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EEE9] tabular-nums">
                {sellerProducts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-[#6B6A65]">
                      {t('seller.noMatchingProducts')}
                    </td>
                  </tr>
                ) : (
                  sellerProducts.map((p) => {
                    const edit = discountEdits[p._id] || {
                      discount: p.discountPercent,
                      stock: p.totalStock,
                      shippingWeightGrams: p.shippingWeightGrams || 500,
                    };
                    const previewSale = Math.round(p.basePrice * (1 - edit.discount / 100));
                    const isPublished = p.isPublished !== false;
                    const isUnlisted = Boolean(p.isUnlisted);
                    const isDiscontinued = Boolean(p.isDiscontinued);
                    const isLive = p.isActive && isPublished && !isUnlisted && !isDiscontinued;
                    const activeOrders = p.activeOrderCount || 0;
                    const isBusy = controllingProdId === p._id;

                    return (
                      <tr key={p._id} className="hover:bg-[#FAF9F6]">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <CatalogThumb src={p.images[0]?.thumbUrl || p.images[0]?.url} alt={p.title} />
                            <div className="min-w-0">
                              <div className="font-semibold text-[#141413] truncate max-w-[240px]">
                                {p.title}
                              </div>
                              <div className="text-[11px] text-[#6B6A65] truncate max-w-[240px]">
                                {tc(p.category)} · {p.occasions.map((o) => to(o)).join(', ')}
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[#57534E]">
                                <label className="inline-flex items-center gap-1"><input type="checkbox" checked={Boolean(p.onlinePaymentRequired)} onChange={(e) => void handleProductRuleChange(p, { onlinePaymentRequired: e.target.checked })}/> Prepaid only</label>
                                <label className="inline-flex items-center gap-1"><input type="checkbox" checked={p.codAllowed !== false} onChange={(e) => void handleProductRuleChange(p, { codAllowed: e.target.checked })}/> COD</label>
                                <label className="inline-flex items-center gap-1"><input type="checkbox" checked={p.isReturnable !== false} onChange={(e) => void handleProductRuleChange(p, { isReturnable: e.target.checked, ...(!e.target.checked ? { returnWindowDays: 0 } : {}) })}/> Returnable</label>
                                {p.isReturnable !== false && <select aria-label="Return window" value={p.returnWindowDays ?? 7} onChange={(e) => void handleProductRuleChange(p, { returnWindowDays: Number(e.target.value) })} className="rounded border border-[#D6D3CD] bg-white px-1 py-0.5"><option value={3}>3d</option><option value={7}>7d</option><option value={10}>10d</option><option value={15}>15d</option><option value={30}>30d</option></select>}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {isDiscontinued ? (
                              <span className="rounded border border-stone-300 bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-[#44403C]">
                                {t('seller.statusDiscontinued')}
                              </span>
                            ) : isLive ? (
                              <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                                {t('seller.statusPublished')}
                              </span>
                            ) : (
                              <>
                                {!isPublished && (
                                  <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
                                    {t('seller.statusUnpublished')}
                                  </span>
                                )}
                                {isUnlisted && (
                                  <span className="rounded border border-stone-300 bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-[#57534E]">
                                    {t('seller.statusUnlisted')}
                                  </span>
                                )}
                              </>
                            )}
                            {p.totalStock <= 0 && !isDiscontinued && (
                              <span className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-800">
                                {t('seller.statusOutOfStock')}
                              </span>
                            )}
                            {activeOrders > 0 && (
                              <span className="rounded border border-[#881337]/30 bg-[#881337]/5 px-2 py-0.5 text-[10px] font-semibold text-[#881337]">
                                {t('seller.activeOrdersBadge', { count: activeOrders })}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[#6B6A65]">{formatINR(p.basePrice)}</td>
                        <td className="px-4 py-3 font-semibold text-[#141413]">
                          {formatINR(previewSale)}
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            min={0}
                            max={90}
                            value={edit.discount}
                            onChange={(e) =>
                              setDiscountEdits((prev) => ({
                                ...prev,
                                [p._id]: { ...edit, discount: Number(e.target.value) },
                              }))
                            }
                            className="w-16 rounded border border-[#D6D3CD] px-2 py-1 text-xs tabular-nums"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            min={0}
                            value={edit.stock}
                            onChange={(e) =>
                              setDiscountEdits((prev) => ({
                                ...prev,
                                [p._id]: { ...edit, stock: Number(e.target.value) },
                              }))
                            }
                            className="w-16 rounded border border-[#D6D3CD] px-2 py-1 text-xs tabular-nums"
                          />
                          <label className="mt-2 block text-[10px] text-[#78716C]">Shipping weight (g)
                            <input type="number" min={1} max={100000} value={edit.shippingWeightGrams} onChange={(e) => setDiscountEdits((prev) => ({ ...prev, [p._id]: { ...edit, shippingWeightGrams: Number(e.target.value) } }))} className="mt-1 w-20 rounded border border-[#D6D3CD] px-2 py-1 text-xs tabular-nums"/>
                          </label>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setEditImagesTarget(p);
                                setEditImagesList(p.images.map((img, i) => ({ ...img, sortOrder: i })));
                                setEditImageUrlInput('');
                              }}
                              className="inline-flex items-center gap-1 rounded border border-[#D6D3CD] bg-white px-2 py-1 text-[11px] font-medium text-[#141413] hover:border-[#141413] whitespace-nowrap cursor-pointer"
                            >
                              <ImageIcon className="h-3 w-3" />
                              <span>{t('seller.manageImages', { count: p.images.length })}</span>
                            </button>
                            <button
                              type="button"
                              disabled={savingProdId === p._id}
                              onClick={() => handleSaveInlineOffer(p._id)}
                              className="rounded border border-[#881337] px-2.5 py-1 text-[11px] font-medium text-[#881337] hover:bg-[#881337] hover:text-white transition-colors whitespace-nowrap cursor-pointer"
                            >
                              {savingProdId === p._id ? t('seller.saving') : t('seller.updateOffer')}
                            </button>
                            {!isDiscontinued && (
                              <>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() =>
                                    handleProductControlAction(
                                      p,
                                      isPublished ? 'unpublish' : 'publish'
                                    )
                                  }
                                  className="inline-flex items-center gap-1 rounded border border-[#D6D3CD] bg-white px-2 py-1 text-[11px] font-medium text-[#44403C] hover:border-[#141413] whitespace-nowrap cursor-pointer"
                                >
                                  {isPublished ? (
                                    <>
                                      <EyeOff className="h-3 w-3" />
                                      <span>{t('seller.btnUnpublish')}</span>
                                    </>
                                  ) : (
                                    <>
                                      <Eye className="h-3 w-3" />
                                      <span>{t('seller.btnPublish')}</span>
                                    </>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() =>
                                    handleProductControlAction(p, isUnlisted ? 'relist' : 'unlist')
                                  }
                                  className="rounded border border-[#D6D3CD] bg-white px-2 py-1 text-[11px] font-medium text-[#44403C] hover:border-[#141413] whitespace-nowrap cursor-pointer"
                                >
                                  {isUnlisted ? t('seller.btnRelist') : t('seller.btnUnlist')}
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() =>
                                    handleProductControlAction(
                                      p,
                                      p.totalStock > 0 ? 'mark_out_of_stock' : 'restock',
                                      p.totalStock > 0 ? undefined : Math.max(15, edit.stock || 15)
                                    )
                                  }
                                  className="inline-flex items-center gap-1 rounded border border-[#D6D3CD] bg-white px-2 py-1 text-[11px] font-medium text-[#44403C] hover:border-[#141413] whitespace-nowrap cursor-pointer"
                                >
                                  <PackageX className="h-3 w-3" />
                                  <span>
                                    {p.totalStock > 0
                                      ? t('seller.btnMarkOos')
                                      : t('seller.btnRestock')}
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleProductControlAction(p, 'discontinue')}
                                  className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100 whitespace-nowrap cursor-pointer"
                                >
                                  <Ban className="h-3 w-3" />
                                  <span>{t('seller.btnDiscontinue')}</span>
                                </button>
                              </>
                            )}
                            {isDiscontinued && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleProductControlAction(p, 'relist')}
                                className="inline-flex items-center gap-1 rounded border border-emerald-700 bg-emerald-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-800 whitespace-nowrap cursor-pointer"
                              >
                                <Eye className="h-3 w-3" />
                                <span>{t('seller.btnRelist')}</span>
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => setRemoveTarget(p)}
                              className="inline-flex items-center gap-1 rounded border border-red-200 bg-white px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50 whitespace-nowrap cursor-pointer"
                            >
                              <Trash2 className="h-3 w-3" />
                              <span>{t('seller.btnRemove')}</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2B: CATEGORY CONTROL PANEL (ADD / ENABLE / DISABLE) */}
      {sellerTab === 'categories' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-5 rounded-lg border border-[#E8E6E1] bg-white p-6 space-y-4">
            <div className="flex items-start gap-2.5">
              <FolderCog className="h-5 w-5 text-[#881337] shrink-0 mt-0.5" />
              <div>
                <h2 className="font-display text-2xl font-semibold text-[#141413]">
                  {t('seller.catAddTitle')}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-[#6B6A65]">
                  {t('seller.catSub')}
                </p>
              </div>
            </div>

            {catError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                {catError}
              </div>
            )}

            <form onSubmit={handleCreateCategory} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-medium text-[#44403C] mb-1">
                  {t('seller.catName')}
                </label>
                <input
                  type="text"
                  required
                  placeholder={t('seller.catNamePlaceholder')}
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm focus:border-[#881337] focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-medium text-[#44403C] mb-1">
                  {t('seller.catDesc')}
                </label>
                <textarea
                  rows={2}
                  placeholder={t('seller.catDescPlaceholder')}
                  value={catDesc}
                  onChange={(e) => setCatDesc(e.target.value)}
                  className="w-full rounded-md border border-[#D6D3CD] p-2.5 text-xs focus:border-[#881337] focus:outline-none"
                />
              </div>
              <ActionButton
                type="submit"
                actionKey="save_category"
                role={tutorialRole}
                disabled={catBusy}
                showHelpIcon
                icon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
                labelOverride={catBusy ? t('seller.catAdding') : t('seller.catAddBtn')}
                className="w-full"
              />
            </form>
          </div>

          <div className="lg:col-span-7 space-y-3">
            <div className="rounded-lg border border-[#E8E6E1] bg-white p-5 space-y-3">
              <h3 className="font-display text-xl font-semibold text-[#141413]">
                {t('seller.catTitle')}
              </h3>
              {categories.length === 0 ? (
                <p className="text-xs text-[#6B6A65]">{t('seller.catEmpty')}</p>
              ) : (
                <div className="divide-y divide-[#F0EEE9]">
                  {categories.map((cat) => (
                    <div
                      key={cat._id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3.5"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-[#141413]">
                            {tc(cat.name)}
                          </span>
                          <span
                            className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                              cat.isEnabled
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-stone-100 text-[#6B6A65] border border-[#D6D3CD]'
                            }`}
                          >
                            {cat.isEnabled ? t('seller.catEnabled') : t('seller.catDisabled')}
                          </span>
                          {cat.isDefault && (
                            <span className="rounded-md bg-[#FAF9F6] border border-[#E8E6E1] px-2 py-0.5 text-[10px] font-medium text-[#57534E]">
                              {t('seller.catDefaultBadge')}
                            </span>
                          )}
                          <span className="text-[11px] text-[#6B6A65] tabular-nums">
                            · {t('seller.catProductsCount', { count: cat.productCount ?? 0 })}
                          </span>
                        </div>
                        {cat.description && (
                          <p className="text-xs text-[#6B6A65]">{cat.description}</p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={togglingCatId === cat._id}
                          onClick={() => handleToggleCategoryStatus(cat)}
                          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
                            cat.isEnabled
                              ? 'border-[#D6D3CD] bg-white text-[#44403C] hover:border-[#881337] hover:text-[#881337]'
                              : 'border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800'
                          }`}
                        >
                          {cat.isEnabled ? (
                            <>
                              <EyeOff className="h-3.5 w-3.5" />
                              <span>{t('seller.catDisableBtn')}</span>
                            </>
                          ) : (
                            <>
                              <Eye className="h-3.5 w-3.5" />
                              <span>{t('seller.catEnableBtn')}</span>
                            </>
                          )}
                        </button>
                        {!cat.isDefault && (cat.productCount || 0) === 0 && (
                          <button
                            type="button"
                            onClick={() => handleDeleteCategory(cat._id)}
                            aria-label={t('seller.catDeleteBtn')}
                            className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>{t('seller.catDeleteBtn')}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2C: SEASONAL SALES CAMPAIGNS & FLASH COUNTDOWN CARDS */}
      {sellerTab === 'campaigns' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-5 rounded-lg border border-[#E8E6E1] bg-white p-6 space-y-4">
            <div className="flex items-start gap-2.5">
              <Flame className="h-5 w-5 text-[#881337] shrink-0 mt-0.5" />
              <div>
                <h2 className="font-display text-2xl font-semibold text-[#141413]">
                  {t('seller.campaignCreateTitle')}
                </h2>
                <p className="mt-0.5 text-xs text-[#6B6A65]">{t('flash.sub')}</p>
              </div>
            </div>

            {cmpError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                {cmpError}
              </div>
            )}

            <form onSubmit={handleCreateCampaign} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-medium text-[#44403C] mb-1">
                  {t('seller.campaignName')}
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Diwali Sparkle Flash Sale"
                  value={cmpName}
                  onChange={(e) => setCmpName(e.target.value)}
                  className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[#44403C] mb-1">
                    {t('seller.campaignSeason')}
                  </label>
                  <select
                    value={cmpSeason}
                    onChange={(e) => setCmpSeason(e.target.value as SeasonType)}
                    className="w-full rounded-md border border-[#D6D3CD] bg-white px-2.5 py-2 text-xs"
                  >
                    {SEASONS.map((s) => (
                      <option key={s} value={s}>
                        {tseason(s)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-[#44403C] mb-1">
                    {t('seller.campaignDiscount')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={85}
                    value={cmpDiscount}
                    onChange={(e) => setCmpDiscount(Number(e.target.value))}
                    className="w-full rounded-md border border-[#D6D3CD] px-2.5 py-2 text-xs tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-[#44403C] mb-1">
                  {t('seller.campaignTagline')}
                </label>
                <input
                  type="text"
                  placeholder="Heirloom kundan drops for festive nights."
                  value={cmpTagline}
                  onChange={(e) => setCmpTagline(e.target.value)}
                  className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-xs"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-[#44403C]">
                    {t('seller.campaignSchedule')}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => applyCampaignPreset('live_now')}
                      className="rounded border border-[#D6D3CD] px-2 py-0.5 text-[10px] hover:border-[#881337] cursor-pointer"
                    >
                      {t('flash.liveNow')}
                    </button>
                    <button
                      type="button"
                      onClick={() => applyCampaignPreset('in_2h')}
                      className="rounded border border-[#D6D3CD] px-2 py-0.5 text-[10px] hover:border-[#881337] cursor-pointer"
                    >
                      +2h
                    </button>
                    <button
                      type="button"
                      onClick={() => applyCampaignPreset('tomorrow')}
                      className="rounded border border-[#D6D3CD] px-2 py-0.5 text-[10px] hover:border-[#881337] cursor-pointer"
                    >
                      +24h
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-[#6B6A65] mb-0.5">
                      {t('seller.campaignStart')}
                    </label>
                    <input
                      type="datetime-local"
                      required
                      value={cmpStartsAt}
                      onChange={(e) => setCmpStartsAt(e.target.value)}
                      className="w-full rounded border border-[#D6D3CD] px-2 py-1.5 text-[11px]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-[#6B6A65] mb-0.5">
                      {t('seller.campaignEnd')}
                    </label>
                    <input
                      type="datetime-local"
                      required
                      value={cmpEndsAt}
                      onChange={(e) => setCmpEndsAt(e.target.value)}
                      className="w-full rounded border border-[#D6D3CD] px-2 py-1.5 text-[11px]"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-medium text-[#44403C] mb-1.5">
                  {t('seller.campaignSelectProducts')} ({cmpProductIds.length})
                </label>
                <div className="max-h-44 overflow-y-auto rounded-md border border-[#E8E6E1] divide-y divide-[#F0EEE9]">
                  {sellerProducts.map((p) => {
                    const checked = cmpProductIds.includes(p._id);
                    return (
                      <label
                        key={p._id}
                        className="flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-[#FAF9F6] cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setCmpProductIds((prev) =>
                              checked ? prev.filter((id) => id !== p._id) : [...prev, p._id]
                            )
                          }
                        />
                        <span className="truncate flex-1 font-medium text-[#141413]">{p.title}</span>
                        <span className="text-[11px] text-[#6B6A65] tabular-nums shrink-0">
                          {formatINR(p.salePrice)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <ActionButton
                type="submit"
                actionKey="launch_campaign"
                role={tutorialRole}
                disabled={cmpBusy}
                showHelpIcon
                icon={<Flame className="h-3.5 w-3.5" aria-hidden="true" />}
                labelOverride={cmpBusy ? t('seller.saving') : t('seller.campaignLaunchBtn')}
                className="w-full"
              />
            </form>
          </div>

          <div className="lg:col-span-7 space-y-3">
            {sellerCampaigns.map((cmp) => (
              <div
                key={cmp._id}
                className="rounded-lg border border-[#E8E6E1] bg-white p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-[#881337]/10 px-2 py-0.5 text-[10px] font-semibold text-[#881337]">
                      {tseason(cmp.season)}
                    </span>
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                        cmp.phase === 'live'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : cmp.phase === 'upcoming'
                            ? 'bg-amber-50 text-amber-800 border border-amber-200'
                            : 'bg-stone-100 text-[#6B6A65]'
                      }`}
                    >
                      {cmp.phase === 'live'
                        ? t('flash.liveNow')
                        : cmp.phase === 'upcoming'
                          ? t('flash.startingSoon')
                          : 'Ended'}
                    </span>
                    <span className="text-xs font-semibold text-[#A16207] tabular-nums">
                      {t('flash.upToOff', { percent: cmp.discountPercent })}
                    </span>
                  </div>
                  <div className="font-display text-xl font-semibold text-[#141413]">
                    {cmp.name}
                  </div>
                  <p className="text-xs text-[#6B6A65]">{cmp.tagline}</p>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#57534E] pt-1">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(cmp.startsAt).toLocaleString()} →{' '}
                      {new Date(cmp.endsAt).toLocaleString()}
                    </span>
                    <span className="tabular-nums font-medium">
                      {t('flash.itemsCount', { count: cmp.productIds.length })}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleToggleCampaignActive(cmp)}
                    className="rounded border border-[#D6D3CD] px-3 py-1.5 text-xs font-medium hover:border-[#141413] cursor-pointer"
                  >
                    {cmp.isActive ? t('seller.catDisableBtn') : t('seller.catEnableBtn')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteCampaign(cmp._id)}
                    aria-label={t('seller.catDeleteBtn')}
                    className="rounded border border-red-200 p-1.5 text-red-700 hover:bg-red-50 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2D: SELLER COUPONS (CHECKOUT + PRODUCT LEVEL + USER ASSIGNMENT) */}
      {sellerTab === 'coupons' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-5 rounded-lg border border-[#E8E6E1] bg-white p-6 space-y-4">
            <div className="flex items-start gap-2.5">
              <Tag className="h-5 w-5 text-[#881337] shrink-0 mt-0.5" />
              <div>
                <h2 className="font-display text-2xl font-semibold text-[#141413]">
                  {t('seller.couponCreateTitle')}
                </h2>
              </div>
            </div>

            {cpnError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                {cpnError}
              </div>
            )}

            <form onSubmit={handleCreateCoupon} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[#44403C] mb-1">
                    {t('seller.couponCode')}
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="FESTIVE20"
                    value={cpnCode}
                    onChange={(e) => setCpnCode(e.target.value.toUpperCase())}
                    className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-xs font-mono uppercase"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#44403C] mb-1">
                    {t('seller.couponType')}
                  </label>
                  <select
                    value={cpnType}
                    onChange={(e) => setCpnType(e.target.value as CouponDiscountType)}
                    className="w-full rounded-md border border-[#D6D3CD] bg-white px-2.5 py-2 text-xs"
                  >
                    <option value="percentage">{t('seller.couponPercent')}</option>
                    <option value="flat">{t('seller.couponFlat')}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-[#44403C] mb-1">
                  {t('seller.couponTitle')}
                </label>
                <input
                  type="text"
                  required
                  placeholder="20% Off Selected Kundan & Silks"
                  value={cpnTitle}
                  onChange={(e) => setCpnTitle(e.target.value)}
                  className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-xs"
                />
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block font-medium text-[#44403C] mb-1">
                    {t('seller.couponValue')}
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={cpnValue}
                    onChange={(e) => setCpnValue(Number(e.target.value))}
                    className="w-full rounded-md border border-[#D6D3CD] px-2.5 py-2 text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#44403C] mb-1">
                    {t('seller.couponMinOrder')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={cpnMinOrder}
                    onChange={(e) => setCpnMinOrder(Number(e.target.value))}
                    className="w-full rounded-md border border-[#D6D3CD] px-2.5 py-2 text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#44403C] mb-1">
                    {t('seller.couponMaxCap')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={cpnMaxCap}
                    onChange={(e) => setCpnMaxCap(e.target.value)}
                    className="w-full rounded-md border border-[#D6D3CD] px-2.5 py-2 text-xs tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[#44403C] mb-1">Usage Limit</label>
                  <input
                    type="number"
                    min={1}
                    value={cpnUsageLimit}
                    onChange={(e) => setCpnUsageLimit(Number(e.target.value))}
                    className="w-full rounded-md border border-[#D6D3CD] px-2.5 py-2 text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#44403C] mb-1">
                    {t('admin.inviteExpiry')}
                  </label>
                  <select
                    value={cpnExpiresDays}
                    onChange={(e) => setCpnExpiresDays(Number(e.target.value))}
                    className="w-full rounded-md border border-[#D6D3CD] bg-white px-2.5 py-2 text-xs"
                  >
                    <option value={7}>{t('admin.inviteDays', { days: 7 })}</option>
                    <option value={30}>{t('admin.inviteDays', { days: 30 })}</option>
                    <option value={90}>{t('admin.inviteDays', { days: 90 })}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-[#44403C] mb-1.5">
                  {t('seller.couponScope')}
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCpnScope('all_seller_products')}
                    className={`flex-1 rounded-md border px-2.5 py-1.5 text-xs font-medium cursor-pointer ${
                      cpnScope === 'all_seller_products'
                        ? 'border-[#881337] bg-[#881337] text-white'
                        : 'border-[#D6D3CD] text-[#44403C]'
                    }`}
                  >
                    {t('seller.couponScopeAll')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCpnScope('selected_products')}
                    className={`flex-1 rounded-md border px-2.5 py-1.5 text-xs font-medium cursor-pointer ${
                      cpnScope === 'selected_products'
                        ? 'border-[#881337] bg-[#881337] text-white'
                        : 'border-[#D6D3CD] text-[#44403C]'
                    }`}
                  >
                    {t('seller.couponScopeSelected')}
                  </button>
                </div>
              </div>

              {cpnScope === 'selected_products' && (
                <div className="max-h-36 overflow-y-auto rounded-md border border-[#E8E6E1] divide-y divide-[#F0EEE9]">
                  {sellerProducts.map((p) => {
                    const checked = cpnProductIds.includes(p._id);
                    return (
                      <label
                        key={p._id}
                        className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#FAF9F6] cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setCpnProductIds((prev) =>
                              checked ? prev.filter((id) => id !== p._id) : [...prev, p._id]
                            )
                          }
                        />
                        <span className="truncate flex-1">{p.title}</span>
                      </label>
                    );
                  })}
                </div>
              )}

              <div>
                <label className="block font-medium text-[#44403C] mb-1.5">
                  {t('seller.couponAssignUsers')}
                </label>
                <div className="max-h-28 overflow-y-auto rounded-md border border-[#E8E6E1] divide-y divide-[#F0EEE9] mb-2">
                  {knownCustomers.map((cust) => {
                    const checked = cpnAssignedUserIds.includes(cust._id);
                    return (
                      <label
                        key={cust._id}
                        className="flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-[#FAF9F6] cursor-pointer"
                      >
                        <span className="flex items-center gap-2 truncate">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setCpnAssignedUserIds((prev) =>
                                checked
                                  ? prev.filter((id) => id !== cust._id)
                                  : [...prev, cust._id]
                              )
                            }
                          />
                          <span className="font-medium text-[#141413] truncate">{cust.name}</span>
                        </span>
                        <span className="text-[10px] text-[#6B6A65] truncate">{cust.email}</span>
                      </label>
                    );
                  })}
                </div>
                <input
                  type="text"
                  placeholder={t('seller.couponExtraEmails')}
                  value={cpnExtraEmails}
                  onChange={(e) => setCpnExtraEmails(e.target.value)}
                  className="w-full rounded-md border border-[#D6D3CD] px-3 py-1.5 text-xs"
                />
              </div>

              <ActionButton
                type="submit"
                actionKey="create_coupon"
                role={tutorialRole}
                disabled={cpnBusy}
                showHelpIcon
                icon={<Tag className="h-3.5 w-3.5" aria-hidden="true" />}
                labelOverride={cpnBusy ? t('seller.saving') : t('seller.couponCreateBtn')}
                className="w-full"
              />
            </form>
          </div>

          <div className="lg:col-span-7 space-y-3">
            {sellerCoupons.map((cpn) => {
              const hasAssigned =
                cpn.assignedUserIds.length > 0 || cpn.assignedEmails.length > 0;
              return (
                <div
                  key={cpn._id}
                  className="rounded-lg border border-[#E8E6E1] bg-white p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded border border-[#881337]/30 bg-[#881337]/5 px-2.5 py-0.5 font-mono text-xs font-bold text-[#881337]">
                        {cpn.code}
                      </span>
                      <span className="text-xs font-semibold text-[#141413]">
                        {cpn.discountType === 'percentage'
                          ? `${cpn.discountValue}% Off`
                          : `${formatINR(cpn.discountValue)} Off`}
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                          cpn.isActive
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-stone-100 text-[#6B6A65]'
                        }`}
                      >
                        {cpn.isActive ? t('seller.catEnabled') : t('seller.catDisabled')}
                      </span>
                    </div>
                    <div className="text-xs font-medium text-[#141413]">{cpn.title}</div>
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#6B6A65] tabular-nums">
                      <span>
                        {cpn.scope === 'selected_products'
                          ? `${cpn.productIds.length} Selected Product(s)`
                          : t('seller.couponScopeAll')}
                      </span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {hasAssigned
                          ? `${cpn.assignedUserIds.length + cpn.assignedEmails.length} Assigned User(s)`
                          : 'All Customers'}
                      </span>
                      <span>·</span>
                      <span>
                        Used {cpn.usedCount}/{cpn.usageLimit || '∞'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggleCouponActive(cpn)}
                      className="rounded border border-[#D6D3CD] px-3 py-1.5 text-xs font-medium hover:border-[#141413] cursor-pointer"
                    >
                      {cpn.isActive ? t('seller.catDisableBtn') : t('seller.catEnableBtn')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteCoupon(cpn._id)}
                      aria-label={t('seller.catDeleteBtn')}
                      className="rounded border border-red-200 p-1.5 text-red-700 hover:bg-red-50 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: SELLER ORDERS & COURIER TRACKING */}
      {isVerifiedSellerOrAdmin && sellerTab === 'providers' && <ProviderManagementPanel isAdmin={isAdmin} />}

      {isVerifiedSellerOrAdmin && sellerTab === 'logistics' && <LogisticsManagementPanel />}

      {isVerifiedSellerOrAdmin && sellerTab === 'returns' && (
        <section className="space-y-4">
          <div><h2 className="text-lg font-semibold">Returns and cancellation review</h2><p className="text-xs text-[#78716C]">Review buyer evidence and confirm physical receipt before releasing wallet refunds.</p></div>
          {returnNotice && <p role="status" className="text-xs text-[#57534E]">{returnNotice}</p>}
          {returnRequests.length === 0 ? <div className="rounded-lg border border-[#E8E6E1] bg-white p-8 text-center text-xs text-[#78716C]">No return requests.</div> : returnRequests.map((item) => (
            <article key={item._id} className="rounded-lg border border-[#E8E6E1] bg-white p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-sm font-semibold">{item.productId} · Order {item.orderId}</div><span className="rounded-full bg-[#F5F5F4] px-2 py-1 text-[10px] font-semibold">{item.status}</span></div>
              <p className="text-xs text-[#57534E]">{item.reason}</p>
              <div className="flex flex-wrap gap-2">{(item.media || []).map((media: any, index: number) => <a key={index} href={media.url} target="_blank" rel="noreferrer" className="text-xs text-[#881337] underline">Evidence {index + 1}</a>)}</div>
              {item.selfCourier && <p className="text-xs">Buyer courier: {item.courierName} · {item.trackingId} {item.trackingUrl && <a href={item.trackingUrl} target="_blank" rel="noreferrer" className="text-[#881337] underline">Track</a>}</p>}
              {item.providerReviewStatus && item.providerReviewStatus!=='NOT_FORWARDED' && <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs"><p className="font-semibold text-sky-950">Provider review · {item.providerReviewStatus}</p>{item.providerDecisionNote&&<p className="mt-1 text-sky-900">{item.providerDecisionNote}</p>}{item.providerReturnAddress&&<div className="mt-2 text-sky-950"><p className="font-semibold">Approved return-to address</p><p>{item.providerReturnAddress.name} · {item.providerReturnAddress.contactName} · {item.providerReturnAddress.contactPhone}</p><p>{item.providerReturnAddress.addressLine1} {item.providerReturnAddress.addressLine2}, {item.providerReturnAddress.city}, {item.providerReturnAddress.state} {item.providerReturnAddress.postalCode}</p></div>}</div>}
              {item.returnPickupStatus==='BOOKED' && <p className="text-xs">Return pickup: {item.returnPickupCarrier} · {item.returnPickupTrackingId} {item.returnPickupTrackingUrl&&<a href={item.returnPickupTrackingUrl} target="_blank" rel="noreferrer" className="text-[#881337] underline">Track pickup</a>}</p>}
              <div className="flex flex-wrap gap-2">
                {item.status === 'REQUESTED' && <><button type="button" onClick={() => void handleReturnAction(item._id, 'approve')} className="rounded-md bg-[#881337] px-3 py-2 text-xs font-semibold text-white">Approve return</button><button type="button" onClick={() => void handleReturnAction(item._id, 'reject')} className="rounded-md border px-3 py-2 text-xs">Reject</button>{(!item.providerReviewStatus||item.providerReviewStatus==='NOT_FORWARDED')&&<button type="button" onClick={()=>{setReturnForwardTarget(item);setReturnSharePickupAddress(true)}} className="rounded-md border border-sky-300 px-3 py-2 text-xs font-semibold text-sky-900">Forward to provider</button>}</>}
                {item.providerReviewStatus==='APPROVED'&&item.returnPickupStatus!=='BOOKED'&&<button type="button" onClick={()=>{setReturnPickupTarget(item);setReturnPickupDraft({carrierName:'',trackingId:'',trackingUrl:''})}} className="rounded-md border border-sky-300 px-3 py-2 text-xs font-semibold text-sky-900">Record courier pickup</button>}
                {['APPROVED', 'IN_TRANSIT'].includes(item.status) && <button type="button" onClick={() => void handleReturnAction(item._id, 'mark_received')} className="rounded-md bg-[#881337] px-3 py-2 text-xs font-semibold text-white">Verify &amp; mark received · Wallet refund</button>}
              </div>
            </article>
          ))}
        </section>
      )}

      {returnForwardTarget&&<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true"><form onSubmit={handleForwardReturnToProvider} className="w-full max-w-md max-h-[90dvh] overflow-y-auto overscroll-contain space-y-4 rounded-xl bg-white p-5 shadow-xl"><div><h3 className="text-lg font-semibold">Forward return to provider</h3><p className="mt-1 text-xs leading-5 text-[#6B6A65]">The linked provider will review the return and confirm its return-to address.</p></div><label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950"><input type="checkbox" checked={returnSharePickupAddress} onChange={e=>setReturnSharePickupAddress(e.target.checked)} className="mt-0.5"/><span><strong>Share buyer pickup address with provider</strong><br/>Required only if the provider is expected to arrange courier collection. Leave unchecked to keep the buyer’s address private.</span></label><div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={()=>setReturnForwardTarget(null)} className="min-h-[44px] sm:min-h-[36px] rounded-md border px-4 py-2 text-xs">Cancel</button><button type="submit" className="min-h-[44px] sm:min-h-[36px] rounded-md bg-[#881337] px-4 py-2 text-xs font-semibold text-white">Forward for provider review</button></div></form></div>}
      {returnPickupTarget&&<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true"><form onSubmit={handleRecordReturnPickup} className="w-full max-w-md max-h-[90dvh] overflow-y-auto overscroll-contain space-y-3 rounded-xl bg-white p-5 shadow-xl"><div><h3 className="text-lg font-semibold">Record return courier pickup</h3><p className="mt-1 text-xs text-[#6B6A65]">Enter the courier booking details after arranging the reverse pickup.</p></div><label className="block text-xs font-semibold">Courier name<input required value={returnPickupDraft.carrierName} onChange={e=>setReturnPickupDraft(v=>({...v,carrierName:e.target.value}))} className="mt-1 min-h-[44px] w-full rounded border px-3 py-2"/></label><label className="block text-xs font-semibold">AWB / tracking ID<input required value={returnPickupDraft.trackingId} onChange={e=>setReturnPickupDraft(v=>({...v,trackingId:e.target.value}))} className="mt-1 min-h-[44px] w-full rounded border px-3 py-2"/></label><label className="block text-xs font-semibold">Tracking URL (optional)<input type="url" value={returnPickupDraft.trackingUrl} onChange={e=>setReturnPickupDraft(v=>({...v,trackingUrl:e.target.value}))} className="mt-1 min-h-[44px] w-full rounded border px-3 py-2"/></label><div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={()=>setReturnPickupTarget(null)} className="min-h-[44px] sm:min-h-[36px] rounded-md border px-4 py-2 text-xs">Cancel</button><button type="submit" className="min-h-[44px] sm:min-h-[36px] rounded-md bg-[#881337] px-4 py-2 text-xs font-semibold text-white">Save pickup booking</button></div></form></div>}
      {isAdmin && sellerTab === 'platform' && (
        <section className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-[#141413]">Service &amp; Checkout Feature Flags</h2>
            <p className="mt-1 text-xs text-[#6B6A65] max-w-prose">
              Control heavyweight services separately on the 512 MB tier. Toggle carrier shipping quotes, background logistics worker, online payment gateways, and POS machine thresholds in real time.
            </p>
          </div>

          {platformNotice && (
            <div role="status" className="rounded-lg border border-[#E8E6E1] bg-white px-4 py-3 text-xs font-medium text-[#141413]">
              {platformNotice}
            </div>
          )}

          <form onSubmit={savePlatformFlags} className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Shipping & Memory Guardrails */}
              <div className="rounded-xl border border-[#E8E6E1] bg-white p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-[#141413]">Shipping &amp; 512 MB Worker Guardrails</h3>
                  <p className="text-[11px] text-[#78716C] mt-0.5">
                    When shipping quotes are paused, customers complete normal checkout with free delivery and zero carrier blocking.
                  </p>
                </div>

                <label className="flex min-h-[44px] items-center justify-between gap-3 border-b border-[#F0EEE9] pb-3 cursor-pointer">
                  <div>
                    <div className="text-xs font-semibold text-[#141413]">Live carrier delivery quotes</div>
                    <div className="text-[11px] text-[#6B6A65]">Query Shiprocket / Shadowfax rate engine during checkout</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={platformDraft.shippingQuotesEnabled}
                    onChange={(e) =>
                      setPlatformDraft((p) => ({ ...p, shippingQuotesEnabled: e.target.checked }))
                    }
                    className="h-4 w-4 accent-[#881337]"
                  />
                </label>

                <label className="block text-xs font-medium text-[#44403C]">
                  Fallback delivery charge (₹) when quotes are flagged off
                  <input
                    type="number"
                    min={0}
                    max={5000}
                    value={platformDraft.flatFallbackShippingInr}
                    onChange={(e) =>
                      setPlatformDraft((p) => ({
                        ...p,
                        flatFallbackShippingInr: Math.max(0, Number(e.target.value) || 0),
                      }))
                    }
                    className="mt-1 min-h-[44px] w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm tabular-nums"
                  />
                  <span className="mt-1 block text-[11px] text-[#78716C]">Set to 0 for Free Delivery (default).</span>
                </label>

                <label className="flex min-h-[44px] items-center justify-between gap-3 pt-1 cursor-pointer">
                  <div>
                    <div className="text-xs font-semibold text-[#141413]">Co-located logistics background worker</div>
                    <div className="text-[11px] text-[#6B6A65]">Requires RUN_LOGISTICS_WORKER=1 env flag; keep OFF on Free 512 MB tier</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={platformDraft.backgroundWorkerEnabled}
                    onChange={(e) =>
                      setPlatformDraft((p) => ({ ...p, backgroundWorkerEnabled: e.target.checked }))
                    }
                    className="h-4 w-4 accent-[#881337]"
                  />
                </label>
              </div>

              {/* Online Payment Gateways */}
              <div className="rounded-xl border border-[#E8E6E1] bg-white p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-[#141413]">Online Payment Gateways &amp; Collection Modes</h3>
                  <p className="text-[11px] text-[#78716C] mt-0.5">
                    Keep Razorpay / Stripe paused until traffic scales; use Seller Direct Collection, COD, and POS on Delivery without gateway complexity.
                  </p>
                </div>

                <label className="flex min-h-[44px] items-center justify-between gap-3 border-b border-[#F0EEE9] pb-3 cursor-pointer">
                  <div>
                    <div className="text-xs font-semibold text-[#141413]">Online payment gateways (Razorpay / Stripe)</div>
                    <div className="text-[11px] text-[#6B6A65]">Show gateway payment options at checkout and order history</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={platformDraft.onlinePaymentEnabled}
                    onChange={(e) =>
                      setPlatformDraft((p) => ({ ...p, onlinePaymentEnabled: e.target.checked }))
                    }
                    className="h-4 w-4 accent-[#881337]"
                  />
                </label>

                <label className="flex min-h-[44px] items-center justify-between gap-3 border-b border-[#F0EEE9] pb-3 cursor-pointer">
                  <div>
                    <div className="text-xs font-semibold text-[#141413]">Seller direct payment collection</div>
                    <div className="text-[11px] text-[#6B6A65]">Notify seller to share UPI/cash details and confirm payment</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={platformDraft.sellerDirectCollectEnabled}
                    onChange={(e) =>
                      setPlatformDraft((p) => ({ ...p, sellerDirectCollectEnabled: e.target.checked }))
                    }
                    className="h-4 w-4 accent-[#881337]"
                  />
                </label>

                <label className="flex min-h-[44px] items-center justify-between gap-3 cursor-pointer">
                  <div>
                    <div className="text-xs font-semibold text-[#141413]">Cash on Delivery (COD)</div>
                    <div className="text-[11px] text-[#6B6A65]">Standard doorstep cash collection</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={platformDraft.codEnabled}
                    onChange={(e) => setPlatformDraft((p) => ({ ...p, codEnabled: e.target.checked }))}
                    className="h-4 w-4 accent-[#881337]"
                  />
                </label>

                <label className="block text-xs font-medium text-[#44403C]">
                  COD maximum order value (₹)
                  <input
                    type="number"
                    min={0}
                    max={500000}
                    value={platformDraft.codMaxOrderValueInr}
                    onChange={(e) =>
                      setPlatformDraft((p) => ({
                        ...p,
                        codMaxOrderValueInr: Math.max(0, Number(e.target.value) || 0),
                      }))
                    }
                    className="mt-1 min-h-[44px] w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm tabular-nums"
                  />
                </label>
              </div>

              {/* POS Machine on Delivery */}
              <div className="rounded-xl border border-[#E8E6E1] bg-white p-5 space-y-4 lg:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-[#141413]">POS Machine on Delivery Integration</h3>
                    <p className="text-[11px] text-[#78716C] mt-0.5">
                      Offer a portable Card / UPI POS machine when cart value reaches demand threshold or exceeds COD limit.
                    </p>
                  </div>
                  <label className="flex min-h-[44px] items-center gap-2 text-xs font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={platformDraft.posMachineEnabled}
                      onChange={(e) =>
                        setPlatformDraft((p) => ({ ...p, posMachineEnabled: e.target.checked }))
                      }
                      className="h-4 w-4 accent-[#881337]"
                    />
                    Enabled
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block text-xs font-medium text-[#44403C]">
                    POS demand highlight threshold (₹)
                    <input
                      type="number"
                      min={0}
                      max={500000}
                      value={platformDraft.posDemandCartThresholdInr}
                      onChange={(e) =>
                        setPlatformDraft((p) => ({
                          ...p,
                          posDemandCartThresholdInr: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      className="mt-1 min-h-[44px] w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm tabular-nums"
                    />
                  </label>
                  <label className="block text-xs font-medium text-[#44403C]">
                    POS terminal display label
                    <input
                      type="text"
                      maxLength={80}
                      value={platformDraft.posTerminalLabel}
                      onChange={(e) =>
                        setPlatformDraft((p) => ({ ...p, posTerminalLabel: e.target.value }))
                      }
                      className="mt-1 min-h-[44px] w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm"
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end">
              <button
                type="submit"
                disabled={platformBusy}
                className="min-h-[44px] rounded-md bg-[#881337] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#9F1239] disabled:opacity-50 cursor-pointer"
              >
                {platformBusy ? 'Saving flags…' : 'Save service flags'}
              </button>
            </div>
          </form>
        </section>
      )}

      {isVerifiedSellerOrAdmin && sellerTab === 'payments' && (
        <section className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-[#141413]">Payment settings</h2>
            <p className="mt-1 text-xs text-[#78716C]">Connect Razorpay and Stripe. Secret fields are write-only and encrypted before storage.</p>
          </div>
          {platformFlags && !platformFlags.onlinePaymentEnabled && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-950">
              Online payment gateways are currently paused at platform level. Orders run via COD, Seller Direct Collection, and POS Machine on Delivery; saved gateway keys stay encrypted until Admin enables online gateways.
            </div>
          )}
          {(['razorpay', 'stripe'] as const).map((provider) => (
            <div key={provider} className="rounded-xl border border-[#E8E6E1] bg-white p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold capitalize">{provider}</h3>
                <label className="flex min-h-[44px] items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={gatewayDrafts[provider].enabled} onChange={(e) => setGatewayDrafts((prev) => ({ ...prev, [provider]: { ...prev[provider], enabled: e.target.checked } }))} />
                  Active
                </label>
              </div>
              <label className="block text-xs font-medium">Key ID / Publishable Key
                <input value={gatewayDrafts[provider].keyId} onChange={(e) => setGatewayDrafts((prev) => ({ ...prev, [provider]: { ...prev[provider], keyId: e.target.value } }))} className="mt-1 min-h-[44px] w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm" autoComplete="off" />
              </label>
              <label className="block text-xs font-medium">API Secret
                <input type="password" value={gatewayDrafts[provider].secret} onChange={(e) => setGatewayDrafts((prev) => ({ ...prev, [provider]: { ...prev[provider], secret: e.target.value } }))} placeholder="Leave blank to keep existing secret" className="mt-1 min-h-[44px] w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm" autoComplete="new-password" />
              </label>
              <label className="block text-xs font-medium">Webhook Signing Secret
                <input type="password" value={gatewayDrafts[provider].webhookSecret} onChange={(e) => setGatewayDrafts((prev) => ({ ...prev, [provider]: { ...prev[provider], webhookSecret: e.target.value } }))} placeholder="Leave blank to keep existing secret" className="mt-1 min-h-[44px] w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm" autoComplete="new-password" />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[11px] text-[#78716C]">{gatewaySettings.find((item) => item.provider === provider)?.secretMasked || 'No secret configured'}</span>
                <ActionButton
                  actionKey="save_payment_gateway"
                  role={tutorialRole}
                  disabled={gatewayBusy || !gatewayDrafts[provider].keyId.trim()}
                  showHelpIcon={provider === 'razorpay'}
                  onClick={() => void savePaymentSettings(provider)}
                  labelOverride={gatewayBusy ? 'Saving…' : 'Save settings'}
                />
              </div>
            </div>
          ))}
          {gatewayNotice && <p role="status" className="text-xs text-[#57534E]">{gatewayNotice}</p>}
        </section>
      )}

      {sellerTab === 'orders' && (
        <div className="space-y-4">
          <div className="inline-flex items-center gap-1 rounded-lg bg-[#F0EEE9] p-1">
            {(['Current', 'Past', 'Completed'] as OrderTab[]).map((tabItem) => (
              <button
                key={tabItem}
                type="button"
                onClick={() => setOrderTab(tabItem)}
                className={`rounded-md px-3.5 py-1.5 text-xs font-medium cursor-pointer ${
                  orderTab === tabItem ? 'bg-white text-[#141413] shadow-xs' : 'text-[#57534E]'
                }`}
              >
                {totab(tabItem)}
              </button>
            ))}
          </div>

          {paymentConfirmNotice && (
            <div role="status" className="rounded-md border border-[#E8E6E1] bg-white px-4 py-2.5 text-xs font-medium text-[#141413]">
              {paymentConfirmNotice}
            </div>
          )}

          <div className="space-y-3">
            {sellerOrders.map((ord) => (
              <div
                key={ord._id}
                className="rounded-lg border border-[#E8E6E1] bg-white p-5 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs space-y-0.5">
                    <div>
                      <span className="font-mono font-semibold text-[#141413]">
                        {ord.orderNumber}
                      </span>
                      <span className="text-[#6B6A65]">
                        {' '}
                        · {ord.shippingAddress.fullName} ({ord.shippingAddress.city}) ·{' '}
                        <span className="font-semibold text-[#881337]">{ts(ord.status)}</span>
                      </span>
                    </div>
                    <div className="text-[11px] text-[#57534E]">
                      Mode:{' '}
                      <span className="font-semibold text-[#141413]">
                        {ord.paymentMode === 'POS_ON_DELIVERY'
                          ? 'POS Machine on Delivery'
                          : ord.paymentMode === 'SELLER_COLLECT'
                            ? 'Seller Direct Collection'
                            : ord.paymentMode || 'COD'}
                      </span>
                      {ord.posRequested && (
                        <span className="ml-2 font-semibold text-[#881337]">
                          · Carry portable POS terminal
                        </span>
                      )}
                      {ord.paymentStatus && (
                        <span
                          className={`ml-2 font-semibold ${
                            ord.paymentStatus === 'PAID' ? 'text-emerald-700' : 'text-[#6B6A65]'
                          }`}
                        >
                          · {ord.paymentStatus}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-sm font-semibold tabular-nums">
                    {formatINR(ord.totalAmount)}
                  </div>
                </div>

                {ord.manualPaymentCollection?.confirmedAt && (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-900">
                    <span className="font-semibold">
                      Payment confirmed ({ord.manualPaymentCollection.method.replaceAll('_', ' ')})
                    </span>
                    {ord.manualPaymentCollection.referenceNumber && (
                      <span className="font-mono ml-2 tabular-nums">
                        · Ref: {ord.manualPaymentCollection.referenceNumber}
                      </span>
                    )}
                    {ord.manualPaymentCollection.posTerminalId && (
                      <span className="font-mono ml-2 tabular-nums">
                        · Terminal: {ord.manualPaymentCollection.posTerminalId}
                      </span>
                    )}
                  </div>
                )}

                <div className="space-y-1">
                  {ord.items.map((item, iIdx) => (
                    <div key={`${item.variantSku}-${iIdx}`} className="flex flex-wrap items-center gap-2 text-xs text-[#57534E]">
                      <span>
                        {item.title} ({item.size} · x{item.quantity})
                      </span>
                      {item.catalogStatus && item.catalogStatus !== 'active' && (
                        <span className="rounded bg-[#F0EEE9] px-1.5 py-0.5 text-[10px] font-medium text-[#6B6A65]">
                          {item.catalogStatus === 'removed'
                            ? t('orders.itemRemoved')
                            : item.catalogStatus === 'discontinued'
                              ? t('orders.itemDiscontinued')
                              : t('orders.itemUnpublished')}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {ord.whatsappDispatch && (
                  <div className="text-[11px] text-[#6B6A65] flex items-center gap-2">
                    <span>
                      {t('cart.sellerWaAlert')} ({ord.whatsappDispatch.channel}):
                    </span>
                    <a
                      href={ord.whatsappDispatch.waLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-[#881337] hover:underline"
                    >
                      <span>{t('share.openWhatsapp')}</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}

                {ord.status === 'CANCELLATION_REQUESTED' && (
                  <div className="flex flex-wrap gap-2 rounded-md bg-[#FFF8F6] p-3">
                    <span className="w-full text-xs font-medium text-[#57534E]">Buyer requested cancellation. {ord.providerCancellationReview?.status==='PENDING'?'Awaiting provider decision.':ord.providerCancellationReview?.status==='APPROVED'?'Provider approved the cancellation.':ord.providerCancellationReview?.status==='REJECTED'?'Provider rejected the cancellation.':'You can forward provider-supplied orders for a second-level decision.'}</span>
                    {!ord.providerCancellationReview?.status || ord.providerCancellationReview.status==='NOT_FORWARDED' ? <button type="button" onClick={() => void handleCancellationForward(ord._id)} className="rounded border border-[#881337] px-3 py-1.5 text-xs font-semibold text-[#881337]">Forward to provider</button> : null}
                    <button type="button" disabled={ord.providerCancellationReview?.status==='PENDING'||ord.providerCancellationReview?.status==='REJECTED'} onClick={() => void handleCancellationReview(ord._id, 'approve')} className="rounded bg-[#881337] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">Approve &amp; refund to wallet</button>
                    <button type="button" onClick={() => void handleCancellationReview(ord._id, 'reject')} className="rounded border border-[#D6D3CD] px-3 py-1.5 text-xs">Reject request</button>
                  </div>
                )}

                {paymentConfirmOrderId === ord._id && (
                  <div className="rounded-md border border-[#E8E6E1] bg-[#FAF9F6] p-3.5 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#141413]">
                        Confirm Direct / POS Payment Collection
                      </span>
                      <button
                        type="button"
                        onClick={() => setPaymentConfirmOrderId(null)}
                        className="text-xs text-[#6B6A65] hover:text-[#141413] cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <label className="block text-[11px] font-medium text-[#44403C]">
                        Method
                        <select
                          value={paymentConfirmDraft.method}
                          onChange={(e) =>
                            setPaymentConfirmDraft((d) => ({
                              ...d,
                              method: e.target.value as 'CASH' | 'UPI' | 'POS_CARD' | 'BANK_TRANSFER',
                            }))
                          }
                          className="mt-1 min-h-[44px] w-full rounded-md border border-[#D6D3CD] bg-white px-2.5 py-2 text-xs"
                        >
                          <option value="POS_CARD">POS Card / Tap</option>
                          <option value="UPI">UPI / QR Transfer</option>
                          <option value="CASH">Cash on Delivery</option>
                          <option value="BANK_TRANSFER">Bank Transfer / IMPS</option>
                        </select>
                      </label>
                      <label className="block text-[11px] font-medium text-[#44403C]">
                        RRN / UTR / Slip Ref (optional)
                        <input
                          type="text"
                          value={paymentConfirmDraft.referenceNumber}
                          onChange={(e) =>
                            setPaymentConfirmDraft((d) => ({ ...d, referenceNumber: e.target.value }))
                          }
                          placeholder="e.g. RRN42190811"
                          className="mt-1 min-h-[44px] w-full rounded-md border border-[#D6D3CD] bg-white px-2.5 py-2 text-xs font-mono"
                        />
                      </label>
                      <label className="block text-[11px] font-medium text-[#44403C]">
                        POS Terminal ID (optional)
                        <input
                          type="text"
                          value={paymentConfirmDraft.posTerminalId}
                          onChange={(e) =>
                            setPaymentConfirmDraft((d) => ({ ...d, posTerminalId: e.target.value }))
                          }
                          placeholder="e.g. POS-MUM-02"
                          className="mt-1 min-h-[44px] w-full rounded-md border border-[#D6D3CD] bg-white px-2.5 py-2 text-xs font-mono"
                        />
                      </label>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={paymentConfirmDraft.notes}
                        onChange={(e) =>
                          setPaymentConfirmDraft((d) => ({ ...d, notes: e.target.value }))
                        }
                        placeholder="Collection note (optional)"
                        className="flex-1 min-h-[44px] rounded-md border border-[#D6D3CD] bg-white px-3 py-2 text-xs"
                      />
                      <button
                        type="button"
                        disabled={paymentConfirmBusy}
                        onClick={() => void handleConfirmManualPayment(ord._id)}
                        className="min-h-[44px] rounded-md bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 cursor-pointer"
                      >
                        {paymentConfirmBusy ? 'Confirming…' : 'Mark as Paid'}
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#F0EEE9]">
                  {['Pending', 'PENDING_SELLER_CONFIRMATION'].includes(ord.status) && (
                    <ActionButton
                      actionKey="confirm_order"
                      role={tutorialRole}
                      variant="outline"
                      fullWidthMobile={false}
                      showHelpIcon
                      onClick={() => handleOrderStatusChange(ord, 'Confirmed')}
                      labelOverride={t('seller.confirmOrder')}
                    />
                  )}
                  {ord.paymentStatus !== 'PAID' && ord.status !== 'Cancelled' && (
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentConfirmOrderId((curr) => (curr === ord._id ? null : ord._id));
                        setPaymentConfirmDraft({
                          method:
                            ord.paymentMode === 'POS_ON_DELIVERY'
                              ? 'POS_CARD'
                              : ord.paymentMode === 'COD'
                                ? 'CASH'
                                : 'UPI',
                          referenceNumber: '',
                          posTerminalId: '',
                          notes: '',
                        });
                      }}
                      className="min-h-[44px] sm:min-h-[36px] rounded border border-emerald-700 bg-emerald-50/70 px-3 py-1.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 cursor-pointer"
                    >
                      {ord.paymentMode === 'POS_ON_DELIVERY' ? 'Confirm POS / Payment' : 'Confirm payment'}
                    </button>
                  )}
                  {(['Confirmed', 'PAID_AND_PROCESSING'].includes(ord.status)) && (
                    <button
                      type="button"
                      onClick={() => handleOrderStatusChange(ord, 'Packed')}
                      className="min-h-[44px] sm:min-h-[36px] rounded border border-[#D6D3CD] px-3 py-1.5 text-xs font-medium hover:border-[#141413] cursor-pointer"
                    >
                      {t('seller.markPacked')}
                    </button>
                  )}
                  {['Confirmed', 'PAID_AND_PROCESSING', 'Packed'].includes(ord.status) && (
                    <ActionButton
                      actionKey="ship_order"
                      role={tutorialRole}
                      variant="primary"
                      fullWidthMobile={false}
                      showHelpIcon
                      onClick={() => {
                        setShipOrderTarget(ord);
                        setTrackingId(`TRK${Math.floor(100000 + Math.random() * 899999)}`);
                        setTrackingUrl('https://www.bluedart.com/tracking');
                      }}
                      icon={<Truck className="h-3.5 w-3.5" aria-hidden="true" />}
                      labelOverride={t('seller.shipTracking')}
                    />
                  )}
                  {['Shipped', 'Out for Delivery'].includes(ord.status) && (
                    <button
                      type="button"
                      onClick={() => handleOrderStatusChange(ord, 'Delivered')}
                      className="inline-flex items-center gap-1 rounded bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-800 cursor-pointer"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>{t('seller.markDelivered')}</span>
                    </button>
                  )}
                  {ord.status !== 'Delivered' && ord.status !== 'Cancelled' && (
                    <button
                      type="button"
                      onClick={() => handleOrderStatusChange(ord, 'Cancelled')}
                      className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 cursor-pointer"
                    >
                      {t('seller.cancelOrder')}
                    </button>
                  )}
                </div>
              </div>
            ))}

            {ordersHasMore && (
              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => loadSellerOrders(orderTab, ordersNextSkip, true)}
                  className="rounded-md border border-[#D6D3CD] bg-white px-5 py-2 text-xs font-semibold hover:border-[#881337] cursor-pointer"
                >
                  {t('orders.loadNext')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Attach Courier Tracking Modal */}
      {shipOrderTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto overscroll-contain rounded-lg border border-[#E8E6E1] bg-white p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[#F0EEE9] pb-3">
              <h3 className="font-display text-2xl font-semibold text-[#141413]">
                {t('seller.shipTracking')}
              </h3>
              <button
                type="button"
                onClick={() => setShipOrderTarget(null)}
                aria-label={t('detail.close')}
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-md hover:bg-[#FAF9F6] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleOrderStatusChange(shipOrderTarget, 'Shipped', {
                  companyName: courierCompany,
                  trackingId,
                  trackingUrl,
                });
              }}
              className="space-y-3"
            >
              <div>
                <label className="block text-xs font-medium text-[#44403C] mb-1">
                  {t('seller.courierCompany')}
                </label>
                <input
                  type="text"
                  required
                  value={courierCompany}
                  onChange={(e) => setCourierCompany(e.target.value)}
                  className="min-h-[44px] w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#44403C] mb-1">
                  {t('seller.trackingId')}
                </label>
                <input
                  type="text"
                  required
                  value={trackingId}
                  onChange={(e) => setTrackingId(e.target.value)}
                  className="min-h-[44px] w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#44403C] mb-1">
                  {t('seller.trackingUrl')}
                </label>
                <input
                  type="url"
                  required
                  value={trackingUrl}
                  onChange={(e) => setTrackingUrl(e.target.value)}
                  className="min-h-[44px] w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm"
                />
              </div>
              <button
                type="submit"
                className="min-h-[44px] w-full rounded-md bg-[#881337] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#9F1239] cursor-pointer"
              >
                {t('seller.shipTracking')}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Permanent Product Removal Confirmation / Active Order Block Modal */}
      {removeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto overscroll-contain rounded-lg border border-[#E8E6E1] bg-white p-5 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-[#F0EEE9] pb-3">
              <div className="flex items-center gap-2.5">
                <AlertTriangle
                  className={`h-5 w-5 shrink-0 ${
                    (removeTarget.activeOrderCount || 0) > 0 ? 'text-amber-700' : 'text-red-700'
                  }`}
                />
                <h3 className="font-display text-2xl font-semibold text-[#141413]">
                  {(removeTarget.activeOrderCount || 0) > 0
                    ? t('seller.removeBlockedTitle')
                    : t('seller.removeModalTitle')}
                </h3>
              </div>
              <button
                type="button"
                aria-label={t('detail.close')}
                onClick={() => setRemoveTarget(null)}
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-md hover:bg-[#FAF9F6] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {(removeTarget.activeOrderCount || 0) > 0 ? (
              <div className="space-y-4 text-xs leading-relaxed text-[#44403C]">
                <p>
                  {t('seller.removeBlockedDesc', {
                    title: removeTarget.title,
                    count: removeTarget.activeOrderCount || 0,
                  })}
                </p>
                <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setRemoveTarget(null)}
                    className="rounded-md border border-[#D6D3CD] px-4 py-2 text-xs font-medium text-[#141413] cursor-pointer"
                  >
                    {t('detail.close')}
                  </button>
                  {!removeTarget.isDiscontinued && (
                    <button
                      type="button"
                      disabled={controllingProdId === removeTarget._id}
                      onClick={() => handleProductControlAction(removeTarget, 'discontinue')}
                      className="inline-flex items-center gap-1.5 rounded-md bg-amber-700 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-800 cursor-pointer"
                    >
                      <Ban className="h-3.5 w-3.5" />
                      <span>{t('seller.btnDiscontinueInstead')}</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4 text-xs leading-relaxed text-[#44403C]">
                <p>{t('seller.removeModalDesc', { title: removeTarget.title })}</p>
                <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setRemoveTarget(null)}
                    className="rounded-md border border-[#D6D3CD] px-4 py-2 text-xs font-medium text-[#141413] cursor-pointer"
                  >
                    {t('detail.close')}
                  </button>
                  <button
                    type="button"
                    disabled={removingProduct}
                    onClick={() => handleConfirmRemoveProduct(removeTarget)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>
                      {removingProduct ? t('seller.removingBtn') : t('seller.removeConfirmCta')}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* New Myntra-Style Product Listing Modal with WebP Compression (<120KB) */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl max-h-[90dvh] overflow-y-auto overscroll-contain rounded-lg border border-[#E8E6E1] bg-white p-4 sm:p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-[#F0EEE9] pb-3">
              <div>
                <h3 className="font-display text-2xl font-semibold text-[#141413]">
                  {t('seller.addListing')}
                </h3>
                <p className="text-xs text-[#6B6A65]">{t('seller.webpHint')}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                aria-label={t('detail.close')}
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-md hover:bg-[#FAF9F6] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {createError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateProduct} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-medium text-[#44403C] mb-1">
                    {t('seller.formTitle')}
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={t('seller.formTitlePlaceholder')}
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#44403C] mb-1">
                    {t('seller.formSku')}
                  </label>
                  <input
                    type="text"
                    required
                    value={newSku}
                    onChange={(e) => setNewSku(e.target.value)}
                    className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="block font-medium text-[#44403C] mb-1">
                    {t('filter.category')}
                  </label>
                  <select
                    value={newCat}
                    onChange={(e) => setNewCat(e.target.value as ProductCategory)}
                    className="w-full rounded-md border border-[#D6D3CD] px-2.5 py-2 text-xs bg-white"
                  >
                    {(categories.length > 0
                      ? categories
                      : [
                          { _id: '1', name: 'Artificial Jewellery' },
                          { _id: '2', name: 'Clothing' },
                          { _id: '3', name: 'Accessories' },
                        ]
                    ).map((cat) => (
                      <option key={cat._id} value={cat.name}>
                        {tc(cat.name)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-[#44403C] mb-1">
                    {t('seller.formSubCat')}
                  </label>
                  <input
                    type="text"
                    required
                    value={newSubCat}
                    onChange={(e) => setNewSubCat(e.target.value)}
                    className="w-full rounded-md border border-[#D6D3CD] px-2.5 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#44403C] mb-1">
                    {t('seller.formBasePrice')}
                  </label>
                  <input
                    type="number"
                    required
                    min={99}
                    value={newBasePrice}
                    onChange={(e) => setNewBasePrice(Number(e.target.value))}
                    className="w-full rounded-md border border-[#D6D3CD] px-2.5 py-2 text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#44403C] mb-1">
                    {t('seller.formDiscount')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={90}
                    value={newDiscount}
                    onChange={(e) => setNewDiscount(Number(e.target.value))}
                    className="w-full rounded-md border border-[#D6D3CD] px-2.5 py-2 text-xs tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-[#44403C] mb-1">
                  {t('seller.formDesc')}
                </label>
                <textarea
                  rows={2}
                  required
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  className="w-full rounded-md border border-[#D6D3CD] p-2.5 text-xs"
                />
              </div>

              <div>
                <label className="block font-medium text-[#44403C] mb-1.5">
                  {t('detail.occasionsLabel')}
                </label>
                <div className="flex flex-wrap gap-2">
                  {OCCASIONS.map((occ) => {
                    const active = newOccasions.includes(occ);
                    return (
                      <button
                        key={occ}
                        type="button"
                        onClick={() =>
                          setNewOccasions((prev) =>
                            prev.includes(occ)
                              ? prev.length > 1
                                ? prev.filter((x) => x !== occ)
                                : prev
                              : [...prev, occ]
                          )
                        }
                        className={`rounded-md border px-2.5 py-1 text-xs cursor-pointer ${
                          active
                            ? 'border-[#881337] bg-[#881337] text-white'
                            : 'border-[#D6D3CD] text-[#57534E]'
                        }`}
                      >
                        {to(occ)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block font-medium text-[#44403C] mb-1.5">
                  {t('seller.seasonsLabel')}
                </label>
                <div className="flex flex-wrap gap-2">
                  {SEASONS.map((ssn) => {
                    const active = newSeasons.includes(ssn);
                    return (
                      <button
                        key={ssn}
                        type="button"
                        onClick={() =>
                          setNewSeasons((prev) =>
                            prev.includes(ssn)
                              ? prev.filter((x) => x !== ssn)
                              : [...prev, ssn]
                          )
                        }
                        className={`rounded-md border px-2.5 py-1 text-xs cursor-pointer ${
                          active
                            ? 'border-[#A16207] bg-[#A16207] text-white'
                            : 'border-[#D6D3CD] text-[#57534E]'
                        }`}
                      >
                        {tseason(ssn)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="block font-medium text-[#44403C] mb-1">
                    {t('seller.formColorName')}
                  </label>
                  <input
                    type="text"
                    value={newColorName}
                    onChange={(e) => setNewColorName(e.target.value)}
                    className="w-full rounded-md border border-[#D6D3CD] px-2.5 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#44403C] mb-1">
                    {t('seller.formSwatchHex')}
                  </label>
                  <input
                    type="color"
                    value={newColorHex}
                    onChange={(e) => setNewColorHex(e.target.value)}
                    className="h-8 w-full rounded border border-[#D6D3CD] p-0.5"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#44403C] mb-1">
                    {t('seller.formSizes')}
                  </label>
                  <input
                    type="text"
                    value={newSizes}
                    onChange={(e) => setNewSizes(e.target.value)}
                    className="w-full rounded-md border border-[#D6D3CD] px-2.5 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#44403C] mb-1">
                    {t('seller.formTotalStock')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={newStock}
                    onChange={(e) => setNewStock(Number(e.target.value))}
                    className="w-full rounded-md border border-[#D6D3CD] px-2.5 py-2 text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#44403C] mb-1">Shipping weight (grams per item)</label>
                  <input type="number" min={1} max={100000} value={newShippingWeightGrams} onChange={(e)=>setNewShippingWeightGrams(Number(e.target.value))} className="w-full rounded-md border border-[#D6D3CD] px-2.5 py-2 text-xs tabular-nums"/>
                  <p className="mt-1 text-[10px] text-[#78716C]">Used to estimate courier rates; include protective packaging.</p>
                </div>
              </div>

              {newCat === 'Artificial Jewellery' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 border-t border-[#F0EEE9] pt-3">
                  <input
                    type="text"
                    placeholder={t('detail.baseMetal')}
                    value={baseMetal}
                    onChange={(e) => setBaseMetal(e.target.value)}
                    className="rounded-md border border-[#D6D3CD] px-2.5 py-2 text-xs"
                  />
                  <input
                    type="text"
                    placeholder={t('detail.plating')}
                    value={plating}
                    onChange={(e) => setPlating(e.target.value)}
                    className="rounded-md border border-[#D6D3CD] px-2.5 py-2 text-xs"
                  />
                  <input
                    type="text"
                    placeholder={t('detail.stoneType')}
                    value={stoneType}
                    onChange={(e) => setStoneType(e.target.value)}
                    className="rounded-md border border-[#D6D3CD] px-2.5 py-2 text-xs"
                  />
                  <input
                    type="number"
                    placeholder={t('detail.weight')}
                    value={weightGrams}
                    onChange={(e) => setWeightGrams(Number(e.target.value))}
                    className="rounded-md border border-[#D6D3CD] px-2.5 py-2 text-xs tabular-nums"
                  />
                </div>
              )}

              {newCat === 'Clothing' && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-[#F0EEE9] pt-3">
                  <input
                    type="text"
                    placeholder={t('detail.fabric')}
                    value={fabric}
                    onChange={(e) => setFabric(e.target.value)}
                    className="rounded-md border border-[#D6D3CD] px-2.5 py-2 text-xs"
                  />
                  <input
                    type="text"
                    placeholder={t('detail.fit')}
                    value={fit}
                    onChange={(e) => setFit(e.target.value)}
                    className="rounded-md border border-[#D6D3CD] px-2.5 py-2 text-xs"
                  />
                  <input
                    type="text"
                    placeholder={t('detail.pattern')}
                    value={pattern}
                    onChange={(e) => setPattern(e.target.value)}
                    className="rounded-md border border-[#D6D3CD] px-2.5 py-2 text-xs"
                  />
                </div>
              )}

              <div className="rounded-lg border border-[#E8E6E1] bg-[#FAF9F6] p-4 space-y-3">
                <div className="font-semibold text-[#292524]">Customer visibility</div>
                <div className="flex flex-wrap gap-4 text-xs">
                  <label className="inline-flex items-center gap-2"><input type="radio" checked={newVisibility === 'PUBLIC'} onChange={() => setNewVisibility('PUBLIC')} /> Public / All customers</label>
                  <label className="inline-flex items-center gap-2"><input type="radio" checked={newVisibility === 'ASSIGNED'} onChange={() => setNewVisibility('ASSIGNED')} /> Assign to specific customers</label>
                </div>
                {newVisibility === 'ASSIGNED' && <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-[#57534E]">{newAssignedCustomers.length} selected</span>
                  <button type="button" onClick={() => setShowCustomerSearch(true)} className="rounded-md border border-[#D6D3CD] bg-white px-3 py-2 text-xs font-semibold">Choose customers</button>
                </div>}
                <div className="border-t border-[#E8E6E1] pt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={newOnlineRequired} onChange={(e) => setNewOnlineRequired(e.target.checked)} /> Online payment required</label>
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={newCodAllowed} onChange={(e) => setNewCodAllowed(e.target.checked)} /> Cash on delivery allowed</label>
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={newReturnable} onChange={(e) => setNewReturnable(e.target.checked)} /> Returnable product</label>
                  {newReturnable && <label className="flex items-center gap-2 text-xs">Return window
                    <input type="number" min={1} max={90} value={newReturnWindow} onChange={(e) => setNewReturnWindow(Number(e.target.value))} className="w-16 rounded border border-[#D6D3CD] px-2 py-1" /> days
                  </label>}
                </div>
              </div>

              <div className="border-t border-[#F0EEE9] pt-3 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-2 rounded-md border border-[#D6D3CD] px-3 py-2 text-xs font-medium text-[#141413] hover:border-[#881337] cursor-pointer">
                    <Upload className="h-3.5 w-3.5" />
                    <span>
                      {uploadingImg ? t('seller.uploadingWebp') : t('seller.uploadWebpMulti')}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleImageFileChange}
                      className="hidden"
                    />
                  </label>

                  <div className="flex flex-1 min-w-[200px] items-center gap-1.5">
                    <input
                      type="url"
                      placeholder={t('seller.imageUrlPlaceholder')}
                      value={newImageUrlInput}
                      onChange={(e) => setNewImageUrlInput(e.target.value)}
                      className="flex-1 rounded-md border border-[#D6D3CD] px-2.5 py-2 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const clean = newImageUrlInput.trim();
                        if (!clean) return;
                        setUploadedImages((prev) => [
                          ...prev,
                          { url: clean, thumbUrl: clean, byteSize: 0, storage: 'url' },
                        ]);
                        setNewImageUrlInput('');
                      }}
                      className="rounded-md border border-[#D6D3CD] bg-[#FAF9F6] px-3 py-2 text-xs font-medium text-[#141413] hover:border-[#141413] whitespace-nowrap cursor-pointer"
                    >
                      {t('seller.addUrlBtn')}
                    </button>
                  </div>
                </div>

                {uploadedImages.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {uploadedImages.map((u, i) => (
                      <div
                        key={`${u.url}-${i}`}
                        className="flex items-center justify-between gap-2 rounded border border-[#E8E6E1] p-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <img
                            src={u.thumbUrl}
                            alt={`Product ${i + 1}`}
                            className="h-11 w-11 shrink-0 rounded object-cover border border-[#E8E6E1]"
                          />
                          <div className="min-w-0">
                            <div className="text-[11px] font-semibold text-[#141413]">
                              {i === 0 ? t('seller.primaryLabel') : `#${i + 1}`}
                            </div>
                            <div className="text-[10px] font-mono text-[#6B6A65] truncate">
                              {u.byteSize > 0
                                ? `${(u.byteSize / 1024).toFixed(1)} KB WebP (${u.storage})`
                                : u.url}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {i > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                setUploadedImages((prev) => {
                                  const next = [...prev];
                                  const [picked] = next.splice(i, 1);
                                  return [picked, ...next];
                                })
                              }
                              className="rounded border border-[#D6D3CD] px-2 py-1 text-[10px] font-medium text-[#141413] hover:border-[#881337] cursor-pointer"
                            >
                              {t('seller.setPrimary')}
                            </button>
                          )}
                          <button
                            type="button"
                            aria-label={t('detail.close')}
                            onClick={() =>
                              setUploadedImages((prev) => prev.filter((_, idx) => idx !== i))
                            }
                            className="rounded p-1 text-[#78716C] hover:text-red-700 cursor-pointer"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={creatingProduct}
                className="w-full rounded-md bg-[#881337] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#9F1239] cursor-pointer"
              >
                {creatingProduct ? t('seller.saving') : t('seller.addListing')}
              </button>
            </form>
          </div>
        </div>
      )}

      <CustomerSearchModal
        open={showCustomerSearch}
        selected={newAssignedCustomers}
        onClose={() => setShowCustomerSearch(false)}
        onChange={setNewAssignedCustomers}
      />

      {/* Existing Product Multi-Image Manager Modal */}
      {editImagesTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-xl max-h-[90dvh] overflow-y-auto overscroll-contain rounded-lg border border-[#E8E6E1] bg-white p-4 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-[#F0EEE9] pb-3">
              <div className="min-w-0">
                <h3 className="font-display text-2xl font-semibold text-[#141413]">
                  {t('seller.imagesModalTitle')}
                </h3>
                <p className="text-xs text-[#6B6A65] truncate max-w-sm">
                  {editImagesTarget.title}
                </p>
              </div>
              <button
                type="button"
                aria-label={t('detail.close')}
                onClick={() => setEditImagesTarget(null)}
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-md hover:bg-[#FAF9F6] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveProductImages} className="space-y-4 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-2 rounded-md border border-[#D6D3CD] px-3 py-2 font-medium text-[#141413] hover:border-[#881337] cursor-pointer">
                  <Upload className="h-3.5 w-3.5" />
                  <span>
                    {uploadingImg ? t('seller.uploadingWebp') : t('seller.uploadWebpMulti')}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleEditImagesFileChange}
                    className="hidden"
                  />
                </label>

                <div className="flex flex-1 min-w-[200px] items-center gap-1.5">
                  <input
                    type="url"
                    placeholder={t('seller.imageUrlPlaceholder')}
                    value={editImageUrlInput}
                    onChange={(e) => setEditImageUrlInput(e.target.value)}
                    className="flex-1 rounded-md border border-[#D6D3CD] px-2.5 py-2 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const clean = editImageUrlInput.trim();
                      if (!clean) return;
                      setEditImagesList((prev) => [
                        ...prev,
                        {
                          url: clean,
                          thumbUrl: clean,
                          altText: editImagesTarget.title,
                          sortOrder: prev.length,
                        },
                      ]);
                      setEditImageUrlInput('');
                    }}
                    className="rounded-md border border-[#D6D3CD] bg-[#FAF9F6] px-3 py-2 font-medium text-[#141413] hover:border-[#141413] whitespace-nowrap cursor-pointer"
                  >
                    {t('seller.addUrlBtn')}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[340px] overflow-y-auto">
                {editImagesList.map((img, i) => (
                  <div
                    key={`${img.url}-${i}`}
                    className="flex items-center justify-between gap-2 rounded border border-[#E8E6E1] p-2"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <img
                        src={img.thumbUrl || img.url}
                        alt={img.altText || editImagesTarget.title}
                        referrerPolicy="no-referrer"
                        className="h-12 w-12 shrink-0 rounded object-cover border border-[#E8E6E1]"
                      />
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-[#141413]">
                          {i === 0 ? t('seller.primaryLabel') : `#${i + 1}`}
                        </div>
                        <div className="text-[10px] font-mono text-[#6B6A65] truncate max-w-[140px]">
                          {img.url}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {i > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setEditImagesList((prev) => {
                              const next = [...prev];
                              const [picked] = next.splice(i, 1);
                              return [picked, ...next];
                            })
                          }
                          className="rounded border border-[#D6D3CD] px-2 py-1 text-[10px] font-medium text-[#141413] hover:border-[#881337] cursor-pointer"
                        >
                          {t('seller.setPrimary')}
                        </button>
                      )}
                      {editImagesList.length > 1 && (
                        <button
                          type="button"
                          aria-label={t('detail.close')}
                          onClick={() =>
                            setEditImagesList((prev) => prev.filter((_, idx) => idx !== i))
                          }
                          className="rounded p-1 text-[#78716C] hover:text-red-700 cursor-pointer"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="submit"
                disabled={savingImages || editImagesList.length === 0}
                className="w-full rounded-md bg-[#881337] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#9F1239] disabled:opacity-50 cursor-pointer"
              >
                {savingImages ? t('seller.saving') : t('seller.saveImages')}
              </button>
            </form>
          </div>
        </div>
      )}
        </div>
      </main>
    </div>
  );
}
