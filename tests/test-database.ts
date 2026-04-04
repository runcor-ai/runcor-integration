// Integration database tests — no API key needed

import { IntegrationDatabase } from '../src/database.js';
import { SQLiteConnector } from '../src/connectors/sqlite.js';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';

const DB_PATH = './test-integration.db';
const TARGET_DB_PATH = './test-target.db';
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; console.log(`  ✗ ${message}`); }
}

function cleanup(): void {
  for (const p of [DB_PATH, TARGET_DB_PATH]) {
    try { unlinkSync(p); } catch { /* ignore */ }
    try { unlinkSync(p + '-wal'); } catch { /* ignore */ }
    try { unlinkSync(p + '-shm'); } catch { /* ignore */ }
  }
}

// ── Setup target database ──

cleanup();

const targetDb = new Database(TARGET_DB_PATH);
targetDb.exec(`
  CREATE TABLE customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    status INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER REFERENCES customers(id),
    amount REAL NOT NULL,
    status INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
  INSERT INTO customers (name, email, status) VALUES ('Acme Ltd', 'info@acme.com', 1);
  INSERT INTO customers (name, email, status) VALUES ('Marketplace Corp', 'sales@marketplace.com', 2);
  INSERT INTO customers (name, email, status) VALUES ('TechStart Inc', 'hello@techstart.io', 1);
  INSERT INTO orders (customer_id, amount, status) VALUES (1, 1500.00, 3);
  INSERT INTO orders (customer_id, amount, status) VALUES (1, 2200.00, 2);
  INSERT INTO orders (customer_id, amount, status) VALUES (2, 4200.00, 1);
  INSERT INTO orders (customer_id, amount, status) VALUES (3, 800.00, 3);
`);
targetDb.close();

// ── Test IntegrationDatabase ──

console.log('\n=== IntegrationDatabase Tests ===\n');

const db = new IntegrationDatabase(DB_PATH);

// Schema snapshots
console.log('Schema snapshots:');
const snapshot = {
  id: randomUUID(),
  tables: [{ name: 'customers', probable_purpose: 'customer records', confidence: 0.8, columns: [], row_count: 3, relationships: [], sample_data: [] }],
  confidence: 0.8,
  captured_at: new Date().toISOString(),
  cycle: 1,
};
db.saveSnapshot(snapshot);
const retrieved = db.getLatestSnapshot();
assert(retrieved !== null, 'Snapshot saved and retrieved');
assert(retrieved!.id === snapshot.id, 'Snapshot ID matches');
assert(retrieved!.tables.length === 1, 'Tables preserved');

// Observations
console.log('\nObservations:');
const obs = {
  id: randomUUID(),
  table_name: 'customers',
  change_type: 'insert' as const,
  row_data: { name: 'New Corp', email: 'new@corp.com' },
  observed_at: new Date().toISOString(),
  cycle: 1,
};
db.saveObservation(obs);
const observations = db.getObservations('customers');
assert(observations.length === 1, 'Observation saved and retrieved');
assert(observations[0].table_name === 'customers', 'Table name preserved');
assert(db.getObservationCount() === 1, 'Observation count correct');

// Patterns
console.log('\nPatterns:');
db.savePattern({
  id: randomUUID(),
  description: 'Orders table gets ~4 inserts per cycle',
  confidence: 0.7,
  occurrence_count: 5,
  first_seen: 1,
  last_seen: 5,
  pattern_data: { table: 'orders', avg_inserts: 4 },
});
const patterns = db.getPatterns(0.5);
assert(patterns.length === 1, 'Pattern saved and retrieved');
assert(patterns[0].confidence === 0.7, 'Pattern confidence preserved');

// Poll state
console.log('\nPoll state:');
db.savePollState({ table_name: 'customers', last_id: 3, last_timestamp: null, last_hash: null, poll_frequency_seconds: 300 });
const pollState = db.getPollState('customers');
assert(pollState !== null, 'Poll state saved and retrieved');
assert(pollState!.last_id === 3, 'Last ID preserved');

// Generated tools
console.log('\nGenerated tools:');
db.saveTool('get_customer', 'Get a customer by ID', { type: 'object' }, 'SELECT * FROM customers WHERE id = ?');
const tools = db.getTools();
assert(tools.length === 1, 'Tool saved and retrieved');
assert(tools[0].name === 'get_customer', 'Tool name preserved');

db.close();

// ── Test SQLiteConnector ──

console.log('\n=== SQLiteConnector Tests ===\n');

const connector = new SQLiteConnector({ type: 'sqlite', database: TARGET_DB_PATH, path: TARGET_DB_PATH });
await connector.connect();

const tables = await connector.getTables();
assert(tables.includes('customers'), 'Found customers table');
assert(tables.includes('orders'), 'Found orders table');

const columns = await connector.getColumns('customers');
assert(columns.length === 5, 'Customers has 5 columns');
assert(columns.some(c => c.name === 'name'), 'Found name column');
assert(columns.some(c => c.is_primary_key), 'Found primary key');

const fks = await connector.getForeignKeys('orders');
assert(fks.length === 1, 'Orders has 1 foreign key');
assert(fks[0].to_table === 'customers', 'FK points to customers');

const rowCount = await connector.getRowCount('customers');
assert(rowCount === 3, 'Customers has 3 rows');

const samples = await connector.getSampleRows('orders', 2);
assert(samples.length === 2, 'Got 2 sample rows');

const queryResult = await connector.query('SELECT * FROM customers WHERE status = ?', [1]);
assert(queryResult.length === 2, 'Query with params works');

await connector.disconnect();

// ── Cleanup ──

cleanup();

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
