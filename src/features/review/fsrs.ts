import type { Schedule } from "../../shared/types";

export type Rating = "Again" | "Hard" | "Good" | "Easy";

export const RatingMap: Record<Rating, number> = {
  Again: 1,
  Hard: 2,
  Good: 3,
  Easy: 4,
};

export interface FSRSParameters {
  requestRetention: number;
  maximumInterval: number;
  w: [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
}

// Default weights fitted for standard FSRS-4.5
export const DEFAULT_FSRS_PARAMS: FSRSParameters = {
  requestRetention: 0.9,
  maximumInterval: 36500,
  w: [
    0.40255, 1.18385, 3.173, 15.691, 7.1949, 0.5345, 1.4604, 0.0046, 1.5457,
    0.1524, 1.0601, 1.9395, 0.11, 0.296, 0.2269, 0.2315, 2.9898,
  ],
};

const FACTOR = 19 / 81;
const DECAY = -0.5;

/**
 * Calculates Retrievability (probability of recalling) given elapsed days t and stability S.
 * R(t, S) = (1 + FACTOR * (t / S)) ^ DECAY
 */
export function calculateRetrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0 || elapsedDays <= 0) return 1.0;
  const r = Math.pow(1 + FACTOR * (elapsedDays / stability), DECAY);
  return Math.max(0, Math.min(1, r));
}

/**
 * Calculates interval in days given stability S and desired retention r.
 * I(S, r) = (S / FACTOR) * (r ^ (1 / DECAY) - 1)
 */
export function calculateInterval(
  stability: number,
  desiredRetention: number,
  maximumInterval = 36500,
): number {
  if (stability <= 0) return 1;
  const interval = (stability / FACTOR) * (Math.pow(desiredRetention, 1 / DECAY) - 1);
  return Math.min(maximumInterval, Math.max(1, Math.round(interval)));
}

/**
 * Initial difficulty D0(G) = w4 - exp(w5 * (G - 1)) + 1, clamped to [1, 10].
 */
export function initialDifficulty(ratingValue: number, params: FSRSParameters): number {
  const d0 = params.w[4] - Math.exp(params.w[5] * (ratingValue - 1)) + 1;
  return Math.max(1, Math.min(10, d0));
}

/**
 * Initial stability S0(G) = w[G - 1].
 */
export function initialStability(ratingValue: number, params: FSRSParameters): number {
  return Math.max(0.1, params.w[ratingValue - 1]);
}

/**
 * Updates difficulty with mean reversion:
 * D' = D - w6 * (G - 3)
 * D'' = w7 * D0(3) + (1 - w7) * D'
 */
export function nextDifficulty(
  currentDifficulty: number,
  ratingValue: number,
  params: FSRSParameters,
): number {
  const d0Good = initialDifficulty(3, params);
  const rawD = currentDifficulty - params.w[6] * (ratingValue - 3);
  const reverted = params.w[7] * d0Good + (1 - params.w[7]) * rawD;
  return Math.max(1, Math.min(10, reverted));
}

/**
 * Updates stability for successful recall (Hard, Good, Easy):
 * S' = S * (1 + exp(w8) * (11 - D) * S^(-w9) * (exp((1 - R) * w10) - 1) * hard_or_easy_factor)
 */
export function nextRecallStability(
  difficulty: number,
  stability: number,
  retrievability: number,
  ratingValue: number,
  params: FSRSParameters,
): number {
  const hardPenalty = ratingValue === 2 ? params.w[15] : 1;
  const easyBonus = ratingValue === 4 ? params.w[16] : 1;
  const factor = hardPenalty * easyBonus;

  const expW8 = Math.exp(params.w[8]);
  const diffFactor = 11 - difficulty;
  const stabFactor = Math.pow(Math.max(0.1, stability), -params.w[9]);
  const rFactor = Math.exp((1 - retrievability) * params.w[10]) - 1;

  const increment = stability * expW8 * diffFactor * stabFactor * rFactor * factor;
  return Math.max(0.1, stability + Math.max(0, increment));
}

/**
 * Updates stability for forgotten recall (Again):
 * S' = w11 * D^(-w12) * ((S + 1)^w13 - 1) * exp((1 - R) * w14)
 * Soft-landing prevents cliff-edge resets while reducing stability appropriately.
 */
