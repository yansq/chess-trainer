import { GAME_SOURCES, type GameSource } from "../types";
import { Select } from "./select";

export function GameSourceSelect({
  value,
  onChange,
}: {
  value: GameSource | null;
  onChange: (value: GameSource | null) => void;
}) {
  return (
    <Select<GameSource | "">
      label="来源平台"
      value={value ?? ""}
      onValueChange={(next) => onChange(next || null)}
      options={[{ value: "", label: "全部平台" }, ...GAME_SOURCES]}
    />
  );
}
