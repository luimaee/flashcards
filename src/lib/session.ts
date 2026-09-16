import type { SourceInput } from "./client";
import type { Flashcard } from "./flashcards/schema";

/**
 * Page state for one study session, kept as a pure reducer so the rules can
 * be tested without a browser. The important guarantees:
 *   - a failed "regenerate all" never throws away the cards on screen;
 *   - a failed first generation keeps the pasted text;
 *   - editing or deleting marks the session as edited so the UI can warn
 *     before replacing everything;
 *   - a deck, once saved to the local library, keeps its id across edits
 *     and regenerations, so every change lands in the same file.
 */

export type Phase = "idle" | "working" | "done";

export interface DeckRef {
  id: string;
  title: string;
  folder: string | null;
}

export type SaveState = "idle" | "saving" | "saved" | "error";

export interface SessionState {
  phase: Phase;
  source: SourceInput | null;
  /** Text in the paste box. Survives errors so the student never re-pastes. */
  draftText: string;
  cards: Flashcard[];
  notice: string | null;
  error: string | null;
  busyCardId: string | null;
  edited: boolean;
  workingMessage: string | null;
  /** The saved deck this session belongs to, once it has been written to disk. */
  deck: DeckRef | null;
  saveState: SaveState;
  saveError: string | null;
  savedAt: number | null;
}

export type SessionAction =
  | { type: "setDraftText"; text: string }
  | { type: "generateStart"; source: SourceInput }
  | { type: "generateSuccess"; cards: Flashcard[]; notice: string | undefined }
  | { type: "generateFailure"; message: string }
  | { type: "generateCancelled" }
  | { type: "regenerateCardStart"; id: string }
  | { type: "regenerateCardSuccess"; id: string; card: Flashcard }
  | { type: "regenerateCardFailure"; message: string }
  | { type: "updateCard"; card: Flashcard }
  | { type: "deleteCard"; id: string }
  | { type: "dismissError" }
  | { type: "startOver" }
  | { type: "deckCreated"; deck: DeckRef; savedAt: number }
  | { type: "deckOpened"; deck: DeckRef; cards: Flashcard[]; source: SourceInput; savedAt: number }
  | { type: "setTitle"; title: string }
  | { type: "saveStart" }
  | { type: "saveSuccess"; savedAt: number }
  | { type: "saveFailure"; message: string };

export const initialSession: SessionState = {
  phase: "idle",
  source: null,
  draftText: "",
  cards: [],
  notice: null,
  error: null,
  busyCardId: null,
  edited: false,
  workingMessage: null,
  deck: null,
  saveState: "idle",
  saveError: null,
  savedAt: null,
};

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "setDraftText":
      return { ...state, draftText: action.text };

    case "generateStart":
      return {
        ...state,
        phase: "working",
        source: action.source,
        error: null,
        notice: null,
        workingMessage:
          action.source.kind === "pdf"
            ? "Reading your PDF and writing cards. This usually takes under a minute."
            : "Reading your notes and writing cards. This usually takes under a minute.",
      };

    case "generateSuccess":
      return {
        ...state,
        phase: "done",
        cards: action.cards,
        notice: action.notice ?? null,
        error: null,
        edited: false,
        busyCardId: null,
        workingMessage: null,
      };

    case "generateFailure":
      // Keep whatever the student already has. If there are cards on screen
      // this was a "regenerate all", so stay on the results view.
      return {
        ...state,
        phase: state.cards.length > 0 ? "done" : "idle",
        error: action.message,
        workingMessage: null,
      };

    case "generateCancelled":
      return {
        ...state,
        phase: state.cards.length > 0 ? "done" : "idle",
        workingMessage: null,
      };

    case "regenerateCardStart":
      return { ...state, busyCardId: action.id, error: null };

    case "regenerateCardSuccess":
      return {
        ...state,
        busyCardId: null,
        cards: state.cards.map((c) => (c.id === action.id ? action.card : c)),
      };

    case "regenerateCardFailure":
      return { ...state, busyCardId: null, error: action.message };

    case "updateCard":
      return {
        ...state,
        edited: true,
        cards: state.cards.map((c) => (c.id === action.card.id ? action.card : c)),
      };

    case "deleteCard":
      return { ...state, edited: true, cards: state.cards.filter((c) => c.id !== action.id) };

    case "dismissError":
      return { ...state, error: null, saveError: null };

    case "startOver":
      return initialSession;

    case "deckCreated":
      return { ...state, deck: action.deck, saveState: "saved", saveError: null, savedAt: action.savedAt };

    case "deckOpened":
      return {
        ...initialSession,
        phase: "done",
        deck: action.deck,
        cards: action.cards,
        source: action.source,
        saveState: "saved",
        savedAt: action.savedAt,
      };

    case "setTitle":
      return state.deck ? { ...state, deck: { ...state.deck, title: action.title } } : state;

    case "saveStart":
      return { ...state, saveState: "saving", saveError: null };

    case "saveSuccess":
      return { ...state, saveState: "saved", saveError: null, savedAt: action.savedAt };

    case "saveFailure":
      return { ...state, saveState: "error", saveError: action.message };

    default:
      return state;
  }
}
