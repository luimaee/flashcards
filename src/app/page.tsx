"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { CardEditor } from "@/components/CardEditor";
import { SourceForm } from "@/components/SourceForm";
import { ApiError, fetchProviderInfo, requestCards, type ProviderInfo, type SourceInput } from "@/lib/client";
import { cardsToCsv } from "@/lib/csv";
import type { Flashcard } from "@/lib/flashcards/schema";
import { initialSession, sessionReducer } from "@/lib/session";

/**
 * The whole app lives on one page. State is kept in memory only: refreshing
 * the page clears everything, which is the intended behaviour for this beta.
 * The state rules live in src/lib/session.ts so they can be unit-tested.
 */
export default function Home() {
  const [state, dispatch] = useReducer(sessionReducer, initialSession);
  const [exportError, setExportError] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderInfo | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchProviderInfo().then((info) => {
      if (!cancelled) setProvider(info);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const generate = useCallback(async (source: SourceInput) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setExportError(null);
    dispatch({ type: "generateStart", source });
    try {
      const result = await requestCards(source, { signal: controller.signal });
      dispatch({ type: "generateSuccess", cards: result.cards, notice: result.notice });
    } catch (error) {
      if (error instanceof ApiError && error.code === "cancelled") {
        dispatch({ type: "generateCancelled" });
        return;
      }
      dispatch({
        type: "generateFailure",
        message: error instanceof ApiError ? error.message : "Something went wrong. Please try again.",
      });
    }
  }, []);

  const regenerateOne = useCallback(
    async (id: string) => {
      if (!state.source) return;
      dispatch({ type: "regenerateCardStart", id });
      try {
        const result = await requestCards(state.source, { count: 1, avoid: state.cards });
        const replacement = result.cards[0];
        if (!replacement) {
          dispatch({ type: "regenerateCardFailure", message: "No different card could be made for that spot. Try editing it instead." });
          return;
        }
        dispatch({ type: "regenerateCardSuccess", id, card: replacement });
      } catch (error) {
        dispatch({
          type: "regenerateCardFailure",
          message: error instanceof ApiError ? error.message : "Could not regenerate that card. Please try again.",
        });
      }
    },
    [state.cards, state.source],
  );

  function regenerateAll() {
    if (!state.source) return;
    if (state.edited && !window.confirm("This replaces every card, including the ones you edited or deleted. Continue?")) {
      return;
    }
    void generate(state.source);
  }

  function cancelGeneration() {
    abortRef.current?.abort();
  }

  function startOver() {
    abortRef.current?.abort();
    setExportError(null);
    dispatch({ type: "startOver" });
  }

  function exportCsv() {
    setExportError(null);
    try {
      const ready = state.cards.filter((c) => c.question.trim() && c.answer.trim());
      if (ready.length === 0) {
        setExportError("There are no complete cards to export. Each card needs a question and an answer.");
        return;
      }
      const csv = cardsToCsv(ready);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `flashcards-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setExportError("The CSV file could not be created. Please try again or copy the cards by hand.");
    }
  }

  const isWorking = state.phase === "working";
  const showResults = state.phase !== "idle" && state.cards.length > 0;
  const cards: Flashcard[] = state.cards;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 py-10 sm:py-16">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Turn your lecture notes into study cards
        </h1>
        <p className="mt-3 max-w-xl text-base leading-7 text-ink-soft">
          Upload a lecture PDF or paste your notes. You get 10 editable flashcards, each with the part of the lecture it came from, ready to export to Anki.
        </p>
      </header>

      {!showResults && (
        <>
          <SourceForm
            disabled={isWorking}
            text={state.draftText}
            onTextChange={(text) => dispatch({ type: "setDraftText", text })}
            onSubmit={generate}
          />

          {isWorking && <WorkingBanner message={state.workingMessage} onCancel={cancelGeneration} />}

          {state.error && !isWorking && (
            <ErrorBanner message={state.error} onDismiss={() => dispatch({ type: "dismissError" })} />
          )}

          <PrivacyNote provider={provider} />
        </>
      )}

      {showResults && (
        <section aria-label="Your flashcards">
          <div className="mb-4 rounded-2xl border border-accent/30 bg-accent-soft px-5 py-4 text-sm leading-6 text-ink">
            <strong className="font-semibold">Please check every card against your lecture.</strong> These cards were generated automatically and can be wrong or miss context. Open &ldquo;From the lecture&rdquo; under each card to see the exact passage it was based on, and edit anything that is off.
            {provider?.provider === "mock" && (
              <span className="mt-1 block text-ink-soft">
                Sample mode is on: cards are built directly from sentences in your material, without an AI model.
              </span>
            )}
          </div>

          {isWorking && <WorkingBanner message={state.workingMessage} onCancel={cancelGeneration} />}

          {state.error && !isWorking && (
            <ErrorBanner message={state.error} onDismiss={() => dispatch({ type: "dismissError" })} />
          )}

          {state.notice && (
            <p role="status" className="mb-4 rounded-xl bg-paper px-4 py-3 text-sm text-ink-soft ring-1 ring-line">
              {state.notice}
            </p>
          )}

          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-ink-soft">
              {cards.length} card{cards.length === 1 ? "" : "s"}
              {state.edited ? ", edited" : ""}
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={regenerateAll}
                disabled={state.busyCardId !== null || isWorking}
                className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition hover:bg-line/40 disabled:opacity-60"
              >
                Regenerate all
              </button>
              <button
                type="button"
                onClick={exportCsv}
                disabled={state.busyCardId !== null || isWorking || cards.length === 0}
                className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-strong disabled:opacity-60"
              >
                Export CSV for Anki
              </button>
              <button
                type="button"
                onClick={startOver}
                className="rounded-full px-4 py-2 text-sm font-medium text-ink-soft transition hover:bg-line/40"
              >
                Start over
              </button>
            </div>
          </div>

          {exportError && (
            <p role="alert" className="mb-4 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
              {exportError}
            </p>
          )}

          <ul className="flex flex-col gap-4">
            {cards.map((card, index) => (
              <CardEditor
                key={card.id}
                card={card}
                index={index}
                busy={state.busyCardId === card.id || isWorking}
                onChange={(updated) => dispatch({ type: "updateCard", card: updated })}
                onDelete={(id) => dispatch({ type: "deleteCard", id })}
                onRegenerate={regenerateOne}
              />
            ))}
          </ul>

          <p className="mt-8 text-xs leading-5 text-ink-soft">
            The CSV starts with a few &ldquo;#&rdquo; lines that tell Anki how to read it, then one row per card: Front, Back, Tags, Difficulty, Source. In Anki choose File, then Import, pick the file, and check that Front and Back map to your note fields. Tags are picked up automatically. You can ignore the last two columns or map them to extra fields.
          </p>
        </section>
      )}

      {state.phase === "done" && cards.length === 0 && (
        <div className="mb-6 rounded-2xl border border-dashed border-line px-5 py-6 text-center text-sm text-ink-soft">
          All cards were deleted.{" "}
          <button type="button" onClick={regenerateAll} className="font-medium text-accent underline underline-offset-2">
            Make a new set
          </button>{" "}
          from the same material, or start over above.
        </div>
      )}

      <footer className="mt-auto pt-12 text-xs leading-5 text-ink-soft">
        Private beta. Nothing you upload is stored on the server: files are read in memory and discarded once your cards are made. Refreshing the page clears your cards, so export them first.
      </footer>
    </div>
  );
}

function WorkingBanner({ message, onCancel }: { message: string | null; onCancel: () => void }) {
  return (
    <div role="status" aria-live="polite" className="my-4 flex items-center gap-3 rounded-2xl border border-line bg-card px-5 py-4">
      <span className="h-3 w-3 animate-pulse rounded-full bg-accent" aria-hidden="true" />
      <div className="flex-1 text-sm text-ink">{message}</div>
      <button type="button" onClick={onCancel} className="rounded-full px-3 py-1 text-xs font-medium text-ink-soft hover:bg-line/60">
        Cancel
      </button>
    </div>
  );
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div role="alert" className="my-4 rounded-2xl border border-warn/30 bg-warn-soft px-5 py-4">
      <p className="text-sm font-medium text-warn">{message}</p>
      <button type="button" onClick={onDismiss} className="mt-2 text-xs font-medium text-warn underline underline-offset-2">
        Dismiss
      </button>
    </div>
  );
}

function PrivacyNote({ provider }: { provider: ProviderInfo | null }) {
  return (
    <p className="mt-6 text-xs leading-5 text-ink-soft">
      {provider === null && "Your material is processed on this server only and is not kept after your cards are made."}
      {provider?.sendsTextExternally === false &&
        "Sample mode is on: your material stays on this server, is processed in memory, and is not kept. When an AI provider is connected, lecture text will be sent to that provider to write the cards, and this note will say so."}
      {provider?.sendsTextExternally === true &&
        `To write the cards, the text of your material is sent to the connected AI provider (${provider.provider}). It is not stored on this server after your cards are made.`}
    </p>
  );
}
