// Writing-streak tracking: one calendar day (UTC) with at least one committed
// line keeps the streak alive. Called from creditLine() on every credited line.
export const dayOf = (ts) => new Date(ts).toISOString().slice(0, 10);

export function bumpStreak(u, now = Date.now()) {
  const day = dayOf(now);
  if (u.lastWroteDay === day) return u; // already wrote today
  const yesterday = dayOf(now - 86_400_000);
  u.streak = u.lastWroteDay === yesterday ? (u.streak || 0) + 1 : 1;
  u.bestStreak = Math.max(u.bestStreak || 0, u.streak);
  u.lastWroteDay = day;
  return u;
}
