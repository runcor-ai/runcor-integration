// runcor-integration — public API

export { createIntegrationAgent } from './integration-agent.js';
export type { IntegrationAgent } from './integration-agent.js';
export { IntegrationDatabase } from './database.js';
export { discoverSchema } from './schema-discovery.js';
export { detectChanges } from './change-detector.js';
export { createPatternLearner } from './pattern-learner.js';
export type { PatternLearner } from './pattern-learner.js';
export { generateTools } from './tool-generator.js';
export { queryByIntent } from './query-builder.js';

// Connectors
export { SQLiteConnector } from './connectors/sqlite.js';

// Types
export type {
  ConnectorConfig,
  SchemaSnapshot,
  TableSchema,
  ColumnSchema,
  ForeignKeyInfo,
  Observation,
  Pattern,
  PollState,
  DynamicTool,
  ToolResult,
  DatabaseConnector,
  ColumnInfo,
  ForeignKeyRaw,
  ModelComplete,
  IntegrationAgentConfig,
} from './types.js';
