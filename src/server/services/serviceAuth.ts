import crypto, { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export const SERVICE_TIMESTAMP_HEADER = 'x-service-timestamp';
export const SERVICE_SIGNATURE_HEADER = 'x-service-signature';
const DEFAULT_MAX_SKEW_SECONDS = 300;

export function buildServiceSignaturePayload(input: {
  timestamp: string;
  method: string;
  path: string;
  rawBody: string;
}): string {
  return `${input.timestamp}.${input.method.toUpperCase()}.${input.path}.${input.rawBody}`;
}

export function signServiceHeaders(input: {
  method: string;
  path: string;
  rawBody: string;
  secret: string;
  timestamp?: string;
}): Record<string, string> {
  if (!input.secret) {
    throw new Error('SERVICE_INTERNAL_SECRET_REQUIRED');
  }
  const timestamp = input.timestamp ?? String(Math.floor(Date.now() / 1000));
  const canonical = buildServiceSignaturePayload({
    timestamp,
    method: input.method,
    path: input.path,
    rawBody: input.rawBody,
  });
  const signature = crypto
    .createHmac('sha256', input.secret)
    .update(canonical)
    .digest('hex');

  return {
    [SERVICE_TIMESTAMP_HEADER]: timestamp,
    [SERVICE_SIGNATURE_HEADER]: signature,
  };
}

export function verifyServiceSignature(input: {
  method: string;
  path: string;
  rawBody: string;
  timestampHeader?: string;
  signatureHeader?: string;
  secret?: string;
  nowEpochSeconds?: number;
  maxSkewSeconds?: number;
}): {
  ok: boolean;
  reason?:
    | 'SERVICE_SECRET_NOT_CONFIGURED'
    | 'MISSING_AUTH_HEADERS'
    | 'EXPIRED_OR_INVALID_TIMESTAMP'
    | 'INVALID_SERVICE_SIGNATURE';
} {
  const secret = input.secret?.trim();
  if (!secret) {
    return { ok: false, reason: 'SERVICE_SECRET_NOT_CONFIGURED' };
  }
  const timestamp = String(input.timestampHeader || '').trim();
  const signature = String(input.signatureHeader || '').trim();
  if (!timestamp || !signature) {
    return { ok: false, reason: 'MISSING_AUTH_HEADERS' };
  }
  const parsedTs = Number(timestamp);
  if (!Number.isSafeInteger(parsedTs) || parsedTs <= 0) {
    return { ok: false, reason: 'EXPIRED_OR_INVALID_TIMESTAMP' };
  }
  const now = input.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  const maxSkew = input.maxSkewSeconds ?? DEFAULT_MAX_SKEW_SECONDS;
  if (Math.abs(now - parsedTs) > maxSkew) {
    return { ok: false, reason: 'EXPIRED_OR_INVALID_TIMESTAMP' };
  }
  const canonical = buildServiceSignaturePayload({
    timestamp,
    method: input.method,
    path: input.path,
    rawBody: input.rawBody,
  });
  const expected = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
  const suppliedBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (suppliedBuf.length !== expectedBuf.length || !timingSafeEqual(suppliedBuf, expectedBuf)) {
    return { ok: false, reason: 'INVALID_SERVICE_SIGNATURE' };
  }
  return { ok: true };
}

export function createInternalServiceAuthMiddleware(getSecret: () => string | undefined) {
  return (req: Request, res: Response, next: NextFunction) => {
    const rawBuffer = (req as Request & { rawBody?: Buffer }).rawBody;
    const rawBody = rawBuffer
      ? rawBuffer.toString('utf8')
      : req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0
        ? JSON.stringify(req.body)
        : '';
    const check = verifyServiceSignature({
      method: req.method,
      path: req.originalUrl || req.url || req.path,
      rawBody,
      timestampHeader: String(req.headers[SERVICE_TIMESTAMP_HEADER] || ''),
      signatureHeader: String(req.headers[SERVICE_SIGNATURE_HEADER] || ''),
      secret: getSecret(),
    });
    if (!check.ok) {
      const status = check.reason === 'SERVICE_SECRET_NOT_CONFIGURED' ? 503 : 401;
      return res.status(status).json({ error: check.reason || 'UNAUTHORIZED_SERVICE_CALL' });
    }
    next();
  };
}

export async function callInternalService<T>(input: {
  baseUrl: string;
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  secret: string;
  timeoutMs?: number;
}): Promise<T> {
  const method = input.method || 'POST';
  const normalizedBase = input.baseUrl.replace(/\/$/, '');
  const normalizedPath = input.path.startsWith('/') ? input.path : `/${input.path}`;
  const rawBody = input.body === undefined ? '' : JSON.stringify(input.body);
  const authHeaders = signServiceHeaders({
    method,
    path: normalizedPath,
    rawBody,
    secret: input.secret,
  });

  const response = await fetch(`${normalizedBase}${normalizedPath}`, {
    method,
    headers: {
      ...authHeaders,
      ...(rawBody ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(rawBody ? { body: rawBody } : {}),
    signal: AbortSignal.timeout(input.timeoutMs ?? 8000),
  });

  const text = await response.text();
  let parsed: any = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { error: text || 'INVALID_SERVICE_RESPONSE' };
  }

  if (!response.ok) {
    const err = new Error(parsed.error || `INTERNAL_SERVICE_HTTP_${response.status}`) as Error & {
      statusCode?: number;
    };
    err.statusCode = response.status;
    throw err;
  }
  return parsed as T;
}
