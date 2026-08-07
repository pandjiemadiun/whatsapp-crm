import { test as base } from '@playwright/test';
import pg from 'pg';

/**
 * Koneksi PostgreSQL untuk E2E (env vars atau default local dev).
 */
const { Pool } = pg;

const pool = new Pool({
  host: process.env.DATABASE_HOST || 'localhost',
  port: Number(process.env.DATABASE_PORT || 5432),
  database: process.env.DATABASE_NAME || 'garuda_dev',
  user: process.env.DATABASE_USER || 'garuda_user',
  password: process.env.DATABASE_PASSWORD || 'your_db_password',
});

export interface DbFixture {
  /**
   * Eksekusi query dan return rows.
   * ```ts
   * const rows = await db.query('SELECT id FROM products WHERE name = $1', ['X']);
   * ```
   */
  query: <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;
  /**
   * Hapus data test berdasarkan kondisi.
   * ```ts
   * await db.cleanup('products', "name LIKE 'TestProduct_%'");
   * ```
   */
  cleanup: (table: string, condition: string) => Promise<void>;
  /** Tutup pool koneksi (panggil di test.afterAll). */
  close: () => Promise<void>;
}

export const dbFixture = base.extend<{ db: DbFixture }>({
  db: async ({}, use) => {
    const db: DbFixture = {
      async query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
        const res = await pool.query(sql, params);
        return res.rows as T[];
      },
      async cleanup(table: string, condition: string): Promise<void> {
        await pool.query(`DELETE FROM ${table} WHERE ${condition}`);
      },
      async close(): Promise<void> {
        await pool.end();
      },
    };
    await use(db);
  },
});

export { pool };
