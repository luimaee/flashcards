import { ulid } from "ulid";
import type { EntityKind, Op, Version } from "./schema";

/**
 * Op construction and reconciliation rules. Pure: no database access, so the
 * rules are unit-tested in isolation. See docs/storage-design.md.
 */

export interface Clock {
  device: string;
  next(): number; // monotonic per device
  now(): number; // wall clock
}

export function newId(): string {
  return ulid();
}

export function versionOf(op: Op): Version {
  return { device: op.device, seq: op.seq };
}

export function sameVersion(a: Version | null | undefined, b: Version | null | undefined): boolean {
  if (!a || !b) return a === b;
  return a.device === b.device && a.seq === b.seq;
}

export function makeOp(
  clock: Clock,
  entity: EntityKind,
  entityId: string,
  kind: Op["kind"],
  patch: Record<string, unknown>,
  base: Version | null,
): Op {
  const seq = clock.next();
  return { opId: `${clock.device}:${seq}`, device: clock.device, seq, ts: clock.now(), entity, entityId, kind, base, patch };
}

export interface Versioned {
  id: string;
  version: Version;
  updatedAt: number;
  deletedAt?: number;
  conflictOf?: string;
}

export type ApplyResult<T extends Versioned> =
  | { action: "created" | "updated" | "deleted" | "restored"; doc: T }
  | { action: "skipped"; reason: "stale-create" | "already-applied" }
  | { action: "forked"; doc: T; fork: T };

/**
 * Apply one op to the current row (or null if none exists). Returns the new
 * row, or a fork when the op was made against an older version than the one
 * we hold (a concurrent edit from another device or an imported file).
 *
 * Deletes and restores never fork: the newer of the two wins by (ts, device)
 * only among tombstone ops, and a restore is always an explicit op, so a
 * closed notebook cannot bring a deletion back on its own.
 */
export function applyOp<T extends Versioned>(current: T | null, op: Op): ApplyResult<T> {
  const version = versionOf(op);

  if (op.kind === "create") {
    if (current) {
      if (sameVersion(current.version, version)) return { action: "skipped", reason: "already-applied" };
      // Same id created twice: only possible from an import replaying history; keep ours.
      return { action: "skipped", reason: "stale-create" };
    }
    const doc = { ...(op.patch as object), id: op.entityId, version, updatedAt: op.ts } as T;
    return { action: "created", doc };
  }

  if (!current) return { action: "skipped", reason: "stale-create" };
  if (sameVersion(current.version, version)) return { action: "skipped", reason: "already-applied" };

  if (op.kind === "delete") {
    return { action: "deleted", doc: { ...current, deletedAt: op.ts, version, updatedAt: op.ts } };
  }
  if (op.kind === "restore") {
    const { deletedAt: _dropped, ...rest } = current;
    void _dropped;
    return { action: "restored", doc: { ...rest, version, updatedAt: op.ts } as T };
  }

  // update
  const basedOnCurrent = sameVersion(op.base, current.version);
  const fromSameDevice = op.device === current.version.device;
  if (basedOnCurrent || fromSameDevice) {
    return { action: "updated", doc: { ...current, ...(op.patch as object), version, updatedAt: op.ts } as T };
  }
  // Concurrent edit against an older base from another device: keep both.
  const fork = {
    ...current,
    ...(op.patch as object),
    id: `${current.id}~${op.device}`,
    conflictOf: current.id,
    version,
    updatedAt: op.ts,
  } as T;
  return { action: "forked", doc: current, fork };
}

/** Order ops for replay: by device, then seq. Deterministic and idempotent. */
export function sortOps(ops: Op[]): Op[] {
  return [...ops].sort((a, b) => (a.device < b.device ? -1 : a.device > b.device ? 1 : a.seq - b.seq));
}
