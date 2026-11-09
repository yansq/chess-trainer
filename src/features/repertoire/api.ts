import { invoke } from "@tauri-apps/api/core";
import type { Repertoire, RepertoireSummary, RepertoireNode } from "./model";
export const repertoireApi = {
  list: () => invoke<RepertoireSummary[]>("repertoire_list"),
  get: (id: string) => invoke<Repertoire>("repertoire_get", { id }),
  save: (book: Repertoire) => invoke<Repertoire>("repertoire_save", { book }),
  addMove: (
    id: string,
    revision: number,
    node: RepertoireNode,
    notes: Record<string, string>,
  ) => invoke<number>("repertoire_add_move", { id, revision, node, notes }),
  delete: (id: string, revision: number) =>
    invoke<void>("repertoire_delete", { id, revision }),
};
