// Session/permission-checking primitives — deliberately NOT identity
// establishment (Office/Employee use real Supabase Auth, the Client Portal
// uses a URL token + PIN; see ARCHITECTURE_REDESIGN_PROPOSAL.md §1.8). Each
// app's own doLogin/bootstrap stays local; only the logic that *consumes*
// an already-established identity (role checks, permission gates) lives
// here, shared. Extracted from apps/office/main.js's _canAccessPage/
// getUserPerm verbatim — same rule as packages/business: relocate, don't
// change. Both were parameterized (role/user passed in explicitly) instead
// of closing over main.js's module-level _appUser, which is what makes them
// testable here in isolation.

// Shared by nav()'s own gate and by the last-page restore in
// applyUserPermissions() -- not every page has a sidebar .ni entry to check
// visibility against (Settings is only reachable via the user menu), so
// restoring on reload needs the same real rule nav() enforces, not a DOM check.
export function canAccessPage(role, pg){
  const rolePages={
    Admin: null, // null = all pages allowed
    Manager: ['dash','jobs','inv','stmt','rep','req','dir','props','certs','client','set','map'],
    Finance: ['dash','jobs','inv','stmt','rep','dir','props','set'],
    Staff:   ['dash','jobs','inv','stmt','req','dir','props','certs','client'],
  };
  const allowed=rolePages[role];
  if(allowed && !allowed.includes(pg)) return false;
  if(pg==='set' && role !== 'Admin' && role !== 'Manager' && role !== 'Finance') return false;
  if(pg==='audit' && role!=='Admin') return false;
  return true;
}

// Get a user's permission — always evaluated against the real logged-in
// user's role/flags. This is intentionally NOT gated on any "pin lock"
// setting: whether a login prompt is shown and what a logged-in user is
// allowed to do are two separate questions.
export function getPermission(user, perm){
  if(!user) return false;
  const u=user;
  if(u.role==='Admin') return true;              // Admin: always yes
  if(u.role==='Viewer') return false;            // Viewer: always no for write perms
  if(u.role==='Manager'){
    if(perm==='canManageUsers') return false;    // Managers cannot manage users
    return true;                                 // Managers: yes for everything else
  }
  // Staff: per-permission
  if(perm==='seeLandlord')      return u.seeLandlord!==false;
  if(perm==='seeLandlordPhone') return u.seeLandlordPhone!==false;
  if(perm==='seeAgent')         return u.seeAgent!==false;
  if(perm==='seeContact')       return u.seeContact!==false;
  if(perm==='seePrice')         return u.seePrice!==false;
  if(perm==='canEdit')          return u.canEdit===true;
  if(perm==='canDelete')        return u.canDelete===true;
  if(perm==='canInvoice')       return u.canInvoice===true;
  if(perm==='canFinance')       return u.canFinance===true;
  if(perm==='canManageUsers')   return false;
  return true;
}
