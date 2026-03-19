// ---------------------------------------------------------------------------
// PostgreSQL adapter - wraps the pg library to implement the Database interface.
// Used in production when DATABASE_URL is set.
// ---------------------------------------------------------------------------

import { Pool, type PoolClient } from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Database, RunResult } from "./database.js";

export class PostgresDatabase implements Database {
  private pool: Pool;
  private txStorage = new AsyncLocalStorage<PoolClient>();

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  /**
   * Convert SQLite-style ? placeholders to PostgreSQL-style $1, $2, ...
   * This allows the engine to use ? everywhere and have the adapter translate.
   *
   * Only replaces ? characters that are outside single-quoted string literals.
   * This avoids corrupting string values containing '?' and preserves
   * PostgreSQL JSONB operators (though we don't use them currently).
   */
  private convertPlaceholders(sql: string): string {
    let index = 0;
    let inString = false;
    let result = "";

    for (let i = 0; i < sql.length; i++) {
      const ch = sql[i]!;

      if (ch === "'" && !inString) {
        inString = true;
        result += ch;
      } else if (ch === "'" && inString) {
        // Handle escaped quotes ('')
        if (i + 1 < sql.length && sql[i + 1] === "'") {
          result += "''";
          i++;
        } else {
          inString = false;
          result += ch;
        }
      } else if (ch === "?" && !inString) {
        result += "$" + String(++index);
      } else {
        result += ch;
      }
    }

    return result;
  }

  /** Get the current query target: transaction client if inside a transaction, otherwise the pool. */
  private get queryTarget(): Pool | PoolClient {
    return this.txStorage.getStore() ?? this.pool;
  }

  async run(sql: string, params?: unknown[]): Promise<RunResult> {
    const result = await this.queryTarget.query(this.convertPlaceholders(sql), params);
    return { changes: result.rowCount ?? 0 };
  }

  async get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined> {
    const result = await this.queryTarget.query(this.convertPlaceholders(sql), params);
    return (result.rows[0] as T) ?? undefined;
  }

  async all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = await this.queryTarget.query(this.convertPlaceholders(sql), params);
    return result.rows as T[];
  }

  async exec(sql: string): Promise<void> {
    await this.queryTarget.query(sql);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // If already inside a transaction, use SAVEPOINT for nesting
    const existingClient = this.txStorage.getStore();
    if (existingClient) {
      const savepoint = `sp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await existingClient.query(`SAVEPOINT ${savepoint}`);
      try {
        const result = await fn();
        await existingClient.query(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (e) {
        await existingClient.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        throw e;
      }
    }

    // Top-level transaction: acquire a client and run fn within AsyncLocalStorage
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await this.txStorage.run(client, fn);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
