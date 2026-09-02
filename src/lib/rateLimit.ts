/**
 * Basic in-memory rate limit for the private beta.
 *
 * Caps how many generation requests one client can make in a window. State
 * lives in this server process only, which is fine for a single-instance
 * beta and deliberately not more than that.
 */

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

export const GENERATE_RATE_LIMIT: RateLimitOptions = {
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 30,
};

export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private readonly options: RateLimitOptions) {}

  /** Returns true when the request is allowed. */
  check(key: string, now = Date.now()): { allowed: boolean; retryAfterMs: number } {
    const cutoff = now - this.options.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.options.max) {
      const retryAfterMs = recent[0] + this.options.windowMs - now;
      this.hits.set(key, recent);
      return { allowed: false, retryAfterMs };
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) this.prune(now);
    return { allowed: true, retryAfterMs: 0 };
  }

  private prune(now: number) {
    const cutoff = now - this.options.windowMs;
    for (const [key, times] of this.hits) {
      const recent = times.filter((t) => t > cutoff);
      if (recent.length === 0) this.hits.delete(key);
      else this.hits.set(key, recent);
    }
  }
}

/** Best-effort client key. Behind a proxy the first forwarded IP is used. */
export function clientKeyFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim() || "unknown";
  return headers.get("x-real-ip") ?? "local";
}
