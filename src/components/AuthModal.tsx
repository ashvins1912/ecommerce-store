import { useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react';
import {
  apiFetch,
  clearClientSessionTokens,
  setClientSessionTokens,
} from '../lib/api';
import { useI18n } from '../lib/i18n';
import type { AuthSessionSummary, CartItem, User } from '../shared/types';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  oauthConfigured: { google: boolean; meta: boolean };
  onAuthChanged: (payload: {
    user: User | null;
    likedProductIds?: string[];
    cart?: CartItem[];
  }) => void;
}

export function AuthModal({
  isOpen,
  onClose,
  user,
  oauthConfigured,
  onAuthChanged,
}: AuthModalProps) {
  const { t, locale } = useI18n();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AuthSessionSummary[]>([]);
  const [rotatingToken, setRotatingToken] = useState(false);

  const loadSessions = async () => {
    try {
      const data = await apiFetch<{ sessions: AuthSessionSummary[] }>('/api/auth/sessions');
      setSessions(data.sessions || []);
    } catch {
      setSessions([]);
    }
  };

  useEffect(() => {
    if (isOpen && user) {
      void loadSessions();
    } else if (!user) {
      setSessions([]);
    }
  }, [isOpen, user?._id]);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        try {
          const me = await apiFetch<{
            user: User | null;
            csrfToken?: string;
            likedProductIds: string[];
            cart: CartItem[];
          }>('/api/auth/me');
          setClientSessionTokens(undefined, me.csrfToken);
          onAuthChanged(me);
          onClose();
        } catch (err) {
          setError((err as Error).message);
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onAuthChanged, onClose]);

  if (!isOpen) return null;

  const handleOAuthPopup = async (provider: 'google' | 'meta') => {
    setError(null);
    setLoading(true);
    try {
      const { url } = await apiFetch<{ url: string }>(`/api/auth/oauth/${provider}/url`);
      const popup = window.open(url, `${provider}_oauth`, 'width=540,height=680');
      if (!popup) {
        setError('Popup blocked by browser. Please allow popups and try again.');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async (payload: {
    email: string;
    name?: string;
    provider?: 'google' | 'meta';
    quickDemoUserId?: string;
  }) => {
    setError(null);
    setLoading(true);
    try {
      const data = await apiFetch<{
        user: User;
        accessToken?: string;
        csrfToken?: string;
        likedProductIds: string[];
        cart: CartItem[];
      }>('/api/auth/signin', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setClientSessionTokens(data.accessToken, data.csrfToken);
      onAuthChanged(data);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleRotateToken = async () => {
    setRotatingToken(true);
    setError(null);
    try {
      const res = await apiFetch<{
        accessToken: string;
        csrfToken: string;
        sessions: AuthSessionSummary[];
      }>('/api/auth/sessions/rotate', { method: 'POST' });
      setClientSessionTokens(res.accessToken, res.csrfToken);
      setSessions(res.sessions || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRotatingToken(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    setError(null);
    try {
      const res = await apiFetch<{ ok: boolean; loggedOutCurrent?: boolean }>(
        `/api/auth/sessions/${encodeURIComponent(sessionId)}`,
        { method: 'DELETE' }
      );
      if (res.loggedOutCurrent) {
        clearClientSessionTokens();
        const me = await apiFetch<{
          user: User | null;
          likedProductIds: string[];
          cart: CartItem[];
        }>('/api/auth/me');
        onAuthChanged(me);
        onClose();
        return;
      }
      await loadSessions();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleRevokeOthers = async () => {
    setError(null);
    try {
      const res = await apiFetch<{ sessions: AuthSessionSummary[] }>(
        '/api/auth/sessions/revoke-others',
        { method: 'POST' }
      );
      setSessions(res.sessions || []);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
      clearClientSessionTokens();
      const me = await apiFetch<{
        user: User | null;
        likedProductIds: string[];
        cart: CartItem[];
      }>('/api/auth/me');
      onAuthChanged(me);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const dummyAccounts = [
    {
      id: 'usr_buyer_1',
      name: 'Ananya Mehta',
      email: 'ananya.mehta@example.com',
      roleLabel: t('auth.roleBuyer'),
      desc: t('auth.buyerProfileDesc'),
    },
    {
      id: 'usr_seller_1',
      name: 'Meera Zaveri',
      email: 'meera@zaveriatelier.in',
      roleLabel: t('auth.roleSeller'),
      desc: t('auth.sellerProfileDesc'),
    },
    {
      id: 'usr_admin_1',
      name: 'Kala & Karat Ops',
      email: 'ops@kalaandkarat.in',
      roleLabel: t('auth.roleAdmin'),
      desc: t('auth.adminProfileDesc'),
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs">
      <div className="max-h-[90vh] overflow-y-auto w-full max-w-lg rounded-lg border border-[#E8E6E1] bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#F0EEE9] pb-4">
          <div>
            <h2 className="font-display text-2xl font-semibold text-[#141413]">
              {user ? t('auth.sessionTitle') : t('auth.signInTitle')}
            </h2>
            <p className="mt-1 text-xs text-[#6B6A65]">
              {user ? t('auth.sessionSub') : t('auth.signInSub')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('detail.close')}
            className="rounded-md p-1.5 text-[#57534E] hover:bg-[#F5F3EE] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {error}
          </div>
        )}

        {user ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-md border border-[#E8E6E1] bg-[#FAF9F6] p-4 text-sm">
              <div className="font-semibold text-[#141413]">{user.name}</div>
              <div className="text-xs text-[#6B6A65]">
                {user.email} · {t('auth.role')}: {user.role}
              </div>
              {user.mobileNumber && (
                <div className="mt-2 text-xs text-[#57534E] tabular-nums">
                  {t('auth.mobile')}: {user.mobileNumber}
                </div>
              )}
              {user.shippingAddresses[0] && (
                <div className="mt-1 text-xs text-[#57534E]">
                  {t('auth.defaultAddress')}: {user.shippingAddresses[0].street},{' '}
                  {user.shippingAddresses[0].city} {user.shippingAddresses[0].pincode}
                </div>
              )}
            </div>

            {/* SSL Token Authentication Session Manager */}
            <div className="rounded-md border border-[#E8E6E1] bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F0EEE9] pb-2.5">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-700" />
                  <span className="text-xs font-semibold text-[#141413]">
                    {t('ssl.title')}
                  </span>
                </div>
                <span className="text-[11px] font-mono text-emerald-800">
                  {t('ssl.tlsActive')}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleRotateToken}
                  disabled={rotatingToken}
                  className="inline-flex items-center gap-1.5 rounded border border-[#141413] bg-[#141413] px-3 py-1.5 text-[11px] font-medium text-white hover:bg-[#2A2927] disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`h-3 w-3 ${rotatingToken ? 'animate-spin' : ''}`} />
                  {rotatingToken ? t('ssl.rotating') : t('ssl.rotateBtn')}
                </button>
                {sessions.length > 1 && (
                  <button
                    type="button"
                    onClick={handleRevokeOthers}
                    className="inline-flex items-center gap-1 rounded border border-[#D6D3CD] px-3 py-1.5 text-[11px] font-medium text-[#57534E] hover:border-[#881337] hover:text-[#881337] cursor-pointer"
                  >
                    {t('ssl.revokeOthers')}
                  </button>
                )}
              </div>

              <div className="mt-3 space-y-2 max-h-44 overflow-y-auto">
                {sessions.length === 0 ? (
                  <p className="text-[11px] text-[#6B6A65]">{t('ssl.noSessions')}</p>
                ) : (
                  sessions.map((s) => (
                    <div
                      key={s.sessionId}
                      className={`flex items-center justify-between gap-2 rounded border px-3 py-2 text-[11px] ${
                        s.isCurrent
                          ? 'border-emerald-300 bg-emerald-50/40'
                          : 'border-[#F0EEE9] bg-[#FAF9F6]'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 font-medium text-[#141413]">
                          <span className="font-mono uppercase text-[10px] text-[#57534E]">
                            {s.protocol.toUpperCase()}
                          </span>
                          <span>·</span>
                          <span className="font-mono">{s.tokenFingerprint}</span>
                          {s.isCurrent && (
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
                              · {t('ssl.currentBadge')}
                            </span>
                          )}
                        </div>
                        <div className="truncate text-[10px] text-[#6B6A65] tabular-nums">
                          {s.provider} · {t('ssl.expires')}:{' '}
                          {new Date(s.expiresAt).toLocaleDateString(locale)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRevokeSession(s.sessionId)}
                        title={t('ssl.revoke')}
                        className="inline-flex shrink-0 items-center gap-1 rounded border border-[#E8E6E1] bg-white px-2 py-1 text-[10px] font-medium text-[#6B6A65] hover:border-red-300 hover:text-red-700 cursor-pointer"
                      >
                        <Trash2 className="h-3 w-3" />
                        {t('ssl.revoke')}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              disabled={loading}
              className="w-full rounded-md border border-[#D6D3CD] px-4 py-2.5 text-xs font-medium text-[#141413] hover:bg-[#F5F3EE] cursor-pointer"
            >
              {t('auth.signOut')}
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-5">
            {/* Real OAuth 2.0 Popup Triggers */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={loading}
                onClick={() =>
                  oauthConfigured.google
                    ? handleOAuthPopup('google')
                    : handleSignIn({
                        email: 'guest.google@example.com',
                        name: 'Google Shopper',
                        provider: 'google',
                      })
                }
                className="flex items-center justify-center gap-2 rounded-md border border-[#D6D3CD] bg-white px-3 py-2.5 text-xs font-medium text-[#141413] hover:bg-[#FAF9F6] cursor-pointer"
              >
                <span>{t('auth.google')}</span>
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() =>
                  oauthConfigured.meta
                    ? handleOAuthPopup('meta')
                    : handleSignIn({
                        email: 'guest.meta@example.com',
                        name: 'Meta Shopper',
                        provider: 'meta',
                      })
                }
                className="flex items-center justify-center gap-2 rounded-md border border-[#D6D3CD] bg-white px-3 py-2.5 text-xs font-medium text-[#141413] hover:bg-[#FAF9F6] cursor-pointer"
              >
                <span>{t('auth.meta')}</span>
              </button>
            </div>

            {/* Email Buyer Sign-In */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!email.trim()) return;
                handleSignIn({
                  email: email.trim(),
                  name: name.trim() || undefined,
                  provider: 'google',
                });
              }}
              className="space-y-3 border-t border-[#F0EEE9] pt-4"
            >
              <div className="text-xs font-medium text-[#44403C]">{t('auth.emailHeading')}</div>
              <input
                type="text"
                placeholder={t('auth.namePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm focus:border-[#881337] focus:outline-none"
              />
              <input
                type="email"
                required
                placeholder={t('auth.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm focus:border-[#881337] focus:outline-none"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md bg-[#881337] px-4 py-2.5 text-xs font-medium text-white hover:bg-[#9F1239] cursor-pointer"
              >
                {loading ? t('auth.signingIn') : t('auth.signInSync')}
              </button>
            </form>
          </div>
        )}

        {/* Dummy Test Accounts (Customer, Seller, Admin) - always accessible for fast role testing */}
        <div className="mt-5 border-t border-[#F0EEE9] pt-4">
          <div className="mb-2 text-xs font-medium text-[#6B6A65]">
            {t('auth.quickProfiles')}
          </div>
          <div className="space-y-2">
            {dummyAccounts.map((acc) => {
              const isActive =
                Boolean(user) &&
                (user?._id === acc.id || user?.email.toLowerCase() === acc.email.toLowerCase());
              return (
                <button
                  key={acc.id}
                  type="button"
                  disabled={loading || isActive}
                  onClick={() =>
                    handleSignIn({
                      email: acc.email,
                      quickDemoUserId: acc.id,
                    })
                  }
                  className={`w-full rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                    isActive
                      ? 'border-[#881337] bg-[#FFF8F6]'
                      : 'border-[#E8E6E1] hover:border-[#881337] cursor-pointer'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[#141413]">
                      {acc.name} · <span className="text-[#881337]">{acc.roleLabel}</span>
                    </span>
                    {isActive && (
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[#881337]">
                        {t('auth.activeLabel')}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#6B6A65]">{acc.desc}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
