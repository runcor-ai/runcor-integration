# runcor-integration

Integration agent for the [runcor](https://github.com/runcor-ai/runcor) AI runtime. Bridges bespoke systems into the runcor ecosystem so other agents can collaborate with systems they know nothing about.

## What it does

runcor-integration connects to an external database (read-only), learns its schema and behavior over time, and exposes that knowledge as dynamic MCP tools that other agents can call. It's the bridge between "I need customer info" and knowing which table, which columns, and which joins to use.

```
Bespoke database (read-only)
       ↓ observe
  INTEGRATION AGENT
       ↓                    ↓
  Own memory cubes        Dynamic MCP tools
  (learned patterns)      (other agents call these)
```

**V1**: Database observation + dynamic MCP tool serving.
**Future**: Could learn from any I/O boundary — API traffic, file changes, event streams, log files.

## How it works

### Phase 1 — Learn the system (observation)
- Connect to target database (read-only)
- Discover tables, columns, types, foreign keys
- Classify what everything means via [R++](https://github.com/runcor-ai/rpp) spec
- Poll for changes over time — learn patterns
- Memory cubes reinforce what's proven, forget what's noise

### Phase 2 — Serve other agents (dynamic MCP)
- Dynamically generate tools based on what it's learned
- `get_customer { id }` — knows which table and columns
- `search_orders { query }` — knows the right text columns to search
- `query { question }` — translates natural language to SQL
- Other agents call these through the normal MCP adapter pattern

### Example flow

```
Sales Agent: "I need customer info for Acme Ltd"
    ↓ calls integration agent tool
Integration Agent:
    1. Knows customer data is in tbl_contacts (learned)
    2. Queries target database with the right joins
    3. Returns structured data
    ↓
Sales Agent: uses data to compose email
```

## 3-cube architecture

1. **Short-term memory** — recent observations: "new table discovered", "status changed on 12 rows"
2. **Long-term memory** — proven understanding: "tbl_contacts is the customers table", "status 4 means shipped"
3. **Integration database** — schema snapshots, observations, patterns, poll state, generated tools

## Bolt-on integration

```typescript
import { createEngine } from 'runcor';
import { createIntegrationAgent } from 'runcor-integration';

const engine = await createEngine({ ... });

const agent = await createIntegrationAgent({
  name: 'erp-system',
  connector: { type: 'sqlite', database: './legacy-erp.db', path: './legacy-erp.db' },
  openaiApiKey: process.env.OPENAI_API_KEY,
}, ctx.model);

await agent.init();

// Get dynamically generated tools
const tools = agent.getTools();
// tools: get_customer, search_customer, recent_orders, query, describe_system, ...

// Ask questions
const answer = await agent.ask('How many orders does Acme Ltd have?');

// Run observation cycle
const { observationCount } = await agent.cycle();
```

## R++ specs

| Spec | Purpose |
|------|---------|
| `classify-schema.rpp` | Classify table and column purposes |
| `build-query.rpp` | Translate natural language to SQL |
| `detect-pattern.rpp` | Identify behavioral patterns from observations |
| `summarize-entity.rpp` | Cross-table entity summary |
| `explain-system.rpp` | Describe how the system works |

## Setup

```bash
npm install runcor-integration
```

Requires:
- Node.js >= 20.6.0
- `OPENAI_API_KEY` for embeddings and memory

### Database connectors

V1 supports SQLite. Future connectors for Postgres, MySQL, MSSQL.

## Testing

```bash
npm test                  # Database + connector tests (no API key needed)
npm run test:schema       # Schema discovery (needs OPENAI_API_KEY)
```

## File structure

```
src/
  types.ts                — All type definitions
  database.ts             — Agent's own SQLite storage
  integration-agent.ts    — Main agent factory
  schema-discovery.ts     — Schema analysis via R++ spec
  change-detector.ts      — Poll for changes (timestamp, ID, or hash)
  pattern-learner.ts      — runcor-memory integration
  tool-generator.ts       — Dynamic MCP tool creation
  query-builder.ts        — Natural language → SQL translation
  connectors/
    base.ts               — Connector interface
    sqlite.ts             — SQLite read-only connector
specs/
  classify-schema.rpp     — Table/column classification
  build-query.rpp         — NL → SQL translation
  detect-pattern.rpp      — Behavioral pattern detection
  summarize-entity.rpp    — Entity summary generation
  explain-system.rpp      — System behavior explanation
```

## License

MIT
