import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

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
  // Radix reserves an empty value; the prefix preserves our "all" filters.
  return (
    <SelectPrimitive.Root
      value={`value:${value}`}
      onValueChange={(next) => onValueChange(next.slice(6) as T)}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        className="select-trigger min-h-11 min-w-0 justify-between rounded-[7px] border border-field-edge bg-field px-3 py-2.5 text-[14px] leading-[22px] font-medium text-app [&>span:first-child]:overflow-hidden [&>span:first-child]:text-ellipsis [&>span:first-child]:whitespace-nowrap [&_svg]:shrink-0 [&_svg]:text-engine-muted hover:border-[#587168] hover:filter-none focus-visible:border-focus focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_#80b49333] data-[state=open]:border-focus data-[state=open]:shadow-[0_0_0_2px_#80b49333]"
        aria-label={label}
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon asChild>
          <ChevronDown size={16} aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className="select-content z-50 min-w-[var(--radix-select-trigger-width)] max-w-[var(--radix-select-content-available-width)] max-h-[min(320px,var(--radix-select-content-available-height))] overflow-hidden rounded-[10px] border border-control-edge bg-panel text-app shadow-[0_12px_32px_#0006]"
          position="popper"
          sideOffset={6}
          collisionPadding={12}
        >
          <SelectPrimitive.ScrollUpButton className="select-scroll-button flex h-6 items-center justify-center text-engine-muted">
            <ChevronUp size={16} aria-hidden="true" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="select-viewport p-[5px]">
            {options.map((option) => (
              <SelectPrimitive.Item
                className="select-item relative flex min-h-9 cursor-pointer items-center rounded-md pt-2 pr-[34px] pb-2 pl-2.5 text-[14px] leading-5 outline-none select-none data-[state=checked]:text-[#c6e8ce] data-[highlighted]:bg-[#263a35] data-[highlighted]:text-selected-ink data-[disabled]:pointer-events-none data-[disabled]:opacity-45"
                key={option.value}
                value={`value:${option.value}`}
                disabled={option.disabled}
              >
                <SelectPrimitive.ItemText>
                  {option.label}
                </SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="select-indicator absolute right-2.5 flex">
                  <Check size={16} aria-hidden="true" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="select-scroll-button flex h-6 items-center justify-center text-engine-muted">
            <ChevronDown size={16} aria-hidden="true" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
