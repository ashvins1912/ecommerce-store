import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { syncHtmlLangDir } from '../i18n/config';

const TUTORIAL_EVENT = 'kk:open-action-help';
let driverModulePromise;
const CUSTOMER_TOUR_SEEN_KEY = 'kk_customer_tour_seen';

const ROLE_DEFAULT_STEPS = {
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

/**
 * Dispatch a targeted contextual help event for a single ActionButton.
 * @param {{ actionKey: string, role: 'ADMIN' | 'CUSTOMER' | 'SELLER' | 'PROVIDER' }} detail
 */
export function dispatchActionHelp(detail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(TUTORIAL_EVENT, { detail }));
}

function getFocusableElements(container) {
  const nodes = Array.from(
    container.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
  return nodes.filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
}

function isElementVisible(el) {
  if (!el || !(el instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  const rects = el.getClientRects();
  return rects.length > 0 && rects[0].width > 0 && rects[0].height > 0;
}

/**
 * Find the currently visible tour target (supports responsive compact aliases like -compact on mobile).
 * @param {string} actionKey
 * @returns {HTMLElement | null}
 */
function findVisibleTourElement(actionKey) {
  const candidates = [
    ...document.querySelectorAll(`[data-tour="btn-${actionKey}"]`),
    ...document.querySelectorAll(`[data-tour="btn-${actionKey}-compact"]`),
  ];
  for (const candidate of candidates) {
    if (isElementVisible(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Constrain the active driver.js popover inside the viewport with at least 16px safe padding on all edges
 * so narrow 320px–640px mobile viewports never clip popover controls or text.
 * @param {HTMLElement | null} popoverEl
 */
function clampPopoverToViewport(popoverEl) {
  if (!popoverEl || typeof window === 'undefined') return;

  const pad = 16;
  const maxWidth = Math.max(240, window.innerWidth - pad * 2);
  const maxHeight = Math.max(200, window.innerHeight - pad * 2);

  popoverEl.style.maxWidth = `${maxWidth}px`;
  popoverEl.style.maxHeight = `${maxHeight}px`;
  popoverEl.style.overflowY = 'auto';
  popoverEl.style.boxSizing = 'border-box';

  const rect = popoverEl.getBoundingClientRect();
  let deltaX = 0;
  let deltaY = 0;

  if (rect.right > window.innerWidth - pad) {
    deltaX = window.innerWidth - pad - rect.right;
  }
  if (rect.left + deltaX < pad) {
    deltaX = pad - rect.left;
  }

  if (rect.bottom > window.innerHeight - pad) {
    deltaY = window.innerHeight - pad - rect.bottom;
  }
  if (rect.top + deltaY < pad) {
    deltaY = pad - rect.top;
  }

  if (deltaX !== 0) {
    const currentLeft = parseFloat(popoverEl.style.left || `${rect.left}`);
    if (Number.isFinite(currentLeft)) {
      popoverEl.style.left = `${Math.round(currentLeft + deltaX)}px`;
    }
  }
  if (deltaY !== 0) {
    const currentTop = parseFloat(popoverEl.style.top || `${rect.top}`);
    if (Number.isFinite(currentTop)) {
      popoverEl.style.top = `${Math.round(currentTop + deltaY)}px`;
    }
  }
}

function readCustomerTourSeen() {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(CUSTOMER_TOUR_SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

function writeCustomerTourSeen() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CUSTOMER_TOUR_SEEN_KEY, '1');
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

/**
 * Accessible, language-reactive guided tour hook backed by driver.js.
 * @param {'ADMIN' | 'CUSTOMER' | 'SELLER' | 'PROVIDER'} role
 */
export function useI18nTutorial(role) {
  const { t, i18n } = useTranslation();
  const driverRef = useRef(null);
  const launchRequestRef = useRef(0);
  const previousFocusRef = useRef(null);
  const liveRegionRef = useRef(null);
  const activeSessionRef = useRef(null);
  const [hasSeenCustomerTour, setHasSeenCustomerTour] = useState(readCustomerTourSeen);

  const markCustomerTourSeen = useCallback(() => {
    writeCustomerTourSeen();
    setHasSeenCustomerTour(true);
  }, []);

  const announce = useCallback((message) => {
    const node = liveRegionRef.current;
    if (!node || !message) return;
    node.textContent = '';
    window.requestAnimationFrame(() => {
      node.textContent = message;
    });
  }, []);

  // Ensure a shared visually hidden aria-live="polite" region exists
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
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
    (keys, singleHelp) => {
      const steps = [];
      const isNarrowViewport = typeof window !== 'undefined' && window.innerWidth < 640;

      for (const actionKey of keys) {
        const el = findVisibleTourElement(actionKey);
        if (!el) continue;

        const title = t(`tutorials.${role}.${actionKey}.title`, {
          defaultValue: t(`actions.${actionKey}`),
        });
        const description = t(`tutorials.${role}.${actionKey}.desc`, {
          defaultValue: t(`actions.${actionKey}`),
        });

        steps.push({
          element: el,
          popover: {
            title,
            description,
            side: 'bottom',
            align: isNarrowViewport ? 'center' : 'start',
            ...(singleHelp
              ? { showButtons: ['close'], doneBtnText: t('tour_controls.done') }
              : {}),
          },
        });
      }
      return steps;
    },
    [role, t]
  );

  const launchSession = useCallback(
    async (keys, mode, initialIndex = 0, preserveFocusOrigin = false) => {
      if (typeof window === 'undefined' || typeof document === 'undefined') return false;
      const requestId = ++launchRequestRef.current;
      try {
        driverModulePromise ||= Promise.all([import('driver.js'), import('driver.js/dist/driver.css')]);
        await driverModulePromise;
      } catch {
        driverModulePromise = undefined;
        return false;
      }
      if (requestId !== launchRequestRef.current || typeof window === 'undefined' || typeof document === 'undefined') return false;
      const { driver } = await import('driver.js');

      const prefersReducedMotion = Boolean(
        window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      );

      const steps = buildSteps(keys, mode === 'single');
      if (steps.length === 0) return false;

      if (!preserveFocusOrigin && document.activeElement instanceof HTMLElement) {
        previousFocusRef.current = document.activeElement;
      }

      destroyDriver(false);

      if (role === 'CUSTOMER') {
        markCustomerTourSeen();
      }

      const clampedIndex = Math.max(0, Math.min(steps.length - 1, initialIndex));
      activeSessionRef.current = {
        mode,
        keys,
        stepIndex: clampedIndex,
      };

      const config = {
        steps,
        animate: !prefersReducedMotion,
        smoothScroll: false,
        allowClose: true,
        allowKeyboardControl: true,
        stagePadding: 6,
        popoverOffset: 10,
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

          window.requestAnimationFrame(() => {
            clampPopoverToViewport(wrapper);
            const focusTarget =
              wrapper.querySelector('.driver-popover-next-btn:not([disabled])') ||
              wrapper.querySelector('.driver-popover-close-btn') ||
              wrapper;
            if (focusTarget instanceof HTMLElement) {
              focusTarget.focus({ preventScroll: true });
            }
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
    [announce, buildSteps, destroyDriver, markCustomerTourSeen, role, t]
  );

  // Re-clamp active popover when mobile viewport resizes or orientation changes
  useEffect(() => {
    const onResize = () => {
      if (!driverRef.current?.isActive()) return;
      const popoverEl = document.querySelector('.driver-popover.kk-driver-popover');
      if (popoverEl instanceof HTMLElement) {
        clampPopoverToViewport(popoverEl);
      }
    };
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Focus trap + Escape + Arrow key support while popover is mounted
  useEffect(() => {
    const onKeyDown = (event) => {
      const instance = driverRef.current;
      if (!instance || !instance.isActive()) return;
      const popoverEl = document.querySelector('.driver-popover');
      if (!(popoverEl instanceof HTMLElement)) return;

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
        const current = document.activeElement;

        if (!(current instanceof HTMLElement) || !popoverEl.contains(current)) {
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

  // Language-reactive sync: keep <html lang/dir> synchronized and update active tutorial text live
  useEffect(() => {
    const currentLang = i18n.resolvedLanguage || i18n.language || 'en';
    syncHtmlLangDir(currentLang);
    const session = activeSessionRef.current;
    if (!session || !driverRef.current?.isActive()) return;
    const savedIndex = session.stepIndex;
    const savedMode = session.mode;
    const savedKeys = session.keys;
    activeSessionRef.current = null;
    launchSession(savedKeys, savedMode, savedIndex, true);
  }, [i18n.language, i18n.resolvedLanguage, launchSession]);

  const startRoleTour = useCallback(
    (customKeys) => {
      const keys =
        customKeys && customKeys.length > 0
          ? customKeys
          : ROLE_DEFAULT_STEPS[role] || ROLE_DEFAULT_STEPS.CUSTOMER;
      return launchSession(keys, 'role', 0, false);
    },
    [launchSession, role]
  );

  const startCustomerTour = useCallback(() => {
    return launchSession(ROLE_DEFAULT_STEPS.CUSTOMER, 'role', 0, false);
  }, [launchSession]);

  const startActionHelp = useCallback(
    (actionKey) => {
      return launchSession([actionKey], 'single', 0, false);
    },
    [launchSession]
  );

  const closeTour = useCallback(() => {
    launchRequestRef.current += 1;
    destroyDriver(true);
  }, [destroyDriver]);

  // Listen to ActionButton "?" help requests targeted at this role
  useEffect(() => {
    const handler = (event) => {
      const custom = event;
      if (!custom?.detail || custom.detail.role !== role) return;
      startActionHelp(custom.detail.actionKey);
    };
    window.addEventListener(TUTORIAL_EVENT, handler);
    return () => window.removeEventListener(TUTORIAL_EVENT, handler);
  }, [role, startActionHelp]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      launchRequestRef.current += 1;
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
    startCustomerTour,
    startActionHelp,
    closeTour,
    hasSeenCustomerTour,
    dismissCustomerTourPrompt: markCustomerTourSeen,
  };
}
