import { useCallback, useEffect, useMemo, useState } from 'react';
import { INR_FROM_PAISE } from '@commerce/shared-utils';
import type { ProviderProductView } from '@commerce/shared-types';
import { StatusBadge } from '@commerce/shared-ui';
import { Package, RefreshCw, Upload, Wallet, Building2, AlertCircle, LogOut, Search, ChevronLeft, ChevronRight, ArrowUpDown, Truck } from 'lucide-react';

type Product = Omit<ProviderProductView, 'id'> & {
  _id: string;
  negotiationHistory?: Array<{ comment?: string; action?: string; targetPricePaise?: number }>;
};
type Settlement = {
  _id: string;
  orderId: string;
  amountPaise: number;
  quantity: number;
  status: string;
  utrReference?: string;
};
type Shipment = { id: string; orderNumber: string; status: string; createdAt: string; items: Array<{ productId: string; title: string; quantity: number }>; courierTracking?: { companyName: string; trackingId: string; trackingUrl?: string } | null; manualDispatchAllowed: boolean; appShipment?: { shipmentId: string; bookingStatus: string; awbNumber?: string; labelUrl?: string; manifestUrl?: string; pickupScheduled?: boolean; statusCode: number; estimatedDeliveryAt?: string; carrierName?: string; trackingEvents?: Array<{ statusCode: number; location?: string; occurredAt: string }> } | null };
type LogisticsProvider = { id: string; code: string; name: string; type: 'DIRECT' | 'AGGREGATOR'; auth_schema_json?: { fields?: Array<{ name: string; label: string; type?: string }> } };
type ProviderCarrier = { id: string; provider_id: string; is_active: boolean; logistics_providers?: { code: string; name: string; type: string } };
type ProviderWarehouse = { id: string; warehouse_code: string; name: string; city: string; state: string; postal_code: string; is_default: boolean };
type LinkedSeller = { id: string; name: string };
type Delegation = { sellerId: string; status: string; requestedCarrierCodes: string[]; allowedCarrierCodes: string[]; requestedDisclosureFields: string[]; allowedDisclosureFields: string[]; expiresAt?: string | null };
type CarrierRate = { providerCode: string; serviceCode: string; amountMinor: number; currency: string; estimatedTransitHours: number; serviceable: boolean; codSupported: boolean; expiresAt: string };
type ProviderReturn = { id:string; orderId:string; productId:string; quantity:number; reason:string; media:Array<{url:string}>; providerReviewStatus:string; providerDecisionNote?:string; providerPickupAddressShared:boolean; pickupAddress?:{fullName:string;phone:string;street:string;city:string;state:string;pincode:string}|null; providerReturnAddress?:{name:string;contactName:string;contactPhone:string;addressLine1:string;addressLine2?:string;city:string;state:string;postalCode:string}|null; returnPickup:{status:string;carrier?:string;trackingId?:string;trackingUrl?:string} };
type ProviderCancellation = { id:string; orderNumber:string; items:Array<{title:string;quantity:number}>; forwardedAt:string };

type ProviderProfile = {
  businessName?: string;
  contactPerson?: string;
  kycStatus?: string;
  linkedSellerCount?: number;
};
type Session = { role?: string; user?: { role?: string; name?: string; email?: string } };

let csrfToken = '';
const inputClass = 'w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 shadow-sm outline-none transition focus:border-rose-800 focus:ring-2 focus:ring-rose-800/15';
const labelClass = 'grid min-w-0 gap-1.5 text-xs font-medium text-stone-700';
const buttonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-rose-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-50';

async function api<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...(init.headers || {}),
    },
  });
  const data = await response.json();
  if (url === '/api/auth/me' && data.csrfToken) csrfToken = data.csrfToken;
  if (!response.ok) throw new Error(data.error || data.message || 'Request failed');
  return data as T;
}

const money = (paise: number) => INR_FROM_PAISE(paise);

