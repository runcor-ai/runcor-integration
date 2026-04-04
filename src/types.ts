// runcor-integration types

// ── Connector Config ──

export interface ConnectorConfig {
  type: 'postgres' | 'mysql' | 'sqlite' | 'mssql';
  host?: string;
  port?: number;
  database: string;
  user?: string;
  password?: string;
  path?: string;
  readOnly?: boolean;
}

// ── Schema Types ──

export interface SchemaSnapshot {
  id: string;
  tables: TableSchema[];
  confidence: number;
  captured_at: string;
  cycle: number;
}

export interface TableSchema {
  name: string;
  probable_purpose: string;
  confidence: number;
  columns: ColumnSchema[];
  row_count: number;
  relationships: ForeignKeyInfo[];
  sample_data: Record<string, unknown>[];
}

export interface ColumnSchema {
  name: string;
  db_type: string;
  probable_meaning: string;
  confidence: number;
  is_primary_key: boolean;
  is_foreign_key: boolean;
  is_nullable: boolean;
  is_enum: boolean;
  enum_values?: Array<{ value: unknown; probable_meaning: string }>;
}

export interface ForeignKeyInfo {
  from_table: string;
  from_column: string;
  to_table: string;
  to_column: string;
  relationship_type: string;
}

// ── Observation Types ──

export interface Observation {
  id: string;
  table_name: string;
  change_type: 'insert' | 'update' | 'delete' | 'schema_change';
  row_data: Record<string, unknown>;
  previous_data?: Record<string, unknown>;
  observed_at: string;
  cycle: number;
}

export interface Pattern {
  id: string;
  description: string;
  confidence: number;
  occurrence_count: number;
  first_seen: number;
  last_seen: number;
  pattern_data: Record<string, unknown>;
}

export interface PollState {
  table_name: string;
  last_id: number | null;
  last_timestamp: string | null;
  last_hash: string | null;
  poll_frequency_seconds: number;
}

// ── Dynamic Tool Types ──

export interface DynamicTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

// ── Database Connector Interface ──

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  is_primary_key: boolean;
  default_value: unknown;
}

export interface ForeignKeyRaw {
  from_column: string;
  to_table: string;
  to_column: string;
}

export interface DatabaseConnector {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getTables(): Promise<string[]>;
  getColumns(table: string): Promise<ColumnInfo[]>;
  getForeignKeys(table: string): Promise<ForeignKeyRaw[]>;
  getRowCount(table: string): Promise<number>;
  getSampleRows(table: string, limit?: number): Promise<Record<string, unknown>[]>;
  query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
}

// ── Model Interface ──

export interface ModelComplete {
  complete(request: {
    prompt?: string;
    systemPrompt?: string;
    responseFormat?: 'text' | 'json';
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ text: string }>;
}

// ── Agent Config ──

export interface IntegrationAgentConfig {
  name: string;
  connector: ConnectorConfig;
  openaiApiKey?: string;
  model?: ModelComplete;
  dbPath?: string;
  pollIntervalMs?: number;
  memoryConfig?: {
    tau?: number;
    durability?: number;
  };
}
