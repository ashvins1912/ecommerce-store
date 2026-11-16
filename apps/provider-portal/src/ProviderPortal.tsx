import { useCallback, useEffect, useMemo, useState } from 'react';
import { INR_FROM_PAISE } from '@commerce/shared-utils';
import type { ProviderProductView } from '@commerce/shared-types';
import { StatusBadge } from '@commerce/shared-ui';
import { Package, RefreshCw, Upload, Wallet, Building2, AlertCircle, LogOut, Search, ChevronLeft, ChevronRight, ArrowUpDown } from 'lucide-react';

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
type Shipment = { id: string; orderNumber: string; status: string; createdAt: string; items: Array<{ productId: string; title: string; quantity: number }>; courierTracking?: { companyName: string; trackingId: string; trackingUrl?: string } | null; manualDispatchAllowed: boolean };
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
      const [profileResult, productResult, settlementResult, shipmentResult] = await Promise.all([
        api<any>('/api/provider/profile'),
        api<any>('/api/provider/products?' + productParams.toString()),
        api<any>('/api/provider/settlements?' + settlementParams.toString()),
        api<any>('/api/provider/shipments'),
      ]);
      setProviderProfile(profileResult.profile || null);
      setProducts(productResult.products || []);
      setProductTotal(Number(productResult.total || 0));
      setSettlements(settlementResult.settlements || []);
      setShipments(shipmentResult.shipments || []);
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
                    <option value="ALL">All statuses</option><option value="DRAFT">Draft</option><option value="PENDING_REVIEW">Pending review</option><option value="NEGOTIATION_REQUESTED">Negotiation requested</option><option value="RESUBMITTED">Resubmitted</option><option value="APPROVED">Approved</option>
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

            <section className="min-w-0 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg bg-sky-50 text-sky-800"><Package className="h-5 w-5" /></div><div><h2 className="font-semibold">Provider shipments</h2><p className="text-xs text-stone-500">Orders containing only your published products · no buyer address or contact details</p></div></div>
                <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-600">{shipments.length} active / recent</span>
              </div>
              {shipments.length ? <div className="divide-y divide-stone-100">
                {shipments.map((shipment) => <article key={shipment.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{shipment.orderNumber}</h3><StatusBadge status={shipment.status} /></div>
                    <p className="mt-1 text-xs text-stone-500">{shipment.items.map((item) => item.title + ' × ' + item.quantity).join(' · ')}</p>
                    {shipment.courierTracking && <p className="mt-2 break-all text-xs text-stone-600">{shipment.courierTracking.companyName} · {shipment.courierTracking.trackingId} {shipment.courierTracking.trackingUrl && <a className="font-semibold text-rose-900 underline" href={shipment.courierTracking.trackingUrl} target="_blank" rel="noreferrer">Track</a>}</p>}
                  </div>
                  {shipment.manualDispatchAllowed && <button type="button" onClick={() => void recordManualShipment(shipment)} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-rose-900 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-800">Record manual shipment</button>}
                </article>)}
              </div> : <p className="rounded-xl bg-stone-50 px-4 py-8 text-center text-sm text-stone-500">No provider-fulfilment orders are ready yet.</p>}
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">Manual dispatch is available after the seller marks the order Packed and payment is confirmed (or the order is COD). In-app carrier booking requires a carrier configuration and dispatch authorization from the linked seller.</p>
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
