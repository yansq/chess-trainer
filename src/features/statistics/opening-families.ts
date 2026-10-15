import type { OpeningStat } from "../../shared/types";

export type OpeningFamilyStat = Omit<OpeningStat, "eco">;

export function groupOpeningFamilies(
  stats: OpeningStat[],
): OpeningFamilyStat[] {
  const families = new Map<string, OpeningFamilyStat>();
  for (const stat of stats) {
    // Lichess names follow "Opening family: Variation, Subvariation, ...".
    const opening = stat.opening.split(":", 1)[0].trim() || "未知开局";
    let family = families.get(opening);
    if (!family) {
      family = {
        opening,
        total: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        winRate: 0,
        scoreRate: 0,
      };
      families.set(opening, family);
    }
    family.total += stat.total;
    family.wins += stat.wins;
    family.draws += stat.draws;
    family.losses += stat.losses;
  }
  return [...families.values()]
    .map((family) => ({
      ...family,
      winRate: family.total ? family.wins / family.total : 0,
      scoreRate: family.total
        ? (family.wins + family.draws * 0.5) / family.total
        : 0,
    }))
    .sort(
      (a, b) => b.total - a.total || a.opening.localeCompare(b.opening, "en"),
    );
}
