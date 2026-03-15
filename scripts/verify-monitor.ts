/**
 * verify-monitor.ts
 *
 * Compara el estado parseado de cada status.md con el ultimo estado
 * registrado en la DB SQLite del monitor. Detecta:
 *   - OK:       archivo y DB coinciden
 *   - MISMATCH: la DB tiene un estado distinto al del archivo (pendiente de poll)
 *   - MISSING:  el item nunca fue registrado en la DB
 *   - UNKNOWN:  el parser no reconoce el valor de estado (DESCONOCIDO)
 *
 * Uso:
 *   bun run verify-monitor
 */

import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseFeatureStatus, parseBugStatus } from '../src/monitor/core/statusParser';

// ─── Rutas ────────────────────────────────────────────────────────────────────

const APPDATA = process.env.APPDATA ?? '';
const DB_PATH = join(APPDATA, 'Worflow Agent', 'monitor-history.db');
const DOCS_DIR = join(import.meta.dir, '..', 'docs');
const FEATURES_DIR = join(DOCS_DIR, 'features');
const BUGS_DIR = join(DOCS_DIR, 'bugs');

// ─── Colores ANSI ─────────────────────────────────────────────────────────────

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  white:  '\x1b[97m',
};

// ─── Tipos ────────────────────────────────────────────────────────────────────

type ItemType = 'feature' | 'bug';

interface VerifyResult {
  type:       ItemType;
  slug:       string;
  title:      string;
  fileState:  string;
  dbState:    string | null;
  status:     'OK' | 'MISMATCH' | 'MISSING' | 'UNKNOWN';
}

// ─── Leer DB ──────────────────────────────────────────────────────────────────

let dbStateMap = new Map<string, string>();   // "type:slug" → to_value
let dbRowCount = 0;

if (!existsSync(DB_PATH)) {
  console.log(`\n${C.yellow}Aviso: no se encontro la DB en ${DB_PATH}${C.reset}`);
  console.log(`Arranca la app al menos una vez para crearla.\n`);
  console.log(`Se mostraran todos los items como MISSING.\n`);
} else {
  const db = new Database(DB_PATH, { readonly: true });

  const rows = db.prepare<{ item_slug: string; item_type: string; to_value: string }, []>(`
    SELECT pe.item_slug, pe.item_type, pe.to_value
    FROM pipeline_events pe
    INNER JOIN (
      SELECT item_slug, item_type, MAX(id) as max_id
      FROM pipeline_events
      WHERE event_type IN ('feature_state_changed', 'bug_state_changed')
      GROUP BY item_slug, item_type
    ) latest ON pe.id = latest.max_id
  `).all();

  dbRowCount = rows.length;
  for (const row of rows) {
    dbStateMap.set(`${row.item_type}:${row.item_slug}`, row.to_value);
  }

  db.close();
}

// ─── Parsear status.md ────────────────────────────────────────────────────────

const results: VerifyResult[] = [];

function classify(fileState: string, dbState: string | null): VerifyResult['status'] {
  if (fileState === 'DESCONOCIDO') return 'UNKNOWN';
  if (dbState === null)            return 'MISSING';
  if (dbState === fileState)       return 'OK';
  return 'MISMATCH';
}

