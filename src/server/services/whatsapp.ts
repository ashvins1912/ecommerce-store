export interface WhatsAppSendResult {
  delivered: boolean;
  channel: 'meta_cloud' | 'evolution_api' | 'wa_me_fallback';
  waLink: string;
  messagePreview: string;
  sentAt: string;
}

export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone.trim());
}

export function getSellerOrderNotificationNumber(seller: {
  orderNotificationWhatsAppNumber?: string;
  whatsappNumber?: string;
  mobileNumber?: string;
}): string {
  return [
    seller.orderNotificationWhatsAppNumber,
    seller.whatsappNumber,
    seller.mobileNumber,
  ].map((phone) => phone?.trim() || '').find(Boolean) || '';
}

export function buildWaMeLink(phone: string, text: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export async function checkWhatsAppNumberExists(phone: string): Promise<{
  exists: boolean;
  checkedVia: 'evolution_api' | 'format_validation';
}> {
  if (!isValidE164(phone)) {
    return { exists: false, checkedVia: 'format_validation' };
  }

  const evoUrl = process.env.EVOLUTION_API_URL;
  const evoKey = process.env.EVOLUTION_API_KEY;
  const evoInstance = process.env.EVOLUTION_INSTANCE;

  if (evoUrl && evoKey && evoInstance) {
    try {
      const resp = await fetch(
        `${evoUrl.replace(/\/$/, '')}/chat/whatsappNumbers/${evoInstance}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: evoKey,
          },
          body: JSON.stringify({ numbers: [phone.replace('+', '')] }),
        }
      );
      if (resp.ok) {
        const data = (await resp.json()) as Array<{ exists?: boolean }>;
        return { exists: Boolean(data?.[0]?.exists), checkedVia: 'evolution_api' };
      }
    } catch {
      // Fallback to E.164 format verification
    }
  }

  return { exists: true, checkedVia: 'format_validation' };
}

export async function sendWhatsAppMessage(
  toPhone: string,
  message: string
): Promise<WhatsAppSendResult> {
  const sentAt = new Date().toISOString();
  const waLink = buildWaMeLink(toPhone, message);

  // For friend/social sharing without a specific recipient phone, return wa.me share link directly
  if (!toPhone.trim()) {
    return {
      delivered: false,
      channel: 'wa_me_fallback',
      waLink,
      messagePreview: message,
      sentAt,
    };
  }

  // 1. Meta WhatsApp Cloud API (1,000 free service conversations/month)
  const metaToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const metaPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (metaToken && metaPhoneId) {
    try {
      const resp = await fetch(
        `https://graph.facebook.com/v20.0/${metaPhoneId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${metaToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: toPhone.replace('+', ''),
            type: 'text',
            text: { body: message },
          }),
        }
      );
      if (resp.ok) {
        return {
          delivered: true,
          channel: 'meta_cloud',
          waLink,
          messagePreview: message,
          sentAt,
        };
      }
    } catch {
      // Try Evolution API or fallback
    }
  }

  // 2. Open-source Evolution API
  const evoUrl = process.env.EVOLUTION_API_URL;
  const evoKey = process.env.EVOLUTION_API_KEY;
  const evoInstance = process.env.EVOLUTION_INSTANCE;

  if (evoUrl && evoKey && evoInstance) {
    try {
      const resp = await fetch(
        `${evoUrl.replace(/\/$/, '')}/message/sendText/${evoInstance}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: evoKey,
          },
          body: JSON.stringify({
            number: toPhone.replace('+', ''),
            text: message,
          }),
        }
      );
      if (resp.ok) {
        return {
          delivered: true,
          channel: 'evolution_api',
          waLink,
          messagePreview: message,
          sentAt,
        };
      }
    } catch {
      // Fall through to wa.me deep-link
    }
  }

  return {
    delivered: false,
    channel: 'wa_me_fallback',
    waLink,
    messagePreview: message,
    sentAt,
  };
}
