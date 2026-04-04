// Query builder — translates natural language intent into SQL queries

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SchemaSnapshot, DatabaseConnector, ToolResult, ModelComplete } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(__dirname, '..', 'specs', 'build-query.rpp');

let cachedSpec: string | null = null;
function loadSpec(): string {
  if (!cachedSpec) cachedSpec = readFileSync(SPEC_PATH, 'utf-8');
  return cachedSpec;
}

/** Translate a natural language question into a SQL query and execute it */
export async function queryByIntent(
  intent: string,
  schema: SchemaSnapshot,
  connector: DatabaseConnector,
  model: ModelComplete,
  learnedPatterns: string,
): Promise<ToolResult> {
  const spec = loadSpec();

  // Build a compact schema description for the LLM
  const schemaDesc = schema.tables.map(t =>
    `${t.name} (${t.probable_purpose}): ${t.columns.map(c => `${c.name} ${c.db_type} [${c.probable_meaning}]`).join(', ')}` +
    (t.relationships.length > 0 ? `\n  FK: ${t.relationships.map(r => `${r.from_column} → ${r.to_table}.${r.to_column}`).join(', ')}` : ''),
  ).join('\n');

  const response = await model.complete({
    systemPrompt: `You are a SQL query builder. Follow this R++ specification exactly.\n\n\`\`\`rpp\n${spec}\n\`\`\``,
    prompt: JSON.stringify({
      intent,
      schema: schemaDesc,
      learned_patterns: learnedPatterns,
      db_type: 'sqlite', // V1: only support SQLite syntax
    }),
    responseFormat: 'json',
    temperature: 0,
    maxTokens: 500,
  });

  const parsed = JSON.parse(response.text);
  const sql = String(parsed.sql || '');
  const explanation = String(parsed.explanation || '');

  if (!sql || sql.trim().length === 0) {
    return { content: [{ type: 'text', text: `Could not build a query for: "${intent}". ${explanation}` }] };
  }

  // Safety: only allow SELECT statements
  if (!sql.trim().toUpperCase().startsWith('SELECT')) {
    return { content: [{ type: 'text', text: `Refused: only SELECT queries are allowed. Generated: ${sql}` }], isError: true };
  }

  try {
    const params = parsed.params || [];
    const rows = await connector.query(sql, params);
    return {
      content: [{
        type: 'text',
        text: `${explanation}\n\nQuery: ${sql}\nResults (${rows.length} rows):\n${JSON.stringify(rows, null, 2)}`,
      }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Query failed: ${err instanceof Error ? err.message : String(err)}\nSQL: ${sql}` }],
      isError: true,
    };
  }
}
