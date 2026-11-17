import imageCompression from 'browser-image-compression';

const rawApiBase = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
const rawAssetBase = (import.meta.env.VITE_ASSET_BASE_URL || '').trim().replace(/\/+$/, '');

export const API_BASE_URL = rawApiBase;
export const ASSET_BASE_URL = rawAssetBase || rawApiBase;

export function resolveApiUrl(url: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (API_BASE_URL && url.startsWith('/api')) {
    return `${API_BASE_URL}${url}`;
  }
  return url;
}

export function resolveAssetUrl(url: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:')) {
    return url;
  }
  if (ASSET_BASE_URL && url.startsWith('/uploads')) {
    return `${ASSET_BASE_URL}${url}`;
  }
  return url;
}

export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

const SSL_TOKEN_KEY = 'kk_ssl_token';
const CSRF_TOKEN_KEY = 'kk_csrf_token';

export function getClientAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(SSL_TOKEN_KEY);
}

export function setClientSessionTokens(accessToken?: string, csrfToken?: string) {
  if (typeof window === 'undefined') return;
  if (accessToken) sessionStorage.setItem(SSL_TOKEN_KEY, accessToken);
  if (csrfToken) sessionStorage.setItem(CSRF_TOKEN_KEY, csrfToken);
}

export function clearClientSessionTokens() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(SSL_TOKEN_KEY);
  sessionStorage.removeItem(CSRF_TOKEN_KEY);
}

export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const token = getClientAccessToken();
  const csrf = typeof window !== 'undefined' ? sessionStorage.getItem(CSRF_TOKEN_KEY) : null;
  const resolvedUrl = resolveApiUrl(url);
  const res = await fetch(resolvedUrl, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...options?.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || `Request failed (${res.status})`) as Error & {
      code?: string;
      status?: number;
    };
    err.code = data.error;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export async function compressAndUploadImage(file: File): Promise<{
  url: string;
  thumbUrl: string;
  byteSize: number;
  storage: 'r2' | 'local';
}> {
  const compressed = await imageCompression(file, {
    maxSizeMB: 0.11, // <120KB target client-side before Sharp server-side pass
    maxWidthOrHeight: 1200,
    useWebWorker: true,
    fileType: 'image/webp',
  });

  const form = new FormData();
  form.append('image', compressed, file.name.replace(/\.[^.]+$/, '.webp'));

  return apiFetch('/api/upload', {
    method: 'POST',
    body: form,
  });
}

export interface WhatsAppShareResult {
  delivered: boolean;
  channel: 'meta_cloud' | 'evolution_api' | 'wa_me_fallback';
  waLink: string;
  messagePreview: string;
  sentAt: string;
}

export async function sendWhatsAppMessage(
  toPhone: string,
  message: string
): Promise<WhatsAppShareResult> {
  try {
    return await apiFetch<WhatsAppShareResult>('/api/whatsapp/share', {
      method: 'POST',
      body: JSON.stringify({ toPhone, message }),
    });
  } catch {
    const digits = toPhone.replace(/[^\d]/g, '');
    return {
      delivered: false,
      channel: 'wa_me_fallback',
      waLink: `https://wa.me/${digits}?text=${encodeURIComponent(message)}`,
      messagePreview: message,
      sentAt: new Date().toISOString(),
    };
  }
}

export async function logShareEvent(
  productId: string,
  channel: 'whatsapp' = 'whatsapp'
): Promise<{ ok: boolean; productId: string; sharesCount: number }> {
  return apiFetch<{ ok: boolean; productId: string; sharesCount: number }>(
    '/api/analytics/share',
    {
      method: 'POST',
      body: JSON.stringify({ productId, channel }),
    }
  );
}
