// utils/access.js
export const canReadNeighborhood = (neighborhood, user) => {
  if (neighborhood.type === "global") return true;
  if (neighborhood.type === "public" && user) return true;
  if (!user) return false;
  return neighborhood.members.some((m) => m.user.toString() === user.userId);
};
