import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LocalAdapter } from '../src/adapters/local/local-adapter.js';

describe('Scoring Rubric Operations & Normalization', () => {
  let tmpDir: string;
  let adapter: LocalAdapter;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-search-rubric-test-'));
    adapter = new LocalAdapter(tmpDir);
    await adapter.initialize();
  });

  afterEach(async () => {
    await adapter.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('retrieves default 4 seeded dimensions with full criteria and weights', async () => {
    const rubric = await adapter.getScoringRubric();
    expect(rubric).toHaveLength(4);

    const dims = rubric.map(r => r.dimension);
    expect(dims).toContain('Title match');
    expect(dims).toContain('Skills match');
    expect(dims).toContain('Experience match');
    expect(dims).toContain('Seniority fit');

    const totalWeight = rubric.reduce((sum, r) => sum + r.weight, 0);
    expect(totalWeight).toBe(100);

    for (const r of rubric) {
      expect(r.poor_description).toBeTruthy();
      expect(r.moderate_description).toBeTruthy();
      expect(r.strong_description).toBeTruthy();
    }
  });

  it('allows arbitrary integer weights that do not sum to 100', async () => {
    // Add custom dimension with weight 15
    await adapter.addRubricDimension({
      dimension: 'Domain knowledge',
      weight: 15,
      poor_description: 'No relevant domain history',
      moderate_description: 'Familiar with adjacent domain',
      strong_description: 'Deep domain expert',
    });

    const rubric = await adapter.getScoringRubric();
    expect(rubric).toHaveLength(5);
    const sumWeights = rubric.reduce((sum, r) => sum + r.weight, 0);
    expect(sumWeights).toBe(115); // Sum is 115, not 100

    // Nearest integer normalization calculation
    const normalized = rubric.map(r => ({
      dimension: r.dimension,
      rawWeight: r.weight,
      normalizedWeight: Math.round((r.weight / sumWeights) * 100),
    }));

    expect(normalized.find(r => r.dimension === 'Domain knowledge')?.normalizedWeight).toBe(
      Math.round((15 / 115) * 100) // 13%
    );
  });

  it('supports case-insensitive updates for dimension names', async () => {
    // Update 'Title match' using lowercase 'title match'
    const updated = await adapter.updateRubricDimension('title match', {
      weight: 35,
      poor_description: 'Completely irrelevant title',
    });

    expect(updated.dimension).toBe('Title match');
    expect(updated.weight).toBe(35);
    expect(updated.poor_description).toBe('Completely irrelevant title');

    // Fetch rubric and confirm
    const rubric = await adapter.getScoringRubric();
    const titleDim = rubric.find(r => r.dimension.toLowerCase() === 'title match');
    expect(titleDim?.weight).toBe(35);
    expect(titleDim?.poor_description).toBe('Completely irrelevant title');
  });

  it('supports case-insensitive removals for dimension names', async () => {
    // Remove 'Seniority fit' using uppercase 'SENIORITY FIT'
    const removed = await adapter.removeRubricDimension('SENIORITY FIT');
    expect(removed).toBe(true);

    const rubric = await adapter.getScoringRubric();
    expect(rubric).toHaveLength(3);
    expect(rubric.find(r => r.dimension.toLowerCase() === 'seniority fit')).toBeUndefined();
  });

  it('upserts dimension case-insensitively without creating duplicate rows', async () => {
    // Add 'skills match' (lowercase) with new weight
    await adapter.addRubricDimension({
      dimension: 'skills match',
      weight: 40,
    });

    const rubric = await adapter.getScoringRubric();
    // Length should still be 4, not 5
    expect(rubric).toHaveLength(4);
    const skillDim = rubric.find(r => r.dimension.toLowerCase() === 'skills match');
    expect(skillDim?.weight).toBe(40);
  });

  it('immediately reflects direct edits to scoring-rubric.md on subsequent reads', async () => {
    const rubricPath = path.join(tmpDir, 'scoring-rubric.md');
    
    // Simulate user directly editing scoring-rubric.md
    const customContent = `# Scoring Rubric

| Dimension | Weight | Poor (1-2) | Moderate (3) | Strong (4-5) |
| --- | --- | --- | --- | --- |
| System Architecture | 60% | No distributed systems experience | Basic microservices | High-scale distributed design |
| Cultural Alignment | 40% | Solo only | Team player | Multi-org leadership |
`;
    fs.writeFileSync(rubricPath, customContent, 'utf-8');

    // Read without re-initializing
    const rubric = await adapter.getScoringRubric();
    expect(rubric).toHaveLength(2);
    expect(rubric[0].dimension).toBe('System Architecture');
    expect(rubric[0].weight).toBe(60);
    expect(rubric[1].dimension).toBe('Cultural Alignment');
    expect(rubric[1].weight).toBe(40);
  });
});
