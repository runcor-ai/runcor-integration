// SQLite connector — read-only access to a target SQLite database

import Database from 'better-sqlite3';
import type { DatabaseConnector, ColumnInfo, ForeignKeyRaw, ConnectorConfig } from '../types.js';

export class SQLiteConnector implements DatabaseConnector {
  private db: Database.Database | null = null;
  private config: ConnectorConfig;

  constructor(config: ConnectorConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    const dbPath = this.config.path || this.config.database;
    this.db = new Database(dbPath, { readonly: true });
  }

  async disconnect(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  async getTables(): Promise<string[]> {
    this.ensureConnected();
    const rows = this.db!.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all() as Array<{ name: string }>;
    return rows.map(r => r.name);
  }

  async getColumns(table: string): Promise<ColumnInfo[]> {
    this.ensureConnected();
    const rows = this.db!.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
      cid: number; name: string; type: string; notnull: number; dflt_value: unknown; pk: number;
    }>;
    return rows.map(r => ({
      name: r.name,
      type: r.type,
      nullable: r.notnull === 0,
      is_primary_key: r.pk > 0,
      default_value: r.dflt_value,
    }));
  }

  async getForeignKeys(table: string): Promise<ForeignKeyRaw[]> {
    this.ensureConnected();
    const rows = this.db!.prepare(`PRAGMA foreign_key_list("${table}")`).all() as Array<{
      id: number; seq: number; table: string; from: string; to: string;
    }>;
    return rows.map(r => ({
      from_column: r.from,
      to_table: r.table,
      to_column: r.to,
    }));
  }

  async getRowCount(table: string): Promise<number> {
    this.ensureConnected();
    const row = this.db!.prepare(`SELECT COUNT(*) as count FROM "${table}"`).get() as { count: number };
    return row.count;
  }

  async getSampleRows(table: string, limit: number = 100): Promise<Record<string, unknown>[]> {
    this.ensureConnected();
    return this.db!.prepare(`SELECT * FROM "${table}" LIMIT ?`).all(limit) as Record<string, unknown>[];
  }

  async query(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    this.ensureConnected();
    return this.db!.prepare(sql).all(...params) as Record<string, unknown>[];
  }

  private ensureConnected(): void {
    if (!this.db) throw new Error('SQLite connector not connected. Call connect() first.');
  }
}
