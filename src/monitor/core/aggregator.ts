import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PipelineSnapshot, AgentSummary, AgentId, FeatureRecord, BugRecord, AgentMetrics, AgentBehaviorMetrics } from './types';
import { parseFeatureStatus, parseBugStatus } from './statusParser';

const PIPELINE_ORDER: AgentId[] = ['leo', 'cloe', 'max', 'ada', 'cipher'];

// Promedia un array de numeros nullable. Retorna null si no hay valores no-null.
// Redondea a 2 decimales para coincidir con la precision del resto del modulo.
function avgNullable(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

function computeAgentSummaries(
  features: FeatureRecord[],
  bugs: BugRecord[]
): AgentSummary[] {
  return PIPELINE_ORDER.map((agentId): AgentSummary => {
    // Collect all metrics for this agent across features and bugs
    const allMetrics: AgentMetrics[] = [];

    for (const f of features) {
      const m = f.metrics.find((x) => x.agentId === agentId);
      if (m) allMetrics.push(m);
    }
    for (const b of bugs) {
      const m = b.agentMetrics[agentId];
      if (m) allMetrics.push(m);
    }

    const total = allMetrics.length;
    if (total === 0) {
      return {
        agentId,
        totalFeatures: 0,
        avgIterations: 0,
        reworkCount: 0,
        reworkRate: 0,
        avgConfidence: 0,
        totalGapsDeclared: 0,
        completedHandoffs: 0,
        avgChecklistRate: null,
        avgStructureScore: null,
        avgHallucinationRate: null,
        memoryReadRate: null,
      };
    }

    const reworkCount = allMetrics.filter((m) => m.rework === true).length;
    const iterationsValues = allMetrics.map((m) => m.iteraciones).filter((v): v is number => v !== null);
    const avgIterations = iterationsValues.length > 0
      ? iterationsValues.reduce((a, b) => a + b, 0) / iterationsValues.length
      : 0;

    const confMap = { alta: 3, media: 2, baja: 1 } as const;
    const confValues = allMetrics
      .map((m) => m.confianza)
      .filter((v): v is 'alta' | 'media' | 'baja' => v !== null)
      .map((v) => confMap[v]);
    const avgConfidence = confValues.length > 0
      ? confValues.reduce((a, b) => a + b, 0) / confValues.length
      : 0;

    const totalGapsDeclared = allMetrics
      .map((m) => m.gapsDeclarados ?? 0)
      .reduce((a, b) => a + b, 0);

    // Completados: handoffs donde este agente es el "from" y estan marcados completed
    const completedHandoffs = features
      .flatMap((f) => f.handoffs)
      .filter((h) => h.from === agentId && h.completed)
      .length;

    // Metricas de comportamiento (solo desde features, no bugs -- v1)
    const behaviorEntries: AgentBehaviorMetrics[] = [];
    for (const f of features) {
      const bm = f.behaviorMetrics[agentId];
      if (bm) behaviorEntries.push(bm);
    }

    const avgChecklistRate    = avgNullable(behaviorEntries.map(b => b.checklistRate));
    const avgStructureScore   = avgNullable(behaviorEntries.map(b => b.structureScore));
    const avgHallucinationRate = avgNullable(behaviorEntries.map(b => b.hallucinationRate));

    // memoryReadRate
    const memoryReads = behaviorEntries
      .map(b => b.memoryRead)
      .filter((v): v is boolean => v !== null);
    const memoryReadRate = memoryReads.length > 0
      ? Math.round((memoryReads.filter(v => v).length / memoryReads.length) * 100) / 100
      : null;

    return {
      agentId,
      totalFeatures: total,
      avgIterations: Math.round(avgIterations * 100) / 100,
      reworkCount,
      reworkRate: Math.round((reworkCount / total) * 100) / 100,
      avgConfidence: Math.round(avgConfidence * 100) / 100,
      totalGapsDeclared,
      completedHandoffs,
      avgChecklistRate,
      avgStructureScore,
      avgHallucinationRate,
      memoryReadRate,
    };
  });
}

export function buildSnapshot(docsDir: string, repoRoot: string = ''): PipelineSnapshot {
  const parseErrors: string[] = [];
  const features: FeatureRecord[] = [];
  const bugs: BugRecord[] = [];

  // --- features ---
  const featuresDir = join(docsDir, 'features');
  if (existsSync(featuresDir)) {
    let slugs: string[] = [];
    try {
      slugs = readdirSync(featuresDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch (e: any) {
      parseErrors.push(`Cannot read features dir: ${e.message}`);
    }

    for (const slug of slugs) {
      const filePath = join(featuresDir, slug, 'status.md');
      if (!existsSync(filePath)) continue;
      try {
        const content = readFileSync(filePath, 'utf-8');
        features.push(parseFeatureStatus(content, slug, filePath, repoRoot));
      } catch (e: any) {
        parseErrors.push(`${filePath}: ${e.message}`);
      }
    }
  }

  // --- bugs ---
  const bugsDir = join(docsDir, 'bugs');
  if (existsSync(bugsDir)) {
    let bugDirs: string[] = [];
    try {
      bugDirs = readdirSync(bugsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch (e: any) {
      parseErrors.push(`Cannot read bugs dir: ${e.message}`);
    }

    for (const dirName of bugDirs) {
      const filePath = join(bugsDir, dirName, 'status.md');
      if (!existsSync(filePath)) continue;
      try {
        const content = readFileSync(filePath, 'utf-8');
        // dirName format: "001-slug-del-bug"
        const idMatch = dirName.match(/^(\d+)-(.+)$/);
        const id = idMatch?.[1] ?? dirName;
        const slug = idMatch?.[2] ?? dirName;
        bugs.push(parseBugStatus(content, id, slug, filePath));
      } catch (e: any) {
        parseErrors.push(`${filePath}: ${e.message}`);
      }
    }
  }

  const agentSummaries = computeAgentSummaries(features, bugs);

  return {
    features,
    bugs,
    agentSummaries,
    lastUpdatedAt: new Date().toISOString(),
    parseErrors,
  };
}
