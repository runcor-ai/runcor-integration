// Schema discovery — connects to target DB, reads schema, classifies via R++ spec

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseConnector, SchemaSnapshot, TableSchema, ColumnSchema, ForeignKeyInfo, ModelComplete } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(__dirname, '..', 'specs', 'classify-schema.rpp');

let cachedSpec: string | null = null;
function loadSpec(): string {
  if (!cachedSpec) cachedSpec = readFileSync(SPEC_PATH, 'utf-8');
  return cachedSpec;
}

/** Discover and classify the full schema of a target database */
export async function discoverSchema(
  connector: DatabaseConnector,
  model: ModelComplete,
  cycle: number,
  sampleLimit: number = 50,
): Promise<SchemaSnapshot> {
  const tables = await connector.getTables();
  const tableSchemas: TableSchema[] = [];

  for (const tableName of tables) {
    const columns = await connector.getColumns(tableName);
    const foreignKeys = await connector.getForeignKeys(tableName);
    const rowCount = await connector.getRowCount(tableName);
    const sampleData = await connector.getSampleRows(tableName, sampleLimit);

    // Classify via R++ spec
    const classification = await classifyTable(tableName, columns, foreignKeys, sampleData, model);

    const columnSchemas: ColumnSchema[] = columns.map(col => ({
      name: col.name,
      db_type: col.type,
      probable_meaning: classification.columns[col.name]?.meaning ?? 'unknown',
      confidence: classification.columns[col.name]?.confidence ?? 0.3,
      is_primary_key: col.is_primary_key,
      is_foreign_key: foreignKeys.some(fk => fk.from_column === col.name),
      is_nullable: col.nullable,
      is_enum: classification.columns[col.name]?.is_enum ?? false,
      enum_values: classification.columns[col.name]?.enum_values,
    }));

    const relationships: ForeignKeyInfo[] = foreignKeys.map(fk => ({
      from_table: tableName,
      from_column: fk.from_column,
      to_table: fk.to_table,
      to_column: fk.to_column,
      relationship_type: 'one-to-many',
    }));

    tableSchemas.push({
      name: tableName,
      probable_purpose: classification.purpose,
      confidence: classification.confidence,
      columns: columnSchemas,
      row_count: rowCount,
      relationships,
      sample_data: sampleData.slice(0, 5),
    });
  }

  const overallConfidence = tableSchemas.length > 0
    ? tableSchemas.reduce((sum, t) => sum + t.confidence, 0) / tableSchemas.length
    : 0;

  return {
    id: randomUUID(),
    tables: tableSchemas,
    confidence: overallConfidence,
    captured_at: new Date().toISOString(),
    cycle,
  };
}

interface ClassificationResult {
  purpose: string;
  confidence: number;
  columns: Record<string, { meaning: string; confidence: number; is_enum: boolean; enum_values?: Array<{ value: unknown; probable_meaning: string }> }>;
}

async function classifyTable(
  tableName: string,
  columns: Array<{ name: string; type: string; nullable: boolean; is_primary_key: boolean }>,
  foreignKeys: Array<{ from_column: string; to_table: string; to_column: string }>,
  sampleData: Record<string, unknown>[],
  model: ModelComplete,
): Promise<ClassificationResult> {
  const spec = loadSpec();

  const response = await model.complete({
    systemPrompt: `You are a database schema analyst. Follow this R++ specification exactly.\n\n\`\`\`rpp\n${spec}\n\`\`\``,
    prompt: JSON.stringify({
      table_name: tableName,
      columns: columns.map(c => ({ name: c.name, type: c.type, nullable: c.nullable, is_pk: c.is_primary_key })),
      foreign_keys: foreignKeys,
      sample_rows: sampleData.slice(0, 10),
    }),
    responseFormat: 'json',
    temperature: 0,
    maxTokens: 1500,
  });

  const parsed = JSON.parse(response.text);

  const columnMap: ClassificationResult['columns'] = {};
  for (const col of (parsed.columns || [])) {
    columnMap[col.name] = {
      meaning: String(col.probable_meaning || 'unknown'),
      confidence: Number(col.confidence) || 0.3,
      is_enum: Boolean(col.is_enum),
      enum_values: col.enum_values,
    };
  }

  return {
    purpose: String(parsed.table_purpose || 'unknown'),
    confidence: Number(parsed.confidence) || 0.5,
    columns: columnMap,
  };
}
