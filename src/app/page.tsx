"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { CardEditor } from "@/components/CardEditor";
import { SourceForm } from "@/components/SourceForm";
import { StudyMode } from "@/components/StudyMode";
import {
  ApiError,
  createDeck,
  deleteDeck,
  fetchProviderInfo,
  getDeck,
  listDecks,
  requestCards,
  updateDeck,
  type DeckSummary,
  type ProviderInfo,
  type SourceInput,
} from "@/lib/client";
import { cardsToCsv } from "@/lib/csv";
import { initialSession, sessionReducer } from "@/lib/session";

/**
 * The whole app lives on one page. Cards are kept in memory while you work
 * and written to a deck file in the local library folder after every change,
 * so nothing is lost when the tab closes. The state rules live in
 * src/lib/session.ts so they can be unit-tested.
 */
export default function Home() {
  const [state, dispatch] = useReducer(sessionReducer, initialSession);
  const [exportError, setExportError] = useState<string | null>(null);
  const [studying, setStudying] = useState(false);
  const [provider, setProvider] = useState<ProviderInfo | null>(null);
  const [library, setLibrary] = useState<{ folder: string; decks: DeckSummary[] } | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<string>("");

  const refreshLibrary = useCallback(async () => {
    try {
      setLibrary(await listDecks());
      setLibraryError(null);
    } catch (error) {
      setLibraryError(error instanceof ApiError ? error.message : "Your saved decks could not be listed.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchProviderInfo().then((info) => {
      if (!cancelled) setProvider(info);
    });
    // Deferred so the library fetch runs after mount, outside the effect body.
    const timer = setTimeout(() => void refreshLibrary(), 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refreshLibrary]);

  // Auto-save: every change to cards or title lands in the deck file, debounced.
  const { deck, cards, phase } = state;
  useEffect(() => {
    if (!deck || phase !== "done") return;
    const snapshot = JSON.stringify({ title: deck.title, cards });
    if (snapshot === lastSaved.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      dispatch({ type: "saveStart" });
      try {
        const saved = await updateDeck(deck.id, { title: deck.title, cards });
        lastSaved.current = snapshot;
        dispatch({ type: "saveSuccess", savedAt: saved.updatedAt });
      } catch (error) {
        dispatch({ type: "saveFailure", message: error instanceof ApiError ? error.message : "The deck could not be saved." });
      }
    }, 700);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [deck, cards, phase]);

  const generate = useCallback(
    async (source: SourceInput) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setExportError(null);
      dispatch({ type: "generateStart", source });
      try {
        const result = await requestCards(source, { signal: controller.signal });
        dispatch({ type: "generateSuccess", cards: result.cards, notice: result.notice });
        if (!state.deck && result.sourceText) {
          // First batch from this material: create the deck file right away.
          try {
            const created = await createDeck({
              provider: result.provider,
              source: { kind: result.sourceKind ?? source.kind, name: result.sourceName, text: result.sourceText },
              cards: result.cards,
            });
            lastSaved.current = JSON.stringify({ title: created.deck.title, cards: result.cards });
            dispatch({ type: "deckCreated", deck: { id: created.deck.id, title: created.deck.title, folder: created.folder }, savedAt: created.deck.updatedAt });
            void refreshLibrary();
          } catch (error) {
            dispatch({ type: "saveFailure", message: error instanceof ApiError ? error.message : "The deck could not be saved to your folder." });
          }
        }
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
    },
    [state.deck, refreshLibrary],
  );

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
    if (state.edited && !window.confirm("This replaces every card, including the ones you edited or deleted. Continue?")) return;
    void generate(state.source);
  }

  function cancelGeneration() {
    abortRef.current?.abort();
  }

  function startOver() {
    abortRef.current?.abort();
    setExportError(null);
    lastSaved.current = "";
    dispatch({ type: "startOver" });
    void refreshLibrary();
  }

  async function openDeck(summary: DeckSummary) {
    try {
      const full = await getDeck(summary.id);
      lastSaved.current = JSON.stringify({ title: full.title, cards: full.cards });
      dispatch({
        type: "deckOpened",
        deck: { id: full.id, title: full.title, folder: library?.folder ?? null },
        cards: full.cards,
        source: { kind: "text", text: full.source.text },
        savedAt: full.updatedAt,
      });
    } catch (error) {
      setLibraryError(error instanceof ApiError ? error.message : "That deck could not be opened.");
    }
  }

  async function removeDeck(summary: DeckSummary) {
    if (!window.confirm(`Move "${summary.title}" to the trash folder? The file is kept there; nothing is destroyed.`)) return;
    try {
      await deleteDeck(summary.id);
      void refreshLibrary();
    } catch (error) {
      setLibraryError(error instanceof ApiError ? error.message : "That deck could not be deleted.");
    }
  }

  function exportCsv() {
    setExportError(null);
    try {
      const ready = cards.filter((c) => c.question.trim() && c.answer.trim());
      if (ready.length === 0) {
        setExportError("There are no complete cards to export. Each card needs a question and an answer.");
        return;
      }
      const csv = cardsToCsv(ready);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(deck?.title ?? "flashcards").replace(/[^\w.-]+/g, "_")}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setExportError("The CSV file could not be created. Please try again or copy the cards by hand.");
    }
  }

  const isWorking = phase === "working";
  const showResults = phase !== "idle" && cards.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 py-10 sm:py-16">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Turn your lecture notes into study cards</h1>
        <p className="mt-3 max-w-xl text-base leading-7 text-ink-soft">
          Upload a lecture PDF or paste your notes. You get 10 editable flashcards, each with the part of the lecture it came from. Study them here; every deck is saved on this computer.
        </p>
      </header>

      {!showResults && (
        <>
          <SourceForm disabled={isWorking} text={state.draftText} onTextChange={(text) => dispatch({ type: "setDraftText", text })} onSubmit={generate} />

          {isWorking && <WorkingBanner message={state.workingMessage} onCancel={cancelGeneration} />}

          {state.error && !isWorking && <ErrorBanner message={state.error} onDismiss={() => dispatch({ type: "dismissError" })} />}

          <PrivacyNote provider={provider} folder={library?.folder ?? null} />

          <DeckLibrary library={library} error={libraryError} onOpen={openDeck} onDelete={removeDeck} />
        </>
      )}

      {showResults && (
        <section aria-label="Your flashcards">
          <div className="mb-4 rounded-2xl border border-accent/30 bg-accent-soft px-5 py-4 text-sm leading-6 text-ink">
            <strong className="font-semibold">Please check every card against your lecture.</strong> These cards were generated automatically and can be wrong or miss context. Open &ldquo;From the lecture&rdquo; under each card to see the exact passage it was based on, and edit anything that is off.
            {provider?.provider === "mock" && (
              <span className="mt-1 block text-ink-soft">Sample mode is on: cards are built directly from sentences in your material, without an AI model.</span>
            )}
          </div>

          {isWorking && <WorkingBanner message={state.workingMessage} onCancel={cancelGeneration} />}
          {state.error && !isWorking && <ErrorBanner message={state.error} onDismiss={() => dispatch({ type: "dismissError" })} />}
          {state.saveError && <ErrorBanner message={`Not saved: ${state.saveError}`} onDismiss={() => dispatch({ type: "dismissError" })} />}

          {state.notice && (
            <p role="status" className="mb-4 rounded-xl bg-paper px-4 py-3 text-sm text-ink-soft ring-1 ring-line">
              {state.notice}
            </p>
          )}

          {deck && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                value={deck.title}
                onChange={(e) => dispatch({ type: "setTitle", title: e.target.value })}
                aria-label="Deck title"
                className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-lg font-semibold text-ink outline-none hover:border-line focus:border-accent"
              />
              <span className="text-xs text-ink-soft" role="status">
                {state.saveState === "saving" && "Saving…"}
                {state.saveState === "saved" && state.savedAt && `Saved ${new Date(state.savedAt).toLocaleTimeString()}`}
                {state.saveState === "error" && "Not saved"}
              </span>
            </div>
          )}

          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-ink-soft">
              {cards.length} card{cards.length === 1 ? "" : "s"}
              {state.edited ? ", edited" : ""}
            </span>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={regenerateAll} disabled={state.busyCardId !== null || isWorking} className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition hover:bg-line/40 disabled:opacity-60">
                Regenerate all
              </button>
              <button type="button" onClick={() => setStudying(true)} disabled={state.busyCardId !== null || isWorking} className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-strong disabled:opacity-60">
                Study
              </button>
              <button type="button" onClick={exportCsv} disabled={state.busyCardId !== null || isWorking} className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition hover:bg-line/40 disabled:opacity-60">
                Export CSV for Anki
              </button>
              <button type="button" onClick={startOver} className="rounded-full px-4 py-2 text-sm font-medium text-ink-soft transition hover:bg-line/40">
                {deck ? "Close deck" : "Start over"}
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
              <li key={card.id}>
                <CardEditor
                  card={card}
                  index={index}
                  busy={state.busyCardId === card.id || isWorking}
                  onChange={(updated) => dispatch({ type: "updateCard", card: updated })}
                  onDelete={(id) => dispatch({ type: "deleteCard", id })}
                  onRegenerate={regenerateOne}
                />
              </li>
            ))}
          </ul>

          <p className="mt-8 text-xs leading-5 text-ink-soft">
            {deck?.folder ? `This deck is saved as a file in ${deck.folder}. ` : ""}
            Study runs right here: one card at a time, Got it or Not yet, until every card is known. The CSV export is optional, for people who also use Anki.
          </p>
        </section>
      )}

      {phase === "done" && cards.length === 0 && (
        <div className="mb-6 rounded-2xl border border-dashed border-line px-5 py-6 text-center text-sm text-ink-soft">
          All cards were deleted.{" "}
          <button type="button" onClick={regenerateAll} className="font-medium text-accent underline underline-offset-2">
            Make a new set
          </button>{" "}
          from the same material, or{" "}
          <button type="button" onClick={startOver} className="font-medium text-accent underline underline-offset-2">
            close this deck
          </button>
          .
        </div>
      )}

      {studying && <StudyMode cards={cards} onClose={() => setStudying(false)} />}

      <footer className="mt-auto pt-12 text-xs leading-5 text-ink-soft">
        Runs on this computer. Uploaded files are read in memory and discarded; the cards you make are saved as files in your LectureCards folder and nowhere else.
      </footer>
    </div>
  );
}

