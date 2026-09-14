export const ROLE_RANK = { member: 0, moderator: 1, owner: 2 };

export function canModerate(deleterRole, authorRole, isSelf = false) {
  if (isSelf) return true;
  if (deleterRole === authorRole) return false;
  return (ROLE_RANK[deleterRole] ?? 0) > (ROLE_RANK[authorRole] ?? 0);
}

// Optional: helpers for common checks
export function isOwner(role) {
  return role === "owner";
}

export function isModerator(role) {
  return role === "moderator" || role === "owner";
}
