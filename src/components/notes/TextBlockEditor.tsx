"use client";

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { TextBlock } from "@/lib/store/schema";

interface TextBlockEditorProps {
  block: TextBlock;
  scale: number;
  /** Editing is enabled only for the text and select tools. */
  interactive: boolean;
  autoFocus?: boolean;
  onChange: (text: string) => void;
  onMove: (x: number, y: number) => void;
  onDelete: () => void;
}

/**
 * A typed text block positioned on the page in page units. A textarea that
 * grows with its content; the small bar above it drags the block.
 */
export function TextBlockEditor({ block, scale, interactive, autoFocus, onChange, onMove, onDelete }: TextBlockEditorProps) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const drag = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [block.text, scale, block.width]);

  useEffect(() => {
    if (autoFocus) areaRef.current?.focus();
  }, [autoFocus]);

  const onHandleDown = (ev: ReactPointerEvent<HTMLDivElement>) => {
    ev.preventDefault();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    drag.current = { startX: ev.clientX, startY: ev.clientY, x: block.x, y: block.y };
  };
  const onHandleMove = (ev: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const dx = (ev.clientX - drag.current.startX) / scale;
    const dy = (ev.clientY - drag.current.startY) / scale;
    onMove(Math.max(0, drag.current.x + dx), Math.max(0, drag.current.y + dy));
  };
  const onHandleUp = () => {
    drag.current = null;
  };

  return (
    <div
      className="absolute"
      style={{
        left: block.x * scale,
        top: block.y * scale,
        width: block.width * scale,
        pointerEvents: interactive ? "auto" : "none",
      }}
    >
      {interactive && (
        <div
          role="button"
          aria-label="Move text block"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          className="absolute -top-3 left-0 h-3 w-full cursor-move rounded-t bg-accent/30 opacity-0 hover:opacity-100 focus:opacity-100"
          style={{ touchAction: "none" }}
        />
      )}
      <textarea
        ref={areaRef}
        value={block.text}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (!block.text.trim()) onDelete();
        }}
        readOnly={!interactive}
        tabIndex={interactive ? 0 : -1}
        placeholder="Type…"
        spellCheck
        className={`block w-full resize-none overflow-hidden bg-transparent p-0 leading-snug text-ink outline-none ${interactive ? "rounded ring-1 ring-transparent focus:ring-accent/50" : ""}`}
        style={{ fontSize: block.fontSize * scale, lineHeight: 1.35, fontFamily: "var(--font-sans)" }}
      />
    </div>
  );
}
