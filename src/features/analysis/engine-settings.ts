import { api } from "../../shared/api";

export type AnalysisKind = "preanalysis" | "position";

export function normalizeEngineDepth(value: string | number | null): number {
  const depth = Number(value ?? 14);
  return Number.isFinite(depth)
    ? Math.max(4, Math.min(30, Math.trunc(depth)))
    : 14;
}

export async function getEngineDepth(
  kind: AnalysisKind,
  engineApi: Pick<typeof api, "getSetting"> = api,
): Promise<number> {
  const configured = await engineApi.getSetting(`engine_${kind}_depth`);
  // Preserve the existing depth until this setting has been saved separately.
  return normalizeEngineDepth(
    configured ?? (await engineApi.getSetting("engine_depth")),
  );
}
