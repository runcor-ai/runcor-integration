// SQLite storage for the integration agent's own data

import Database from 'better-sqlite3';
import type { SchemaSnapshot, Observation, Pattern, PollState } from './types.js';

export class IntegrationDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_snapshots (
        id TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        cycle INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS observations (
        id TEXT PRIMARY KEY,
        table_name TEXT NOT NULL,
        change_type TEXT NOT NULL,
        row_data TEXT NOT NULL DEFAULT '{}',
        previous_data TEXT,
        observed_at TEXT NOT NULL,
        cycle INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS patterns (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        occurrence_count INTEGER NOT NULL DEFAULT 1,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        pattern_data TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS poll_state (
        table_name TEXT PRIMARY KEY,
        last_id INTEGER,
        last_timestamp TEXT,
        last_hash TEXT,
        poll_frequency_seconds INTEGER NOT NULL DEFAULT 300
      );

      CREATE TABLE IF NOT EXISTS generated_tools (
        name TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        input_schema TEXT NOT NULL DEFAULT '{}',
        query_template TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_observations_table ON observations(table_name);
      CREATE INDEX IF NOT EXISTS idx_observations_cycle ON observations(cycle);
      CREATE INDEX IF NOT EXISTS idx_patterns_confidence ON patterns(confidence);
    `);
  }

  // ── Schema Snapshots ──

  saveSnapshot(snapshot: SchemaSnapshot): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO schema_snapshots (id, model, confidence, cycle, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(snapshot.id, JSON.stringify(snapshot.tables), snapshot.confidence, snapshot.cycle, snapshot.captured_at);
  }

  getLatestSnapshot(): SchemaSnapshot | null {
    const row = this.db.prepare('SELECT * FROM schema_snapshots ORDER BY created_at DESC LIMIT 1').get() as {
      id: string; model: string; confidence: number; cycle: number; created_at: string;
    } | undefined;
    if (!row) return null;
    return { id: row.id, tables: JSON.parse(row.model), confidence: row.confidence, cycle: row.cycle, captured_at: row.created_at };
  }

  // ── Observations ──

  saveObservation(obs: Observation): void {
    this.db.prepare(`
      INSERT INTO observations (id, table_name, change_type, row_data, previous_data, observed_at, cycle)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(obs.id, obs.table_name, obs.change_type, JSON.stringify(obs.row_data), obs.previous_data ? JSON.stringify(obs.previous_data) : null, obs.observed_at, obs.cycle);
  }

  getObservations(tableName?: string, limit: number = 100): Observation[] {
    const sql = tableName
      ? 'SELECT * FROM observations WHERE table_name = ? ORDER BY observed_at DESC LIMIT ?'
      : 'SELECT * FROM observations ORDER BY observed_at DESC LIMIT ?';
    const params = tableName ? [tableName, limit] : [limit];
    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string; table_name: string; change_type: string; row_data: string; previous_data: string | null; observed_at: string; cycle: number;
    }>;
    return rows.map(r => ({
      id: r.id, table_name: r.table_name, change_type: r.change_type as Observation['change_type'],
      row_data: JSON.parse(r.row_data), previous_data: r.previous_data ? JSON.parse(r.previous_data) : undefined,
      observed_at: r.observed_at, cycle: r.cycle,
    }));
  }

  getObservationCount(): number {
    return (this.db.prepare('SELECT COUNT(*) as c FROM observations').get() as { c: number }).c;
  }

  // ── Patterns ──

  savePattern(pattern: Pattern): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO patterns (id, description, confidence, occurrence_count, first_seen, last_seen, pattern_data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(pattern.id, pattern.description, pattern.confidence, pattern.occurrence_count, pattern.first_seen, pattern.last_seen, JSON.stringify(pattern.pattern_data));
  }

  getPatterns(minConfidence: number = 0): Pattern[] {
    const rows = this.db.prepare('SELECT * FROM patterns WHERE confidence >= ? ORDER BY confidence DESC').all(minConfidence) as Array<{
      id: string; description: string; confidence: number; occurrence_count: number; first_seen: number; last_seen: number; pattern_data: string;
    }>;
    return rows.map(r => ({ ...r, pattern_data: JSON.parse(r.pattern_data) }));
  }

  // ── Poll State ──

  getPollState(tableName: string): PollState | null {
    const row = this.db.prepare('SELECT * FROM poll_state WHERE table_name = ?').get(tableName) as PollState | undefined;
    return row ?? null;
  }

  savePollState(state: PollState): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO poll_state (table_name, last_id, last_timestamp, last_hash, poll_frequency_seconds)
      VALUES (?, ?, ?, ?, ?)
    `).run(state.table_name, state.last_id, state.last_timestamp, state.last_hash, state.poll_frequency_seconds);
  }

  // ── Generated Tools ──

  saveTool(name: string, description: string, inputSchema: Record<string, unknown>, queryTemplate: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT OR REPLACE INTO generated_tools (name, description, input_schema, query_template, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, description, JSON.stringify(inputSchema), queryTemplate, now, now);
  }

  getTools(): Array<{ name: string; description: string; input_schema: Record<string, unknown>; query_template: string }> {
    const rows = this.db.prepare('SELECT * FROM generated_tools').all() as Array<{
      name: string; description: string; input_schema: string; query_template: string;
    }>;
    return rows.map(r => ({ ...r, input_schema: JSON.parse(r.input_schema) }));
  }

  close(): void {
    this.db.close();
  }
}
