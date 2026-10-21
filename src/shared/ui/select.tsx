import { Select as ThemesSelect } from "@radix-ui/themes";

type SelectOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

type SelectProps<T extends string> = {
  label: string;
  value: T;
  options: readonly SelectOption<T>[];
  onValueChange: (value: T) => void;
  disabled?: boolean;
};

export function Select<T extends string>({
  label,
  value,
  options,
  onValueChange,
  disabled,
}: SelectProps<T>) {
  // Prefix values so the application's empty “all” filter is supported.
  return (
    <ThemesSelect.Root
      value={`value:${value}`}
      onValueChange={(next) => onValueChange(next.slice(6) as T)}
      disabled={disabled}
      size="2"
    >
      <ThemesSelect.Trigger aria-label={label} />
      <ThemesSelect.Content position="popper">
        {options.map((option) => (
          <ThemesSelect.Item
            key={option.value}
            value={`value:${option.value}`}
            disabled={option.disabled}
          >
            {option.label}
          </ThemesSelect.Item>
        ))}
      </ThemesSelect.Content>
    </ThemesSelect.Root>
  );
}
