import test from 'node:test';
import assert from 'node:assert/strict';
import { canInviteRole, getAccessLevel } from './roles.js';

test('access levels distinguish root from regular administrators', () => {
  assert.equal(getAccessLevel({ role: 'ADMIN', isRootSuperuser: true }), 0);
  assert.equal(getAccessLevel({ role: 'ADMIN' }), 1);
  assert.equal(getAccessLevel({ role: 'SELLER' }), 2);
  assert.equal(getAccessLevel({ role: 'PROVIDER' }), 2);
  assert.equal(getAccessLevel({ role: 'BUYER' }), 3);
  assert.equal(getAccessLevel(null), null);
});

test('only root can invite administrators', () => {
  assert.equal(canInviteRole({ role: 'ADMIN', isRootSuperuser: true }, 'ADMIN'), true);
  assert.equal(canInviteRole({ role: 'ADMIN' }, 'ADMIN'), false);
  assert.equal(canInviteRole({ role: 'SELLER' }, 'ADMIN'), false);
});

test('Level 1 administrators and sellers can only invite scoped business roles', () => {
  const admin = { role: 'ADMIN' as const };
  const seller = { role: 'SELLER' as const };
  assert.equal(canInviteRole(admin, 'SELLER'), true);
  assert.equal(canInviteRole(admin, 'PROVIDER'), true);
  assert.equal(canInviteRole(seller, 'PROVIDER'), true);
  assert.equal(canInviteRole(seller, 'SELLER'), false);
  assert.equal(canInviteRole({ role: 'PROVIDER' }, 'SELLER'), false);
  assert.equal(canInviteRole(null, 'PROVIDER'), false);
});
