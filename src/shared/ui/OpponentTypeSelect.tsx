import type { OpponentType } from "../types";

export function OpponentTypeSelect({
  value,
  onChange,
}: {
  value: OpponentType;
  onChange: (value: OpponentType) => void;
}) {
  return (
    <select
      aria-label="对局类型"
      value={value}
      onChange={(e) => onChange(e.target.value as OpponentType)}
    >
      <option value="human">真人对局</option>
      <option value="bot">bot 对局</option>
      <option value="all">全部对局</option>
    </select>
  );
}