function DeckLibrary({
  library,
  error,
  onOpen,
  onDelete,
}: {
  library: { folder: string; decks: DeckSummary[] } | null;
  error: string | null;
  onOpen: (d: DeckSummary) => void;
  onDelete: (d: DeckSummary) => void;
}) {
  return (
    <section aria-label="Your saved decks" className="mt-10">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">Your decks</h2>
        {library && <span className="truncate text-xs text-ink-soft" title={library.folder}>{library.folder}</span>}
      </div>
      {error && (
        <p role="alert" className="mb-3 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
          {error}
        </p>
      )}
      {library && library.decks.length === 0 && (
        <p className="rounded-2xl border border-dashed border-line px-5 py-6 text-center text-sm text-ink-soft">
          No decks yet. Every set of cards you make is saved here automatically.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {library?.decks.map((d) => (
          <li key={d.id} className="flex items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3">
            <button type="button" onClick={() => onOpen(d)} className="min-w-0 flex-1 text-left">
              <span className="block truncate font-medium text-ink">{d.title}</span>
              <span className="block text-xs text-ink-soft">
                {d.cardCount} card{d.cardCount === 1 ? "" : "s"} · {d.sourceKind === "pdf" ? "from a PDF" : "from pasted text"} · {new Date(d.updatedAt).toLocaleDateString()}
              </span>
            </button>
            <button type="button" onClick={() => onOpen(d)} className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-white">
              Open
            </button>
            <button type="button" onClick={() => onDelete(d)} aria-label={`Delete deck ${d.title}`} className="rounded-full px-2 py-1 text-xs text-ink-soft hover:text-hard">
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
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

function PrivacyNote({ provider, folder }: { provider: ProviderInfo | null; folder: string | null }) {
  return (
    <p className="mt-6 text-xs leading-5 text-ink-soft">
      {provider === null && "Your material is processed on this computer only."}
      {provider?.sendsTextExternally === false &&
        "Sample mode is on: your material stays on this computer and is processed in memory. When an AI provider is connected, lecture text will be sent to that provider to write the cards, and this note will say so."}
      {provider?.sendsTextExternally === true &&
        `To write the cards, the text of your material is sent to the connected AI provider (${provider.provider}).`}
      {folder ? ` The cards you make, and the text they came from, are saved as files in ${folder}.` : ""}
    </p>
  );
}
