import { useEffect, useState } from 'react';
import { Eye, EyeOff, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react';
import { getSupabaseBrowserClient } from '../lib/supabase';
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
  initialMode?: 'signin' | 'signup';
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
  initialMode = 'signin',
  onAuthChanged,
}: AuthModalProps) {
  const { t, locale } = useI18n();
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verificationNotice, setVerificationNotice] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AuthSessionSummary[]>([]);
  const [rotatingToken, setRotatingToken] = useState(false);

  const handleSocialSignIn = async (provider: 'google' | 'facebook') => {
    setError(null);
    setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        throw new Error('Social sign-in is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
      }
      const redirectTo = new URL(window.location.href);
      redirectTo.searchParams.set('oauth', '1');
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: redirectTo.toString() },
      });
      if (oauthError) throw oauthError;
    } catch (err) {
      setError((err as Error).message || 'Unable to start social sign-in.');
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setError(null);
      setVerificationNotice(null);
    }
  }, [isOpen, initialMode]);

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

  if (!isOpen) return null;

  const handleSignIn = async (
    payload:
      | { quickDemoUserId: string; email?: string }
      | { email: string; password: string }
  ) => {
    setError(null);
    setVerificationNotice(null);
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

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setVerificationNotice(null);

    if (password !== confirmPassword) {
      setError(t('auth.passwordMismatch'));
      return;
    }

    setLoading(true);
    try {
      const data = await apiFetch<{
        ok?: boolean;
        requiresEmailVerification?: boolean;
        message?: string;
        user?: User;
        accessToken?: string;
        csrfToken?: string;
        likedProductIds?: string[];
        cart?: CartItem[];
      }>('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          mobileNumber: mobileNumber.trim() || undefined,
        }),
      });

      if (data.requiresEmailVerification) {
        setVerificationNotice(
          data.message || 'Account created. Please check your email to confirm before signing in.'
        );
        setMode('signin');
        return;
      }

      if (data.user) {
        setClientSessionTokens(data.accessToken, data.csrfToken);
        onAuthChanged({
          user: data.user,
          likedProductIds: data.likedProductIds,
          cart: data.cart,
        });
        onClose();
      }
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
      image: '/src/assets/images/hero_kala_karat_1794740129596.jpg',
    },
    {
      id: 'usr_seller_1',
      name: 'Meera Zaveri',
      email: 'meera@zaveriatelier.in',
      roleLabel: t('auth.roleSeller'),
      desc: t('auth.sellerProfileDesc'),
      image: '/src/assets/images/jewellery_kundan_choker_1794740131002.jpg',
    },
    {
      id: 'usr_admin_1',
      name: 'Kala & Karat Ops',
      email: 'ops@kalaandkarat.in',
      roleLabel: t('auth.roleAdmin'),
      desc: t('auth.adminProfileDesc'),
      image: '/src/assets/images/hero_kala_karat_1794740129596.jpg',
    },
    {
      id: 'usr_provider_1',
      name: 'Aarav Artisan Supply',
      email: 'provider.aarav@example.com',
      roleLabel: 'Provider',
      desc: 'Demo provider · jewellery supply catalog',
      image: '/src/assets/images/jewellery_kundan_choker_1794740131002.jpg',
    },
    {
      id: 'usr_provider_2',
      name: 'Nisha Craft Works',
      email: 'provider.nisha@example.com',
      roleLabel: 'Provider',
      desc: 'Demo provider · handloom and apparel supply',
      image: '/src/assets/images/clothing_anarkali_kurta_1794740131627.jpg',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs">
      <div className="max-h-[90vh] overflow-y-auto w-full max-w-lg rounded-lg border border-[#E8E6E1] bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#F0EEE9] pb-4">
          <div>
            <h2 className="font-display text-2xl font-semibold text-[#141413]">
              {user
                ? t('auth.sessionTitle')
                : mode === 'signup'
                ? t('auth.signUpTitle')
                : t('auth.signInTitle')}
            </h2>
            <p className="mt-1 text-xs text-[#6B6A65]">
              {user
                ? t('auth.sessionSub')
                : mode === 'signup'
                ? t('auth.signUpSub')
                : t('auth.signInSub')}
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

        {verificationNotice && (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            {verificationNotice}
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
            <div className="flex items-center justify-center gap-2 text-[11px] text-[#78716C]">
              <span>Welcome back</span>
              <span aria-hidden="true">·</span>
              <span>Create one account to shop and sell</span>
            </div>
            {/* Account access */}
            <div className="grid grid-cols-2 rounded-md border border-[#E8E6E1] bg-[#FAF9F6] p-1">
              <button
                type="button"
                onClick={() => {
                  setMode('signin');
                  setError(null);
                }}
                className={`rounded py-2 text-xs font-semibold transition-colors cursor-pointer ${
                  mode === 'signin'
                    ? 'bg-white text-[#141413] shadow-xs'
                    : 'text-[#6B6A65] hover:text-[#141413]'
                }`}
              >
                {t('auth.tabSignIn')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('signup');
                  setError(null);
                }}
                className={`rounded py-2 text-xs font-semibold transition-colors cursor-pointer ${
                  mode === 'signup'
                    ? 'bg-white text-[#141413] shadow-xs'
                    : 'text-[#6B6A65] hover:text-[#141413]'
                }`}
              >
                {t('auth.tabSignUp')}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button type="button" disabled={loading} onClick={() => void handleSocialSignIn('google')}
                className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-md border border-[#D6D3CD] bg-white px-3 py-2 text-xs font-semibold text-[#292524] hover:border-[#881337] disabled:opacity-60">
                <span aria-hidden="true" className="text-base font-bold">G</span>
                <span>Google</span>
              </button>
              <button type="button" disabled={loading} onClick={() => void handleSocialSignIn('facebook')}
                className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-md border border-[#D6D3CD] bg-white px-3 py-2 text-xs font-semibold text-[#292524] hover:border-[#881337] disabled:opacity-60">
                <span aria-hidden="true" className="text-base font-bold text-[#1877F2]">f</span>
                <span>Facebook</span>
              </button>
            </div>
            <div className="flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.18em] text-[#A8A29E]">
              <span className="h-px flex-1 bg-[#E8E6E1]" />
              <span>Or use email</span>
              <span className="h-px flex-1 bg-[#E8E6E1]" />
            </div>
            {mode === 'signin' ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!email.trim() || !password) return;
                  void handleSignIn({
                    email: email.trim(),
                    password,
                  });
                }}
                className="space-y-3"
              >
                <div className="text-xs font-medium text-[#44403C]">{t('auth.emailHeading')}</div>
                <input
                  type="email"
                  required
                  placeholder={t('auth.emailPlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm focus:border-[#881337] focus:outline-none"
                />
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder={t('auth.passwordPlaceholder')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 pr-10 text-sm focus:border-[#881337] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#78716C] hover:text-[#141413] cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full min-h-[42px] rounded-md bg-[#881337] px-4 py-2.5 text-xs font-medium text-white hover:bg-[#9F1239] disabled:opacity-60 cursor-pointer"
                >
                  {loading ? t('auth.signingIn') : t('auth.signInSync')}
                </button>
              </form>
            ) : (
              <form onSubmit={handleSignUp} className="space-y-3">
                <input
                  type="text"
                  required
                  minLength={2}
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
                <input
                  type="tel"
                  placeholder={`${t('auth.mobileLabel')} (${t('auth.mobilePlaceholder')})`}
                  value={mobileNumber}
                  onChange={(e) => setMobileNumber(e.target.value)}
                  className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm tabular-nums focus:border-[#881337] focus:outline-none"
                />
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    placeholder={t('auth.passwordPlaceholder')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 pr-10 text-sm focus:border-[#881337] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#78716C] hover:text-[#141413] cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  placeholder={t('auth.confirmPasswordPlaceholder')}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm focus:border-[#881337] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full min-h-[42px] rounded-md bg-[#881337] px-4 py-2.5 text-xs font-medium text-white hover:bg-[#9F1239] disabled:opacity-60 cursor-pointer"
                >
                  {loading ? t('auth.creatingAccount') : t('auth.createAccount')}
                </button>
              </form>
            )}


          </div>
        )}

        {/* Demo profiles are deliberately hidden in production; live users authenticate through Supabase. */}
        {import.meta.env.DEV && <div className="mt-5 border-t border-[#F0EEE9] pt-4">
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
                  <div className="flex items-center gap-3">
                    <img src={acc.image} alt="" className="h-11 w-11 shrink-0 rounded-md object-cover" loading="lazy" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold text-[#141413]">
                          {acc.name} · <span className="text-[#881337]">{acc.roleLabel}</span>
                        </span>
                        {isActive && (
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#881337]">
                            {t('auth.activeLabel')}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[#6B6A65]">{acc.desc}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>}
      </div>
    </div>
  );
}
