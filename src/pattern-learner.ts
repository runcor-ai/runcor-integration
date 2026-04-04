// Pattern learner — records observations to runcor-memory, reinforces proven patterns

import type { Observation, ModelComplete } from './types.js';

export interface PatternLearner {
  recordObservation(obs: Observation): Promise<void>;
  recordObservations(observations: Observation[]): Promise<void>;
  queryPatterns(question: string): Promise<string>;
  cycle(): Promise<void>;
  setCycle(cycle: number): void;
}

/** Create a pattern learner backed by runcor-memory */
export async function createPatternLearner(
  dbPath: string,
  model: ModelComplete,
  openaiApiKey?: string,
): Promise<PatternLearner> {
  const { createCognitiveMemory } = await import('runcor-memory');

  const mem = createCognitiveMemory({
    dbPath,
    openaiApiKey,
    model,
    agentRole: 'Integration agent that observes database systems and learns their behavior patterns',
    config: {
      tau: 40, // High tau — understanding a system is slow
      durability: 10,
      promoteThreshold: 0.6,
      forgetThreshold: 0.05,
    },
  });

  const memory = mem.standalone();

  return {
    async recordObservation(obs: Observation): Promise<void> {
      const summary = `${obs.change_type} in ${obs.table_name}: ${JSON.stringify(obs.row_data).slice(0, 500)}`;
      await memory.record(summary, { tags: ['observation', obs.table_name, obs.change_type] });
    },

    async recordObservations(observations: Observation[]): Promise<void> {
      // Batch: summarize by table
      const byTable = new Map<string, Observation[]>();
      for (const obs of observations) {
        const existing = byTable.get(obs.table_name) ?? [];
        existing.push(obs);
        byTable.set(obs.table_name, existing);
      }

      for (const [table, obs] of byTable) {
        const summary = `${obs.length} changes in ${table}: ${obs.map(o => o.change_type).join(', ')}`;
        await memory.record(summary, { tags: ['observation-batch', table] });
      }
    },

    async queryPatterns(question: string): Promise<string> {
      const results = await memory.query(question, 10);
      if (results.length === 0) return 'No relevant patterns learned yet.';
      return results.map((r: { node: { content: string } }) => r.node.content).join('\n');
    },

    async cycle(): Promise<void> {
      await memory.cycle();
    },

    setCycle(cycle: number): void {
      memory.setCycle(cycle);
    },
  };
}
