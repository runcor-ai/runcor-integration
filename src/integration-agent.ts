// Integration Agent — full cognitive agent with 3-cube architecture

import type { IntegrationAgentConfig, SchemaSnapshot, DynamicTool, DatabaseConnector, ModelComplete } from './types.js';
import { IntegrationDatabase } from './database.js';
import { SQLiteConnector } from './connectors/sqlite.js';
import { discoverSchema } from './schema-discovery.js';
import { detectChanges } from './change-detector.js';
import { createPatternLearner, type PatternLearner } from './pattern-learner.js';
import { generateTools } from './tool-generator.js';
import { queryByIntent } from './query-builder.js';

export interface IntegrationAgent {
  /** Initialize: connect to target DB, discover schema */
  init(): Promise<void>;

  /** Run an observation cycle: poll for changes, learn patterns */
  cycle(): Promise<{ observationCount: number; schemaConfidence: number }>;

  /** Get dynamically generated tools */
  getTools(): DynamicTool[];

  /** Get the current schema snapshot */
  getSchema(): SchemaSnapshot | null;

  /** Ask a natural language question about the target system */
  ask(question: string): Promise<string>;

  /** Disconnect and cleanup */
  shutdown(): Promise<void>;
}

/** Create an integration agent that bridges a bespoke database into the runcor ecosystem */
export async function createIntegrationAgent(
  config: IntegrationAgentConfig,
  model: ModelComplete,
): Promise<IntegrationAgent> {
  const dbPath = config.dbPath ?? `./integration-${config.name}.db`;
  const db = new IntegrationDatabase(dbPath);

  // Create the connector based on config type
  let connector: DatabaseConnector;
  switch (config.connector.type) {
    case 'sqlite':
      connector = new SQLiteConnector(config.connector);
      break;
    default:
      throw new Error(`Connector type "${config.connector.type}" not yet implemented. V1 supports: sqlite`);
  }

  let schema: SchemaSnapshot | null = db.getLatestSnapshot();
  let tools: DynamicTool[] = [];
  let patternLearner: PatternLearner | null = null;
  let currentCycle = schema?.cycle ?? 0;

  return {
    async init(): Promise<void> {
      await connector.connect();

      // Initialize pattern learner (own memory cubes)
      patternLearner = await createPatternLearner(
        dbPath.replace('.db', '-memory.db'),
        model,
        config.openaiApiKey,
      );

      // Initial schema discovery
      schema = await discoverSchema(connector, model, currentCycle);
      db.saveSnapshot(schema);

      // Generate tools from schema
      tools = generateTools(schema, connector, db);

      // Add the natural language query tool
      tools.push({
        name: 'query',
        description: 'Ask a natural language question about the database and get results',
        inputSchema: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'What you want to know' },
          },
          required: ['question'],
        },
        handler: async (args) => {
          if (!schema) return { content: [{ type: 'text', text: 'Schema not yet discovered.' }] };
          const patterns = patternLearner ? await patternLearner.queryPatterns(String(args.question)) : '';
          return queryByIntent(String(args.question), schema, connector, model, patterns);
        },
      });
    },

    async cycle(): Promise<{ observationCount: number; schemaConfidence: number }> {
      currentCycle++;

      if (!schema) throw new Error('Agent not initialized. Call init() first.');

      // Poll for changes
      const observations = await detectChanges(schema.tables, { connector, db, cycle: currentCycle });

      // Record to pattern learner
      if (patternLearner && observations.length > 0) {
        patternLearner.setCycle(currentCycle);
        await patternLearner.recordObservations(observations);
      }

      // Run memory cycle (decay, reinforce, promote)
      if (patternLearner) {
        await patternLearner.cycle();
      }

      // Re-discover schema periodically (every 10 cycles)
      if (currentCycle % 10 === 0) {
        schema = await discoverSchema(connector, model, currentCycle);
        db.saveSnapshot(schema);
        tools = generateTools(schema, connector, db);
      }

      return {
        observationCount: observations.length,
        schemaConfidence: schema.confidence,
      };
    },

    getTools(): DynamicTool[] {
      return tools;
    },

    getSchema(): SchemaSnapshot | null {
      return schema;
    },

    async ask(question: string): Promise<string> {
      if (!schema) return 'Agent not initialized. Call init() first.';
      const patterns = patternLearner ? await patternLearner.queryPatterns(question) : '';
      const result = await queryByIntent(question, schema, connector, model, patterns);
      return result.content[0].text;
    },

    async shutdown(): Promise<void> {
      await connector.disconnect();
      db.close();
    },
  };
}
