/**
 * metrics.ts — Aggregate pipeline metrics across all features and bugs
 *
 * Usage:
 *   bun run scripts/metrics.ts
 *   bun run scripts/metrics.ts --desde 2026-01-01 --hasta 2026-03-31
 *   bun run scripts/metrics.ts --json
 */

import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

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
  items_checklist_verificados?: string; // e.g. "6/8"
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

// ─── Parsing helpers ──────────────────────────────────────────────────────────

function extractMetricsBlock(content: string, agentName: string): AgentMetrics | null {
  const blockHeader = `## Metricas de ${agentName}`;
  const start = content.indexOf(blockHeader);
  if (start === -1) return null;

  const blockStart = start + blockHeader.length;
  // Find end of block (next ## heading or end of file)
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

  // Agent-specific fields
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

interface AgentAggregate {
  agent: string;
  sessions: number;
  rework_count: number;
  confianza_baja_count: number;
  gaps_declarados_total: number;
  archivos_leidos_total: number;
  iteraciones_total: number;
  // Max
  bugs_criticos_total: number;
  // Ada
  bundle_delta_total: number;
  bundle_sessions: number;
  // Cipher
  vulns_criticas_total: number;
  bloqueados: number;
}

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
  // High gaps declared rate is GOOD (honesty signal)
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

  // Global rework rate
  const totalSessions = Object.values(aggs).reduce((s, a) => s + a.sessions, 0);
  const totalRework = Object.values(aggs).reduce((s, a) => s + a.rework_count, 0);
  const globalReworkRate = totalSessions > 0 ? (totalRework / totalSessions) * 100 : 0;

  // Global confianza baja rate
  const totalConfianzaBaja = Object.values(aggs).reduce((s, a) => s + a.confianza_baja_count, 0);
  const globalConfianzaRate = totalSessions > 0 ? (totalConfianzaBaja / totalSessions) * 100 : 0;

  // Global gaps declared rate
  const totalGaps = Object.values(aggs).reduce((s, a) => s + a.gaps_declarados_total, 0);
  const globalGapsRate = totalSessions > 0 ? (totalGaps / totalSessions) * 100 : 0;

  // Cipher block rate
  const cipherAgg = aggs["Cipher"];
  const cipherBlockRate = cipherAgg.sessions > 0
    ? (cipherAgg.bloqueados / cipherAgg.sessions) * 100
    : 0;

  // Global iterations avg
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

  // Ada bundle savings
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

  // Cipher summary
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

  // Records without metrics (no data yet)
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
  const jsonMode = args.includes("--json");
  const desdeIdx = args.indexOf("--desde");
  const hastaIdx = args.indexOf("--hasta");
  const desde = desdeIdx !== -1 ? args[desdeIdx + 1] : undefined;
  const hasta = hastaIdx !== -1 ? args[hastaIdx + 1] : undefined;

  const repoRoot = process.cwd();
  const featureFiles = discoverStatusFiles(join(repoRoot, "docs", "features"), "feature");
  const bugFiles = discoverStatusFiles(join(repoRoot, "docs", "bugs"), "bug");

  const allFiles = [...featureFiles, ...bugFiles];
  const records: PipelineRecord[] = [];

  for (const file of allFiles) {
    const type = file.includes("features") ? "feature" : "bug";
    const record = parseStatusMd(file, type);
    if (!record) continue;

    // Date filter
    if (desde && record.fecha_apertura && record.fecha_apertura < desde) continue;
    if (hasta && record.fecha_apertura && record.fecha_apertura > hasta) continue;

    records.push(record);
  }

  if (records.length === 0) {
    console.log("No se encontraron status.md con metricas en docs/features/ ni docs/bugs/");
    console.log("Los status.md necesitan bloques '## Metricas de X' para aparecer aqui.");
    process.exit(0);
  }

  const aggs = computeAggregates(records);

  if (jsonMode) {
    console.log(JSON.stringify({ records, aggregates: aggs }, null, 2));
    return;
  }

  const report = generateReport(records, aggs, desde, hasta);
  console.log(report);

  // Save to docs/metrics/
  const metricsDir = join(repoRoot, "docs", "metrics");
  if (!existsSync(metricsDir)) mkdirSync(metricsDir, { recursive: true });

  const today = new Date().toISOString().split("T")[0];
  const outPath = join(metricsDir, `dashboard-${today}.md`);
  writeFileSync(outPath, report, "utf-8");
  console.log(`\nReporte guardado en: ${outPath}`);
}

main().catch(console.error);
