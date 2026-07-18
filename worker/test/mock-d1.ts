export type StoredQuota = {
  consumed: number;
  quota_limit: number;
};

export type MockQuotaState = {
  controlEnabled: boolean;
  fail: boolean;
  operations: string[];
  global: Map<string, StoredQuota>;
  browserDaily: Map<string, StoredQuota>;
  browserBurst: Map<string, StoredQuota>;
};

class MockStatement {
  private values: unknown[] = [];

  constructor(
    private readonly sql: string,
    private readonly state: MockQuotaState,
  ) {}

  bind(...values: unknown[]): MockStatement {
    this.values = values;
    return this;
  }

  private checkAvailable(): void {
    this.state.operations.push(this.sql);
    if (this.state.fail) throw new Error("D1 unavailable");
  }

  async first<T>(): Promise<T | null> {
    this.checkAvailable();
    if (this.sql.includes("quota:control")) {
      return { enabled: this.state.controlEnabled ? 1 : 0 } as T;
    }
    if (this.sql.includes("quota:global:read")) {
      return (this.state.global.get(String(this.values[0])) ?? null) as T | null;
    }
    throw new Error(`Unsupported mock D1 first(): ${this.sql}`);
  }

  async run(): Promise<D1Result> {
    this.checkAvailable();
    let changes = 0;

    if (this.sql.includes("quota:global:ensure")) {
      const key = String(this.values[0]);
      const limit = Number(this.values[1]);
      const existing = this.state.global.get(key);
      this.state.global.set(key, {
        consumed: existing?.consumed ?? 0,
        quota_limit: Math.min(existing?.quota_limit ?? limit, limit),
      });
      changes = 1;
    } else if (this.sql.includes("quota:global:reserve")) {
      const row = this.state.global.get(String(this.values[0]));
      if (row && row.consumed < row.quota_limit) {
        row.consumed += 1;
        changes = 1;
      }
    } else if (this.sql.includes("quota:browser:ensure")) {
      const key = `${String(this.values[0])}:${String(this.values[1])}`;
      const limit = Number(this.values[2]);
      const existing = this.state.browserDaily.get(key);
      this.state.browserDaily.set(key, {
        consumed: existing?.consumed ?? 0,
        quota_limit: Math.min(existing?.quota_limit ?? limit, limit),
      });
      changes = 1;
    } else if (this.sql.includes("quota:browser:reserve")) {
      const key = `${String(this.values[0])}:${String(this.values[1])}`;
      const row = this.state.browserDaily.get(key);
      if (row && row.consumed < row.quota_limit) {
        row.consumed += 1;
        changes = 1;
      }
    } else if (this.sql.includes("quota:burst:ensure")) {
      const key = `${String(this.values[0])}:${String(this.values[1])}`;
      const limit = Number(this.values[2]);
      const existing = this.state.browserBurst.get(key);
      this.state.browserBurst.set(key, {
        consumed: existing?.consumed ?? 0,
        quota_limit: Math.min(existing?.quota_limit ?? limit, limit),
      });
      changes = 1;
    } else if (this.sql.includes("quota:burst:reserve")) {
      const key = `${String(this.values[0])}:${String(this.values[1])}`;
      const row = this.state.browserBurst.get(key);
      if (row && row.consumed < row.quota_limit) {
        row.consumed += 1;
        changes = 1;
      }
    } else {
      throw new Error(`Unsupported mock D1 run(): ${this.sql}`);
    }

    return {
      success: true,
      meta: { changes },
      results: [],
    } as unknown as D1Result;
  }
}

export function createMockD1(
  overrides: Partial<Pick<MockQuotaState, "controlEnabled" | "fail">> = {},
): { db: D1Database; state: MockQuotaState } {
  const state: MockQuotaState = {
    controlEnabled: overrides.controlEnabled ?? true,
    fail: overrides.fail ?? false,
    operations: [],
    global: new Map(),
    browserDaily: new Map(),
    browserBurst: new Map(),
  };
  const db = {
    prepare(sql: string) {
      return new MockStatement(sql, state);
    },
  } as unknown as D1Database;
  return { db, state };
}
