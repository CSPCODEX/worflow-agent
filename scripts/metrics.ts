/**
 * metrics.ts — Aggregate pipeline metrics across all features and bugs
 *
 * Usage:
 *   bun run scripts/metrics.ts
 *   bun run scripts/metrics.ts --trigger post-feature/remove-agentdir-ipc
 *   bun run scripts/metrics.ts --history
 *   bun run scripts/metrics.ts --compare 3 5
 *   bun run scripts/metrics.ts --desde 2026-01-01 --hasta 2026-03-31
 *   bun run scripts/metrics.ts --json
 */

import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
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
  // Max-specific
  bugs_criticos?: number;
  bugs_altos?: number;
  items_checklist_verificados?: string;
  // Ada-specific
  bundle_antes_mb?: number;
  bundle_despues_mb?: number;
  optimizaciones_aplicadas?: number;
  optimizaciones_descartadas?: number;
  // Cipher-specific
  vulnerabilidades_criticas?: number;
  vulnerabilidades_altas?: number;
  vulnerabilidades_medias?: number;
  riesgos_aceptados?: number;
  decision?: "APROBADO" | "APROBADO_CON_RIESGOS" | "BLOQUEADO";
}

interface PipelineRecord {
  type: "feature" | "bug";
  name: string;
  path: string;
  estado: string;
  fecha_apertura: string;
  rama: string;
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

// Estructura que se guarda en data_json de cada snapshot
interface SnapshotData {
  meta: {
    features_count: number;
    bugs_count: number;
    total_sessions: number;
  };
  global: {
    rework_rate: number;
    confianza_baja_rate: number;
    gaps_rate: number;
    cipher_block_rate: number;
    iterations_avg: number;
  };
  agents: Record<string, {
    sessions: number;
    rework_rate: number;
    gaps_avg: number;
    files_avg: number;
    iterations_avg: number;
  }>;
}

interface SnapshotRow {
  id: number;
  created_at: string;
  trigger: string | null;
  data_json: string;
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
    base.items_checklist_verificados = parseStr("items_checklist_verificados");
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

function parseStatusMd(filePath: string, type: "feature" | "bug"): PipelineRecord | null {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const nameMatch = content.match(/^# (?:Feature|Bug #?\d*) ?[—-]? ?(.+)$/m);
  const estadoMatch = content.match(/^Estado:\s*(.+)$/m);
  const fechaMatch = content.match(/^Fecha apertura:\s*(.+)$/m);
  const ramaMatch = content.match(/^Rama:\s*(.+)$/m);

  const name = nameMatch ? nameMatch[1].trim() : filePath;
  const record: PipelineRecord = {
    type,
    name,
    path: filePath,
    estado: estadoMatch ? estadoMatch[1].trim() : "desconocido",
    fecha_apertura: fechaMatch ? fechaMatch[1].trim() : "",
    rama: ramaMatch ? ramaMatch[1].trim() : "",
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at  TEXT NOT NULL,
      trigger     TEXT,
      data_json   TEXT NOT NULL
    )
  `);
  return db;
}

function buildSnapshotData(
  records: PipelineRecord[],
  aggs: Record<string, AgentAggregate>
): SnapshotData {
  const totalSessions = Object.values(aggs).reduce((s, a) => s + a.sessions, 0);
  const totalRework = Object.values(aggs).reduce((s, a) => s + a.rework_count, 0);
  const totalConfianzaBaja = Object.values(aggs).reduce((s, a) => s + a.confianza_baja_count, 0);
  const totalGaps = Object.values(aggs).reduce((s, a) => s + a.gaps_declarados_total, 0);
  const totalIteraciones = Object.values(aggs).reduce((s, a) => s + a.iteraciones_total, 0);
  const cipherAgg = aggs["Cipher"];
  const features = records.filter(r => r.type === "feature");
  const bugs = records.filter(r => r.type === "bug");

  const rate = (num: number, den: number) =>
    den > 0 ? Math.round((num / den) * 100) : 0;
  const average = (total: number, count: number) =>
    count > 0 ? Math.round((total / count) * 10) / 10 : 0;

  return {
    meta: {
      features_count: features.length,
      bugs_count: bugs.length,
      total_sessions: totalSessions,
    },
    global: {
      rework_rate: rate(totalRework, totalSessions),
      confianza_baja_rate: rate(totalConfianzaBaja, totalSessions),
      gaps_rate: rate(totalGaps, totalSessions),
      cipher_block_rate: rate(cipherAgg.bloqueados, cipherAgg.sessions),
      iterations_avg: average(totalIteraciones, totalSessions),
    },
    agents: Object.fromEntries(
      ["Leo", "Cloe", "Max", "Ada", "Cipher"].map(agent => {
        const agg = aggs[agent];
        return [agent, {
          sessions: agg.sessions,
          rework_rate: rate(agg.rework_count, agg.sessions),
          gaps_avg: average(agg.gaps_declarados_total, agg.sessions),
          files_avg: average(agg.archivos_leidos_total, agg.sessions),
          iterations_avg: average(agg.iteraciones_total, agg.sessions),
        }];
      })
    ),
  };
}

function saveSnapshot(db: Database, trigger: string, data: SnapshotData): number {
  const now = new Date().toISOString().slice(0, 19);
  const stmt = db.prepare(
    "INSERT INTO snapshots (created_at, trigger, data_json) VALUES (?, ?, ?)"
  );
  const result = stmt.run(now, trigger, JSON.stringify(data));
  return result.lastInsertRowid as number;
}

function listHistory(db: Database): void {
  const rows = db.prepare(
    "SELECT id, created_at, trigger, data_json FROM snapshots ORDER BY id DESC"
  ).all() as SnapshotRow[];

  if (rows.length === 0) {
    console.log("No hay snapshots guardados. Corre el script sin flags para crear el primero.");
    return;
  }

  console.log("\n## Historial de snapshots\n");
  console.log("| ID  | Fecha               | Trigger                                   | Features | Bugs |");
  console.log("|-----|---------------------|-------------------------------------------|----------|------|");

  for (const row of rows) {
    const data = JSON.parse(row.data_json) as SnapshotData;
    const trigger = (row.trigger ?? "manual").padEnd(41);
    const id = String(row.id).padEnd(3);
    console.log(`| ${id} | ${row.created_at} | ${trigger} | ${String(data.meta.features_count).padEnd(8)} | ${data.meta.bugs_count}    |`);
  }
}

function compareSnapshots(db: Database, id1: number, id2: number): void {
  const rows = db.prepare(
    "SELECT id, created_at, trigger, data_json FROM snapshots WHERE id IN (?, ?)"
  ).all(id1, id2) as SnapshotRow[];

  if (rows.length < 2) {
    console.error(`No se encontraron snapshots con IDs ${id1} y ${id2}`);
    process.exit(1);
  }

  const [rowA, rowB] = rows[0].id === id1 ? [rows[0], rows[1]] : [rows[1], rows[0]];
  const a = JSON.parse(rowA.data_json) as SnapshotData;
  const b = JSON.parse(rowB.data_json) as SnapshotData;

  const deltaLabel = (before: number, after: number, lowerIsBetter = true): string => {
    const d = after - before;
    if (d === 0) return "=";
    const better = lowerIsBetter ? d < 0 : d > 0;
    const sign = d > 0 ? `+${d}` : `${d}`;
    return better ? `${sign} mejor` : `${sign} peor`;
  };

  console.log(`\n## Comparacion: snapshot #${id1} vs #${id2}\n`);
  console.log(`Antes:   [#${id1}] ${rowA.created_at} — ${rowA.trigger ?? "manual"}`);
  console.log(`Despues: [#${id2}] ${rowB.created_at} — ${rowB.trigger ?? "manual"}`);

  console.log("\n### Indicadores globales\n");
  console.log("| Indicador              | Antes  | Despues | Delta          |");
  console.log("|------------------------|--------|---------|----------------|");

  const globalComparisons: Array<[string, keyof SnapshotData["global"], boolean]> = [
    ["Rework global %",     "rework_rate",        true],
    ["Confianza baja %",    "confianza_baja_rate", true],
    ["Gaps declarados %",   "gaps_rate",           false],
    ["Bloqueo Cipher %",    "cipher_block_rate",   true],
    ["Iteraciones avg",     "iterations_avg",      true],
  ];

  for (const [label, key, lowerIsBetter] of globalComparisons) {
    const before = a.global[key];
    const after = b.global[key];
    const d = deltaLabel(before, after, lowerIsBetter);
    console.log(
      `| ${label.padEnd(22)} | ${String(before).padEnd(6)} | ${String(after).padEnd(7)} | ${d.padEnd(14)} |`
    );
  }

  console.log("\n### Rework por agente\n");
  console.log("| Agente  | Antes  | Despues | Delta          |");
  console.log("|---------|--------|---------|----------------|");

  for (const agent of ["Leo", "Cloe", "Max", "Ada", "Cipher"]) {
    const before = a.agents[agent]?.rework_rate ?? 0;
    const after = b.agents[agent]?.rework_rate ?? 0;
    const d = deltaLabel(before, after, true);
    console.log(
      `| ${agent.padEnd(7)} | ${String(before + "%").padEnd(6)} | ${String(after + "%").padEnd(7)} | ${d.padEnd(14)} |`
    );
  }

  console.log("\n### Archivos promedio leidos por agente\n");
  console.log("| Agente  | Antes  | Despues | Delta          |");
  console.log("|---------|--------|---------|----------------|");

  for (const agent of ["Leo", "Cloe", "Max", "Ada", "Cipher"]) {
    const before = a.agents[agent]?.files_avg ?? 0;
    const after = b.agents[agent]?.files_avg ?? 0;
    const d = deltaLabel(before, after, true);
    console.log(
      `| ${agent.padEnd(7)} | ${String(before).padEnd(6)} | ${String(after).padEnd(7)} | ${d.padEnd(14)} |`
    );
  }
}

// ─── Report formatting ────────────────────────────────────────────────────────

type Status = "OK" | "⚠" | "❌";

function reworkStatus(rate: number): Status {
  if (rate < 20) return "OK";
  if (rate < 40) return "⚠";
  return "❌";
}

function confianzaStatus(rate: number): Status {
  if (rate < 10) return "OK";
  if (rate < 25) return "⚠";
  return "❌";
}

function gapsStatus(rate: number): Status {
  if (rate > 30) return "OK";
  if (rate > 15) return "⚠";
  return "❌";
}

function iteracionesStatus(avg: number): Status {
  if (avg <= 1.2) return "OK";
  if (avg <= 1.5) return "⚠";
  return "❌";
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
Total registros con metricas: ${records.filter(r => Object.keys(r.metrics).length > 0).length}

---

### Salud del pipeline

`;

  const healthRows = [
    ["Tasa de rework global", pct(totalRework, totalSessions), reworkStatus(globalReworkRate)],
    ["Tasa de confianza baja", pct(totalConfianzaBaja, totalSessions), confianzaStatus(globalConfianzaRate)],
    ["Tasa de gaps declarados", pct(totalGaps, totalSessions), gapsStatus(globalGapsRate)],
    ["Tasa de bloqueo Cipher", pct(cipherAgg.bloqueados, cipherAgg.sessions), reworkStatus(cipherBlockRate)],
    ["Iteraciones promedio", avg(totalIteraciones, totalSessions), iteracionesStatus(globalIteracionesAvg)],
  ];

  const hw = [34, 8, 6];
  report += tableRow(["Indicador", "Valor", "Estado"], hw) + "\n";
  report += tableSep(hw) + "\n";
  for (const row of healthRows) report += tableRow(row, hw) + "\n";

  report += `
---

### Rework por agente

`;
  const rw = [8, 10, 12, 8];
  report += tableRow(["Agente", "Sesiones", "Con rework", "Tasa"], rw) + "\n";
  report += tableSep(rw) + "\n";
  for (const a of agents) {
    const agg = aggs[a];
    report += tableRow([a, String(agg.sessions), String(agg.rework_count), pct(agg.rework_count, agg.sessions)], rw) + "\n";
  }

  report += `
---

### Contexto por agente (archivos promedio leidos)

`;
  const cw = [8, 20, 6];
  report += tableRow(["Agente", "Promedio archivos leidos", "Estado"], cw) + "\n";
  report += tableSep(cw) + "\n";
  for (const a of agents) {
    const agg = aggs[a];
    const avgFiles = agg.sessions > 0 ? agg.archivos_leidos_total / agg.sessions : 0;
    const estado = avgFiles <= 5 ? "EFICIENTE" : avgFiles <= 10 ? "ACEPTABLE" : "EXCESIVO";
    report += tableRow([a, avg(agg.archivos_leidos_total, agg.sessions), estado], cw) + "\n";
  }

  report += `
---

### Gaps declarados por agente

`;
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
    report += `
---

### Ahorro de bundle (Ada)

- Sesiones con datos de bundle: ${adaAgg.bundle_sessions}
- Ahorro total acumulado: ${adaAgg.bundle_delta_total.toFixed(1)} MB
- Ahorro promedio por feature: ${(adaAgg.bundle_delta_total / adaAgg.bundle_sessions).toFixed(1)} MB
`;
  }

  if (cipherAgg.sessions > 0) {
    report += `
---

### Seguridad (Cipher)

- Features auditadas: ${cipherAgg.sessions}
- Vulnerabilidades criticas encontradas: ${cipherAgg.vulns_criticas_total}
- Features bloqueadas: ${cipherAgg.bloqueados}
- Tasa de bloqueo: ${pct(cipherAgg.bloqueados, cipherAgg.sessions)}
`;
  }

  const withoutMetrics = records.filter(r => Object.keys(r.metrics).length === 0);
  if (withoutMetrics.length > 0) {
    report += `
---

### Sin metricas (pipeline en progreso o sin estructura nueva)

`;
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

  // --history: listar snapshots guardados
  if (args.includes("--history")) {
    listHistory(db);
    return;
  }

  // --compare ID1 ID2: comparar dos snapshots
  const compareIdx = args.indexOf("--compare");
  if (compareIdx !== -1) {
    const id1 = parseInt(args[compareIdx + 1], 10);
    const id2 = parseInt(args[compareIdx + 2], 10);
    if (isNaN(id1) || isNaN(id2)) {
      console.error("Uso: --compare <id1> <id2>");
      process.exit(1);
    }
    compareSnapshots(db, id1, id2);
    return;
  }

  // Flujo normal: calcular metricas, guardar snapshot, generar reporte
  const jsonMode = args.includes("--json");
  const desdeIdx = args.indexOf("--desde");
  const hastaIdx = args.indexOf("--hasta");
  const triggerIdx = args.indexOf("--trigger");
  const desde = desdeIdx !== -1 ? args[desdeIdx + 1] : undefined;
  const hasta = hastaIdx !== -1 ? args[hastaIdx + 1] : undefined;
  const trigger = triggerIdx !== -1 ? args[triggerIdx + 1] : "manual";

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

  const aggs = computeAggregates(records);

  if (jsonMode) {
    console.log(JSON.stringify({ records, aggregates: aggs }, null, 2));
    return;
  }

  const report = generateReport(records, aggs, desde, hasta);
  console.log(report);

  // Guardar snapshot en SQLite
  const snapshotData = buildSnapshotData(records, aggs);
  const snapshotId = saveSnapshot(db, trigger, snapshotData);
  console.log(`Snapshot #${snapshotId} guardado (trigger: ${trigger})`);

  // Guardar .md con timestamp completo para lectura humana
  const metricsDir = join(repoRoot, "docs", "metrics");
  const now = new Date().toISOString().replace(/:/g, "-").slice(0, 16);
  const outPath = join(metricsDir, `dashboard-${now}.md`);
  writeFileSync(outPath, report, "utf-8");
  console.log(`Reporte guardado en: ${outPath}`);
}

main().catch(console.error);
