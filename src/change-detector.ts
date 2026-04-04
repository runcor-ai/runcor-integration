// Change detector — polls target database for new/changed rows

import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import type { DatabaseConnector, Observation, PollState, TableSchema } from './types.js';
import type { IntegrationDatabase } from './database.js';

export interface ChangeDetectorOptions {
  connector: DatabaseConnector;
  db: IntegrationDatabase;
  cycle: number;
}

/** Poll all tables for changes using the best available strategy */
export async function detectChanges(
  tables: TableSchema[],
  options: ChangeDetectorOptions,
): Promise<Observation[]> {
  const { connector, db, cycle } = options;
  const observations: Observation[] = [];

  for (const table of tables) {
    const pollState = db.getPollState(table.name);
    const strategy = pickStrategy(table);

    let newRows: Record<string, unknown>[];

    switch (strategy) {
      case 'timestamp': {
        const tsCol = findTimestampColumn(table);
        if (!tsCol) continue;
        const lastTs = pollState?.last_timestamp ?? '1970-01-01T00:00:00Z';
        newRows = await connector.query(
          `SELECT * FROM "${table.name}" WHERE "${tsCol}" > ? ORDER BY "${tsCol}" ASC LIMIT 500`,
          [lastTs],
        );
        if (newRows.length > 0) {
          const maxTs = String(newRows[newRows.length - 1][tsCol]);
          db.savePollState({ table_name: table.name, last_id: null, last_timestamp: maxTs, last_hash: null, poll_frequency_seconds: pollState?.poll_frequency_seconds ?? 300 });
        }
        break;
      }

      case 'max_id': {
        const idCol = findIdColumn(table);
        if (!idCol) continue;
        const lastId = pollState?.last_id ?? 0;
        newRows = await connector.query(
          `SELECT * FROM "${table.name}" WHERE "${idCol}" > ? ORDER BY "${idCol}" ASC LIMIT 500`,
          [lastId],
        );
        if (newRows.length > 0) {
          const maxId = Number(newRows[newRows.length - 1][idCol]);
          db.savePollState({ table_name: table.name, last_id: maxId, last_timestamp: null, last_hash: null, poll_frequency_seconds: pollState?.poll_frequency_seconds ?? 300 });
        }
        break;
      }

      case 'hash': {
        const currentRows = await connector.getSampleRows(table.name, 1000);
        const currentHash = hashRows(currentRows);
        if (currentHash !== pollState?.last_hash) {
          newRows = currentRows; // Treat all as new when hash changes
          db.savePollState({ table_name: table.name, last_id: null, last_timestamp: null, last_hash: currentHash, poll_frequency_seconds: pollState?.poll_frequency_seconds ?? 3600 });
        } else {
          newRows = [];
        }
        break;
      }

      default:
        newRows = [];
    }

    // Record observations
    for (const row of newRows) {
      const obs: Observation = {
        id: randomUUID(),
        table_name: table.name,
        change_type: 'insert', // V1: assume inserts (can't distinguish without triggers)
        row_data: row,
        observed_at: new Date().toISOString(),
        cycle,
      };
      observations.push(obs);
      db.saveObservation(obs);
    }
  }

  return observations;
}

type Strategy = 'timestamp' | 'max_id' | 'hash';

function pickStrategy(table: TableSchema): Strategy {
  if (findTimestampColumn(table)) return 'timestamp';
  if (findIdColumn(table)) return 'max_id';
  return 'hash';
}

function findTimestampColumn(table: TableSchema): string | null {
  const candidates = table.columns.filter(c =>
    c.db_type.toLowerCase().includes('timestamp') ||
    c.db_type.toLowerCase().includes('datetime') ||
    c.name.toLowerCase().includes('updated_at') ||
    c.name.toLowerCase().includes('modified') ||
    c.name.toLowerCase().includes('created_at'),
  );
  return candidates.length > 0 ? candidates[0].name : null;
}

function findIdColumn(table: TableSchema): string | null {
  const pk = table.columns.find(c => c.is_primary_key);
  if (pk && (pk.db_type.toLowerCase().includes('int') || pk.db_type.toLowerCase() === 'integer')) {
    return pk.name;
  }
  return null;
}

function hashRows(rows: Record<string, unknown>[]): string {
  const hash = createHash('sha256');
  hash.update(JSON.stringify(rows));
  return hash.digest('hex');
}
