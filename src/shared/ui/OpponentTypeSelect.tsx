import type { OpponentType } from "../types";
import { Select } from "./select";

export function OpponentTypeSelect({
  value,
  onChange,
}: {
  value: OpponentType;
  onChange: (value: OpponentType) => void;
}) {
  return (
    <Select<OpponentType>
      label="对局类型"
      value={value}
      onValueChange={onChange}
      options={[
        { value: "human", label: "真人对局" },
        { value: "bot", label: "bot 对局" },
        { value: "all", label: "全部对局" },
      ]}
    />
  );
}
