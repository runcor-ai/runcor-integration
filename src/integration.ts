// V2-002 Integration facade — composes schema discovery + tool synthesis (with safety policy)
// + adapter registration into one cohesive API for V2's foundational wiring (FR-090, FR-091, FR-092).
//
// The existing `IntegrationAgent` API remains unchanged for v0.1.x consumers; this module is
// purely additive. Both APIs share underlying primitives: discoverSchema (schema-discovery.ts),
// generateTools (tool-generator.ts), and the connector layer.

import { SQLiteConnector } from './connectors/sqlite.js';
import { discoverSchema as discoverSchemaInternal } from './schema-discovery.js';
import { generateTools } from './tool-generator.js';
import { IntegrationDatabase } from './database.js';
import type {
  DatabaseConnector,
  DiscoveryReport,
  EngineLike,
  Integration,
  IntegrationAgentConfig,
  McpToolDefinition,
  ModelComplete,
  ReachableSource,
  SafetyPolicy,
  SchemaDescriptor,
} from './types.js';
import { DEFAULT_SAFETY_POLICY } from './types.js';

export interface CreateIntegrationOptions {
  /** Used by schema discovery for LLM-driven classification (R++ specs). */
  model: ModelComplete;
  /** Local SQLite path for persisting tool inventory. Default: `./.runcor-integration-v2.db` */
  dbPath?: string;
  openaiApiKey?: string;
}

const DEFAULT_DB_PATH = './.runcor-integration-v2.db';

/**
 * Create a V2-002 Integration facade. The returned object exposes the unified
 * discoverSchemas / synthesizeTools / registerWithEngine / listKnownTools surface
 * specified in autonomous-company-v2/specs/002-faithful-rebuild/research.md §R6.
 */
export function createIntegration(options: CreateIntegrationOptions): Integration {
  const db = new IntegrationDatabase(options.dbPath ?? DEFAULT_DB_PATH);
  const known: McpToolDefinition[] = [];
  /** Connectors created during discoverSchemas, kept open so synthesised tool handlers can use them. */
  const connectorsByUri = new Map<string, DatabaseConnector>();

  return {
    async discoverSchemas(opts: { reachable: ReachableSource[]; cycle?: number }): Promise<DiscoveryReport> {
      const cycle = opts.cycle ?? 0;
      const sources: DiscoveryReport['sources'] = [];

      for (const source of opts.reachable) {
        if (source.kind !== 'sqlite') {
          // v0.2.0: SQLite-only. Other kinds return an empty schema entry per research.md §R6.
          sources.push({ uri: source.uri, schemas: [] });
          continue;
        }

        // Connect (or reuse) the SQLiteConnector for this source.
        let connector = connectorsByUri.get(source.uri);
        if (!connector) {
          connector = new SQLiteConnector({
            type: 'sqlite',
            database: source.uri,
            path: source.uri,
            readOnly: true,
          });
          await connector.connect();
          connectorsByUri.set(source.uri, connector);
        }

        const snapshot = await discoverSchemaInternal(connector, options.model, cycle);
        // Persist the snapshot for forensics + change-detection on subsequent cycles.
        db.saveSnapshot(snapshot);

        const schemas: SchemaDescriptor[] = snapshot.tables.map((t) => ({
          name: t.name,
          fields: t.columns.map((c) => ({ name: c.name, type: c.db_type })),
        }));
        sources.push({ uri: source.uri, schemas });
      }

      return { cycle, sources };
    },

    synthesizeTools(report: DiscoveryReport, policy: SafetyPolicy = DEFAULT_SAFETY_POLICY): McpToolDefinition[] {
      const synthesised: McpToolDefinition[] = [];

      for (const source of report.sources) {
        const connector = connectorsByUri.get(source.uri);
        if (!connector || source.schemas.length === 0) continue;

        // Reconstruct a minimal SchemaSnapshot shape for the existing generateTools entry point.
        // generateTools expects the full snapshot; we re-fetch from the persisted snapshot rather
        // than reconstruct from SchemaDescriptor (which lacks confidence + sample data).
        const lastSnapshot = db.getLatestSnapshot();
        if (!lastSnapshot) continue;

        const dynamicTools = generateTools(lastSnapshot, connector, db);

        for (const dyn of dynamicTools) {
          if (!isToolSafe(dyn.name, policy)) continue;
          synthesised.push({
            name: dyn.name,
            description: dyn.description,
            inputSchema: dyn.inputSchema,
            handler: dyn.handler,
          });
        }
      }

      // Update the known-tools inventory.
      known.length = 0;
      known.push(...synthesised);
      return synthesised;
    },

    async registerWithEngine(engine: EngineLike, tools: McpToolDefinition[]): Promise<void> {
      if (tools.length === 0) {
        // Engine validation rejects empty tools arrays for in-process transport — skip the
        // addAdapter call entirely when there's nothing to register.
        return;
      }

      // Register all synthesised tools as a single in-process adapter named
      // `runcor-integration-discovered`. The engine's adapter validation (runcor v0.3.0+)
      // requires a non-empty tools array for in-process transport.
      await engine.addAdapter({
        name: 'runcor-integration-discovered',
        transport: 'in-process',
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          handler: t.handler,
        })),
      });
    },

    listKnownTools(): McpToolDefinition[] {
      return [...known];
    },
  };
}

/**
 * Apply the SafetyPolicy to a synthesised tool name. Returns `true` if the tool is safe to expose.
 *
 * The current `generateTools` implementation only produces read-only SELECT-shaped tools
 * (`get-by-id`, `search`, `recent`, plus a `describe_system` meta tool); none can issue DDL or
 * mass-delete. The policy is enforced here as a defense-in-depth check — if the generator is
 * ever extended to produce mutation tools, the policy can short-circuit them.
 */
function isToolSafe(toolName: string, policy: SafetyPolicy): boolean {
  const forbid = policy.forbid ?? [];

  for (const rule of forbid) {
    switch (rule) {
      case 'ddl':
        // Block any tool whose name suggests DDL: create-table, drop-*, alter-*, truncate-*.
        if (/^(create|drop|alter|truncate|rename)[-_]/i.test(toolName)) return false;
        break;
      case 'mass_delete':
        // Block delete-* tools (single-row delete is safe, but the generator doesn't produce
        // any delete tools in v0.2.0; this is a defense for future extensions).
        if (/^delete[-_]/i.test(toolName) || /^delete_all[-_]?/i.test(toolName)) return false;
        break;
      case 'unbounded_select':
        // The generator's `search` and `recent` tools both accept an optional `limit` arg with
        // safe defaults — they're not unbounded by construction. This rule is reserved for
        // future generator changes that might expose unbounded-SELECT tools; current tools pass.
        break;
      default:
        // Unknown rules are a no-op (forward-compat: consumers can add custom rules without
        // breaking existing synthesised tools).
        break;
    }
  }

  return true;
}

/**
 * Convenience: derive an `Integration` directly from an `IntegrationAgentConfig`. Exists for
 * symmetry with `createIntegrationAgent`. Note that this constructs a NEW Integration; if the
 * caller already has an IntegrationAgent the two share no state.
 */
export function integrationFromAgentConfig(
  config: IntegrationAgentConfig,
  model: ModelComplete,
): Integration {
  return createIntegration({
    model,
    dbPath: config.dbPath ?? `./integration-${config.name}-v2.db`,
    openaiApiKey: config.openaiApiKey,
  });
}
