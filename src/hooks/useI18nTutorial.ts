import { useCallback, useEffect, useRef } from 'react';
import { driver, type Config, type DriveStep, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { useTranslation } from 'react-i18next';
import type { TutorialRole } from '../i18n/config';

const TUTORIAL_EVENT = 'kk:open-action-help';

export interface TutorialHelpDetail {
  actionKey: string;
  role: TutorialRole;
}

export function dispatchActionHelp(detail: TutorialHelpDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<TutorialHelpDetail>(TUTORIAL_EVENT, { detail }));
}

const ROLE_DEFAULT_STEPS: Record<TutorialRole, string[]> = {
  CUSTOMER: [
    'start_tour',
    'explore_festive',
    'toggle_filters',
    'clear_filters',
    'apply_coupon',
    'proceed_checkout',
    'track_order',
    'request_return',
  ],
  SELLER: [
    'start_tour',
    'sync_trending',
    'add_listing',
    'save_category',
    'launch_campaign',
    'create_coupon',
    'save_payment_gateway',
    'confirm_order',
    'ship_order',
    'save_carrier',
  ],
  ADMIN: [
    'start_tour',
    'create_invite',
    'root_refresh',
    'sync_trending',
    'add_listing',
    'confirm_order',
  ],
  PROVIDER: [
    'start_tour',
    'provider_refresh',
    'provider_save_product',
    'provider_submit_review',
    'provider_save_carrier',
    'provider_save_warehouse',
    'provider_request_delegation',
  ],
};

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const nodes = Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
  return nodes.filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
}

