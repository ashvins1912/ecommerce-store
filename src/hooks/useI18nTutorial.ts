import type { TutorialRole } from '../i18n/config';
import {
  dispatchActionHelp as dispatchActionHelpImpl,
  useI18nTutorial as useI18nTutorialImpl,
} from './useI18nTutorial.js';

export interface TutorialHelpDetail {
  actionKey: string;
  role: TutorialRole;
}

export function dispatchActionHelp(detail: TutorialHelpDetail): void {
  dispatchActionHelpImpl(detail);
}

export function useI18nTutorial(role: TutorialRole): {
  startRoleTour: (customKeys?: string[]) => boolean;
  startCustomerTour: () => boolean;
  startActionHelp: (actionKey: string) => boolean;
  closeTour: () => void;
  hasSeenCustomerTour: boolean;
  dismissCustomerTourPrompt: () => void;
} {
  return useI18nTutorialImpl(role);
}
