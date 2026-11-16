export type PlatformRole = 'BUYER' | 'SELLER' | 'PROVIDER' | 'ADMIN';
export type InviteableRole = 'ADMIN' | 'SELLER' | 'PROVIDER';

export interface RoleActor {
  role: PlatformRole;
  isRootSuperuser?: boolean;
}

/** Level 0 is a dedicated root flag; ADMIN without it is Level 1. */
export function getAccessLevel(actor: RoleActor | null | undefined): 0 | 1 | 2 | 3 | null {
  if (!actor) return null;
  if (actor.role === 'ADMIN' && actor.isRootSuperuser === true) return 0;
  if (actor.role === 'ADMIN') return 1;
  if (actor.role === 'SELLER' || actor.role === 'PROVIDER') return 2;
  return 3;
}

/** Root may provision admins; Level 1 admins may only provision business roles; sellers may invite providers. */
export function canInviteRole(actor: RoleActor | null | undefined, target: InviteableRole): boolean {
  if (!actor) return false;
  const level = getAccessLevel(actor);
  if (level === 0) return true;
  if (level === 1) return target === 'SELLER' || target === 'PROVIDER';
  if (actor.role === 'SELLER') return target === 'PROVIDER';
  return false;
}
