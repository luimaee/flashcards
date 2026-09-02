"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import type { SourceInput } from "@/lib/client";
import { MIN_SOURCE_CHARS } from "@/lib/text";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "@/lib/upload";

interface SourceFormProps {
  disabled: boolean;
  onSubmit: (source: SourceInput) => void;
}

/**
 * Homepage form: drop or choose a PDF, or paste text. Browser-side checks
 * give quick feedback; the server re-checks everything.
 */
export function SourceForm({ disabled, onSubmit }: SourceFormProps) {
  const [mode, setMode] = useState<"upload" | "paste">("upload");
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textId = useId();

  function acceptFile(file: File | undefined) {
    setLocalError(null);
    if (!file) return;
    const looksLikePdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!looksLikePdf) {
      setLocalError("Only PDF files are supported right now. You can paste the text instead.");
      return;
    }
    if (file.size === 0) {
      setLocalError("That file is empty. Please choose a PDF with lecture text in it.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setLocalError(`That file is too big. The limit is ${MAX_UPLOAD_LABEL}.`);
      return;
    }
    onSubmit({ kind: "pdf", file });
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    acceptFile(event.dataTransfer.files?.[0]);
  }

  function submitText() {
    setLocalError(null);
    const trimmed = text.trim();
    if (trimmed.length < MIN_SOURCE_CHARS) {
      setLocalError(
        `Please paste a bit more. About ${MIN_SOURCE_CHARS} characters (a solid paragraph) is the minimum; you have ${trimmed.length}.`,
      );
      return;
    }
    onSubmit({ kind: "text", text: trimmed });
  }

  const tabClass = (active: boolean) =>
    `rounded-full px-4 py-1.5 text-sm font-medium transition ${
      active ? "bg-ink text-paper" : "text-ink-soft hover:bg-line/60"
    }`;

  return (
    <section aria-label="Add your lecture material" className="w-full">
      <div className="mb-4 flex gap-2" role="tablist" aria-label="Input method">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "upload"}
          className={tabClass(mode === "upload")}
          onClick={() => setMode("upload")}
          disabled={disabled}
        >
          Upload a PDF
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "paste"}
          className={tabClass(mode === "paste")}
          onClick={() => setMode("paste")}
          disabled={disabled}
        >
          Paste text
        </button>
      </div>

      {mode === "upload" ? (
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled}
          onClick={() => !disabled && fileInput.current?.click()}
          onKeyDown={(event) => {
            if (!disabled && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              fileInput.current?.click();
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition ${
            dragging ? "border-accent bg-accent-soft" : "border-line bg-card hover:border-accent/60"
          } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
        >
          <span className="text-lg font-medium text-ink">Drop your lecture PDF here</span>
          <span className="mt-1 text-sm text-ink-soft">or click to choose a file</span>
          <span className="mt-4 text-xs text-ink-soft">
            PDF only, up to {MAX_UPLOAD_LABEL}. Must contain selectable text (scanned images will not work yet).
          </span>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            disabled={disabled}
            onChange={(event) => {
              acceptFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>
      ) : (
        <div className="rounded-2xl border border-line bg-card p-4">
          <label htmlFor={textId} className="block text-sm font-medium text-ink">
            Paste lecture notes, slides text, or a transcript
          </label>
          <textarea
            id={textId}
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={disabled}
            rows={10}
            placeholder="Paste anything from the lecture here. A few paragraphs is plenty."
            className="mt-2 w-full resize-y rounded-xl border border-line bg-paper p-3 text-sm leading-6 text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-ink-soft">
              {text.trim().length.toLocaleString()} characters. Minimum {MIN_SOURCE_CHARS}.
            </span>
            <button
              type="button"
              onClick={submitText}
              disabled={disabled}
              className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-white transition hover:bg-accent-strong disabled:opacity-60"
            >
              Make my cards
            </button>
          </div>
        </div>
      )}

      {localError && (
        <p role="alert" className="mt-3 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
          {localError}
        </p>
      )}
    </section>
  );
}
