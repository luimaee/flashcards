/**
 * Pointer arbitration: which pointer events are allowed to draw.
 *
 * Palm rejection rule: once a pen has been seen, touch input is ignored for
 * drawing for a short grace window. A resting palm arrives as touch events
 * while the pen is writing, so this covers the common case without any
 * per-device tuning. Mouse input is always accepted (desktop testing).
 *
 * Pure and DOM-free so the rules can be unit-tested.
 */

export type PointerKind = "pen" | "touch" | "mouse";

export interface PointerLike {
  pointerId: number;
  pointerType: string;
  timeStamp: number;
}

export const TOUCH_GRACE_AFTER_PEN_MS = 1500;

export class PointerArbiter {
  private lastPenSeen = -Infinity;
  private active: { id: number; kind: PointerKind } | null = null;

  /** Should this pointer be allowed to start a stroke? */
  canStart(ev: PointerLike): boolean {
    const kind = kindOf(ev.pointerType);
    if (kind === "pen") this.lastPenSeen = ev.timeStamp;
    if (this.active) return false; // one stroke at a time
    if (kind === "touch" && ev.timeStamp - this.lastPenSeen < TOUCH_GRACE_AFTER_PEN_MS) return false;
    return true;
  }

  start(ev: PointerLike) {
    this.active = { id: ev.pointerId, kind: kindOf(ev.pointerType) };
  }

  /** Is this event part of the active stroke? */
  isActive(ev: PointerLike): boolean {
    if (kindOf(ev.pointerType) === "pen") this.lastPenSeen = Math.max(this.lastPenSeen, ev.timeStamp);
    return this.active !== null && this.active.id === ev.pointerId;
  }

  end(ev: PointerLike) {
    if (kindOf(ev.pointerType) === "pen") this.lastPenSeen = Math.max(this.lastPenSeen, ev.timeStamp);
    if (this.active && this.active.id === ev.pointerId) this.active = null;
  }

  get activeKind(): PointerKind | null {
    return this.active?.kind ?? null;
  }

  /** Touch is currently being ignored because a pen is in use. */
  touchSuppressed(now: number): boolean {
    return now - this.lastPenSeen < TOUCH_GRACE_AFTER_PEN_MS;
  }
}

export function kindOf(pointerType: string): PointerKind {
  if (pointerType === "pen") return "pen";
  if (pointerType === "touch") return "touch";
  return "mouse";
}

/** Pressure to use for a pointer: real pen pressure, or a constant for mouse/touch. */
export function pressureOf(pointerType: string, pressure: number): number {
  if (pointerType === "pen") return Math.max(0.05, Math.min(1, pressure || 0.5));
  return 0.5;
}
