import type { Env } from "./types";

export const MAX_GLOBAL_DAILY_LIMIT = 200;
export const BROWSER_DAILY_LIMIT = 20;
export const BROWSER_BURST_LIMIT = 3;

type QuotaRow = {
  consumed: number;
  quota_limit: number;
};

type ControlRow = {
  enabled: number;
};

export type QuotaStatus = {
  available: boolean;
  code: "AVAILABLE" | "DEMO_DISABLED" | "DAILY_DEMO_LIMIT_REACHED";
  limit: number;
  consumed: number;
  remaining: number;
  resetsAt: string;
};

export type QuotaDenial = {
  allowed: false;
  code:
    | "DEMO_DISABLED"
    | "DAILY_DEMO_LIMIT_REACHED"
    | "BROWSER_DAILY_LIMIT_REACHED"
    | "BROWSER_BURST_LIMIT_REACHED"
    | "QUOTA_CONFIGURATION_INVALID"
    | "QUOTA_CHECK_UNAVAILABLE";
  message: string;
  status: number;
  limit?: number;
  remaining?: number;
  resetsAt: string;
};

export type QuotaAllowance = {
  allowed: true;
  limit: number;
  remaining: number;
  resetsAt: string;
  browserId: string;
  setCookie: boolean;
};

export type QuotaDecision = QuotaDenial | QuotaAllowance;

function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function minuteWindow(now: Date): string {
  return now.toISOString().slice(0, 16);
}

export function nextUtcMidnight(now: Date): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  ).toISOString();
}

function nextMinute(now: Date): string {
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000 + 60_000).toISOString();
}

function parseGlobalLimit(env: Env): number | null {
  if (!/^\d+$/.test(env.DAILY_DEMO_LIMIT ?? "")) return null;
  const limit = Number(env.DAILY_DEMO_LIMIT);
  return Number.isSafeInteger(limit) && limit >= 1 && limit <= MAX_GLOBAL_DAILY_LIMIT
    ? limit
    : null;
}

