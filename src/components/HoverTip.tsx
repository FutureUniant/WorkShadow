import { useCallback, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const SHOW_DELAY_MS = 320;
const TIP_MAX_W = 300;

interface Props {
  label: string;
  children: ReactNode;
  className?: string;
}

function clampTipPosition(rect: DOMRect, above: boolean) {
  const pad = 10;
  const maxW = Math.min(TIP_MAX_W, window.innerWidth - pad * 2);
  let left = rect.left;
  if (left + maxW > window.innerWidth - pad) {
    left = window.innerWidth - pad - maxW;
  }
  if (left < pad) left = pad;
  const top = above ? rect.top - 8 : rect.bottom + 8;
  return { top, left, maxW, above };
}

export function HoverTip({ label, children, className }: Props) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [tip, setTip] = useState<{ top: number; left: number; maxW: number; above: boolean } | null>(null);
  const timerRef = useRef<number | null>(null);

  const hide = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setTip(null);
  }, []);

  const show = useCallback(() => {
    const el = anchorRef.current;
    if (!el || !label.trim()) return;
    if (el.scrollWidth <= el.clientWidth + 1) return;
    const rect = el.getBoundingClientRect();
    const belowTop = rect.bottom + 8 + 36;
    const above = belowTop > window.innerHeight - 10;
    setTip(clampTipPosition(rect, above));
  }, [label]);

  const onEnter = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    timerRef.current = window.setTimeout(show, SHOW_DELAY_MS);
  }, [show]);

  return (
    <>
      <span ref={anchorRef} className={className} onMouseEnter={onEnter} onMouseLeave={hide}>
        {children}
      </span>
      {tip
        ? createPortal(
            <div
              className={`hover-tip${tip.above ? " hover-tip--above" : ""}`}
              role="tooltip"
              style={{ top: tip.top, left: tip.left, maxWidth: tip.maxW }}
            >
              {label}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
