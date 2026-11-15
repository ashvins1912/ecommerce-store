import imageCompression from 'browser-image-compression';

export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
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
