import { useState } from 'react';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, Lock, ShieldCheck, UserPlus } from 'lucide-react';
import { apiFetch, setClientSessionTokens } from '../lib/api';
import { useI18n } from '../lib/i18n';
import type { CartItem, User } from '../shared/types';

interface AccountSignUpViewProps {
  user: User | null;
  onAuthChanged: (payload: {
    user: User | null;
    likedProductIds?: string[];
    cart?: CartItem[];
  }) => void;
  onOpenSignIn: () => void;
  onNavigateStore: () => void;
}

export function AccountSignUpView({
  user,
  onAuthChanged,
  onOpenSignIn,
  onNavigateStore,
}: AccountSignUpViewProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setVerificationMessage(null);

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
        setVerificationMessage(
          data.message || 'Account created. Please verify your email before signing in.'
        );
        return;
      }

      if (data.user) {
        setClientSessionTokens(data.accessToken, data.csrfToken);
        onAuthChanged({
          user: data.user,
          likedProductIds: data.likedProductIds,
          cart: data.cart,
        });
        onNavigateStore();
      } else {
        throw new Error('The sign-up request completed without creating a session. Please try signing in or contact support.');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (user) {
    return (
      <section className="mx-auto max-w-[640px] px-4 sm:px-6 py-12">
        <div className="rounded-lg border border-[#E8E6E1] bg-white p-6 sm:p-8 text-center space-y-4">
          <CheckCircle2 className="h-9 w-9 text-emerald-700 mx-auto" />
          <h1 className="font-display text-3xl font-semibold text-[#141413]">
            {user.name}
          </h1>
          <p className="text-sm text-[#57534E]">
            {user.email} · {t('auth.sessionSub')}
          </p>
          <button
            type="button"
            onClick={onNavigateStore}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-[#881337] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#9F1239] cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>{t('auth.backToStore')}</span>
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
      <button
        type="button"
        onClick={onNavigateStore}
        className="mb-6 inline-flex min-h-[44px] items-center gap-1.5 text-xs font-medium text-[#57534E] hover:text-[#141413] cursor-pointer"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>{t('auth.backToStore')}</span>
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Editorial Column */}
        <div className="lg:col-span-5 space-y-5 pt-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#881337]">
            {t('signup.eyebrow')}
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold leading-tight text-[#141413]">
            {t('signup.heroTitle')}
          </h1>
          <p className="text-sm leading-relaxed text-[#57534E]">
            {t('signup.heroDesc')}
          </p>

          <ul className="space-y-3 border-t border-[#E8E6E1] pt-5 text-xs text-[#44403C]">
            <li className="flex items-start gap-2.5">
              <ShieldCheck className="h-4 w-4 text-[#881337] shrink-0 mt-0.5" />
              <span>{t('signup.perk1')}</span>
            </li>
            <li className="flex items-start gap-2.5">
              <UserPlus className="h-4 w-4 text-[#881337] shrink-0 mt-0.5" />
              <span>{t('signup.perk2')}</span>
            </li>
            <li className="flex items-start gap-2.5">
              <Lock className="h-4 w-4 text-[#881337] shrink-0 mt-0.5" />
              <span>{t('signup.perk3')}</span>
            </li>
          </ul>
        </div>

        {/* Right Form Card */}
        <div className="lg:col-span-7 rounded-xl border border-[#E8E6E1] bg-white p-6 sm:p-8 shadow-sm">
          <div className="border-b border-[#F0EEE9] pb-4">
            <h2 className="font-display text-2xl font-semibold text-[#141413]">
              {t('auth.signUpTitle')}
            </h2>
            <p className="mt-1 text-xs text-[#6B6A65]">{t('auth.signUpSub')}</p>
          </div>

          {error && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
              {error}
            </div>
          )}

          {verificationMessage && (
            <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900 space-y-2">
              <p className="font-medium">{verificationMessage}</p>
              <button
                type="button"
                onClick={onOpenSignIn}
                className="inline-flex items-center rounded bg-[#141413] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#2A2927] cursor-pointer"
              >
                {t('auth.tabSignIn')}
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label
                htmlFor="signup-name"
                className="block text-xs font-medium text-[#44403C] mb-1"
              >
                {t('auth.nameLabel')} *
              </label>
              <input
                id="signup-name"
                type="text"
                required
                minLength={2}
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('auth.namePlaceholder')}
                className="w-full rounded-md border border-[#D6D3CD] px-3.5 py-2.5 text-sm text-[#141413] focus:border-[#881337] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="signup-email"
                  className="block text-xs font-medium text-[#44403C] mb-1"
                >
                  {t('auth.emailLabel')} *
                </label>
                <input
                  id="signup-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('auth.emailPlaceholder')}
                  className="w-full rounded-md border border-[#D6D3CD] px-3.5 py-2.5 text-sm text-[#141413] focus:border-[#881337] focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="signup-mobile"
                  className="block text-xs font-medium text-[#44403C] mb-1"
                >
                  {t('auth.mobileLabel')}
                </label>
                <input
                  id="signup-mobile"
                  type="tel"
                  value={mobileNumber}
                  onChange={(e) => setMobileNumber(e.target.value)}
                  placeholder={t('auth.mobilePlaceholder')}
                  className="w-full rounded-md border border-[#D6D3CD] px-3.5 py-2.5 text-sm text-[#141413] tabular-nums focus:border-[#881337] focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="signup-password"
                  className="block text-xs font-medium text-[#44403C] mb-1"
                >
                  {t('auth.passwordLabel')} *
                </label>
                <div className="relative">
                  <input
                    id="signup-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('auth.passwordPlaceholder')}
                    className="w-full rounded-md border border-[#D6D3CD] px-3.5 py-2.5 pr-10 text-sm text-[#141413] focus:border-[#881337] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-10 w-10 items-center justify-center text-[#78716C] hover:text-[#141413] cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="signup-confirm"
                  className="block text-xs font-medium text-[#44403C] mb-1"
                >
                  {t('auth.confirmPasswordLabel')} *
                </label>
                <input
                  id="signup-confirm"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t('auth.confirmPasswordPlaceholder')}
                  className="w-full rounded-md border border-[#D6D3CD] px-3.5 py-2.5 text-sm text-[#141413] focus:border-[#881337] focus:outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[44px] rounded-md bg-[#881337] px-4 py-3 text-xs font-semibold text-white hover:bg-[#9F1239] disabled:opacity-60 cursor-pointer"
            >
              {loading ? t('auth.creatingAccount') : t('auth.createAccount')}
            </button>
          </form>

          <div className="mt-5 border-t border-[#F0EEE9] pt-4 text-center text-xs text-[#57534E]">
            {t('auth.alreadyAccount')}{' '}
            <button
              type="button"
              onClick={onOpenSignIn}
              className="font-semibold text-[#881337] hover:underline cursor-pointer"
            >
              {t('auth.tabSignIn')}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
