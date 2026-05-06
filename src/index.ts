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

// V2-002 Integration facade (T011 / T012 / T013 / T014 / T015):
export { createIntegration, integrationFromAgentConfig } from './integration.js';
export type { CreateIntegrationOptions } from './integration.js';

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
  // V2-002 surface:
  ReachableSource,
  SchemaDescriptor,
  SchemaDescriptorField,
  DiscoveryReport,
  SafetyPolicy,
  McpToolDefinition,
  Integration,
  EngineLike,
} from './types.js';

export { DEFAULT_SAFETY_POLICY } from './types.js';
