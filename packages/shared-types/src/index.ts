export type CommerceRole = 'BUYER' | 'SELLER' | 'PROVIDER' | 'ADMIN';
export type ProviderProductStatus = 'DRAFT' | 'PENDING_REVIEW' | 'NEGOTIATION_REQUESTED' | 'RESUBMITTED' | 'APPROVED' | 'APPROVED_AND_PUBLISHED' | 'REJECTED';
export type ProviderSettlementStatus = 'READY_FOR_SETTLEMENT' | 'ADJUSTED' | 'VOID' | 'SETTLED';
export interface ProviderInviteView { id: string; email?: string; status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED'; expiresAt: string; inviteUrl?: string }
export interface ProviderProductView { id: string; title: string; category: string; status: ProviderProductStatus; basePricePaise: number; linkedSellerIds: string[]; imageUrls: string[]; updatedAt: string }
export interface ProviderSettlementView { id: string; orderId: string; orderItemKey: string; quantity: number; amountPaise: number; status: ProviderSettlementStatus; utrReference?: string; settledAt?: string }
