import { tryMove } from "../../shared/chess/moves";

export interface SolutionStepInfo {
  fen: string;
  san: string;
  uci: string;
}

export interface ReviewBoardPositionInput {
  puzzleFen: string | undefined;
  attemptFen: string | undefined;
  answerShown: boolean;
  solutionStep: number;
  solutionSteps: readonly SolutionStepInfo[];
}

export function resolveReviewBoardFen(
  input: ReviewBoardPositionInput,
): string | undefined {
  if (!input.puzzleFen) return undefined;
  if (input.answerShown || input.solutionStep > 0) {
    if (input.solutionStep <= 0) return input.puzzleFen;
    return input.solutionSteps[input.solutionStep - 1]?.fen ?? input.puzzleFen;
  }
  return input.attemptFen ?? input.puzzleFen;
}

export function buildSolutionSteps(
  fen: string | undefined,
  solutionLine: string[] | undefined,
): SolutionStepInfo[] {
  if (!fen || !solutionLine) return [];
  let currentFen = fen;
  const steps: SolutionStepInfo[] = [];
  for (const uci of solutionLine) {
    const played = tryMove(
      currentFen,
      uci.slice(0, 2),
      uci.slice(2, 4),
      uci[4] ?? "q",
    );
    if (!played) break;
    steps.push({ fen: played.fen, san: played.san, uci: played.uci });
    currentFen = played.fen;
  }
  return steps;
}

export function calculateInitialSolutionStep(
  playedMovesCount: number,
  maxSteps: number,
): number {
  return Math.max(0, Math.min(maxSteps, playedMovesCount));
}

export function calculateNextStep(
  currentStep: number,
  delta: number,
  maxSteps: number,
): number {
  return Math.max(0, Math.min(maxSteps, currentStep + delta));
}
