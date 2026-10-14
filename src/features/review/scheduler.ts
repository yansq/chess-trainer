import type { Schedule } from "../../shared/types";
export type Rating = "Again" | "Hard" | "Good" | "Easy";
export function scheduleReview(
  current: Schedule,
  rating: Rating,
  now = new Date(),
): Schedule {
  const next = { ...current };
  const success = rating !== "Again";
  if (!success) {
    next.repetitions = 0;
    next.lapses++;
    next.intervalDays = 1;
    next.easeFactor = Math.max(1.3, next.easeFactor - 0.2);
  } else {
    next.repetitions++;
    const factor = rating === "Hard" ? 0.8 : rating === "Easy" ? 1.3 : 1;
    next.intervalDays =
      current.repetitions === 0
        ? 1
        : current.repetitions === 1
          ? 6
          : Math.max(
              1,
              Math.round(current.intervalDays * current.easeFactor * factor),
            );
    next.easeFactor = Math.max(
      1.3,
      current.easeFactor +
        (rating === "Hard" ? -0.15 : rating === "Easy" ? 0.15 : 0),
    );
  }
  next.lastReviewedAt = now.toISOString();
  next.dueAt = new Date(
    now.getTime() + next.intervalDays * 86400000,
  ).toISOString();
  return next;
}
