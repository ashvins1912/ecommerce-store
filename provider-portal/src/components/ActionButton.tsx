import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TutorialRole } from '../i18n/config';
import { dispatchActionHelp } from '../hooks/useI18nTutorial';

export type ActionButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';

export interface ActionButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'role' | 'onClick'> {
  actionKey: string;
  role: TutorialRole;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  showHelpIcon?: boolean;
  onHelpClick?: (actionKey: string, role: TutorialRole) => void;
  variant?: ActionButtonVariant;
  icon?: ReactNode;
  labelOverride?: string;
  fullWidthMobile?: boolean;
}

const VARIANT_CLASSES: Record<ActionButtonVariant, string> = {
  primary:
    'bg-[#881337] text-white border border-transparent hover:bg-[#9F1239] shadow-xs',
  secondary:
    'bg-[#141413] text-white border border-transparent hover:bg-[#292524] shadow-xs',
  outline:
    'bg-white text-[#141413] border border-[#D6D3CD] hover:border-[#881337] hover:text-[#881337]',
  danger:
    'bg-white text-red-700 border border-red-200 hover:bg-red-50 hover:border-red-300',
  ghost:
    'bg-transparent text-[#44403C] border border-transparent hover:bg-[#F5F3EE] hover:text-[#141413]',
};

export function ActionButton({
  actionKey,
  role,
  onClick,
  disabled = false,
  showHelpIcon = false,
  onHelpClick,
  variant = 'primary',
  icon,
  labelOverride,
  fullWidthMobile = true,
  type = 'button',
  className = '',
  ...rest
}: ActionButtonProps) {
  const { t } = useTranslation();
  const translatedLabel = labelOverride || t(`actions.${actionKey}`);

  const widthClass = fullWidthMobile ? 'w-full sm:w-auto' : 'w-auto';

  const handlePrimaryClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  const handleHelpClick = () => {
    if (onHelpClick) {
      onHelpClick(actionKey, role);
      return;
    }
    dispatchActionHelp({ actionKey, role });
  };

  return (
    <div
      className={`inline-flex items-center gap-1.5 ${
        fullWidthMobile ? 'w-full sm:w-auto' : 'w-auto'
      }`}
    >
      <button
        type={type}
        data-tour={`btn-${actionKey}`}
        data-role={role}
        aria-disabled={disabled ? 'true' : undefined}
        disabled={disabled}
        onClick={handlePrimaryClick}
        className={`${widthClass} min-h-[44px] min-w-[44px] inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#881337] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${VARIANT_CLASSES[variant]} ${className}`}
        {...rest}
      >
        {icon}
        <span>{translatedLabel}</span>
      </button>

      {showHelpIcon && (
        <button
          type="button"
          onClick={handleHelpClick}
          aria-label={t('a11y.help_btn_label', { action: translatedLabel })}
          title={t('a11y.help_btn_label', { action: translatedLabel })}
          className="h-[44px] w-[44px] min-h-[44px] min-w-[44px] shrink-0 inline-flex items-center justify-center rounded-md border border-[#E8E6E1] bg-white text-[#57534E] hover:border-[#881337] hover:text-[#881337] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#881337] focus-visible:ring-offset-2 transition-colors cursor-pointer"
        >
          <HelpCircle className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