export function useI18nTutorial(role: TutorialRole) {
  const { t, i18n } = useTranslation();
  const driverRef = useRef<Driver | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const liveRegionRef = useRef<HTMLDivElement | null>(null);
  const activeSessionRef = useRef<{
    mode: 'role' | 'single';
    keys: string[];
    stepIndex: number;
  } | null>(null);

  const announce = useCallback((message: string) => {
    const node = liveRegionRef.current;
    if (!node || !message) return;
    node.textContent = '';
    window.requestAnimationFrame(() => {
      node.textContent = message;
    });
  }, []);

  // Ensure a shared visually hidden aria-live="polite" region exists
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const region = document.createElement('div');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    region.className = 'sr-only';
    region.dataset.kkTutorialLive = role;
    document.body.appendChild(region);
    liveRegionRef.current = region;

    return () => {
      region.remove();
      liveRegionRef.current = null;
    };
  }, [role]);

  const destroyDriver = useCallback((restoreFocus = true) => {
    const active = driverRef.current;
    driverRef.current = null;
    if (active) {
      try {
        active.destroy();
      } catch {
        // Ignore cleanup errors
      }
    }
    if (restoreFocus && previousFocusRef.current && previousFocusRef.current.isConnected) {
      previousFocusRef.current.focus({ preventScroll: true });
      previousFocusRef.current = null;
    }
  }, []);

  const buildSteps = useCallback(
    (keys: string[], singleHelp: boolean): DriveStep[] => {
      const steps: DriveStep[] = [];
      for (const actionKey of keys) {
        const selector = `[data-tour="btn-${actionKey}"]`;
        const el = document.querySelector<HTMLElement>(selector);
        if (!el) continue;

        const title = t(`tutorials.${role}.${actionKey}.title`, {
          defaultValue: t(`actions.${actionKey}`),
        });
        const description = t(`tutorials.${role}.${actionKey}.desc`, {
          defaultValue: t(`actions.${actionKey}`),
        });

        steps.push({
          element: selector,
          popover: {
            title,
            description,
            side: 'bottom',
            align: 'start',
            ...(singleHelp ? { showButtons: ['close'], doneBtnText: t('tour_controls.done') } : {}),
          },
        });
      }
      return steps;
    },
    [role, t]
  );

  const launchSession = useCallback(
    (keys: string[], mode: 'role' | 'single', initialIndex = 0, preserveFocusOrigin = false) => {
      if (typeof window === 'undefined' || typeof document === 'undefined') return false;

      const prefersReducedMotion = Boolean(
        window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      );

      const steps = buildSteps(keys, mode === 'single');
      if (steps.length === 0) return false;

      if (!preserveFocusOrigin && document.activeElement instanceof HTMLElement) {
        previousFocusRef.current = document.activeElement;
      }

      destroyDriver(false);

      const clampedIndex = Math.max(0, Math.min(steps.length - 1, initialIndex));
      activeSessionRef.current = {
        mode,
        keys,
        stepIndex: clampedIndex,
      };

      const config: Config = {
        steps,
        animate: !prefersReducedMotion,
        smoothScroll: false,
        allowClose: true,
        allowKeyboardControl: true,
        showProgress: mode === 'role' && steps.length > 1,
        progressText: t('tour_controls.progress'),
        nextBtnText: t('tour_controls.next'),
        prevBtnText: t('tour_controls.prev'),
        doneBtnText: t('tour_controls.done'),
        popoverClass: 'kk-driver-popover',
        onHighlightStarted: (element) => {
          if (element instanceof HTMLElement) {
            element.scrollIntoView({
              behavior: prefersReducedMotion ? 'auto' : 'smooth',
              block: 'center',
              inline: 'nearest',
            });
          }
        },
        onPopoverRender: (popover, opts) => {
          const wrapper = popover.wrapper;
          wrapper.setAttribute('role', 'dialog');
          wrapper.setAttribute('aria-modal', 'true');
          wrapper.setAttribute('tabindex', '-1');

          const currentIdx = opts.driver.getActiveIndex() ?? clampedIndex;
          if (activeSessionRef.current) {
            activeSessionRef.current.stepIndex = currentIdx;
          }

          const currentStep = steps[currentIdx];
          const stepTitle = currentStep?.popover?.title || '';
          const stepDesc = currentStep?.popover?.description || '';
          announce(
            t('a11y.step_announcement', {
              title: stepTitle,
              desc: stepDesc,
            })
          );

          // Move focus smoothly into the active popover for screen readers & keyboard users
          window.requestAnimationFrame(() => {
            const focusTarget =
              wrapper.querySelector<HTMLElement>('.driver-popover-next-btn:not([disabled])') ||
              wrapper.querySelector<HTMLElement>('.driver-popover-close-btn') ||
              wrapper;
            focusTarget?.focus({ preventScroll: true });
          });
        },
        onDestroyed: () => {
          const shouldRestore = activeSessionRef.current !== null;
          activeSessionRef.current = null;
          driverRef.current = null;
          announce(t('a11y.tour_ended'));
          if (shouldRestore && previousFocusRef.current && previousFocusRef.current.isConnected) {
            const target = previousFocusRef.current;
            previousFocusRef.current = null;
            window.requestAnimationFrame(() => {
              target.focus({ preventScroll: true });
            });
          }
        },
      };

      const instance = driver(config);
      driverRef.current = instance;
      announce(t('a11y.tour_started'));
      instance.drive(clampedIndex);
      return true;
    },
    [announce, buildSteps, destroyDriver, t]
  );

  // Focus trap + Escape + Arrow key support while popover is mounted
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const instance = driverRef.current;
      if (!instance || !instance.isActive()) return;
      const popoverEl = document.querySelector<HTMLElement>('.driver-popover');
      if (!popoverEl) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        instance.destroy();
        return;
      }

      if (event.key === 'ArrowRight') {
        if (instance.hasNextStep()) {
          event.preventDefault();
          instance.moveNext();
        }
        return;
      }

      if (event.key === 'ArrowLeft') {
        if (instance.hasPreviousStep()) {
          event.preventDefault();
          instance.movePrevious();
        }
        return;
      }

      if (event.key === 'Tab') {
        const focusable = getFocusableElements(popoverEl);
        if (focusable.length === 0) {
          event.preventDefault();
          popoverEl.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const current = document.activeElement as HTMLElement | null;

        if (!current || !popoverEl.contains(current)) {
          event.preventDefault();
          first.focus();
          return;
        }

        if (event.shiftKey && current === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && current === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // Language-reactive sync: if a tutorial is active when language changes, update steps seamlessly
  useEffect(() => {
    const session = activeSessionRef.current;
    if (!session || !driverRef.current?.isActive()) return;
    const savedIndex = session.stepIndex;
    const savedMode = session.mode;
    const savedKeys = session.keys;
    activeSessionRef.current = null;
    launchSession(savedKeys, savedMode, savedIndex, true);
  }, [i18n.language, launchSession]);

  const startRoleTour = useCallback(
    (customKeys?: string[]) => {
      const keys = customKeys && customKeys.length > 0 ? customKeys : ROLE_DEFAULT_STEPS[role];
      return launchSession(keys, 'role', 0, false);
    },
    [launchSession, role]
  );

  const startActionHelp = useCallback(
    (actionKey: string) => {
      return launchSession([actionKey], 'single', 0, false);
    },
    [launchSession]
  );

  const closeTour = useCallback(() => {
    destroyDriver(true);
  }, [destroyDriver]);

  // Listen to ActionButton "?" help requests targeted at this role
  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<TutorialHelpDetail>;
      if (!custom.detail || custom.detail.role !== role) return;
      startActionHelp(custom.detail.actionKey);
    };
    window.addEventListener(TUTORIAL_EVENT, handler);
    return () => window.removeEventListener(TUTORIAL_EVENT, handler);
  }, [role, startActionHelp]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      activeSessionRef.current = null;
      if (driverRef.current) {
        try {
          driverRef.current.destroy();
        } catch {
          // Ignore
        }
        driverRef.current = null;
      }
    };
  }, []);

  return {
    startRoleTour,
    startActionHelp,
    closeTour,
  };
}