function demoEnabled(env: Env): boolean {
  return env.DEMO_ENABLED === "true";
}

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("Cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

function browserIdentity(request: Request): { id: string; setCookie: boolean } {
  const existing = cookieValue(request, "demo_session");
  if (existing && /^[a-f0-9-]{16,64}$/i.test(existing)) {
    return { id: existing, setCookie: false };
  }
  return { id: crypto.randomUUID(), setCookie: true };
}

async function hashBrowserId(browserId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(browserId),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

async function databaseControlEnabled(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare("/* quota:control */ SELECT enabled FROM demo_control WHERE id = 1")
    .first<ControlRow>();
  return row?.enabled === 1;
}

async function ensureGlobalRow(
  db: D1Database,
  date: string,
  limit: number,
): Promise<void> {
  await db
    .prepare(
      `/* quota:global:ensure */
       INSERT INTO daily_quota (quota_date, consumed, quota_limit)
       VALUES (?, 0, ?)
       ON CONFLICT (quota_date) DO UPDATE SET
         quota_limit = MIN(daily_quota.quota_limit, excluded.quota_limit),
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(date, limit)
    .run();
}

async function globalRow(db: D1Database, date: string): Promise<QuotaRow | null> {
  return db
    .prepare(
      "/* quota:global:read */ SELECT consumed, quota_limit FROM daily_quota WHERE quota_date = ?",
    )
    .bind(date)
    .first<QuotaRow>();
}

async function reserveGlobal(
  db: D1Database,
  date: string,
  limit: number,
): Promise<QuotaRow | null> {
  await ensureGlobalRow(db, date, limit);
  const update = await db
    .prepare(
      `/* quota:global:reserve */
       UPDATE daily_quota
       SET consumed = consumed + 1, updated_at = CURRENT_TIMESTAMP
       WHERE quota_date = ? AND consumed < quota_limit`,
    )
    .bind(date)
    .run();
  if (!update.success || Number(update.meta.changes ?? 0) !== 1) return null;
  return globalRow(db, date);
}

async function reserveBrowserDaily(
  db: D1Database,
  date: string,
  browserHash: string,
): Promise<boolean> {
  await db
    .prepare(
      `/* quota:browser:ensure */
       INSERT INTO browser_daily_quota (quota_date, browser_hash, consumed, quota_limit)
       VALUES (?, ?, 0, ?)
       ON CONFLICT (quota_date, browser_hash) DO UPDATE SET
         quota_limit = MIN(browser_daily_quota.quota_limit, excluded.quota_limit),
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(date, browserHash, BROWSER_DAILY_LIMIT)
    .run();
  const update = await db
    .prepare(
      `/* quota:browser:reserve */
       UPDATE browser_daily_quota
       SET consumed = consumed + 1, updated_at = CURRENT_TIMESTAMP
       WHERE quota_date = ? AND browser_hash = ? AND consumed < quota_limit`,
    )
    .bind(date, browserHash)
    .run();
  return update.success && Number(update.meta.changes ?? 0) === 1;
}

async function reserveBurst(
  db: D1Database,
  window: string,
  browserHash: string,
): Promise<boolean> {
  await db
    .prepare(
      `/* quota:burst:ensure */
       INSERT INTO browser_burst_quota (window_start, browser_hash, consumed, quota_limit)
       VALUES (?, ?, 0, ?)
       ON CONFLICT (window_start, browser_hash) DO UPDATE SET
         quota_limit = MIN(browser_burst_quota.quota_limit, excluded.quota_limit),
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(window, browserHash, BROWSER_BURST_LIMIT)
    .run();
  const update = await db
    .prepare(
      `/* quota:burst:reserve */
       UPDATE browser_burst_quota
       SET consumed = consumed + 1, updated_at = CURRENT_TIMESTAMP
       WHERE window_start = ? AND browser_hash = ? AND consumed < quota_limit`,
    )
    .bind(window, browserHash)
    .run();
  return update.success && Number(update.meta.changes ?? 0) === 1;
}

export async function readQuotaStatus(
  env: Env,
  now = new Date(),
): Promise<QuotaStatus> {
  const resetsAt = nextUtcMidnight(now);
  if (!demoEnabled(env)) {
    const configuredLimit = parseGlobalLimit(env);
    return {
      available: false,
      code: "DEMO_DISABLED",
      limit: configuredLimit ?? MAX_GLOBAL_DAILY_LIMIT,
      consumed: 0,
      remaining: 0,
      resetsAt,
    };
  }
  const limit = parseGlobalLimit(env);
  if (limit === null) throw new Error("Invalid DAILY_DEMO_LIMIT configuration.");
  if (!(await databaseControlEnabled(env.DB))) {
    return {
      available: false,
      code: "DEMO_DISABLED",
      limit,
      consumed: 0,
      remaining: 0,
      resetsAt,
    };
  }

  const row = await globalRow(env.DB, utcDate(now));
  const effectiveLimit = row ? Math.min(limit, row.quota_limit) : limit;
  const consumed = row?.consumed ?? 0;
  const remaining = Math.max(0, effectiveLimit - consumed);
  return {
    available: remaining > 0,
    code: remaining > 0 ? "AVAILABLE" : "DAILY_DEMO_LIMIT_REACHED",
    limit: effectiveLimit,
    consumed,
    remaining,
    resetsAt,
  };
}

export async function reserveQuota(
  request: Request,
  env: Env,
  now = new Date(),
): Promise<QuotaDecision> {
  const resetsAt = nextUtcMidnight(now);
  if (!demoEnabled(env)) {
    const configuredLimit = parseGlobalLimit(env);
    return {
      allowed: false,
      code: "DEMO_DISABLED",
      message: "The hosted demo is currently disabled.",
      status: 503,
      limit: configuredLimit ?? MAX_GLOBAL_DAILY_LIMIT,
      remaining: 0,
      resetsAt,
    };
  }
  const limit = parseGlobalLimit(env);
  if (limit === null) {
    return {
      allowed: false,
      code: "QUOTA_CONFIGURATION_INVALID",
      message: "Hosted demo quota is not configured safely.",
      status: 503,
      resetsAt,
    };
  }

  try {
    if (!(await databaseControlEnabled(env.DB))) {
      return {
        allowed: false,
        code: "DEMO_DISABLED",
        message: "The hosted demo is currently disabled.",
        status: 503,
        limit,
        remaining: 0,
        resetsAt,
      };
    }

    const date = utcDate(now);
    const global = await reserveGlobal(env.DB, date, limit);
    if (!global) {
      return {
        allowed: false,
        code: "DAILY_DEMO_LIMIT_REACHED",
        message: "Today's hosted demo capacity has been reached.",
        status: 503,
        limit,
        remaining: 0,
        resetsAt,
      };
    }

    const browser = browserIdentity(request);
    const browserHash = await hashBrowserId(browser.id);
    if (!(await reserveBrowserDaily(env.DB, date, browserHash))) {
      return {
        allowed: false,
        code: "BROWSER_DAILY_LIMIT_REACHED",
        message: "This browser has reached its daily demo limit.",
        status: 429,
        limit: BROWSER_DAILY_LIMIT,
        remaining: 0,
        resetsAt,
      };
    }
    if (!(await reserveBurst(env.DB, minuteWindow(now), browserHash))) {
      return {
        allowed: false,
        code: "BROWSER_BURST_LIMIT_REACHED",
        message: "Please wait before submitting another question.",
        status: 429,
        limit: BROWSER_BURST_LIMIT,
        remaining: 0,
        resetsAt: nextMinute(now),
      };
    }

    return {
      allowed: true,
      limit: global.quota_limit,
      remaining: Math.max(0, global.quota_limit - global.consumed),
      resetsAt,
      browserId: browser.id,
      setCookie: browser.setCookie,
    };
  } catch (error) {
    console.error("Quota check failed", error);
    return {
      allowed: false,
      code: "QUOTA_CHECK_UNAVAILABLE",
      message: "Hosted demo capacity could not be verified.",
      status: 503,
      resetsAt,
    };
  }
}

export function quotaHeaders(decision: QuotaDecision | QuotaStatus): Headers {
  const headers = new Headers();
  if ("limit" in decision) headers.set("X-Demo-Limit", String(decision.limit));
  if ("remaining" in decision && decision.remaining !== undefined) {
    headers.set("X-Demo-Remaining", String(decision.remaining));
  }
  headers.set("X-Demo-Reset", decision.resetsAt);
  if ("allowed" in decision && decision.allowed && decision.setCookie) {
    headers.append(
      "Set-Cookie",
      `demo_session=${decision.browserId}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`,
    );
  }
  return headers;
}
