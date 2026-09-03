import type { SourceInput } from "./client";
import type { Flashcard } from "./flashcards/schema";

/**
 * Page state for one study session, kept as a pure reducer so the rules can
 * be tested without a browser. The important guarantees:
 *   - a failed "regenerate all" never throws away the cards on screen;
 *   - a failed first generation keeps the pasted text;
 *   - editing or deleting marks the session as edited so the UI can warn
 *     before replacing everything.
 */

export type Phase = "idle" | "working" | "done";

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
  | { type: "startOver" };

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
      return { ...state, error: null };

    case "startOver":
      return initialSession;

    default:
      return state;
  }
}
