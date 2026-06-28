import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export type SettingsSelectOption = {
  value: string;
  label: string;
};

type Props = {
  value: string;
  options: SettingsSelectOption[];
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  "aria-labelledby"?: string;
};

export function SettingsSelect({ value, options, onChange, id, disabled = false, "aria-labelledby": labelledBy }: Props) {
  const autoId = useId();
  const listboxId = `${autoId}-listbox`;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="settings-select" ref={rootRef}>
      <button
        id={id}
        type="button"
        className={`settings-select__trigger${open ? " is-open" : ""}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-labelledby={labelledBy}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
      >
        <span className="settings-select__value">{selected?.label ?? value}</span>
        <ChevronDown size={16} className="settings-select__chevron" aria-hidden />
      </button>
      {open ? (
        <ul id={listboxId} className="settings-select__menu" role="listbox" aria-labelledby={labelledBy}>
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <li key={opt.value} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`settings-select__option${isSelected ? " is-selected" : ""}`}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  {opt.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
