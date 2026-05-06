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

// ─────────────────────────────────────────────────────────────────
// V2-002 surface (additive — alongside existing IntegrationAgent API)
// ─────────────────────────────────────────────────────────────────

/**
 * Source the engine can integrate with. Currently only `'sqlite'` is implemented in v0.2.0;
 * `'http'` and `'mcp_server'` are reserved for future versions and discoverSchemas returns
 * an empty entry for them.
 */
export interface ReachableSource {
  kind: 'sqlite' | 'http' | 'mcp_server';
  uri: string;
}

/** A description of one column / field in a discovered schema. */
export interface SchemaDescriptorField {
  name: string;
  type: string;
}

/** A description of one table / schema discovered in a source. */
export interface SchemaDescriptor {
  name: string;
  fields: SchemaDescriptorField[];
}

/** Output of `Integration.discoverSchemas` — schemas grouped per reachable source. */
export interface DiscoveryReport {
  cycle: number;
  sources: Array<{ uri: string; schemas: SchemaDescriptor[] }>;
}

/**
 * Safety policy applied during `Integration.synthesizeTools`.
 * `forbid` lists operation classes that MUST NOT appear in synthesised tools (FR-091).
 * Default policy excludes destructive operations: `['ddl', 'mass_delete', 'unbounded_select']`.
 */
export interface SafetyPolicy {
  forbid: Array<'ddl' | 'mass_delete' | 'unbounded_select' | string>;
}

/**
 * MCP-shaped tool definition returned by `synthesizeTools` and registered with the engine.
 * Compatible with `runcor.AdapterToolDefinition` — the `handler` is supplied internally by
 * `runcor-integration` so callers can treat synthesised tools as ready-to-register.
 */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

/**
 * V2-002 integration facade. Composes schema discovery + tool synthesis (with safety
 * filtering) + adapter registration into one cohesive surface.
 */
export interface Integration {
  /** Run schema discovery against a list of reachable sources. SQLite-only in v0.2.0. */
  discoverSchemas(opts: { reachable: ReachableSource[]; cycle?: number }): Promise<DiscoveryReport>;
  /**
   * Convert a DiscoveryReport into MCP-shaped tool definitions, filtered against the policy.
   * Currently SELECT-only tools are produced (read-only by design); `policy.forbid` is consulted
   * to verify the generator is producing safe tools, and any tool whose templates would
   * conflict is dropped.
   */
  synthesizeTools(report: DiscoveryReport, policy: SafetyPolicy): McpToolDefinition[];
  /**
   * Register synthesised tools with a `runcor` engine via the in-process adapter transport
   * added in runcor v0.3.0. The tools become available to the agent's capability layer
   * through the engine's adapter surface (single-intake path per FR-092).
   */
  registerWithEngine(engine: EngineLike, tools: McpToolDefinition[]): Promise<void>;
  /** Inventory of tools currently registered via this Integration instance. */
  listKnownTools(): McpToolDefinition[];
}

/**
 * Minimal subset of the runcor engine's interface that `Integration.registerWithEngine` uses.
 * Compatible with `Runcor` from runcor v0.3.0+ without requiring an explicit import.
 */
export interface EngineLike {
  addAdapter(config: {
    name: string;
    transport: 'in-process';
    tools: Array<{
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
      handler: (args: Record<string, unknown>) => Promise<ToolResult>;
    }>;
  }): Promise<void>;
}

/** Default safety policy. Used when `synthesizeTools` is called without an explicit policy. */
export const DEFAULT_SAFETY_POLICY: SafetyPolicy = {
  forbid: ['ddl', 'mass_delete', 'unbounded_select'],
};

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
