export const COMMERCE_ROLES = ['BUYER', 'SELLER', 'PROVIDER', 'ADMIN'] as const;
export const PROVIDER_EDITABLE_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'NEGOTIATION_REQUESTED', 'RESUBMITTED'] as const;
export const INR_FROM_PAISE = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);
export const isProviderEditable = (status: string) => (PROVIDER_EDITABLE_STATUSES as readonly string[]).includes(status);
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
