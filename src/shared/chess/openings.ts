import openings from "./lichess-openings.json";

const positions: Record<string, string[]> = openings;

export function classifyOpening(
  moves: { fenBefore: string; fenAfter: string }[],
) {
  for (let index = moves.length - 1; index >= 0; index--) {
    const entry =
      positions[moves[index].fenAfter.split(/\s+/).slice(0, 4).join(" ")];
    if (entry) return { eco: entry[0], openingName: entry[1] };
  }
  const initial = moves[0]?.fenBefore;
  const entry = initial
    ? positions[initial.split(/\s+/).slice(0, 4).join(" ")]
    : null;
  return { eco: entry?.[0] ?? null, openingName: entry?.[1] ?? null };
}
