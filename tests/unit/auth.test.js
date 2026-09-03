// Auth permission-primitive tests, written before extraction (same rule as
// tests/unit/business.test.js: "this phase relocates logic; it does not
// change it"). These pin main.js's actual current _canAccessPage/getUserPerm
// behavior, quirks included — e.g. a role absent from canAccessPage's own
// map (Viewer, or any typo/future role) silently gets full page access
// instead of being denied by default, and getPermission falls through to
// Staff's per-flag checks for any role that isn't Admin/Viewer/Manager.
import { describe, it, expect } from 'vitest';
import { canAccessPage, getPermission } from '../../packages/auth/index.js';

describe('canAccessPage — role/page access gate', () => {
  it('Admin: every page allowed, including set and audit', () => {
    for (const pg of ['dash', 'jobs', 'inv', 'stmt', 'rep', 'req', 'dir', 'props', 'certs', 'client', 'set', 'map', 'audit', 'anything-else']) {
      expect(canAccessPage('Admin', pg)).toBe(true);
    }
  });

  it('Manager: allowed for every page in its list, including set; blocked from audit and pages outside its list', () => {
    const allowed = ['dash', 'jobs', 'inv', 'stmt', 'rep', 'req', 'dir', 'props', 'certs', 'client', 'set', 'map'];
    for (const pg of allowed) expect(canAccessPage('Manager', pg)).toBe(true);
    expect(canAccessPage('Manager', 'audit')).toBe(false);
    expect(canAccessPage('Manager', 'not-a-real-page')).toBe(false);
  });

  it('Finance: allowed for its list including set; blocked from audit, and blocked from pages outside its list (e.g. certs, map, req)', () => {
    const allowed = ['dash', 'jobs', 'inv', 'stmt', 'rep', 'dir', 'props', 'set'];
    for (const pg of allowed) expect(canAccessPage('Finance', pg)).toBe(true);
    expect(canAccessPage('Finance', 'audit')).toBe(false);
    expect(canAccessPage('Finance', 'certs')).toBe(false);
    expect(canAccessPage('Finance', 'map')).toBe(false);
    expect(canAccessPage('Finance', 'req')).toBe(false);
  });

  it('Staff: allowed for its list; blocked from set and audit; blocked from pages outside its list (e.g. rep, map)', () => {
    const allowed = ['dash', 'jobs', 'inv', 'stmt', 'req', 'dir', 'props', 'certs', 'client'];
    for (const pg of allowed) expect(canAccessPage('Staff', pg)).toBe(true);
    expect(canAccessPage('Staff', 'set')).toBe(false);
    expect(canAccessPage('Staff', 'audit')).toBe(false);
    expect(canAccessPage('Staff', 'rep')).toBe(false);
    expect(canAccessPage('Staff', 'map')).toBe(false);
  });

  it('QUIRK: a role with no entry in the page-access map (Viewer, or an unrecognized role) gets full default access to every page except set and audit', () => {
    // rolePages['Viewer'] is undefined, so the "allowed && !allowed.includes(pg)"
    // guard never triggers — the function falls straight through to true,
    // for every page except the two that have their own explicit checks.
    for (const pg of ['dash', 'jobs', 'inv', 'stmt', 'rep', 'req', 'dir', 'props', 'certs', 'client', 'map']) {
      expect(canAccessPage('Viewer', pg)).toBe(true);
      expect(canAccessPage('made-up-role', pg)).toBe(true);
      expect(canAccessPage(undefined, pg)).toBe(true);
    }
    expect(canAccessPage('Viewer', 'set')).toBe(false);
    expect(canAccessPage('Viewer', 'audit')).toBe(false);
  });
});

describe('getPermission — per-user, per-permission check', () => {
  it('no user at all: false for every permission', () => {
    expect(getPermission(null, 'canEdit')).toBe(false);
    expect(getPermission(undefined, 'seePrice')).toBe(false);
  });

  it('Admin: true for every permission, regardless of the user object\'s own flags', () => {
    expect(getPermission({ role: 'Admin' }, 'canEdit')).toBe(true);
    expect(getPermission({ role: 'Admin', canEdit: false }, 'canEdit')).toBe(true);
    expect(getPermission({ role: 'Admin' }, 'canManageUsers')).toBe(true);
  });

  it('Viewer: false for every permission, regardless of the user object\'s own flags', () => {
    expect(getPermission({ role: 'Viewer' }, 'seePrice')).toBe(false);
    expect(getPermission({ role: 'Viewer', seePrice: true }, 'seePrice')).toBe(false);
  });

  it('Manager: true for everything except canManageUsers', () => {
    expect(getPermission({ role: 'Manager' }, 'canEdit')).toBe(true);
    expect(getPermission({ role: 'Manager' }, 'seePrice')).toBe(true);
    expect(getPermission({ role: 'Manager' }, 'canManageUsers')).toBe(false);
  });

  it('Staff: "see*" permissions default to true unless explicitly false', () => {
    const u = { role: 'Staff' };
    expect(getPermission(u, 'seeLandlord')).toBe(true);
    expect(getPermission(u, 'seeLandlordPhone')).toBe(true);
    expect(getPermission(u, 'seeAgent')).toBe(true);
    expect(getPermission(u, 'seeContact')).toBe(true);
    expect(getPermission(u, 'seePrice')).toBe(true);
    expect(getPermission({ role: 'Staff', seePrice: false }, 'seePrice')).toBe(false);
  });

  it('Staff: "can*" permissions default to false unless explicitly true', () => {
    const u = { role: 'Staff' };
    expect(getPermission(u, 'canEdit')).toBe(false);
    expect(getPermission(u, 'canDelete')).toBe(false);
    expect(getPermission(u, 'canInvoice')).toBe(false);
    expect(getPermission(u, 'canFinance')).toBe(false);
    expect(getPermission({ role: 'Staff', canEdit: true }, 'canEdit')).toBe(true);
  });

  it('Staff: canManageUsers is always false, even if the flag is set true on the user object', () => {
    expect(getPermission({ role: 'Staff', canManageUsers: true }, 'canManageUsers')).toBe(false);
  });

  it('QUIRK: an unrecognized permission name defaults to true for Staff (and any non-Admin/Viewer/Manager role)', () => {
    expect(getPermission({ role: 'Staff' }, 'notARealPermission')).toBe(true);
  });

  it('QUIRK: a role that is not Admin/Viewer/Manager (e.g. Finance, or a typo) falls through to Staff\'s per-flag checks', () => {
    expect(getPermission({ role: 'Finance' }, 'canEdit')).toBe(false);
    expect(getPermission({ role: 'Finance', canEdit: true }, 'canEdit')).toBe(true);
    expect(getPermission({ role: 'Finance' }, 'seePrice')).toBe(true);
  });
});