export default function ProviderPortal() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token') || '', []);
  const [auth, setAuth] = useState<Session | null>(null);
  const [providerProfile, setProviderProfile] = useState<ProviderProfile | null>(null);
  const [invite, setInvite] = useState<any>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [providerReturns, setProviderReturns] = useState<ProviderReturn[]>([]);
  const [providerCancellations, setProviderCancellations] = useState<ProviderCancellation[]>([]);
  const [returnPickupDrafts, setReturnPickupDrafts] = useState<Record<string,{carrierName:string;trackingId:string;trackingUrl:string}>>({});
  const [shippingProviders, setShippingProviders] = useState<LogisticsProvider[]>([]);
  const [providerCarriers, setProviderCarriers] = useState<ProviderCarrier[]>([]);
  const [providerWarehouses, setProviderWarehouses] = useState<ProviderWarehouse[]>([]);
  const [linkedSellers, setLinkedSellers] = useState<LinkedSeller[]>([]);
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [carrierProviderId, setCarrierProviderId] = useState('');
  const [carrierCredentials, setCarrierCredentials] = useState<Record<string, string>>({});
  const [carrierWebhookSecret, setCarrierWebhookSecret] = useState('');
  const [carrierWebhookCode, setCarrierWebhookCode] = useState('');
  const [warehouseForm, setWarehouseForm] = useState({ warehouseCode: 'MAIN', name: 'Main pickup warehouse', contactName: '', contactPhone: '', addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '', countryCode: 'IN', isDefault: true });
  const [delegationSellerId, setDelegationSellerId] = useState('');
  const [delegationCarrierCodes, setDelegationCarrierCodes] = useState<string[]>([]);
  const [delegationFields, setDelegationFields] = useState<string[]>(['recipientName', 'recipientPhone', 'recipientAddress']);
  const [bookingOrderId, setBookingOrderId] = useState('');
  const [bookingRates, setBookingRates] = useState<CarrierRate[]>([]);
  const [bookingCarrierId, setBookingCarrierId] = useState('');
  const [bookingWarehouseId, setBookingWarehouseId] = useState('');
  const [bookingWeight, setBookingWeight] = useState('500');
  const [shippingSaving, setShippingSaving] = useState(false);
  const [productQuery, setProductQuery] = useState('');
  const [productStatus, setProductStatus] = useState('ALL');
  const [productSort, setProductSort] = useState('updatedAt');
  const [productDirection, setProductDirection] = useState<'asc' | 'desc'>('desc');
  const [productPage, setProductPage] = useState(1);
  const [productTotal, setProductTotal] = useState(0);
  const [settlementQuery, setSettlementQuery] = useState('');
  const [settlementStatus, setSettlementStatus] = useState('ALL');
  const [settlementSort, setSettlementSort] = useState('createdAt');
  const [settlementDirection, setSettlementDirection] = useState<'asc' | 'desc'>('desc');
  const [settlementPage, setSettlementPage] = useState(1);
  const [settlementTotal, setSettlementTotal] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [returnable, setReturnable] = useState(true);
  const [form, setForm] = useState({
    title: '', category: '', subCategory: '', description: '', brand: '',
    manufacturerName: '', manufacturingDate: '', sizeVariants: '', colorVariants: '',
    basePrice: '', imageUrls: '', returnWindowDays: '7', damageReplacementPolicy: '',
  });
  const [profile, setProfile] = useState({
    businessName: '', contactPerson: '', mobile: '', whatsapp: '',
    warehouseAddress: '', taxId: '', settlementDetails: '',
  });

  const role = auth?.role || auth?.user?.role;
  const logout = async () => {
    setLoggingOut(true);
    try {
      await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
      setAuth(null);
      window.location.assign('/?loggedOut=1');
    } catch (error) {
      setNotice((error as Error).message);
      setLoggingOut(false);
    }
  };
  const refresh = useCallback(async () => {
    try {
      const productParams = new URLSearchParams({ page: String(productPage), limit: '10', q: productQuery, status: productStatus, sort: productSort, direction: productDirection });
      const settlementParams = new URLSearchParams({ page: String(settlementPage), limit: '10', q: settlementQuery, status: settlementStatus, sort: settlementSort, direction: settlementDirection });
      const [profileResult, productResult, settlementResult, shipmentResult, carrierResult, warehouseResult, sellerResult, delegationResult, returnResult, cancellationResult] = await Promise.all([
        api<any>('/api/provider/profile'),
        api<any>('/api/provider/products?' + productParams.toString()),
        api<any>('/api/provider/settlements?' + settlementParams.toString()),
        api<any>('/api/provider/shipments'),
        api<any>('/api/provider/logistics/carriers').catch(() => ({ providers: [], carriers: [] })),
        api<any>('/api/provider/logistics/warehouses').catch(() => ({ warehouses: [] })),
        api<any>('/api/provider/linked-sellers').catch(() => ({ sellers: [] })),
        api<any>('/api/provider/fulfillment-delegations').catch(() => ({ delegations: [] })),
        api<any>('/api/provider/returns').catch(() => ({ returns: [] })),
        api<any>('/api/provider/cancellations').catch(() => ({ cancellations: [] })),
      ]);
      setProviderProfile(profileResult.profile || null);
      setProducts(productResult.products || []);
      setProductTotal(Number(productResult.total || 0));
      setSettlements(settlementResult.settlements || []);
      setShipments(shipmentResult.shipments || []);
      setProviderReturns(returnResult.returns || []);
      setProviderCancellations(cancellationResult.cancellations || []);
      setShippingProviders(carrierResult.providers || []);
      setProviderCarriers(carrierResult.carriers || []);
      setProviderWarehouses(warehouseResult.warehouses || []);
      setLinkedSellers(sellerResult.sellers || []);
      setDelegations(delegationResult.delegations || []);
      if (!carrierProviderId && carrierResult.providers?.[0]) setCarrierProviderId(carrierResult.providers[0].id);
      if (!delegationSellerId && sellerResult.sellers?.[0]) setDelegationSellerId(sellerResult.sellers[0].id);
      if (!bookingCarrierId && carrierResult.carriers?.[0]) setBookingCarrierId(carrierResult.carriers[0].id);
      if (!bookingWarehouseId && warehouseResult.warehouses?.[0]) setBookingWarehouseId(warehouseResult.warehouses[0].id);
      setSettlementTotal(Number(settlementResult.total || 0));
    } catch (error) {
      setNotice((error as Error).message);
    }
  }, [productPage, productQuery, productStatus, productSort, productDirection, settlementPage, settlementQuery, settlementStatus, settlementSort, settlementDirection]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api<Session>('/api/auth/me')
      .then((session) => { if (active) setAuth(session); })
      .catch((error) => { if (active) setNotice((error as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!token) return;
    api<any>('/api/provider/invites/' + encodeURIComponent(token))
      .then(setInvite)
      .catch((error) => setNotice((error as Error).message));
  }, [token]);

  useEffect(() => {
    if (role === 'PROVIDER') void refresh();
  }, [role, refresh]);

  const submitProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api('/api/provider/onboarding/accept', {
        method: 'POST',
        body: JSON.stringify({ token, ...profile }),
      });
      setNotice('Provider onboarding completed.');
      setAuth(await api<Session>('/api/auth/me'));
      await refresh();
    } catch (error) {
      setNotice((error as Error).message);
    }
  };

  const uploadImage = async (file: File) => {
    const data = new FormData();
    data.append('image', file);
    setUploading(true);
    try {
      const response = await fetch('/api/provider/upload', {
        method: 'POST',
        credentials: 'include',
        headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
        body: data,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Image upload failed');
      setForm((previous) => ({
        ...previous,
        imageUrls: [previous.imageUrls, result.url].filter(Boolean).join(','),
      }));
      setNotice('Compressed product image uploaded.');
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const submitProduct = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api('/api/provider/products', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          basePricePaise: Math.round(Number(form.basePrice) * 100),
          manufacturingDate: form.manufacturingDate || undefined,
          sizeVariants: form.sizeVariants.split(',').map((value) => value.trim()).filter(Boolean),
          colorVariants: form.colorVariants.split(',').map((value) => value.trim()).filter(Boolean),
          imageUrls: form.imageUrls.split(',').map((value) => value.trim()).filter(Boolean),
          returnable,
          returnWindowDays: Number(form.returnWindowDays),
        }),
      });
      setForm({
        title: '', category: '', subCategory: '', description: '', brand: '',
        manufacturerName: '', manufacturingDate: '', sizeVariants: '', colorVariants: '',
        basePrice: '', imageUrls: '', returnWindowDays: '7', damageReplacementPolicy: '',
      });
      await refresh();
      setNotice('Product draft saved.');
    } catch (error) {
      setNotice((error as Error).message);
    }
  };

  const respondToNegotiation = async (product: Product) => {
    const price = window.prompt('Enter revised provider price in INR', (product.basePricePaise / 100).toFixed(2));
    if (price === null) return;
    const description = window.prompt('Updated description', '');
    try {
      await api('/api/provider/products/' + product._id, {
        method: 'PATCH',
        body: JSON.stringify({
          basePricePaise: Math.round(Number(price) * 100),
          ...(description?.trim() ? { description: description.trim() } : {}),
        }),
      });
      await refresh();
      setNotice('Negotiation response saved. Submit the product again for seller review.');
    } catch (error) {
      setNotice((error as Error).message);
    }
  };

  const submitForReview = async (id: string) => {
    try {
      await api('/api/provider/products/' + id + '/submit', { method: 'POST' });
      await refresh();
      setNotice('Product submitted for seller review.');
    } catch (error) {
      setNotice((error as Error).message);
    }
  };

  const saveProviderCarrier = async (event: React.FormEvent) => {
    event.preventDefault();
    setShippingSaving(true);
    try {
      const result = await api<any>('/api/provider/logistics/carriers', { method: 'POST', body: JSON.stringify({ providerId: carrierProviderId, credentials: carrierCredentials, priorityRank: 100 }) });
      setCarrierWebhookSecret(result.carrier?.webhookSecret || '');
      setCarrierWebhookCode(shippingProviders.find((provider) => provider.id === carrierProviderId)?.code || '');
      setCarrierCredentials({});
      setNotice('Courier account validated and encrypted. Copy its webhook secret if provided.');
      await refresh();
    } catch (error) { setNotice((error as Error).message); }
    finally { setShippingSaving(false); }
  };

  const saveProviderWarehouse = async (event: React.FormEvent) => {
    event.preventDefault();
    setShippingSaving(true);
    try {
      await api('/api/provider/logistics/warehouses', { method: 'POST', body: JSON.stringify(warehouseForm) });
      setNotice('Provider pickup warehouse saved.');
      await refresh();
    } catch (error) { setNotice((error as Error).message); }
    finally { setShippingSaving(false); }
  };

  const requestFulfillmentDelegation = async (event: React.FormEvent) => {
    event.preventDefault();
    setShippingSaving(true);
    try {
      await api('/api/provider/fulfillment-delegations', { method: 'POST', body: JSON.stringify({ sellerId: delegationSellerId, carrierCodes: delegationCarrierCodes, disclosureFields: delegationFields }) });
      setNotice('Fulfilment authorization request sent to the linked seller.');
      await refresh();
    } catch (error) { setNotice((error as Error).message); }
    finally { setShippingSaving(false); }
  };

  const getShipmentRates = async (shipment: Shipment) => {
    if (!bookingCarrierId || !bookingWarehouseId) {
      setNotice('Configure and select a courier account and pickup warehouse first.');
      return;
    }
    setShippingSaving(true);
    setBookingOrderId(shipment.id);
    setBookingRates([]);
    try {
      const result = await api<any>('/api/provider/shipments/rates', { method: 'POST', body: JSON.stringify({ orderId: shipment.id, carrierConfigId: bookingCarrierId, warehouseId: bookingWarehouseId, weightGrams: Number(bookingWeight) }) });
      setBookingRates(result.quotes || []);
      if (!result.quotes?.length) setNotice('No serviceable courier services were returned for this order.');
    } catch (error) { setNotice((error as Error).message); }
    finally { setShippingSaving(false); }
  };

  const bookProviderShipment = async (shipment: Shipment, quote: CarrierRate) => {
    setShippingSaving(true);
    try {
      const result = await api<any>('/api/provider/shipments/book', { method: 'POST', body: JSON.stringify({ orderId: shipment.id, carrierConfigId: bookingCarrierId, warehouseId: bookingWarehouseId, weightGrams: Number(bookingWeight), serviceCode: quote.serviceCode }) });
      setNotice(result.status === 'QUEUED' ? 'Shipment booking queued. AWB and label will appear after carrier confirmation.' : 'A shipment already exists for this order.');
      setBookingRates([]);
      setBookingOrderId('');
      await refresh();
    } catch (error) { setNotice((error as Error).message); }
    finally { setShippingSaving(false); }
  };

  const reviewProviderReturn = async (item: ProviderReturn, action:'approve'|'reject') => {
    setShippingSaving(true);
    try {
      const warehouseId = providerWarehouses.find((warehouse) => warehouse.is_default)?.id || providerWarehouses[0]?.id;
      if (action === 'approve' && !warehouseId) throw new Error('Add a provider pickup / return warehouse before approving returns.');
      await api('/api/provider/returns/' + item.id + '/review', { method:'POST', body:JSON.stringify({ action, warehouseId, note: action==='approve'?'Return accepted; use the approved return-to address.':'Provider declined this return.' }) });
      setNotice(action==='approve'?'Return approved and return-to address shared with seller.':'Return declined and seller notified in the review queue.');
      await refresh();
    } catch(error) { setNotice((error as Error).message); }
    finally { setShippingSaving(false); }
  };

  const recordProviderReturnPickup = async (item:ProviderReturn) => {
    const draft=returnPickupDrafts[item.id];
    if(!draft?.carrierName.trim()||!draft.trackingId.trim()){setNotice('Enter courier name and AWB / tracking ID.');return;}
    setShippingSaving(true);
    try {
      await api('/api/provider/returns/'+item.id+'/pickup',{method:'POST',body:JSON.stringify(draft)});
      setNotice('Return pickup booking details saved and shared with seller.');
      await refresh();
    } catch(error) { setNotice((error as Error).message); }
    finally { setShippingSaving(false); }
  };

  const reviewProviderCancellation = async (item:ProviderCancellation,action:'approve'|'reject') => {
    setShippingSaving(true);
    try {
      await api('/api/provider/cancellations/'+item.id+'/review',{method:'POST',body:JSON.stringify({action,note:action==='approve'?'Provider approves cancellation.':'Provider rejects cancellation.'})});
      setNotice(action==='approve'?'Cancellation approved. Seller can now complete the cancellation review.':'Cancellation rejected. Seller has been notified.');
      await refresh();
    } catch(error) { setNotice((error as Error).message); }
    finally { setShippingSaving(false); }
  };

  const refreshProviderTracking = async (shipment: Shipment) => {
    if (!shipment.appShipment?.shipmentId) return;
    setShippingSaving(true);
    try {
      await api('/api/provider/shipments/' + shipment.appShipment.shipmentId + '/refresh-tracking', { method: 'POST', body: JSON.stringify({}) });
      await refresh();
      setNotice('Carrier tracking refreshed.');
    } catch (error) { setNotice((error as Error).message); }
    finally { setShippingSaving(false); }
  };

  const retryProviderShipment = async (shipment: Shipment) => {
    if (!shipment.appShipment?.shipmentId) return;
    setShippingSaving(true);
    try {
      await api('/api/provider/shipments/' + shipment.appShipment.shipmentId + '/retry', { method: 'POST' });
      setNotice('Shipment booking retry queued. The worker will recheck seller authorization before dispatch.');
      await refresh();
    } catch (error) { setNotice((error as Error).message); }
    finally { setShippingSaving(false); }
  };

  const recordManualShipment = async (shipment: Shipment) => {
    const carrierName = window.prompt('Shipping vendor / courier name');
    if (!carrierName?.trim()) return;
    const trackingId = window.prompt('Tracking / consignment number');
    if (!trackingId?.trim()) return;
    const trackingUrl = window.prompt('Tracking URL (optional)', '') || '';
    try {
      await api('/api/provider/shipments/manual', {
        method: 'POST',
        body: JSON.stringify({ orderId: shipment.id, carrierName: carrierName.trim(), trackingId: trackingId.trim(), trackingUrl: trackingUrl.trim() }),
      });
      setNotice('Manual shipment recorded and order marked as shipped.');
      await refresh();
    } catch (error) {
      setNotice((error as Error).message);
    }
  };

  const showReceipt = async (id: string) => {
    try {
      const result = await api<any>('/api/provider/settlements/' + id + '/receipt');
      const blob = new Blob([JSON.stringify(result.receipt, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'provider-settlement-' + id + '.json';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setNotice((error as Error).message);
    }
  };

  const fields = [
    ['title', 'Product title'], ['category', 'Category'], ['subCategory', 'Subcategory'],
    ['brand', 'Brand'], ['manufacturerName', 'Manufacturer'], ['manufacturingDate', 'Manufacturing date'],
    ['basePrice', 'Base price (INR)'], ['sizeVariants', 'Size variants (comma separated)'],
    ['colorVariants', 'Color variants (comma separated)'], ['returnWindowDays', 'Return window (days)'],
    ['damageReplacementPolicy', 'Damage replacement policy'], ['imageUrls', 'Image URLs (comma separated)'],
    ['description', 'Description'],
  ] as const;

  if (loading) {
    return <main className="mx-auto grid min-h-screen max-w-7xl place-items-center px-4 py-10"><p className="text-sm text-stone-500">Loading provider workspace…</p></main>;
  }

  return (
    <main className="min-h-screen bg-stone-50 px-3 py-5 text-stone-900 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto w-full max-w-7xl space-y-6 sm:space-y-8">
        <header className="flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-800">Kala & Karat · Supply Network</p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">Provider dashboard</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-stone-600">Submit products, respond to seller negotiations and track your receivables.</p>
          </div>
          {role === 'PROVIDER' && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void refresh()} className={buttonClass}>
                <RefreshCw className="h-4 w-4" /> Refresh
              </button>
              <button type="button" onClick={() => void logout()} disabled={loggingOut} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 hover:border-rose-800 disabled:opacity-50">
                <LogOut className="h-4 w-4" /> {loggingOut ? 'Signing out…' : 'Logout'}
              </button>
            </div>
          )}
        </header>

        {role !== 'PROVIDER' && (
          <section className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold">Provider access required</p>
              <p className="mt-1 leading-6">Sign in with the invited email on the <a className="font-semibold underline underline-offset-2" href={'/?auth=1&returnTo=' + encodeURIComponent(window.location.pathname + window.location.search)}>main application</a>, then return here to complete onboarding or manage your supply catalogue. Current role: {role || 'not signed in'}.</p>
            </div>
          </section>
        )}

        {role === 'PROVIDER' && providerProfile && (
          <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:p-5">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-amber-50 text-xl font-bold text-amber-900 sm:h-16 sm:w-16">
              {String(providerProfile.businessName || auth?.user?.name || 'P').slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-semibold">{providerProfile.businessName}</h2>
              <p className="mt-1 break-words text-sm text-stone-600">{providerProfile.contactPerson} · {auth?.user?.email}</p>
              <p className="mt-1 text-xs text-stone-500">KYC: {providerProfile.kycStatus || 'Pending'} · Linked sellers: {providerProfile.linkedSellerCount || 0}</p>
            </div>
            <div className="inline-flex items-center gap-2 self-start rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 sm:self-center">
              <Building2 className="h-4 w-4" /> Supplier workspace
            </div>
          </section>
        )}

        {notice && <p role="status" className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700 shadow-sm">{notice}</p>}

        {role && ['BUYER', 'PROVIDER'].includes(role) && token && invite && (
          <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
            <h2 className="text-xl font-semibold">Complete provider onboarding</h2>
            <p className="mt-1 text-sm text-stone-600">Invited by seller {invite.sellerId}. Invite expires {new Date(invite.expiresAt).toLocaleString()}.</p>
            <form onSubmit={submitProfile} className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Object.entries(profile).map(([key, value]) => (
                <label key={key} className={labelClass}>
                  <span>{key.replace(/[A-Z]/g, (letter) => ' ' + letter)}</span>
                  <input required className={inputClass} value={value} onChange={(event) => setProfile((previous) => ({ ...previous, [key]: event.target.value }))} />
                </label>
              ))}
              <div className="sm:col-span-2 xl:col-span-3">
                <button className={buttonClass} type="submit">Submit business profile</button>
              </div>
            </form>
          </section>
        )}

        {role === 'PROVIDER' && (
          <>
            <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-2">
              <section className="min-w-0 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
                <div className="mb-5 flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-lg bg-rose-50 text-rose-900"><Package className="h-5 w-5" /></div>
                  <div><h2 className="font-semibold">Submit a product</h2><p className="text-xs text-stone-500">Create a supplier catalogue draft</p></div>
                </div>
                <form onSubmit={submitProduct} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {fields.map(([key, label]) => (
                    <label key={key} className={labelClass + (key === 'description' || key === 'imageUrls' || key === 'damageReplacementPolicy' ? ' sm:col-span-2' : '')}>
                      <span>{label}</span>
                      {key === 'description' || key === 'damageReplacementPolicy' ? (
                        <textarea className={inputClass + ' min-h-24 resize-y'} value={form[key]} onChange={(event) => setForm((previous) => ({ ...previous, [key]: event.target.value }))} required={key === 'description'} />
                      ) : (
                        <input className={inputClass} type={key === 'basePrice' ? 'number' : key === 'manufacturingDate' ? 'date' : 'text'} min={key === 'basePrice' ? '0' : undefined} value={form[key]} onChange={(event) => setForm((previous) => ({ ...previous, [key]: event.target.value }))} required={['title', 'category', 'manufacturerName', 'basePrice', 'imageUrls'].includes(key)} />
                      )}
                    </label>
                  ))}
                  <label className="flex items-center gap-2 text-sm text-stone-700 sm:col-span-2">
                    <input type="checkbox" className="h-4 w-4 accent-rose-900" checked={returnable} onChange={(event) => setReturnable(event.target.checked)} /> Returnable product
                  </label>
                  <label className="grid gap-2 text-xs font-medium text-stone-700 sm:col-span-2">
                    <span>Upload product image</span>
                    <input className="block w-full min-w-0 rounded-lg border border-dashed border-stone-300 bg-stone-50 p-3 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-rose-900 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white" type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadImage(file); }} />
                  </label>
                  <div className="sm:col-span-2"><button type="submit" className={buttonClass}>Save product draft</button></div>
                </form>
              </section>

              <section className="min-w-0 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
                <div className="mb-5 flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-lg bg-amber-50 text-amber-900"><Package className="h-5 w-5" /></div>
                  <div><h2 className="font-semibold">Catalogue & negotiations</h2><p className="text-xs text-stone-500">Track seller review and price discussions</p></div>
                </div>
                <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_180px_180px]">
                  <label className="relative">
                    <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-stone-400" />
                    <input aria-label="Search catalogue and negotiations" className={inputClass + ' pl-9'} placeholder="Search products, brand or category" value={productQuery} onChange={(event) => { setProductQuery(event.target.value); setProductPage(1); }} />
                  </label>
                  <select aria-label="Filter catalogue status" className={inputClass} value={productStatus} onChange={(event) => { setProductStatus(event.target.value); setProductPage(1); }}>
                    <option value="ALL">All statuses</option><option value="DRAFT">Draft</option><option value="PENDING_REVIEW">Pending review</option><option value="NEGOTIATION_REQUESTED">Negotiation requested</option><option value="RESUBMITTED">Resubmitted</option><option value="APPROVED_AND_PUBLISHED">Approved & published</option>
                  </select>
                  <select aria-label="Sort catalogue" className={inputClass} value={productSort} onChange={(event) => { setProductSort(event.target.value); setProductPage(1); }}>
                    <option value="updatedAt">Recently updated</option><option value="createdAt">Date created</option><option value="title">Product name</option><option value="price">Provider price</option><option value="status">Status</option>
                  </select>
                  <button type="button" onClick={() => setProductDirection((value) => value === 'asc' ? 'desc' : 'asc')} className="inline-flex min-h-9 items-center gap-2 justify-self-start rounded-lg border border-stone-300 px-3 text-xs font-semibold text-stone-700"><ArrowUpDown className="h-3.5 w-3.5" /> {productDirection === 'asc' ? 'Ascending' : 'Descending'}</button>
                </div>
                {products.length ? (
                  <div className="divide-y divide-stone-100">
                    {products.map((product) => (
                      <article key={product._id} className="grid min-w-0 grid-cols-1 gap-3 py-4 sm:grid-cols-[104px_minmax(0,1fr)]">
                        {product.imageUrls?.length ? (
                          <div className="grid grid-cols-2 content-start gap-1">
                            {product.imageUrls.slice(0, 2).map((src: string, index: number) => <img key={src} src={src} alt={product.title + ' image ' + (index + 1)} loading="lazy" className="h-24 w-full rounded-lg object-cover sm:h-20" onError={(event) => { event.currentTarget.classList.add('hidden'); }} />)}
                          </div>
                        ) : <div className="grid h-20 place-items-center rounded-lg bg-stone-100 text-xs text-stone-500">No image</div>}
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{product.title}</h3><StatusBadge status={product.status} /></div>
                          <p className="mt-1 text-sm text-stone-600">{product.category} · {money(product.basePricePaise)}</p>
                          {product.negotiationHistory?.slice(-2).map((item, index) => <p key={index} className="mt-2 break-words text-xs text-amber-800">{item.comment || (item.action === 'APPROVED_BASE_PRICE' ? 'Seller approved the provider price.' : 'Seller requested a product revision.')}</p>)}
                          <div className="mt-3 flex flex-wrap gap-2">
                            {product.status === 'NEGOTIATION_REQUESTED' && <button type="button" onClick={() => void respondToNegotiation(product)} className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold hover:border-rose-800">Respond to seller</button>}
                            {['DRAFT', 'NEGOTIATION_REQUESTED', 'RESUBMITTED'].includes(product.status) && <button type="button" onClick={() => void submitForReview(product._id)} className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-semibold text-white hover:bg-stone-700">Submit for review</button>}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : <div className="rounded-xl border border-dashed border-stone-300 px-4 py-10 text-center text-sm text-stone-500">No matching catalogue products.</div>}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-4 text-xs text-stone-500">
                  <span>{productTotal} products · Page {productPage} of {Math.max(1, Math.ceil(productTotal / 10))}</span>
                  <div className="flex gap-2">
                    <button type="button" disabled={productPage <= 1} onClick={() => setProductPage((page) => Math.max(1, page - 1))} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-stone-300 px-3 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /> Previous</button>
                    <button type="button" disabled={productPage >= Math.ceil(productTotal / 10)} onClick={() => setProductPage((page) => page + 1)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-stone-300 px-3 disabled:opacity-40">Next <ChevronRight className="h-4 w-4" /></button>
                  </div>
                </div>
              </section>
            </div>

            <section className="grid min-w-0 gap-5 xl:grid-cols-2">
              <div className="min-w-0 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
                <div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="font-semibold">Return review requests</h2><p className="mt-1 text-xs text-stone-500">Seller-forwarded returns · buyer address is shown only when the seller explicitly shares it</p></div><span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">{providerReturns.filter(item=>item.providerReviewStatus==='PENDING').length} pending</span></div>
                {providerReturns.length?providerReturns.map(item=><article key={item.id} className="space-y-3 border-t border-stone-100 py-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2"><strong>Order {item.orderId}</strong><span className="rounded-full bg-stone-100 px-2 py-1">{item.providerReviewStatus}</span></div>
                  <p>{item.productId} · Qty {item.quantity} · {item.reason}</p>
                  <div className="flex flex-wrap gap-2">{item.media.map((media,index)=><a key={index} href={media.url} target="_blank" rel="noreferrer" className="text-rose-900 underline">Evidence {index+1}</a>)}</div>
                  {item.pickupAddress?<div className="rounded-lg bg-amber-50 p-3 text-amber-950"><strong>Buyer pickup address (seller authorized sharing)</strong><p>{item.pickupAddress.fullName} · {item.pickupAddress.phone}</p><p>{item.pickupAddress.street}, {item.pickupAddress.city}, {item.pickupAddress.state} {item.pickupAddress.pincode}</p></div>:<p className="rounded-lg bg-stone-50 p-3 text-stone-600">Buyer pickup address has not been shared. You can approve and provide a return-to address, but cannot arrange pickup from the buyer through this request.</p>}
                  {item.providerReturnAddress&&<p className="rounded-lg bg-emerald-50 p-3 text-emerald-950"><strong>Return-to address:</strong> {item.providerReturnAddress.name}, {item.providerReturnAddress.addressLine1}, {item.providerReturnAddress.city}, {item.providerReturnAddress.state} {item.providerReturnAddress.postalCode}</p>}
                  {item.providerReviewStatus==='PENDING'&&<div className="flex flex-wrap gap-2"><button type="button" disabled={shippingSaving} onClick={()=>void reviewProviderReturn(item,'approve')} className="rounded-lg bg-emerald-700 px-3 py-2 font-semibold text-white disabled:opacity-40">Approve & share return address</button><button type="button" disabled={shippingSaving} onClick={()=>void reviewProviderReturn(item,'reject')} className="rounded-lg border border-stone-300 px-3 py-2 font-semibold disabled:opacity-40">Reject</button></div>}
                  {item.providerReviewStatus==='APPROVED'&&item.pickupAddress&&item.returnPickup.status!=='BOOKED'&&<div className="grid gap-2 sm:grid-cols-3"><input placeholder="Courier name" value={returnPickupDrafts[item.id]?.carrierName||''} onChange={e=>setReturnPickupDrafts(v=>({...v,[item.id]:{carrierName:e.target.value,trackingId:v[item.id]?.trackingId||'',trackingUrl:v[item.id]?.trackingUrl||''}}))} className="rounded border px-2 py-2"/><input placeholder="AWB / tracking ID" value={returnPickupDrafts[item.id]?.trackingId||''} onChange={e=>setReturnPickupDrafts(v=>({...v,[item.id]:{carrierName:v[item.id]?.carrierName||'',trackingId:e.target.value,trackingUrl:v[item.id]?.trackingUrl||''}}))} className="rounded border px-2 py-2"/><button type="button" disabled={shippingSaving} onClick={()=>void recordProviderReturnPickup(item)} className="rounded bg-sky-800 px-3 py-2 font-semibold text-white disabled:opacity-40">Save pickup booking</button><input placeholder="Tracking URL (optional)" value={returnPickupDrafts[item.id]?.trackingUrl||''} onChange={e=>setReturnPickupDrafts(v=>({...v,[item.id]:{carrierName:v[item.id]?.carrierName||'',trackingId:v[item.id]?.trackingId||'',trackingUrl:e.target.value}}))} className="rounded border px-2 py-2 sm:col-span-3"/></div>}
                  {item.returnPickup.status==='BOOKED'&&<p className="text-emerald-800">Pickup booked: {item.returnPickup.carrier} · {item.returnPickup.trackingId} {item.returnPickup.trackingUrl&&<a href={item.returnPickup.trackingUrl} target="_blank" rel="noreferrer" className="underline">Track</a>}</p>}
                </article>):<p className="py-6 text-center text-xs text-stone-500">No return review requests.</p>}
              </div>
              <div className="min-w-0 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
                <div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="font-semibold">Cancellation review requests</h2><p className="mt-1 text-xs text-stone-500">Second-level review for provider-supplied orders</p></div><span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">{providerCancellations.length} pending</span></div>
                {providerCancellations.length?providerCancellations.map(item=><article key={item.id} className="flex flex-col gap-3 border-t border-stone-100 py-3 sm:flex-row sm:items-center sm:justify-between"><div><strong>{item.orderNumber}</strong><p className="mt-1 text-xs text-stone-500">{item.items.map(row=>row.title+' × '+row.quantity).join(' · ')}</p><p className="mt-1 text-[11px] text-stone-400">Forwarded {new Date(item.forwardedAt).toLocaleString()}</p></div><div className="flex gap-2"><button type="button" disabled={shippingSaving} onClick={()=>void reviewProviderCancellation(item,'approve')} className="rounded bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Approve</button><button type="button" disabled={shippingSaving} onClick={()=>void reviewProviderCancellation(item,'reject')} className="rounded border px-3 py-2 text-xs disabled:opacity-40">Reject</button></div></article>):<p className="py-6 text-center text-xs text-stone-500">No cancellation review requests.</p>}
              </div>
            </section>

            <section className="grid min-w-0 gap-5 xl:grid-cols-2">
              <form onSubmit={saveProviderCarrier} className="min-w-0 space-y-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
                <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg bg-sky-50 text-sky-800"><Truck className="h-5 w-5" /></div><div><h2 className="font-semibold">Shipping vendors</h2><p className="text-xs text-stone-500">Connect your own courier or aggregator account</p></div></div>
                <label className={labelClass}>Courier / aggregator
                  <select className={inputClass} value={carrierProviderId} onChange={(event) => { setCarrierProviderId(event.target.value); setCarrierCredentials({}); }}>
                    <option value="">Select shipping vendor</option>
                    {shippingProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} · {provider.type}</option>)}
                  </select>
                </label>
                {(shippingProviders.find((provider) => provider.id === carrierProviderId)?.auth_schema_json?.fields || []).map((field) => (
                  <label key={field.name} className={labelClass}>{field.label}
                    <input className={inputClass} type={field.type || 'password'} autoComplete="off" value={carrierCredentials[field.name] || ''} onChange={(event) => setCarrierCredentials((value) => ({ ...value, [field.name]: event.target.value }))} />
                  </label>
                ))}
                <button className={buttonClass} disabled={shippingSaving || !carrierProviderId}> {shippingSaving ? 'Saving…' : 'Validate & save encrypted credentials'}</button>
                <div className="space-y-2 border-t border-stone-100 pt-3">
                  {providerCarriers.map((carrier) => <div key={carrier.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span>{carrier.logistics_providers?.name || carrier.provider_id} · {carrier.is_active ? 'Active' : 'Disabled'}</span>
                    <button type="button" onClick={async () => { try { await api('/api/provider/logistics/carriers/' + carrier.id + '/active', { method: 'PATCH', body: JSON.stringify({ isActive: !carrier.is_active }) }); await refresh(); } catch (error) { setNotice((error as Error).message); } }} className="rounded-lg border border-stone-300 px-3 py-1.5">{carrier.is_active ? 'Disable' : 'Enable'}</button>
                  </div>)}
                  {!providerCarriers.length && <p className="text-xs text-stone-500">No shipping accounts configured yet.</p>}
                </div>
                {carrierWebhookSecret && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                  <p className="font-semibold">Webhook configuration — secret shown once</p>
                  <p className="mt-1 break-all">URL: {window.location.origin}/api/logistics/webhooks/{carrierWebhookCode}</p>
                  <p className="mt-1 break-all font-mono">Secret: {carrierWebhookSecret}</p>
                  <p className="mt-1">Configure the provider webhook header using x-api-key or x-logistics-signature.</p>
                  <button type="button" onClick={() => void navigator.clipboard?.writeText(carrierWebhookSecret)} className="mt-2 rounded border border-amber-300 px-2 py-1">Copy secret</button>
                </div>}
              </form>

              <form onSubmit={saveProviderWarehouse} className="min-w-0 space-y-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
                <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg bg-amber-50 text-amber-900"><Building2 className="h-5 w-5" /></div><div><h2 className="font-semibold">Provider pickup location</h2><p className="text-xs text-stone-500">Your own dispatch and return address</p></div></div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {([['warehouseCode','Warehouse code'],['name','Location name'],['contactName','Contact name'],['contactPhone','Contact phone'],['addressLine1','Address'],['addressLine2','Address line 2'],['city','City'],['state','State'],['postalCode','Pincode']] as const).map(([key,label]) => <label key={key} className={labelClass}>{label}<input className={inputClass} required={!['addressLine2'].includes(key)} value={warehouseForm[key]} onChange={(event) => setWarehouseForm((value) => ({ ...value, [key]: event.target.value }))} /></label>)}
                </div>
                <label className="flex items-center gap-2 text-xs text-stone-700"><input type="checkbox" checked={warehouseForm.isDefault} onChange={(event) => setWarehouseForm((value) => ({ ...value, isDefault: event.target.checked }))} /> Default pickup location</label>
                <button className={buttonClass} disabled={shippingSaving}>{shippingSaving ? 'Saving…' : 'Save pickup location'}</button>
                <div className="border-t border-stone-100 pt-3">{providerWarehouses.map((warehouse) => <p key={warehouse.id} className="py-1 text-xs text-stone-600">{warehouse.name} · {warehouse.city}, {warehouse.postal_code}{warehouse.is_default ? ' · Default' : ''}</p>)}</div>
              </form>
            </section>

            <section className="grid min-w-0 gap-5 xl:grid-cols-2">
              <form onSubmit={requestFulfillmentDelegation} className="min-w-0 space-y-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
                <div><h2 className="font-semibold">Seller fulfilment authorization</h2><p className="mt-1 text-xs leading-5 text-stone-500">Request explicit seller approval before handling orders or sharing delivery data with a carrier.</p></div>
                <label className={labelClass}>Linked seller
                  <select className={inputClass} required value={delegationSellerId} onChange={(event) => setDelegationSellerId(event.target.value)}>
                    <option value="">Choose linked seller</option>{linkedSellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}
                  </select>
                </label>
                <div className="space-y-2"><p className="text-xs font-semibold text-stone-700">Carriers to authorize</p>
                  {providerCarriers.filter((carrier) => carrier.is_active).map((carrier) => <label key={carrier.id} className="flex items-center gap-2 text-xs text-stone-700"><input type="checkbox" checked={delegationCarrierCodes.includes(carrier.logistics_providers?.code || '')} onChange={(event) => setDelegationCarrierCodes((values) => event.target.checked ? [...values, carrier.logistics_providers?.code || ''].filter(Boolean) : values.filter((value) => value !== carrier.logistics_providers?.code))} />{carrier.logistics_providers?.name || carrier.provider_id}</label>)}
                </div>
                <div className="space-y-2"><p className="text-xs font-semibold text-stone-700">Requested delivery-data permissions</p>
                  {([['recipientName','Recipient name'],['recipientPhone','Recipient phone'],['recipientAddress','Delivery address'],['recipientEmail','Customer email (required by some carriers)']] as const).map(([key,label]) => <label key={key} className="flex items-center gap-2 text-xs text-stone-700"><input type="checkbox" checked={delegationFields.includes(key)} onChange={(event) => setDelegationFields((values) => event.target.checked ? [...values,key] : values.filter((value) => value !== key))} />{label}</label>)}
                </div>
                <button className={buttonClass} disabled={shippingSaving || !delegationSellerId || !delegationCarrierCodes.length}>Send authorization request</button>
                <div className="border-t border-stone-100 pt-3">{delegations.map((delegation) => <p key={delegation.sellerId} className="py-1 text-xs text-stone-600">Seller {linkedSellers.find((seller) => seller.id === delegation.sellerId)?.name || delegation.sellerId} · <strong>{delegation.status}</strong> · {(delegation.allowedCarrierCodes || []).join(', ') || 'Awaiting approval'}</p>)}</div>
              </form>
              <div className="min-w-0 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
                <h2 className="font-semibold">Booking defaults</h2><p className="mt-1 text-xs text-stone-500">Select your account and pickup point before requesting live service rates.</p>
                <label className={labelClass + ' mt-4'}>Carrier account
                  <select className={inputClass} value={bookingCarrierId} onChange={(event) => setBookingCarrierId(event.target.value)}><option value="">Select carrier account</option>{providerCarriers.filter((carrier) => carrier.is_active).map((carrier) => <option key={carrier.id} value={carrier.id}>{carrier.logistics_providers?.name || carrier.id}</option>)}</select>
                </label>
                <label className={labelClass + ' mt-3'}>Pickup location
                  <select className={inputClass} value={bookingWarehouseId} onChange={(event) => setBookingWarehouseId(event.target.value)}><option value="">Select pickup location</option>{providerWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name} · {warehouse.postal_code}</option>)}</select>
                </label>
                <label className={labelClass + ' mt-3'}>Parcel weight (grams)
                  <input className={inputClass} type="number" min="1" max="100000" value={bookingWeight} onChange={(event) => setBookingWeight(event.target.value)} />
                </label>
                <p className="mt-3 rounded-lg bg-stone-50 p-3 text-xs leading-5 text-stone-600">Only active seller-approved delegations are eligible. The seller can revoke access at any time; the worker rechecks authorization immediately before dispatch.</p>
              </div>
            </section>

            <section className="min-w-0 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg bg-sky-50 text-sky-800"><Package className="h-5 w-5" /></div><div><h2 className="font-semibold">Provider shipments</h2><p className="text-xs text-stone-500">Orders containing only your published products · no buyer address or contact details</p></div></div>
                <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-600">{shipments.length} active / recent</span>
              </div>
              {shipments.length ? <div className="divide-y divide-stone-100">
                {shipments.map((shipment) => <article key={shipment.id} className="space-y-3 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{shipment.orderNumber}</h3><StatusBadge status={shipment.status} /></div>
                      <p className="mt-1 text-xs text-stone-500">{shipment.items.map((item) => item.title + ' × ' + item.quantity).join(' · ')}</p>
                      {shipment.courierTracking && <p className="mt-2 break-all text-xs text-stone-600">Manual: {shipment.courierTracking.companyName} · {shipment.courierTracking.trackingId} {shipment.courierTracking.trackingUrl && <a className="font-semibold text-rose-900 underline" href={shipment.courierTracking.trackingUrl} target="_blank" rel="noreferrer">Track</a>}</p>}
                      {shipment.appShipment && <div className="mt-2 space-y-1 rounded-lg bg-sky-50 p-3 text-xs text-sky-950">
                        <p className="font-semibold">{shipment.appShipment.carrierName || 'App-booked carrier'} · {shipment.appShipment.bookingStatus} · AWB {shipment.appShipment.awbNumber || 'Pending'}</p>
                        <p>Tracking status: {({10:'Created',20:'Manifested',30:'In transit',40:'Out for delivery',50:'Delivered',60:'NDR',70:'RTO initiated',80:'RTO delivered',90:'Cancelled'} as Record<number,string>)[shipment.appShipment.statusCode] || 'Pending'}{shipment.appShipment.pickupScheduled ? ' · Pickup scheduled' : ''}{shipment.appShipment.estimatedDeliveryAt ? ' · ETA ' + new Date(shipment.appShipment.estimatedDeliveryAt).toLocaleDateString() : ''}</p>
                        <div className="flex flex-wrap items-center gap-3">{shipment.appShipment.labelUrl && <a className="font-semibold underline" href={shipment.appShipment.labelUrl} target="_blank" rel="noreferrer">Download label</a>}{shipment.appShipment.manifestUrl && <a className="font-semibold underline" href={shipment.appShipment.manifestUrl} target="_blank" rel="noreferrer">Manifest</a>}<button type="button" disabled={shippingSaving} onClick={() => void refreshProviderTracking(shipment)} className="font-semibold underline disabled:opacity-40">Refresh tracking</button></div>
                        {!!shipment.appShipment.trackingEvents?.length && <ol className="mt-2 space-y-1 border-l border-sky-200 pl-3">{shipment.appShipment.trackingEvents.slice(0,5).map((event,index)=><li key={event.statusCode+'-'+event.occurredAt+'-'+index}>{({10:'Created',20:'Manifested',30:'In transit',40:'Out for delivery',50:'Delivered',60:'NDR',70:'RTO initiated',80:'RTO delivered',90:'Cancelled'} as Record<number,string>)[event.statusCode] || 'Tracking update'}{event.location?' · '+event.location:''} · {new Date(event.occurredAt).toLocaleString()}</li>)}</ol>}
                        {shipment.appShipment.bookingStatus === 'FAILED' && !shipment.appShipment.awbNumber && <button type="button" onClick={() => void retryProviderShipment(shipment)} className="mt-1 rounded-md border border-sky-300 px-3 py-1.5 font-semibold">Retry booking</button>}
                      </div>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {shipment.status === 'Packed' && !shipment.appShipment && <button type="button" disabled={shippingSaving} onClick={() => void getShipmentRates(shipment)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-sky-800 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50">Get rates & book in app</button>}
                      {shipment.manualDispatchAllowed && <button type="button" onClick={() => void recordManualShipment(shipment)} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-700 hover:border-rose-800">Manual courier fallback</button>}
                    </div>
                  </div>
                  {bookingOrderId === shipment.id && bookingRates.length > 0 && <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
                    <p className="mb-2 text-xs font-semibold text-sky-950">Available carrier services</p>
                    <div className="grid gap-2 sm:grid-cols-2">{bookingRates.map((quote) => <div key={quote.providerCode + quote.serviceCode} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-100 bg-white p-3 text-xs">
                      <div><p className="font-semibold">{quote.providerCode.toUpperCase()} · {quote.serviceCode}</p><p className="mt-1 text-stone-600">{money(quote.amountMinor)} · {Math.ceil(quote.estimatedTransitHours / 24)} day estimate · {quote.codSupported ? 'COD supported' : 'Prepaid only'}</p></div>
                      <button type="button" disabled={shippingSaving || !quote.serviceable || Date.parse(quote.expiresAt) <= Date.now()} onClick={() => void bookProviderShipment(shipment, quote)} className="rounded-lg bg-rose-900 px-3 py-2 font-semibold text-white disabled:opacity-40">Book shipment</button>
                    </div>)}</div>
                  </div>}
                </article>)}
              </div> : <p className="rounded-xl bg-stone-50 px-4 py-8 text-center text-sm text-stone-500">No provider-fulfilment orders are ready yet. A linked seller must approve your fulfilment request before eligible orders appear.</p>}
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">App booking creates a carrier shipment and queues label generation. AWB, pickup and tracking status update asynchronously from carrier webhooks or tracking polls. Manual dispatch remains available as a fallback for eligible Packed orders.</p>
            </section>

            <section className="min-w-0 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
              <div className="mb-4 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg bg-emerald-50 text-emerald-800"><Wallet className="h-5 w-5" /></div><div><h2 className="font-semibold">Settlements & receivables</h2><p className="text-xs text-stone-500">Supplier settlement status</p></div></div>
              <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_180px_180px]">
                <label className="relative">
                  <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-stone-400" />
                  <input aria-label="Search settlements and receivables" className={inputClass + ' pl-9'} placeholder="Search order, UTR or status" value={settlementQuery} onChange={(event) => { setSettlementQuery(event.target.value); setSettlementPage(1); }} />
                </label>
                <select aria-label="Filter settlement status" className={inputClass} value={settlementStatus} onChange={(event) => { setSettlementStatus(event.target.value); setSettlementPage(1); }}>
                  <option value="ALL">All statuses</option><option value="PENDING_CLEARANCE">Pending clearance</option><option value="READY_FOR_SETTLEMENT">Ready for settlement</option><option value="SETTLED">Settled</option><option value="VOID">Void</option>
                </select>
                <select aria-label="Sort settlements" className={inputClass} value={settlementSort} onChange={(event) => { setSettlementSort(event.target.value); setSettlementPage(1); }}>
                  <option value="createdAt">Date</option><option value="orderId">Order ID</option><option value="amount">Amount</option><option value="quantity">Quantity</option><option value="status">Status</option>
                </select>
                <button type="button" onClick={() => setSettlementDirection((value) => value === 'asc' ? 'desc' : 'asc')} className="inline-flex min-h-9 items-center gap-2 justify-self-start rounded-lg border border-stone-300 px-3 text-xs font-semibold text-stone-700"><ArrowUpDown className="h-3.5 w-3.5" /> {settlementDirection === 'asc' ? 'Ascending' : 'Descending'}</button>
              </div>
              {settlements.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-3">Order</th><th className="px-3 py-3">Quantity</th><th className="px-3 py-3">Amount</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Receipt</th></tr></thead>
                    <tbody className="divide-y divide-stone-100">{settlements.map((settlement) => <tr key={settlement._id}><td className="px-3 py-3 font-medium">{settlement.orderId}</td><td className="px-3 py-3">{settlement.quantity}</td><td className="px-3 py-3 tabular-nums">{money(settlement.amountPaise)}</td><td className="px-3 py-3">{settlement.status}</td><td className="px-3 py-3">{settlement.status === 'SETTLED' && <button type="button" onClick={() => void showReceipt(settlement._id)} className="font-semibold text-rose-900 underline underline-offset-2">Download</button>}</td></tr>)}</tbody>
                  </table>
                </div>
              ) : <p className="rounded-xl bg-stone-50 px-4 py-8 text-center text-sm text-stone-500">No matching settlements.</p>}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-4 text-xs text-stone-500">
                <span>{settlementTotal} receivables · Page {settlementPage} of {Math.max(1, Math.ceil(settlementTotal / 10))}</span>
                <div className="flex gap-2">
                  <button type="button" disabled={settlementPage <= 1} onClick={() => setSettlementPage((page) => Math.max(1, page - 1))} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-stone-300 px-3 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /> Previous</button>
                  <button type="button" disabled={settlementPage >= Math.ceil(settlementTotal / 10)} onClick={() => setSettlementPage((page) => page + 1)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-stone-300 px-3 disabled:opacity-40">Next <ChevronRight className="h-4 w-4" /></button>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