export function nextForgetStability(
  difficulty: number,
  stability: number,
  retrievability: number,
  params: FSRSParameters,
): number {
  const sPrime =
    params.w[11] *
    Math.pow(difficulty, -params.w[12]) *
    (Math.pow(stability + 1, params.w[13]) - 1) *
    Math.exp((1 - retrievability) * params.w[14]);

  // Bound so that stability definitely drops after forgetting, but doesn't hard-reset to 0
  return Math.max(0.1, Math.min(stability * 0.9, sPrime));
}

/**
 * Converts FSRS difficulty (1..10) to classic Ease Factor (2.5..1.3) for legacy compatibility.
 */
export function difficultyToEaseFactor(difficulty: number): number {
  const ef = 2.5 - ((difficulty - 1) / 9) * 1.2;
  return Math.round(Math.max(1.3, Math.min(2.5, ef)) * 100) / 100;
}

/**
 * Converts classic Ease Factor (2.5..1.3) to initial FSRS difficulty (1..10).
 */
export function easeFactorToDifficulty(easeFactor: number): number {
  const d = 10 - ((easeFactor - 1.3) / 1.2) * 9;
  return Math.max(1, Math.min(10, d));
}

/**
 * Core FSRS review scheduler implementation.
 */
export function fsrsSchedule(
  current: Schedule,
  rating: Rating,
  now = new Date(),
  customParams: Partial<FSRSParameters> = {},
): Schedule {
  const params: FSRSParameters = { ...DEFAULT_FSRS_PARAMS, ...customParams };
  const g = RatingMap[rating];
  const next: Schedule = { ...current };

  // Calculate elapsed days since last review
  let elapsedDays = 0;
  if (current.lastReviewedAt) {
    const last = new Date(current.lastReviewedAt).getTime();
    elapsedDays = Math.max(0, (now.getTime() - last) / 86400000);
  }

  // Derive existing stability and difficulty, falling back to legacy fields if needed
  const curStability = current.stability && current.stability > 0
    ? current.stability
    : current.intervalDays > 0
      ? current.intervalDays
      : 0;

  const curDifficulty = current.difficulty && current.difficulty > 0
    ? current.difficulty
    : current.easeFactor
      ? easeFactorToDifficulty(current.easeFactor)
      : initialDifficulty(3, params);

  const isInitial = current.repetitions === 0 && curStability === 0;

  let nextStability: number;
  let nextDifficultyVal: number;
  let intervalDays: number;

  if (isInitial) {
    nextDifficultyVal = initialDifficulty(g, params);
    nextStability = initialStability(g, params);

    if (rating === "Again") {
      next.repetitions = 0;
      next.lapses++;
      intervalDays = 1;
    } else {
      next.repetitions = 1;
      intervalDays = calculateInterval(nextStability, params.requestRetention, params.maximumInterval);
    }
  } else {
    // Review card
    const retrievability = calculateRetrievability(elapsedDays, curStability);
    nextDifficultyVal = nextDifficulty(curDifficulty, g, params);

    if (rating === "Again") {
      next.repetitions = 0;
      next.lapses++;
      nextStability = nextForgetStability(nextDifficultyVal, curStability, retrievability, params);
      intervalDays = 1; // Immediate recovery review on next day
    } else {
      next.repetitions++;
      nextStability = nextRecallStability(
        nextDifficultyVal,
        curStability,
        retrievability,
        g,
        params,
      );

      const calculatedInterval = calculateInterval(
        nextStability,
        params.requestRetention,
        params.maximumInterval,
      );

      // Monotonic progression protection for successful ratings:
      // Hard: at least max(1, current.intervalDays)
      // Good/Easy: strictly at least current.intervalDays + 1
      if (rating === "Hard") {
        intervalDays = Math.max(1, current.intervalDays, calculatedInterval);
      } else {
        intervalDays = Math.max(current.intervalDays + 1, calculatedInterval);
      }
    }
  }

  next.stability = Math.round(nextStability * 100) / 100;
  next.difficulty = Math.round(nextDifficultyVal * 100) / 100;
  next.intervalDays = intervalDays;
  next.easeFactor = difficultyToEaseFactor(next.difficulty);
  next.lastReviewedAt = now.toISOString();
  next.dueAt = new Date(now.getTime() + intervalDays * 86400000).toISOString();

  return next;
}
