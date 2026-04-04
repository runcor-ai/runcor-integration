// Tool generator — dynamically creates MCP tools from learned schema

import type { SchemaSnapshot, TableSchema, DynamicTool, ToolResult, DatabaseConnector } from './types.js';
import type { IntegrationDatabase } from './database.js';

/** Generate MCP-compatible tools from a schema snapshot */
export function generateTools(
  schema: SchemaSnapshot,
  connector: DatabaseConnector,
  db: IntegrationDatabase,
): DynamicTool[] {
  const tools: DynamicTool[] = [];

  for (const table of schema.tables) {
    if (table.confidence < 0.4) continue; // Skip poorly understood tables

    // Tool 1: Get by ID/primary key
    const pkCol = table.columns.find(c => c.is_primary_key);
    if (pkCol) {
      const toolName = `get_${sanitizeName(table.probable_purpose || table.name)}`;
      const tool: DynamicTool = {
        name: toolName,
        description: `Get a ${table.probable_purpose || table.name} record by ${pkCol.probable_meaning || pkCol.name}`,
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: pkCol.db_type.includes('INT') ? 'number' : 'string', description: pkCol.probable_meaning || pkCol.name },
          },
          required: ['id'],
        },
        handler: async (args) => {
          try {
            const rows = await connector.query(`SELECT * FROM "${table.name}" WHERE "${pkCol.name}" = ? LIMIT 1`, [args.id]);
            return formatResult(rows[0] ?? null, table);
          } catch (err) {
            return errorResult(err);
          }
        },
      };
      tools.push(tool);
      db.saveTool(toolName, tool.description, tool.inputSchema, `SELECT * FROM "${table.name}" WHERE "${pkCol.name}" = ?`);
    }

    // Tool 2: Search/list
    const searchToolName = `search_${sanitizeName(table.probable_purpose || table.name)}`;
    const searchableCols = table.columns.filter(c =>
      c.db_type.toLowerCase().includes('text') ||
      c.db_type.toLowerCase().includes('varchar') ||
      c.db_type.toLowerCase().includes('char'),
    );

    if (searchableCols.length > 0) {
      const primarySearchCol = searchableCols[0];
      const tool: DynamicTool = {
        name: searchToolName,
        description: `Search ${table.probable_purpose || table.name} records by ${primarySearchCol.probable_meaning || primarySearchCol.name}`,
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: `Search term for ${primarySearchCol.probable_meaning || primarySearchCol.name}` },
            limit: { type: 'number', description: 'Max results (default 20)' },
          },
          required: ['query'],
        },
        handler: async (args) => {
          try {
            const limit = Number(args.limit) || 20;
            const rows = await connector.query(
              `SELECT * FROM "${table.name}" WHERE "${primarySearchCol.name}" LIKE ? LIMIT ?`,
              [`%${args.query}%`, limit],
            );
            return formatResults(rows, table);
          } catch (err) {
            return errorResult(err);
          }
        },
      };
      tools.push(tool);
      db.saveTool(searchToolName, tool.description, tool.inputSchema, `SELECT * FROM "${table.name}" WHERE "${primarySearchCol.name}" LIKE ?`);
    }

    // Tool 3: List recent (for tables with timestamps)
    const tsCol = table.columns.find(c =>
      c.name.toLowerCase().includes('created') ||
      c.name.toLowerCase().includes('date') ||
      c.db_type.toLowerCase().includes('timestamp'),
    );
    if (tsCol) {
      const recentToolName = `recent_${sanitizeName(table.probable_purpose || table.name)}`;
      const tool: DynamicTool = {
        name: recentToolName,
        description: `Get recent ${table.probable_purpose || table.name} records`,
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Max results (default 20)' },
          },
        },
        handler: async (args) => {
          try {
            const limit = Number(args.limit) || 20;
            const rows = await connector.query(
              `SELECT * FROM "${table.name}" ORDER BY "${tsCol.name}" DESC LIMIT ?`,
              [limit],
            );
            return formatResults(rows, table);
          } catch (err) {
            return errorResult(err);
          }
        },
      };
      tools.push(tool);
    }
  }

  // Meta tool: describe the system
  tools.push({
    name: 'describe_system',
    description: 'Describe the database structure and what the integration agent has learned about it',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const summary = schema.tables.map(t =>
        `${t.name} (${t.probable_purpose}, ${t.row_count} rows, confidence: ${t.confidence.toFixed(2)})\n` +
        `  Columns: ${t.columns.map(c => `${c.name} [${c.probable_meaning}]`).join(', ')}`,
      ).join('\n\n');
      return { content: [{ type: 'text', text: summary }] };
    },
  });

  return tools;
}

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function formatResult(row: Record<string, unknown> | null, table: TableSchema): ToolResult {
  if (!row) return { content: [{ type: 'text', text: 'No record found.' }] };
  const enriched = enrichRow(row, table);
  return { content: [{ type: 'text', text: JSON.stringify(enriched, null, 2) }] };
}

function formatResults(rows: Record<string, unknown>[], table: TableSchema): ToolResult {
  if (rows.length === 0) return { content: [{ type: 'text', text: 'No records found.' }] };
  const enriched = rows.map(r => enrichRow(r, table));
  return { content: [{ type: 'text', text: JSON.stringify(enriched, null, 2) }] };
}

function enrichRow(row: Record<string, unknown>, table: TableSchema): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const col = table.columns.find(c => c.name === key);
    if (col && col.is_enum && col.enum_values) {
      const enumEntry = col.enum_values.find(e => e.value === value);
      result[key] = enumEntry ? `${value} (${enumEntry.probable_meaning})` : value;
    } else {
      result[key] = value;
    }
  }
  return result;
}

function errorResult(err: unknown): ToolResult {
  return { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
}
