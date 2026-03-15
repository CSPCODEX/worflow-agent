/**
 * metrics.ts — Aggregate pipeline metrics across all features and bugs
 *
 * Usage:
 *   bun run scripts/metrics.ts
 *   bun run scripts/metrics.ts --history
 *   bun run scripts/metrics.ts --feature devtools-csp-produccion
 *   bun run scripts/metrics.ts --compare devtools-csp-produccion electrobun-migration
 *   bun run scripts/metrics.ts --desde 2026-01-01 --hasta 2026-03-31
 *   bun run scripts/metrics.ts --json
 */

import { readdirSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { Database } from "bun:sqlite";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentMetrics {
  agent: string;
  archivos_leidos: number;
  archivos_creados: number;
  archivos_modificados: number;
  rework: boolean;
  iteraciones: number;
  confianza: "alta" | "media" | "baja" | "desconocida";
  gaps_declarados: number;
  bugs_criticos?: number;
  bugs_altos?: number;
  bundle_antes_mb?: number;
  bundle_despues_mb?: number;
  optimizaciones_aplicadas?: number;
  optimizaciones_descartadas?: number;
  vulnerabilidades_criticas?: number;
  vulnerabilidades_altas?: number;
  vulnerabilidades_medias?: number;
  riesgos_aceptados?: number;
  decision?: "APROBADO" | "APROBADO_CON_RIESGOS" | "BLOQUEADO";
}

interface PipelineRecord {
  type: "feature" | "bug";
  slug: string;
  name: string;
  path: string;
  estado: string;
  fecha_apertura: string;
  metrics: Partial<Record<string, AgentMetrics>>;
}

interface AgentAggregate {
  agent: string;
  sessions: number;
  rework_count: number;
  confianza_baja_count: number;
  gaps_declarados_total: number;
  archivos_leidos_total: number;
  iteraciones_total: number;
  bugs_criticos_total: number;
  bundle_delta_total: number;
  bundle_sessions: number;
  vulns_criticas_total: number;
  bloqueados: number;
}

interface EntityRow {
  id: number;
  entity_type: string;
  entity_slug: string;
  agent: string;
  recorded_at: string;
  archivos_leidos: number;
  archivos_creados: number;
  archivos_modificados: number;
  rework: number;
  iteraciones: number;
  confianza: string;
  gaps_declarados: number;
  bugs_criticos: number | null;
  bugs_altos: number | null;
  bundle_antes_mb: number | null;
  bundle_despues_mb: number | null;
  optimizaciones_aplicadas: number | null;
  optimizaciones_descartadas: number | null;
  vulns_criticas: number | null;
  vulns_altas: number | null;
  vulns_medias: number | null;
  riesgos_aceptados: number | null;
  decision: string | null;
}

// ─── Parsing helpers ──────────────────────────────────────────────────────────

function extractMetricsBlock(content: string, agentName: string): AgentMetrics | null {
  const blockHeader = `## Metricas de ${agentName}`;
  const start = content.indexOf(blockHeader);
  if (start === -1) return null;

  const blockStart = start + blockHeader.length;
  const nextHeading = content.indexOf("\n##", blockStart);
  const blockContent = nextHeading === -1
    ? content.slice(blockStart)
    : content.slice(blockStart, nextHeading);

  const parseNum = (key: string): number => {
    const match = blockContent.match(new RegExp(`${key}:\\s*(\\d+)`));
    return match ? parseInt(match[1], 10) : 0;
  };

  const parseStr = (key: string): string => {
    const match = blockContent.match(new RegExp(`${key}:\\s*([^\\n]+)`));
    return match ? match[1].trim() : "";
  };

  const parseFloat_ = (key: string): number => {
    const match = blockContent.match(new RegExp(`${key}:\\s*([\\d.]+)`));
    return match ? parseFloat(match[1]) : 0;
  };

  const confianzaRaw = parseStr("confianza").toLowerCase();
  const confianza: AgentMetrics["confianza"] =
    confianzaRaw === "alta" || confianzaRaw === "media" || confianzaRaw === "baja"
      ? confianzaRaw
      : "desconocida";

  const reworkRaw = parseStr("rework").toLowerCase();

  const base: AgentMetrics = {
    agent: agentName,
    archivos_leidos: parseNum("archivos_leidos"),
    archivos_creados: parseNum("archivos_creados"),
    archivos_modificados: parseNum("archivos_modificados"),
    rework: reworkRaw === "si" || reworkRaw === "yes" || reworkRaw === "true",
    iteraciones: parseNum("iteraciones") || 1,
    confianza,
    gaps_declarados: parseNum("gaps_declarados"),
  };

  if (agentName === "Max") {
    base.bugs_criticos = parseNum("bugs_criticos");
    base.bugs_altos = parseNum("bugs_altos");
  }

  if (agentName === "Ada") {
    base.bundle_antes_mb = parseFloat_("bundle_antes_mb");
    base.bundle_despues_mb = parseFloat_("bundle_despues_mb");
    base.optimizaciones_aplicadas = parseNum("optimizaciones_aplicadas");
    base.optimizaciones_descartadas = parseNum("optimizaciones_descartadas");
  }

  if (agentName === "Cipher") {
    base.vulnerabilidades_criticas = parseNum("vulnerabilidades_criticas");
    base.vulnerabilidades_altas = parseNum("vulnerabilidades_altas");
    base.vulnerabilidades_medias = parseNum("vulnerabilidades_medias");
    base.riesgos_aceptados = parseNum("riesgos_aceptados");
    const decisionRaw = parseStr("decision").toUpperCase();
    if (
      decisionRaw === "APROBADO" ||
      decisionRaw === "APROBADO_CON_RIESGOS" ||
      decisionRaw === "BLOQUEADO"
    ) {
      base.decision = decisionRaw as AgentMetrics["decision"];
    }
  }

  return base;
}

function slugFromPath(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  const statusIdx = parts.indexOf("status.md");
  return statusIdx > 0 ? parts[statusIdx - 1] : filePath;
}

function parseStatusMd(filePath: string, type: "feature" | "bug"): PipelineRecord | null {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const nameMatch = content.match(/^# (?:Feature|Bug #?\d*) ?[---]? ?(.+)$/m);
  const estadoMatch = content.match(/^Estado:\s*(.+)$/m);
  const fechaMatch = content.match(/^Fecha apertura:\s*(.+)$/m);

  const slug = slugFromPath(filePath);
  const record: PipelineRecord = {
    type,
    slug,
    name: nameMatch ? nameMatch[1].trim() : slug,
    path: filePath,
    estado: estadoMatch ? estadoMatch[1].trim() : "desconocido",
    fecha_apertura: fechaMatch ? fechaMatch[1].trim() : "",
    metrics: {},
  };

  for (const agent of ["Leo", "Cloe", "Max", "Ada", "Cipher"]) {
    const m = extractMetricsBlock(content, agent);
    if (m) record.metrics[agent] = m;
  }

  return record;
}

function discoverStatusFiles(baseDir: string, type: "feature" | "bug"): string[] {
  if (!existsSync(baseDir)) return [];
  const entries = readdirSync(baseDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = join(baseDir, entry.name, "status.md");
    if (existsSync(candidate)) files.push(candidate);
  }
  return files;
}

// ─── Aggregate computation ────────────────────────────────────────────────────

function emptyAggregate(agent: string): AgentAggregate {
  return {
    agent,
    sessions: 0,
    rework_count: 0,
    confianza_baja_count: 0,
    gaps_declarados_total: 0,
    archivos_leidos_total: 0,
    iteraciones_total: 0,
    bugs_criticos_total: 0,
    bundle_delta_total: 0,
    bundle_sessions: 0,
    vulns_criticas_total: 0,
    bloqueados: 0,
  };
}

function computeAggregates(records: PipelineRecord[]): Record<string, AgentAggregate> {
  const aggs: Record<string, AgentAggregate> = {
    Leo: emptyAggregate("Leo"),
    Cloe: emptyAggregate("Cloe"),
    Max: emptyAggregate("Max"),
    Ada: emptyAggregate("Ada"),
    Cipher: emptyAggregate("Cipher"),
  };

  for (const record of records) {
    for (const [agent, m] of Object.entries(record.metrics)) {
      if (!m || !aggs[agent]) continue;
      const agg = aggs[agent];
      agg.sessions++;
      if (m.rework) agg.rework_count++;
      if (m.confianza === "baja") agg.confianza_baja_count++;
      agg.gaps_declarados_total += m.gaps_declarados ?? 0;
      agg.archivos_leidos_total += m.archivos_leidos ?? 0;
      agg.iteraciones_total += m.iteraciones ?? 1;
      if (agent === "Max") agg.bugs_criticos_total += m.bugs_criticos ?? 0;
      if (agent === "Ada" && m.bundle_antes_mb && m.bundle_despues_mb) {
        agg.bundle_delta_total += m.bundle_antes_mb - m.bundle_despues_mb;
        agg.bundle_sessions++;
      }
      if (agent === "Cipher") {
        agg.vulns_criticas_total += m.vulnerabilidades_criticas ?? 0;
        if (m.decision === "BLOQUEADO") agg.bloqueados++;
      }
    }
  }

  return aggs;
}

// ─── SQLite layer ─────────────────────────────────────────────────────────────

function openDb(repoRoot: string): Database {
  const metricsDir = join(repoRoot, "docs", "metrics");
  if (!existsSync(metricsDir)) mkdirSync(metricsDir, { recursive: true });
  const db = new Database(join(metricsDir, "metrics.db"));
  db.exec("PRAGMA journal_mode = WAL");

  // Migrate: drop old global snapshots table if it exists
  db.exec("DROP TABLE IF EXISTS snapshots");

  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_metrics (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type             TEXT NOT NULL,
      entity_slug             TEXT NOT NULL,
      agent                   TEXT NOT NULL,
      recorded_at             TEXT NOT NULL,
      archivos_leidos         INTEGER DEFAULT 0,
      archivos_creados        INTEGER DEFAULT 0,
      archivos_modificados    INTEGER DEFAULT 0,
      rework                  INTEGER DEFAULT 0,
      iteraciones             INTEGER DEFAULT 1,
      confianza               TEXT DEFAULT 'desconocida',
      gaps_declarados         INTEGER DEFAULT 0,
      bugs_criticos           INTEGER,
      bugs_altos              INTEGER,
      bundle_antes_mb         REAL,
      bundle_despues_mb       REAL,
      optimizaciones_aplicadas   INTEGER,
      optimizaciones_descartadas INTEGER,
      vulns_criticas          INTEGER,
      vulns_altas             INTEGER,
      vulns_medias            INTEGER,
      riesgos_aceptados       INTEGER,
      decision                TEXT,
      UNIQUE(entity_slug, agent)
    )
  `);

  return db;
}

function upsertEntityMetrics(db: Database, records: PipelineRecord[]): void {
  const now = new Date().toISOString().slice(0, 19);
  const stmt = db.prepare(`
    INSERT INTO entity_metrics (
      entity_type, entity_slug, agent, recorded_at,
      archivos_leidos, archivos_creados, archivos_modificados,
      rework, iteraciones, confianza, gaps_declarados,
      bugs_criticos, bugs_altos,
      bundle_antes_mb, bundle_despues_mb, optimizaciones_aplicadas, optimizaciones_descartadas,
      vulns_criticas, vulns_altas, vulns_medias, riesgos_aceptados, decision
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?
    )
    ON CONFLICT(entity_slug, agent) DO UPDATE SET
      recorded_at             = excluded.recorded_at,
      archivos_leidos         = excluded.archivos_leidos,
      archivos_creados        = excluded.archivos_creados,
      archivos_modificados    = excluded.archivos_modificados,
      rework                  = excluded.rework,
      iteraciones             = excluded.iteraciones,
      confianza               = excluded.confianza,
      gaps_declarados         = excluded.gaps_declarados,
      bugs_criticos           = excluded.bugs_criticos,
      bugs_altos              = excluded.bugs_altos,
      bundle_antes_mb         = excluded.bundle_antes_mb,
      bundle_despues_mb       = excluded.bundle_despues_mb,
      optimizaciones_aplicadas    = excluded.optimizaciones_aplicadas,
      optimizaciones_descartadas  = excluded.optimizaciones_descartadas,
      vulns_criticas          = excluded.vulns_criticas,
      vulns_altas             = excluded.vulns_altas,
      vulns_medias            = excluded.vulns_medias,
      riesgos_aceptados       = excluded.riesgos_aceptados,
      decision                = excluded.decision
  `);

  for (const record of records) {
    for (const [agent, m] of Object.entries(record.metrics)) {
      if (!m) continue;
      stmt.run(
        record.type, record.slug, agent, now,
        m.archivos_leidos ?? 0,
        m.archivos_creados ?? 0,
        m.archivos_modificados ?? 0,
        m.rework ? 1 : 0,
        m.iteraciones ?? 1,
        m.confianza ?? "desconocida",
        m.gaps_declarados ?? 0,
        m.bugs_criticos ?? null,
        m.bugs_altos ?? null,
        m.bundle_antes_mb ?? null,
        m.bundle_despues_mb ?? null,
        m.optimizaciones_aplicadas ?? null,
        m.optimizaciones_descartadas ?? null,
        m.vulnerabilidades_criticas ?? null,
        m.vulnerabilidades_altas ?? null,
        m.vulnerabilidades_medias ?? null,
        m.riesgos_aceptados ?? null,
        m.decision ?? null,
      );
    }
  }
}

function listHistory(db: Database): void {
  const rows = db.prepare(`
    SELECT
      entity_type,
      entity_slug,
      GROUP_CONCAT(agent, ', ') as agents,
      SUM(rework) as rework_total,
      COUNT(*) as session_count,
      ROUND(AVG(archivos_leidos), 1) as avg_files,
      MAX(recorded_at) as last_scan
    FROM entity_metrics
    GROUP BY entity_slug
    ORDER BY entity_type, entity_slug
  `).all() as Array<{
    entity_type: string;
    entity_slug: string;
    agents: string;
    rework_total: number;
    session_count: number;
    avg_files: number;
    last_scan: string;
  }>;

  if (rows.length === 0) {
    console.log("No hay registros. Corre el script sin flags para poblar la DB.");
    return;
  }

  console.log("\n## Historial por intervencion\n");
  console.log("| Tipo    | Slug                             | Agentes | Rework | Sesiones | Archivos avg |");
  console.log("|---------|----------------------------------|---------|--------|----------|--------------|");

  for (const row of rows) {
    const tipo = row.entity_type.padEnd(7);
    const slug = row.entity_slug.padEnd(32);
    const agents = row.agents.padEnd(7);
    console.log(`| ${tipo} | ${slug} | ${agents} | ${String(row.rework_total).padEnd(6)} | ${String(row.session_count).padEnd(8)} | ${row.avg_files} |`);
  }
}

function showFeature(db: Database, slug: string): void {
  const rows = db.prepare(
    "SELECT * FROM entity_metrics WHERE entity_slug = ? ORDER BY agent"
  ).all(slug) as EntityRow[];

  if (rows.length === 0) {
    console.error(`No se encontraron registros para: ${slug}`);
    process.exit(1);
  }

  const type = rows[0].entity_type;
  console.log(`\n## ${type}: ${slug}\n`);
  console.log("| Agente  | Archivos | Rework | Gaps | Iteraciones | Confianza    |");
  console.log("|---------|----------|--------|------|-------------|--------------|");

  for (const row of rows) {
    console.log(
      `| ${row.agent.padEnd(7)} | ${String(row.archivos_leidos).padEnd(8)} | ${row.rework ? "si" : "no".padEnd(6)} | ${String(row.gaps_declarados).padEnd(4)} | ${String(row.iteraciones).padEnd(11)} | ${row.confianza.padEnd(12)} |`
    );
  }

  // Agent-specific extras
  for (const row of rows) {
    if (row.agent === "Ada" && row.bundle_antes_mb != null && row.bundle_despues_mb != null) {
      const delta = (row.bundle_antes_mb - row.bundle_despues_mb).toFixed(2);
      console.log(`\nAda — bundle: ${row.bundle_antes_mb} MB → ${row.bundle_despues_mb} MB (ahorro: ${delta} MB)`);
    }
    if (row.agent === "Cipher" && row.decision != null) {
      console.log(`\nCipher — decision: ${row.decision} | vulns criticas: ${row.vulns_criticas ?? 0} | riesgos aceptados: ${row.riesgos_aceptados ?? 0}`);
    }
    if (row.agent === "Max" && row.bugs_criticos != null) {
      console.log(`\nMax — bugs criticos: ${row.bugs_criticos} | bugs altos: ${row.bugs_altos ?? 0}`);
    }
  }
}

function compareEntities(db: Database, slug1: string, slug2: string): void {
  const agents = ["Leo", "Cloe", "Max", "Ada", "Cipher"];

  const fetchBySlug = (slug: string): Map<string, EntityRow> => {
    const rows = db.prepare(
      "SELECT * FROM entity_metrics WHERE entity_slug = ?"
    ).all(slug) as EntityRow[];
    return new Map(rows.map(r => [r.agent, r]));
  };

  const a = fetchBySlug(slug1);
  const b = fetchBySlug(slug2);

  if (a.size === 0) { console.error(`Sin datos para: ${slug1}`); process.exit(1); }
  if (b.size === 0) { console.error(`Sin datos para: ${slug2}`); process.exit(1); }

  const deltaLabel = (before: number, after: number, lowerIsBetter = true): string => {
    const d = after - before;
    if (d === 0) return "=";
    const better = lowerIsBetter ? d < 0 : d > 0;
    const sign = d > 0 ? `+${d}` : `${d}`;
    return better ? `${sign} mejor` : `${sign} peor`;
  };

  console.log(`\n## Comparacion: ${slug1} vs ${slug2}\n`);
  console.log("| Agente  | Metrica         | " + slug1.slice(0, 20).padEnd(20) + " | " + slug2.slice(0, 20).padEnd(20) + " | Delta          |");
  console.log("|---------|-----------------|" + "-".repeat(22) + "|" + "-".repeat(22) + "|----------------|");

  const metrics: Array<{ key: keyof EntityRow; label: string; lowerIsBetter: boolean }> = [
    { key: "archivos_leidos", label: "archivos leidos", lowerIsBetter: true },
    { key: "rework",          label: "rework",          lowerIsBetter: true },
    { key: "gaps_declarados", label: "gaps",             lowerIsBetter: false },
    { key: "iteraciones",     label: "iteraciones",      lowerIsBetter: true },
  ];

  for (const agent of agents) {
    const rowA = a.get(agent);
    const rowB = b.get(agent);
    if (!rowA && !rowB) continue;

    for (const { key, label, lowerIsBetter } of metrics) {
      const before = rowA ? (rowA[key] as number) : 0;
      const after = rowB ? (rowB[key] as number) : 0;
      if (before === 0 && after === 0) continue;
      const d = deltaLabel(before, after, lowerIsBetter);
      console.log(
        `| ${agent.padEnd(7)} | ${label.padEnd(15)} | ${String(before).padEnd(20)} | ${String(after).padEnd(20)} | ${d.padEnd(14)} |`
      );
    }
  }
}

// ─── Report formatting ────────────────────────────────────────────────────────

type Status = "OK" | "WARNING" | "CRITICO";

function reworkStatus(rate: number): Status {
  if (rate < 20) return "OK";
  if (rate < 40) return "WARNING";
  return "CRITICO";
}

function confianzaStatus(rate: number): Status {
  if (rate < 10) return "OK";
  if (rate < 25) return "WARNING";
  return "CRITICO";
}

function gapsStatus(rate: number): Status {
  if (rate > 30) return "OK";
  if (rate > 15) return "WARNING";
  return "CRITICO";
}

function iteracionesStatus(avg: number): Status {
  if (avg <= 1.2) return "OK";
  if (avg <= 1.5) return "WARNING";
  return "CRITICO";
}

function pct(num: number, den: number): string {
  if (den === 0) return "N/A";
  return `${Math.round((num / den) * 100)}%`;
}

function avg(total: number, count: number): string {
  if (count === 0) return "N/A";
  return (total / count).toFixed(1);
}

function padEnd(str: string, len: number): string {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

function tableRow(cols: string[], widths: number[]): string {
  return "| " + cols.map((c, i) => padEnd(c, widths[i])).join(" | ") + " |";
}

function tableSep(widths: number[]): string {
  return "|" + widths.map(w => "-".repeat(w + 2)).join("|") + "|";
}

function generateReport(
  records: PipelineRecord[],
  aggs: Record<string, AgentAggregate>,
  desde?: string,
  hasta?: string
): string {
  const today = new Date().toISOString().split("T")[0];
  const features = records.filter(r => r.type === "feature");
  const bugs = records.filter(r => r.type === "bug");

  const totalSessions = Object.values(aggs).reduce((s, a) => s + a.sessions, 0);
  const totalRework = Object.values(aggs).reduce((s, a) => s + a.rework_count, 0);
  const globalReworkRate = totalSessions > 0 ? (totalRework / totalSessions) * 100 : 0;
  const totalConfianzaBaja = Object.values(aggs).reduce((s, a) => s + a.confianza_baja_count, 0);
  const globalConfianzaRate = totalSessions > 0 ? (totalConfianzaBaja / totalSessions) * 100 : 0;
  const totalGaps = Object.values(aggs).reduce((s, a) => s + a.gaps_declarados_total, 0);
  const globalGapsRate = totalSessions > 0 ? (totalGaps / totalSessions) * 100 : 0;
  const cipherAgg = aggs["Cipher"];
  const cipherBlockRate = cipherAgg.sessions > 0
    ? (cipherAgg.bloqueados / cipherAgg.sessions) * 100
    : 0;
  const totalIteraciones = Object.values(aggs).reduce((s, a) => s + a.iteraciones_total, 0);
  const globalIteracionesAvg = totalSessions > 0 ? totalIteraciones / totalSessions : 1;

  const agents = ["Leo", "Cloe", "Max", "Ada", "Cipher"];

  let report = `## Dashboard de metricas — ${today}
Periodo: ${desde ?? "inicio"} — ${hasta ?? "hoy"}
Features analizadas: ${features.length} | Bugs analizados: ${bugs.length}
Total con metricas: ${records.filter(r => Object.keys(r.metrics).length > 0).length}

---

### Salud del pipeline

`;

  const healthRows = [
    ["Tasa de rework global",    pct(totalRework, totalSessions),        reworkStatus(globalReworkRate)],
    ["Tasa de confianza baja",   pct(totalConfianzaBaja, totalSessions), confianzaStatus(globalConfianzaRate)],
    ["Tasa de gaps declarados",  pct(totalGaps, totalSessions),          gapsStatus(globalGapsRate)],
    ["Tasa de bloqueo Cipher",   pct(cipherAgg.bloqueados, cipherAgg.sessions), reworkStatus(cipherBlockRate)],
    ["Iteraciones promedio",     avg(totalIteraciones, totalSessions),   iteracionesStatus(globalIteracionesAvg)],
  ];

  const hw = [24, 8, 8];
  report += tableRow(["Indicador", "Valor", "Estado"], hw) + "\n";
  report += tableSep(hw) + "\n";
  for (const row of healthRows) report += tableRow(row, hw) + "\n";

  report += `\n---\n\n### Rework por agente\n\n`;
  const rw = [8, 10, 12, 8];
  report += tableRow(["Agente", "Sesiones", "Con rework", "Tasa"], rw) + "\n";
  report += tableSep(rw) + "\n";
  for (const a of agents) {
    const agg = aggs[a];
    report += tableRow([a, String(agg.sessions), String(agg.rework_count), pct(agg.rework_count, agg.sessions)], rw) + "\n";
  }

  report += `\n---\n\n### Gaps declarados por agente\n\n`;
  const gw = [8, 24, 22];
  report += tableRow(["Agente", "Total gaps declarados", "Promedio por sesion"], gw) + "\n";
  report += tableSep(gw) + "\n";
  for (const a of agents) {
    const agg = aggs[a];
    report += tableRow([a, String(agg.gaps_declarados_total), avg(agg.gaps_declarados_total, agg.sessions)], gw) + "\n";
  }
  report += `\nNota: gaps_declarados bajos pueden indicar que los agentes ocultan incertidumbre.\n`;

  if (aggs["Ada"].bundle_sessions > 0) {
    const adaAgg = aggs["Ada"];
    report += `\n---\n\n### Ahorro de bundle (Ada)\n\n`;
    report += `- Sesiones con datos de bundle: ${adaAgg.bundle_sessions}\n`;
    report += `- Ahorro total acumulado: ${adaAgg.bundle_delta_total.toFixed(1)} MB\n`;
    report += `- Ahorro promedio por feature: ${(adaAgg.bundle_delta_total / adaAgg.bundle_sessions).toFixed(1)} MB\n`;
  }

  if (cipherAgg.sessions > 0) {
    report += `\n---\n\n### Seguridad (Cipher)\n\n`;
    report += `- Features auditadas: ${cipherAgg.sessions}\n`;
    report += `- Vulnerabilidades criticas: ${cipherAgg.vulns_criticas_total}\n`;
    report += `- Features bloqueadas: ${cipherAgg.bloqueados}\n`;
    report += `- Tasa de bloqueo: ${pct(cipherAgg.bloqueados, cipherAgg.sessions)}\n`;
  }

  const withoutMetrics = records.filter(r => Object.keys(r.metrics).length === 0);
  if (withoutMetrics.length > 0) {
    report += `\n---\n\n### Sin metricas (pipeline en progreso o sin estructura nueva)\n\n`;
    for (const r of withoutMetrics) {
      report += `- ${r.type}: ${r.name} (${r.estado})\n`;
    }
  }

  return report;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const repoRoot = process.cwd();
  const db = openDb(repoRoot);

  // --history: listar todas las intervenciones registradas
  if (args.includes("--history")) {
    listHistory(db);
    return;
  }

  // --feature <slug>: ver metricas de una intervencion especifica
  const featureIdx = args.indexOf("--feature");
  if (featureIdx !== -1) {
    const slug = args[featureIdx + 1] ?? "";
    if (!slug) {
      console.error("Uso: --feature <slug>");
      process.exit(1);
    }
    showFeature(db, slug);
    return;
  }

  // --compare <slug1> <slug2>: comparar dos intervenciones
  const compareIdx = args.indexOf("--compare");
  if (compareIdx !== -1) {
    const slug1 = args[compareIdx + 1] ?? "";
    const slug2 = args[compareIdx + 2] ?? "";
    if (!slug1 || !slug2) {
      console.error("Uso: --compare <slug1> <slug2>");
      process.exit(1);
    }
    compareEntities(db, slug1, slug2);
    return;
  }

  // Flujo normal: escanear status.md, upsert en DB, generar reporte
  const jsonMode = args.includes("--json");
  const desdeIdx = args.indexOf("--desde");
  const hastaIdx = args.indexOf("--hasta");
  const desde = desdeIdx !== -1 ? args[desdeIdx + 1] : undefined;
  const hasta = hastaIdx !== -1 ? args[hastaIdx + 1] : undefined;

  const featureFiles = discoverStatusFiles(join(repoRoot, "docs", "features"), "feature");
  const bugFiles = discoverStatusFiles(join(repoRoot, "docs", "bugs"), "bug");
  const records: PipelineRecord[] = [];

  for (const file of [...featureFiles, ...bugFiles]) {
    const type = file.includes("features") ? "feature" : "bug";
    const record = parseStatusMd(file, type);
    if (!record) continue;
    if (desde && record.fecha_apertura && record.fecha_apertura < desde) continue;
    if (hasta && record.fecha_apertura && record.fecha_apertura > hasta) continue;
    records.push(record);
  }

  if (records.length === 0) {
    console.log("No se encontraron status.md con metricas en docs/features/ ni docs/bugs/");
    process.exit(0);
  }

  // Upsert per-entity rows
  upsertEntityMetrics(db, records);

  if (jsonMode) {
    const aggs = computeAggregates(records);
    console.log(JSON.stringify({ records, aggregates: aggs }, null, 2));
    return;
  }

  const aggs = computeAggregates(records);
  const report = generateReport(records, aggs, desde, hasta);
  console.log(report);
}

main().catch(console.error);
