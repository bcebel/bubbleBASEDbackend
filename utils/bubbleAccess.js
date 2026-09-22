// utils/bubbleAccess.js
export const canRead = (bubble, user) => {
  if (!bubble) return false;
  if (bubble.type === "personal") {
    return user && bubble.owner.toString() === user.userId;
  }
  if (bubble.type === "private") {
    if (!user) return false;
    return bubble.members.some((m) => m.user.toString() === user.userId);
  }
  if (bubble.type === "public") {
    return !!user; // logged-in users can read
  }
  if (bubble.type === "global") {
    return true; // anyone can read
  }
  if (bubble.type === "direct") {
    if (!user) return false;
    return bubble.members.some((m) => m.user.toString() === user.userId);
  }
  return false;
};

export const canPost = (bubble, user) => {
  if (!user) return false;
  return bubble.members.some((m) => m.user.toString() === user.userId);
};

export const canJoin = (bubble, user) => {
  if (!user) return false;
  if (bubble.type === "personal") return false;
  if (bubble.type === "direct") return false;
  const isMember = bubble.members.some(
    (m) => m.user.toString() === user.userId,
  );
  return !isMember;
};
