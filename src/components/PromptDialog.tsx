import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PromptOptions } from "../types";

interface Props {
  options: PromptOptions | null;
  onClose: (value: string | null) => void;
}

export function PromptDialog({ options, onClose }: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!options) return;
    setValue(options.defaultValue);
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [options]);

  if (!options) return null;

  return (
    <div className="modal-backdrop">
      <section className="modal-card" onKeyDown={(e) => e.stopPropagation()}>
        <h2>{options.title}</h2>
        {options.message ? <p>{options.message}</p> : null}
        <label className="prompt-dialog__field">
          <span className="visually-hidden">{options.title}</span>
          <input
            ref={inputRef}
            type="text"
            value={value}
            placeholder={options.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const v = value.trim();
                onClose(v.length ? v : null);
              }
              if (e.key === "Escape") {
                e.preventDefault();
                onClose(null);
              }
            }}
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={() => onClose(null)}>
            {t("cancel")}
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              const v = value.trim();
              onClose(v.length ? v : null);
            }}
          >
            {t("confirm")}
          </button>
        </div>
      </section>
    </div>
  );
}
