import type { Schedule } from "../../shared/types";
import {
  fsrsSchedule,
  type FSRSParameters,
  type Rating,
} from "./fsrs";

export type { Rating } from "./fsrs";

/**
 * Schedules the next review for a puzzle using the FSRS (Free Spaced Repetition Scheduler) algorithm.
 */
export function scheduleReview(
  current: Schedule,
  rating: Rating,
  now = new Date(),
  customParams: Partial<FSRSParameters> = {},
): Schedule {
  return fsrsSchedule(current, rating, now, customParams);
}

/**
 * Previews next intervals for all four rating buttons (Again, Hard, Good, Easy)
 * to provide clear visibility to the user during training.
 */
export function previewNextIntervals(
  current: Schedule,
  now = new Date(),
  customParams: Partial<FSRSParameters> = {},
): Record<Rating, number> {
  const ratings: Rating[] = ["Again", "Hard", "Good", "Easy"];
  const result = {} as Record<Rating, number>;
  for (const r of ratings) {
    const next = fsrsSchedule(current, r, now, customParams);
    result[r] = next.intervalDays;
  }
  return result;
}
