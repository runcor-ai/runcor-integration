// Tests for V2-002 Integration.registerWithEngine (T016).
//
// Verifies that synthesised tools register with a runcor-engine-shaped target via the
// in-process adapter transport. The test uses a mock EngineLike — runcor itself is a peer
// dep and isn't required for unit tests.

import { createIntegration } from '../src/integration.js';
import type { McpToolDefinition, EngineLike, ToolResult } from '../src/index.js';
import { unlinkSync } from 'node:fs';

const DB_PATH = './test-register-with-engine.db';
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ ${message}`);
  }
}

function cleanup(): void {
  try { unlinkSync(DB_PATH); } catch { /* ignore */ }
  try { unlinkSync(DB_PATH + '-wal'); } catch { /* ignore */ }
  try { unlinkSync(DB_PATH + '-shm'); } catch { /* ignore */ }
}

interface CapturedAdapter {
  name: string;
  transport: string;
  toolCount: number;
  tools: Array<{ name: string; description: string }>;
}

function makeMockEngine(): { engine: EngineLike; captured: CapturedAdapter[] } {
  const captured: CapturedAdapter[] = [];
  return {
    captured,
    engine: {
      async addAdapter(config) {
        captured.push({
          name: config.name,
          transport: config.transport,
          toolCount: config.tools.length,
          tools: config.tools.map((t) => ({ name: t.name, description: t.description })),
        });
      },
    },
  };
}

const mockModel = {
  complete: async () => ({ text: '{}' }),
};

// Build a synthesised tool list directly (bypass the LLM-driven pipeline for pure unit tests).
function makeFakeTool(name: string): McpToolDefinition {
  return {
    name,
    description: `Fake ${name} tool`,
    inputSchema: { type: 'object' },
    handler: async (): Promise<ToolResult> => ({
      content: [{ type: 'text', text: `${name} called` }],
    }),
  };
}

cleanup();
const integration = createIntegration({ model: mockModel, dbPath: DB_PATH });

// ─── registerWithEngine: round-trip ────────────────────────────────────────

console.log('\n=== Integration.registerWithEngine ===\n');

{
  const { engine, captured } = makeMockEngine();
  const tools = [makeFakeTool('search-users'), makeFakeTool('search-orders')];
  await integration.registerWithEngine(engine, tools);

  assert(captured.length === 1, '1 adapter registered (got ' + captured.length + ')');
  assert(
    captured[0].name === 'runcor-integration-discovered',
    'Adapter name is "runcor-integration-discovered"',
  );
  assert(captured[0].transport === 'in-process', 'Transport is in-process');
  assert(captured[0].toolCount === 2, '2 tools passed to engine.addAdapter');
  assert(
    captured[0].tools[0].name === 'search-users',
    'First tool name preserved',
  );
  assert(
    captured[0].tools[0].description === 'Fake search-users tool',
    'First tool description preserved',
  );
}

{
  // Empty tools list → no addAdapter call (engine validation rejects empty in-process tools).
  const { engine, captured } = makeMockEngine();
  await integration.registerWithEngine(engine, []);
  assert(captured.length === 0, 'Empty tools list does NOT call engine.addAdapter');
}

// ─── listKnownTools ──────────────────────────────────────────────────────

console.log('\n=== Integration.listKnownTools ===\n');

{
  // listKnownTools is populated by synthesizeTools (which runs the pipeline). For unit tests
  // we don't have a real schema, so listKnownTools starts empty.
  const known = integration.listKnownTools();
  assert(Array.isArray(known), 'listKnownTools returns an array');
  assert(known.length === 0, 'listKnownTools returns empty before synthesizeTools is called');
}

// ─── discoverSchemas: HTTP / mcp_server return empty ─────────────────────

console.log('\n=== Integration.discoverSchemas (non-SQLite kinds) ===\n');

{
  const report = await integration.discoverSchemas({
    reachable: [
      { kind: 'http', uri: 'http://example.com/api' },
      { kind: 'mcp_server', uri: 'mcp://other-server' },
    ],
    cycle: 1,
  });

  assert(report.cycle === 1, 'cycle roundtrips through discoverSchemas');
  assert(report.sources.length === 2, '2 source entries returned');
  assert(report.sources[0].schemas.length === 0, 'http source returns empty schemas (v0.2.0)');
  assert(report.sources[1].schemas.length === 0, 'mcp_server source returns empty schemas (v0.2.0)');
}

cleanup();

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