// Features
if (existsSync(FEATURES_DIR)) {
  for (const entry of readdirSync(FEATURES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const statusPath = join(FEATURES_DIR, entry.name, 'status.md');
    if (!existsSync(statusPath)) continue;
    try {
      const content = readFileSync(statusPath, 'utf-8');
      const record  = parseFeatureStatus(content, entry.name, statusPath);
      const dbState = dbStateMap.get(`feature:${entry.name}`) ?? null;
      results.push({
        type:      'feature',
        slug:      entry.name,
        title:     record.title,
        fileState: record.state,
        dbState,
        status:    classify(record.state, dbState),
      });
    } catch {
      // status.md ilegible — ignorar
    }
  }
}

// Bugs
if (existsSync(BUGS_DIR)) {
  for (const entry of readdirSync(BUGS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const statusPath = join(BUGS_DIR, entry.name, 'status.md');
    if (!existsSync(statusPath)) continue;
    const m = entry.name.match(/^(\d{3})-(.+)$/);
    if (!m) continue;
    const [, id, slug] = m;
    try {
      const content = readFileSync(statusPath, 'utf-8');
      const record  = parseBugStatus(content, id, slug, statusPath);
      const dbState = dbStateMap.get(`bug:${entry.name}`) ?? null;
      results.push({
        type:      'bug',
        slug:      entry.name,
        title:     record.title,
        fileState: record.state,
        dbState,
        status:    classify(record.state, dbState),
      });
    } catch {
      // status.md ilegible — ignorar
    }
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────

const byStatus = {
  OK:       results.filter(r => r.status === 'OK'),
  MISMATCH: results.filter(r => r.status === 'MISMATCH'),
  MISSING:  results.filter(r => r.status === 'MISSING'),
  UNKNOWN:  results.filter(r => r.status === 'UNKNOWN'),
};

const statusColor: Record<VerifyResult['status'], string> = {
  OK:       C.green,
  MISMATCH: C.red,
  MISSING:  C.yellow,
  UNKNOWN:  C.cyan,
};

const statusIcon: Record<VerifyResult['status'], string> = {
  OK:       'OK     ',
  MISMATCH: 'MISMATCH',
  MISSING:  'MISSING',
  UNKNOWN:  'UNKNOWN',
};

const W = { prefix: 5, slug: 46, file: 22, db: 22, status: 8 };
const SEPARATOR = '─'.repeat(W.prefix + W.slug + W.file + W.db + W.status + 3);

function row(r: VerifyResult): string {
  const color  = statusColor[r.status];
  const prefix = `[${r.type === 'feature' ? 'F' : 'B'}]`.padEnd(W.prefix);
  const slug   = r.slug.substring(0, W.slug - 1).padEnd(W.slug);
  const file   = r.fileState.padEnd(W.file);
  const dbCol  = (r.dbState ?? '—').padEnd(W.db);
  const icon   = statusIcon[r.status];
  return `${color}${prefix}${slug} ${file} ${dbCol} ${icon}${C.reset}`;
}

console.log(`\n${C.bold}Monitor Verify${C.reset}  ${C.dim}${DB_PATH}${C.reset}`);
console.log(`${C.dim}Items: ${results.length} en disco | ${dbRowCount} entradas en DB${C.reset}\n`);

console.log(
  `${C.green}OK ${byStatus.OK.length}${C.reset}  ` +
  `${C.red}MISMATCH ${byStatus.MISMATCH.length}${C.reset}  ` +
  `${C.yellow}MISSING ${byStatus.MISSING.length}${C.reset}  ` +
  `${C.cyan}UNKNOWN ${byStatus.UNKNOWN.length}${C.reset}\n`
);

// Header
console.log(C.bold +
  '     ' +
  'SLUG'.padEnd(W.slug) + ' ' +
  'FILE STATE'.padEnd(W.file) + ' ' +
  'DB STATE'.padEnd(W.db) + ' ' +
  'STATUS' +
C.reset);
console.log(C.dim + SEPARATOR + C.reset);

// Orden: MISMATCH primero, luego UNKNOWN, MISSING, OK
const ordered = [
  ...byStatus.MISMATCH,
  ...byStatus.UNKNOWN,
  ...byStatus.MISSING,
  ...byStatus.OK,
];

for (const r of ordered) {
  console.log(row(r));
}

console.log(C.dim + SEPARATOR + C.reset);

// ─── Detalle de problemas ─────────────────────────────────────────────────────

if (byStatus.MISMATCH.length > 0) {
  console.log(`\n${C.bold}${C.red}MISMATCHES — estado en disco distinto al de la DB:${C.reset}`);
  console.log(`${C.dim}(la DB se actualiza en el siguiente ciclo de poll — 30s)${C.reset}`);
  for (const r of byStatus.MISMATCH) {
    console.log(`  [${r.type[0].toUpperCase()}] ${r.slug}`);
    console.log(`      Archivo : ${r.fileState}`);
    console.log(`      DB      : ${r.dbState}`);
  }
}

if (byStatus.UNKNOWN.length > 0) {
  console.log(`\n${C.bold}${C.cyan}UNKNOWN — el parser no reconoce el valor de estado:${C.reset}`);
  console.log(`${C.dim}(anadir la entrada a FEATURE_STATE_MAP o BUG_STATE_MAP en statusParser.ts)${C.reset}`);
  for (const r of byStatus.UNKNOWN) {
    console.log(`  [${r.type[0].toUpperCase()}] ${r.slug}`);
  }
}

if (byStatus.MISSING.length > 0) {
  console.log(`\n${C.bold}${C.yellow}MISSING — nunca registrados en la DB:${C.reset}`);
  console.log(`${C.dim}(la DB se pobla en el primer ciclo de poll tras arrancar la app)${C.reset}`);
  for (const r of byStatus.MISSING) {
    console.log(`  [${r.type[0].toUpperCase()}] ${r.slug}  →  ${r.fileState}`);
  }
}

console.log('');
