import { useCallback, useEffect, useState } from 'react';
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
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Link2,
  Lock,
  Mail,
  Plus,
  RefreshCw,
  ShieldCheck,
  Truck,
  Upload,
  X,
} from 'lucide-react';
import type {
  CartItem,
  OccasionType,
  Order,
  OrderListResponse,
  OrderStatus,
  OrderTab,
  Product,
  ProductCategory,
  ProductListResponse,
  ReviewClass,
  SellerAnalyticsResponse,
  SellerInvite,
  TimeGranularity,
  User,
} from '../shared/types';
import { apiFetch, compressAndUploadImage, formatINR } from '../lib/api';
import { useI18n } from '../lib/i18n';

const OCCASIONS: OccasionType[] = [
  'Wedding',
  'Festive',
  'Party',
  'Office Wear',
  'Casual',
  'Daily Wear',
];

const REVIEW_CLASSES: ReviewClass[] = [
  'Quality',
  'Finish & Shine',
  'Value for Money',
  'Fit & Sizing',
  'Packaging',
];

type SellerTab = 'invites' | 'analytics' | 'catalog' | 'orders';

interface AdminInviteRow extends SellerInvite {
  inviteUrl: string;
}

interface ValidatedInviteInfo {
  _id: string;
  email: string;
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
}: SellerHubViewProps) {
  const { t, tc, to, tr, ts, totab, locale } = useI18n();
  const isAdmin = user?.role === 'ADMIN';
  const [sellerTab, setSellerTab] = useState<SellerTab>(isAdmin ? 'invites' : 'analytics');

  useEffect(() => {
    if (user?.role === 'ADMIN') {
      setSellerTab('invites');
    } else if (sellerTab === 'invites') {
      setSellerTab('analytics');
    }
  }, [user?.role]);

  // Invited Seller Onboarding state (strictly requires Admin-issued ?sellerInvite=<token>)
  const [inviteCheckLoading, setInviteCheckLoading] = useState(false);
  const [validatedInvite, setValidatedInvite] = useState<ValidatedInviteInfo | null>(null);
  const [inviteInvalid, setInviteInvalid] = useState(false);
  const [sellerFullName, setSellerFullName] = useState('');
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
    mailtoUrl: string;
  } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Analytics state
  const [granularity, setGranularity] = useState<TimeGranularity>('month');
  const [analytics, setAnalytics] = useState<SellerAnalyticsResponse | null>(null);
  const [cronNotice, setCronNotice] = useState<string | null>(null);

  // Seller Catalog & Dynamic Offers state
  const [catalogSearch, setCatalogSearch] = useState('');
  const [sellerProducts, setSellerProducts] = useState<Product[]>([]);
  const [discountEdits, setDiscountEdits] = useState<
    Record<string, { discount: number; stock: number }>
  >({});
  const [savingProdId, setSavingProdId] = useState<string | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);

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
  const [newOccasions, setNewOccasions] = useState<OccasionType[]>(['Festive', 'Wedding']);
  const [newColorName, setNewColorName] = useState('Antique Gold');
  const [newColorHex, setNewColorHex] = useState('#A16207');
  const [newSizes, setNewSizes] = useState('Free Size');
  const [uploadedImages, setUploadedImages] = useState<
    Array<{ url: string; thumbUrl: string; byteSize: number; storage: string }>
  >([]);
  const [uploadingImg, setUploadingImg] = useState(false);
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
  }, [inviteToken, isVerifiedSellerOrAdmin, user?.name]);

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
    const data = await apiFetch<SellerAnalyticsResponse>(
      `/api/seller/analytics?granularity=${granularity}`
    );
    setAnalytics(data);
  }, [isVerifiedSellerOrAdmin, granularity]);

  const loadSellerCatalog = useCallback(async () => {
    if (!isVerifiedSellerOrAdmin || !user) return;
    const params = new URLSearchParams({
      sort: 'newly_added',
      page: '1',
      ...(user.role === 'SELLER' ? { sellerId: user._id } : {}),
      ...(catalogSearch.trim() ? { q: catalogSearch.trim() } : {}),
    });
    const res = await apiFetch<ProductListResponse>(`/api/products?${params}`);
    setSellerProducts(res.products);
    const edits: Record<string, { discount: number; stock: number }> = {};
    for (const p of res.products) {
      edits[p._id] = { discount: p.discountPercent, stock: p.totalStock };
    }
    setDiscountEdits(edits);
  }, [isVerifiedSellerOrAdmin, user, catalogSearch]);

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
    }
  }, [isVerifiedSellerOrAdmin, loadAnalytics, loadSellerCatalog]);

  useEffect(() => {
    if (isAdmin && sellerTab === 'invites') {
      loadAdminInvites();
    }
  }, [isAdmin, sellerTab, loadAdminInvites]);

  useEffect(() => {
    if (isVerifiedSellerOrAdmin && sellerTab === 'orders') {
      loadSellerOrders(orderTab, 0, false);
    }
  }, [isVerifiedSellerOrAdmin, sellerTab, orderTab, loadSellerOrders]);

  // --- Invite Link Redemption Screen (ONLY when opened with ?sellerInvite=<token>) ---
  if (!isVerifiedSellerOrAdmin && inviteToken) {
    if (inviteCheckLoading) {
      return (
        <section className="mx-auto max-w-lg px-4 py-16 text-center text-sm text-[#6B6A65]">
          {t('detail.loadingProduct')}
        </section>
      );
    }

    if (inviteInvalid || !validatedInvite) {
      return (
        <section className="mx-auto max-w-lg px-4 py-14">
          <div className="rounded-lg border border-[#E8E6E1] bg-white p-8 text-center space-y-4">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#FAF9F6] text-[#881337]">
              <Lock className="h-5 w-5" />
            </div>
            <h1 className="font-display text-3xl font-semibold text-[#141413]">
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
              className="rounded-md bg-[#141413] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#292524] cursor-pointer"
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
          likedProductIds: string[];
          cart: CartItem[];
        }>('/api/seller/invites/accept', {
          method: 'POST',
          body: JSON.stringify({
            inviteToken,
            name: sellerFullName.trim(),
            whatsappNumber: waNumber.trim(),
            otpCode: otpCode.trim(),
            storeName: storeName.trim(),
            description: storeDesc.trim() || 'Handcrafted jewellery and apparel atelier.',
          }),
        });
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
              {t('seller.invitedTitle')}
            </div>
            <h1 className="mt-1 font-display text-3xl font-semibold text-[#141413]">
              {validatedInvite.storeName || validatedInvite.email}
            </h1>
            <p className="mt-1 text-xs leading-relaxed text-[#6B6A65]">
              {t('seller.invitedSub', {
                admin: validatedInvite.invitedByName,
                email: validatedInvite.email,
              })}
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
      <section className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-16 text-center">
        <div className="mx-auto max-w-md rounded-lg border border-[#E8E6E1] bg-white p-8 space-y-4">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#FAF9F6] text-[#881337]">
            <Lock className="h-5 w-5" />
          </div>
          <h1 className="font-display text-3xl font-semibold text-[#141413]">
            {t('seller.title')}
          </h1>
          <p className="text-sm leading-relaxed text-[#6B6A65]">{t('seller.guestDesc')}</p>
          <button
            type="button"
            onClick={onOpenAuth}
            className="rounded-md bg-[#881337] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#9F1239] cursor-pointer"
          >
            {t('seller.signInCta')}
          </button>
        </div>
      </section>
    );
  }

  if (!isVerifiedSellerOrAdmin) {
    return (
      <section className="mx-auto max-w-lg px-4 py-14">
        <div className="rounded-lg border border-[#E8E6E1] bg-white p-8 text-center space-y-4">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#FAF9F6] text-[#881337]">
            <Lock className="h-5 w-5" />
          </div>
          <h1 className="font-display text-3xl font-semibold text-[#141413]">
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
                className="rounded-md bg-[#141413] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#292524] cursor-pointer"
              >
                {t('seller.backToStore')}
              </button>
            )}
            <button
              type="button"
              onClick={onOpenAuth}
              className="rounded-md border border-[#D6D3CD] bg-white px-4 py-2.5 text-xs font-medium text-[#141413] hover:border-[#881337] cursor-pointer"
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
      const res = await apiFetch<{ invite: AdminInviteRow; mailtoUrl: string }>(
        '/api/admin/seller-invites',
        {
          method: 'POST',
          body: JSON.stringify({
            email: inviteEmail.trim(),
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
      `Hello,\n\nYou have been invited by ${inv.invitedByName} (Kala & Karat Admin) to onboard your atelier${inv.storeName ? ` (${inv.storeName})` : ''} on Kala & Karat.\n\nOpen your private onboarding link:\n${inv.inviteUrl}\n\n${inv.note ? `Admin note: ${inv.note}\n\n` : ''}Expires: ${new Date(inv.expiresAt).toLocaleDateString('en-IN')}`
    );
    return `mailto:${encodeURIComponent(inv.email)}?subject=${subject}&body=${body}`;
  };

  // --- Seller Catalog & Order Handlers ---
  const handleSaveInlineOffer = async (productId: string) => {
    const edit = discountEdits[productId];
    if (!edit) return;
    setSavingProdId(productId);
    try {
      await apiFetch(`/api/products/${productId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          discountPercent: edit.discount,
          totalStock: edit.stock,
        }),
      });
      await loadSellerCatalog();
      onCatalogMutated();
    } finally {
      setSavingProdId(null);
    }
  };

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImg(true);
    setCreateError(null);
    try {
      const uploaded = await compressAndUploadImage(file);
      setUploadedImages((prev) => [...prev, uploaded]);
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setUploadingImg(false);
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
          images: imgs,
          occasions: newOccasions,
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

  const handleOrderStatusChange = async (
    order: Order,
    status: OrderStatus,
    tracking?: { companyName: string; trackingId: string; trackingUrl: string }
  ) => {
    const res = await apiFetch<{ order: Order }>(`/api/orders/${order._id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, courierTracking: tracking }),
    });
    setSellerOrders((prev) => prev.map((o) => (o._id === order._id ? res.order : o)));
    setShipOrderTarget(null);
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
    ...(isAdmin ? [{ id: 'invites' as const, label: t('admin.invitesTab') }] : []),
    { id: 'analytics', label: t('seller.tabAnalytics') },
    { id: 'catalog', label: t('seller.tabCatalog') },
    { id: 'orders', label: t('seller.tabOrders') },
  ];

  return (
    <main className="mx-auto max-w-[1320px] px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      {/* Top Seller / Admin Breadcrumb & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#E8E6E1] pb-6">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#6B6A65]">
            <span>{t('nav.sellerHub')}</span>
            <span>/</span>
            <span className="font-medium text-[#141413]">
              {user.sellerProfile?.storeName || user.name}
            </span>
            {user.whatsappNumber && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {t('seller.waVerified')} ({user.whatsappNumber})
                </span>
              </>
            )}
          </div>
          <h1 className="mt-1 font-display text-3xl font-semibold text-[#141413]">
            {isAdmin ? t('seller.adminPerfTitle') : t('seller.perfTitle')}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          <div className="inline-flex max-w-full overflow-x-auto items-center gap-1 rounded-lg bg-[#F0EEE9] p-1">
            {tabOptions.map((tabItem) => (
              <button
                key={tabItem.id}
                type="button"
                onClick={() => setSellerTab(tabItem.id)}
                className={`rounded-md px-3 sm:px-3.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                  sellerTab === tabItem.id
                    ? 'bg-white text-[#141413] shadow-xs'
                    : 'text-[#57534E] hover:text-[#141413]'
                }`}
              >
                {tabItem.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleRunTrendingCron}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#D6D3CD] bg-white px-3.5 py-2 text-xs font-medium text-[#141413] hover:border-[#881337] whitespace-nowrap cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>{t('seller.syncTrending')}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSellerTab('catalog');
              setShowNewModal(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#881337] px-4 py-2 text-xs font-semibold text-white hover:bg-[#9F1239] whitespace-nowrap cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{t('seller.addListing')}</span>
          </button>
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
                  {t('admin.inviteEmail')}
                </label>
                <input
                  type="email"
                  required
                  placeholder="artisan@atelier.in"
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

              <button
                type="submit"
                disabled={creatingInvite}
                className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-[#881337] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#9F1239] cursor-pointer"
              >
                <Link2 className="h-3.5 w-3.5" />
                <span>
                  {creatingInvite ? t('admin.creatingInvite') : t('admin.createInviteCta')}
                </span>
              </button>
            </form>

            {latestCreatedInvite && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50/70 p-4 space-y-3 text-xs">
                <div className="font-semibold text-emerald-900">
                  {t('admin.inviteReadyNotice', { email: latestCreatedInvite.invite.email })}
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
                  <a
                    href={latestCreatedInvite.mailtoUrl}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#141413] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#292524]"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    <span>{t('admin.sendEmail')}</span>
                  </a>
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
                      <td className="px-4 py-3 font-medium text-[#141413]">{inv.email}</td>
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
                      <td className="px-4 py-3 text-right">
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
                            <a
                              href={buildMailtoForInvite(inv)}
                              className="inline-flex items-center gap-1 rounded border border-[#D6D3CD] px-2 py-1 text-[11px] font-medium text-[#141413] hover:border-[#881337]"
                            >
                              <Mail className="h-3 w-3" />
                              <span>{t('admin.sendEmail')}</span>
                            </a>
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
        <div className="space-y-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="rounded-lg border border-[#E8E6E1] bg-white p-4 sm:p-5">
              <div className="text-xs text-[#6B6A65]">{t('seller.kpiRevenue')}</div>
              <div className="mt-1 text-xl sm:text-2xl font-semibold text-[#141413] tabular-nums">
                {formatINR(analytics.overview.totalRevenue)}
              </div>
              <div className="mt-1 text-[11px] text-[#6B6A65] tabular-nums">
                {analytics.overview.totalOrders} {t('orders.colOrders')}
              </div>
            </div>
            <div className="rounded-lg border border-[#E8E6E1] bg-white p-5">
              <div className="text-xs text-[#6B6A65]">{t('seller.kpiViews')}</div>
              <div className="mt-1 text-2xl font-semibold text-[#141413] tabular-nums">
                {analytics.overview.totalViews.toLocaleString()}
              </div>
              <div className="mt-1 text-[11px] text-[#6B6A65] tabular-nums">
                {analytics.overview.totalLikes.toLocaleString()} {t('card.likes')} ·{' '}
                {analytics.overview.totalCartAdds}
              </div>
            </div>
            <div className="rounded-lg border border-[#E8E6E1] bg-white p-5">
              <div className="text-xs text-[#6B6A65]">{t('seller.kpiConv')}</div>
              <div className="mt-1 text-2xl font-semibold text-[#141413] tabular-nums">
                {analytics.overview.conversionRate}%
              </div>
            </div>
            <div className="rounded-lg border border-[#E8E6E1] bg-white p-5">
              <div className="text-xs text-[#6B6A65]">{t('seller.kpiTrust')}</div>
              <div className="mt-1 text-2xl font-semibold text-[#141413] tabular-nums">
                {analytics.overview.trustScore.toFixed(1)} / 5.0
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 rounded-lg border border-[#E8E6E1] bg-white p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-xl font-semibold text-[#141413]">
                    {t('seller.revTrend')}
                  </h2>
                  <p className="text-xs text-[#6B6A65]">{t('orders.aggDesc')}</p>
                </div>
                <div className="inline-flex items-center gap-1 rounded-md bg-[#F0EEE9] p-1">
                  {(
                    [
                      { id: 'day', label: t('orders.granDay') },
                      { id: 'week', label: t('orders.granWeek') },
                      { id: 'month', label: t('orders.granMonth') },
                      { id: 'year', label: t('orders.granYear') },
                    ] as const
                  ).map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setGranularity(g.id)}
                      className={`rounded px-2.5 py-1 text-[11px] font-medium cursor-pointer ${
                        granularity === g.id
                          ? 'bg-white text-[#141413] shadow-xs'
                          : 'text-[#57534E]'
                      }`}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics.timeSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F0EEE9" />
                    <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#6B6A65' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#6B6A65' }} />
                    <Tooltip
                      formatter={(val: any) => [formatINR(Number(val)), 'Revenue']}
                      contentStyle={{ fontSize: '12px', borderRadius: '6px' }}
                    />
                    <Bar dataKey="revenue" fill="#881337" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="lg:col-span-5 rounded-lg border border-[#E8E6E1] bg-white p-6 space-y-4">
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
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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

          <div className="rounded-lg border border-[#E8E6E1] bg-white overflow-hidden">
            <div className="border-b border-[#E8E6E1] px-6 py-4">
              <h3 className="font-display text-xl font-semibold text-[#141413]">
                {t('seller.prodBreakdown')}
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-left text-xs">
                <thead className="bg-[#FAF9F6] border-b border-[#E8E6E1] text-[#6B6A65]">
                  <tr>
                    <th className="px-5 py-3 font-medium">{t('seller.colProduct')}</th>
                    <th className="px-4 py-3 font-medium text-right">{t('seller.colViews')}</th>
                    <th className="px-4 py-3 font-medium text-right">{t('card.likes')}</th>
                    <th className="px-4 py-3 font-medium text-right">{t('seller.colBag')}</th>
                    <th className="px-4 py-3 font-medium text-right">{t('seller.colSales')}</th>
                    <th className="px-4 py-3 font-medium text-right">{t('seller.colConv')}</th>
                    <th className="px-5 py-3 font-medium text-right">{t('seller.kpiRevenue')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0EEE9] tabular-nums">
                  {analytics.topProducts.map((tp) => (
                    <tr key={tp._id} className="hover:bg-[#FAF9F6]">
                      <td className="px-5 py-3 font-medium text-[#141413] max-w-[260px] truncate">
                        {tp.title}
                      </td>
                      <td className="px-4 py-3 text-right">{tp.viewsCount.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right">{tp.likesCount}</td>
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

      {/* TAB 2: CATALOG & INLINE DYNAMIC OFFERS */}
      {sellerTab === 'catalog' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <input
              type="search"
              value={catalogSearch}
              onChange={(e) => setCatalogSearch(e.target.value)}
              placeholder={t('seller.searchCatalog')}
              className="w-full max-w-md rounded-md border border-[#D6D3CD] bg-white px-3.5 py-2 text-xs focus:border-[#881337] focus:outline-none"
            />
            <span className="text-xs text-[#6B6A65] tabular-nums">
              {t('seller.listedPieces', { count: sellerProducts.length })}
            </span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-[#E8E6E1] bg-white">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="border-b border-[#E8E6E1] bg-[#FAF9F6] text-[#6B6A65]">
                <tr>
                  <th className="px-4 py-3 font-medium">{t('seller.colPiece')}</th>
                  <th className="px-4 py-3 font-medium">{t('seller.colBase')}</th>
                  <th className="px-4 py-3 font-medium">{t('seller.colSale')}</th>
                  <th className="px-4 py-3 font-medium">{t('seller.colDiscount')}</th>
                  <th className="px-4 py-3 font-medium">{t('seller.colStock')}</th>
                  <th className="px-4 py-3 font-medium text-right">{t('seller.colAction')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EEE9] tabular-nums">
                {sellerProducts.map((p) => {
                  const edit = discountEdits[p._id] || {
                    discount: p.discountPercent,
                    stock: p.totalStock,
                  };
                  const previewSale = Math.round(p.basePrice * (1 - edit.discount / 100));
                  return (
                    <tr key={p._id} className="hover:bg-[#FAF9F6]">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <img
                            src={p.images[0]?.url}
                            alt={p.title}
                            referrerPolicy="no-referrer"
                            className="h-10 w-10 rounded object-cover border border-[#E8E6E1]"
                          />
                          <div className="min-w-0">
                            <div className="font-semibold text-[#141413] truncate max-w-[240px]">
                              {p.title}
                            </div>
                            <div className="text-[11px] text-[#6B6A65]">
                              {tc(p.category)} · {p.occasions.map((o) => to(o)).join(', ')}
                            </div>
                          </div>
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
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          disabled={savingProdId === p._id}
                          onClick={() => handleSaveInlineOffer(p._id)}
                          className="rounded border border-[#881337] px-3 py-1 text-xs font-medium text-[#881337] hover:bg-[#881337] hover:text-white transition-colors cursor-pointer"
                        >
                          {savingProdId === p._id ? t('seller.saving') : t('seller.updateOffer')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: SELLER ORDERS & COURIER TRACKING */}
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

          <div className="space-y-3">
            {sellerOrders.map((ord) => (
              <div
                key={ord._id}
                className="rounded-lg border border-[#E8E6E1] bg-white p-5 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs">
                    <span className="font-mono font-semibold text-[#141413]">
                      {ord.orderNumber}
                    </span>
                    <span className="text-[#6B6A65]">
                      {' '}
                      · {ord.shippingAddress.fullName} ({ord.shippingAddress.city}) ·{' '}
                      <span className="font-semibold text-[#881337]">{ts(ord.status)}</span>
                    </span>
                  </div>
                  <div className="text-sm font-semibold tabular-nums">
                    {formatINR(ord.totalAmount)}
                  </div>
                </div>

                <div className="text-xs text-[#57534E]">
                  {ord.items.map((i) => `${i.title} (${i.size} · x${i.quantity})`).join(', ')}
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

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#F0EEE9]">
                  {ord.status === 'Pending' && (
                    <button
                      type="button"
                      onClick={() => handleOrderStatusChange(ord, 'Confirmed')}
                      className="rounded border border-[#D6D3CD] px-3 py-1 text-xs font-medium hover:border-[#141413] cursor-pointer"
                    >
                      {t('seller.confirmOrder')}
                    </button>
                  )}
                  {(ord.status === 'Pending' || ord.status === 'Confirmed') && (
                    <button
                      type="button"
                      onClick={() => handleOrderStatusChange(ord, 'Packed')}
                      className="rounded border border-[#D6D3CD] px-3 py-1 text-xs font-medium hover:border-[#141413] cursor-pointer"
                    >
                      {t('seller.markPacked')}
                    </button>
                  )}
                  {['Pending', 'Confirmed', 'Packed'].includes(ord.status) && (
                    <button
                      type="button"
                      onClick={() => {
                        setShipOrderTarget(ord);
                        setTrackingId(`TRK${Math.floor(100000 + Math.random() * 899999)}`);
                        setTrackingUrl('https://www.bluedart.com/tracking');
                      }}
                      className="inline-flex items-center gap-1.5 rounded bg-[#881337] px-3 py-1 text-xs font-medium text-white hover:bg-[#9F1239] cursor-pointer"
                    >
                      <Truck className="h-3.5 w-3.5" />
                      <span>{t('seller.shipTracking')}</span>
                    </button>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded-lg border border-[#E8E6E1] bg-white p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[#F0EEE9] pb-3">
              <h3 className="font-display text-2xl font-semibold text-[#141413]">
                {t('seller.shipTracking')}
              </h3>
              <button
                type="button"
                onClick={() => setShipOrderTarget(null)}
                className="p-1 cursor-pointer"
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
                  className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm"
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
                  className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm font-mono"
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
                  className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm"
                />
              </div>
              <button
                type="submit"
                className="w-full rounded-md bg-[#881337] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#9F1239] cursor-pointer"
              >
                {t('seller.shipTracking')}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* New Myntra-Style Product Listing Modal with WebP Compression (<120KB) */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-3 sm:p-4">
          <div className="mx-auto max-w-2xl rounded-lg border border-[#E8E6E1] bg-white p-4 sm:p-6 space-y-5 my-4 sm:my-6">
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
                className="p-1 cursor-pointer"
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
                    <option value="Artificial Jewellery">{tc('Artificial Jewellery')}</option>
                    <option value="Clothing">{tc('Clothing')}</option>
                    <option value="Accessories">{tc('Accessories')}</option>
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

              <div className="border-t border-[#F0EEE9] pt-3 space-y-2">
                <label className="inline-flex items-center gap-2 rounded-md border border-[#D6D3CD] px-3 py-2 text-xs font-medium text-[#141413] hover:border-[#881337] cursor-pointer">
                  <Upload className="h-3.5 w-3.5" />
                  <span>
                    {uploadingImg ? t('seller.uploadingWebp') : t('seller.uploadWebp')}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageFileChange}
                    className="hidden"
                  />
                </label>
                {uploadedImages.length > 0 && (
                  <div className="flex flex-wrap gap-3">
                    {uploadedImages.map((u, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 rounded border border-[#E8E6E1] p-1.5"
                      >
                        <img
                          src={u.thumbUrl}
                          alt="Uploaded"
                          className="h-10 w-10 rounded object-cover"
                        />
                        <span className="text-[11px] font-mono text-[#6B6A65]">
                          {(u.byteSize / 1024).toFixed(1)} KB WebP ({u.storage})
                        </span>
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
    </main>
  );
}
