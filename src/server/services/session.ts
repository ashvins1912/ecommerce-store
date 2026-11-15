import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import type { AuthSessionSummary, User } from '../../shared/types.js';

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET must be configured in production.');
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export interface AuthSessionRecord {
  sessionId: string;
  userId: string;
  role: User['role'];
  provider: 'supabase' | 'invite' | 'demo';
  tokenFingerprint: string;
  csrfToken: string;
  tlsSecure: boolean;
  protocol: string;
  userAgent: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  revokedAt?: string | null;
}

export interface SignedSessionPayload {
  sid: string;
  sub: string;
  role: User['role'];
  iat: number;
  exp: number;
  tls: boolean;
}

function toBase64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64').toString('utf-8');
}

export function isRequestTlsSecure(req: Request): { tlsSecure: boolean; protocol: string } {
  const fwdProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  const fwdSsl = String(req.headers['x-forwarded-ssl'] || '').toLowerCase();
  const host = String(req.headers.host || '');
  const isHttps =
    req.secure ||
    fwdProto.includes('https') ||
    fwdSsl === 'on' ||
    host.includes('.run.app');
  return {
    tlsSecure: isHttps,
    protocol: isHttps ? 'https' : req.protocol || 'http',
  };
}

export function getSslSessionCookieOpts() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    maxAge: TOKEN_TTL_MS,
    path: '/',
  };
}

export function signSslSessionToken(payload: SignedSessionPayload): string {
  const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = toBase64Url(JSON.stringify(payload));
  const unsigned = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(unsigned).digest();
  return `${unsigned}.${toBase64Url(sig)}`;
}

export function verifySslSessionToken(token?: string | null): SignedSessionPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const unsigned = `${header}.${body}`;
  const expected = toBase64Url(
    crypto.createHmac('sha256', SESSION_SECRET).update(unsigned).digest()
  );

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromBase64Url(body)) as SignedSessionPayload;
    if (!parsed.sid || !parsed.sub || !parsed.exp) return null;
    if (Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function extractBearerOrCookieToken(req: Request): string | null {
  const authHeader = String(req.headers.authorization || '');
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }
  const cookieToken = req.cookies?.kk_session;
  if (typeof cookieToken === 'string' && cookieToken.trim()) {
    return cookieToken.trim();
  }
  return null;
}

export function buildTokenFingerprint(token: string): string {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return `tls_${hash.slice(0, 12)}`;
}

export function createSessionArtifact(
  req: Request,
  user: User,
  provider: 'supabase' | 'invite' | 'demo'
): { record: AuthSessionRecord; token: string } {
  const nowMs = Date.now();
  const expMs = nowMs + TOKEN_TTL_MS;
  const sessionId = `sess_${crypto.randomBytes(12).toString('hex')}`;
  const csrfToken = `csrf_${crypto.randomBytes(12).toString('hex')}`;
  const { tlsSecure, protocol } = isRequestTlsSecure(req);

  const token = signSslSessionToken({
    sid: sessionId,
    sub: user._id,
    role: user.role,
    iat: nowMs,
    exp: expMs,
    tls: tlsSecure,
  });

  const ua = String(req.headers['user-agent'] || 'Web Client').slice(0, 140);
  const record: AuthSessionRecord = {
    sessionId,
    userId: user._id,
    role: user.role,
    provider,
    tokenFingerprint: buildTokenFingerprint(token),
    csrfToken,
    tlsSecure,
    protocol,
    userAgent: ua,
    createdAt: new Date(nowMs).toISOString(),
    lastActiveAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(expMs).toISOString(),
    revokedAt: null,
  };

  return { record, token };
}

export function toSessionSummary(
  rec: AuthSessionRecord,
  currentSessionId?: string | null
): AuthSessionSummary {
  return {
    sessionId: rec.sessionId,
    tokenFingerprint: rec.tokenFingerprint,
    tlsSecure: rec.tlsSecure,
    protocol: rec.protocol,
    provider: rec.provider,
    userAgent: rec.userAgent,
    createdAt: rec.createdAt,
    lastActiveAt: rec.lastActiveAt,
    expiresAt: rec.expiresAt,
    revokedAt: rec.revokedAt || null,
    isCurrent: Boolean(currentSessionId && rec.sessionId === currentSessionId),
  };
}

export function attachSslSecurityHeaders(res: Response) {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}
