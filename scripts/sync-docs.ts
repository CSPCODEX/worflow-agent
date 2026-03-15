/**
 * sync-docs.ts
 *
 * Detecta ramas mergeadas en main y actualiza automaticamente los status.md
 * correspondientes en docs/features/ y docs/bugs/.
 *
 * Uso: bun run sync-docs  (desde la raiz del repo)
 *
 * Soporta dos formatos de linea de estado:
 *   - Formato plano: "Estado: ..."  /  "Estado final: ..."
 *   - Formato bold:  "**Estado:** ..." (archivos mas antiguos)
 *
 * El script es idempotente — ejecutarlo multiples veces produce el mismo resultado.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type DocKind = 'feature' | 'bug';

interface DocEntry {
  kind: DocKind;
  slug: string;       // nombre exacto de la carpeta (ej. "delete-agent", "001-validacion-encoding-caracteres")
  branchName: string; // "feature/<slug>" o "bug/<slug>"
  statusPath: string; // ruta absoluta al status.md
}

interface SyncResult {
  slug: string;
  branchName: string;
  action: 'mergeado' | 'archivado' | 'sin-cambios';
  mergeDate?: string; // ISO date string "YYYY-MM-DD", solo cuando action === 'mergeado'
  reason?: string;    // descripcion del por que sin-cambios
}

// ---------------------------------------------------------------------------
// runGit
// ---------------------------------------------------------------------------

/**
 * Ejecuta un comando git de forma sincrona y retorna stdout trimmeado.
 * spawnSync es correcto aqui — este es un script CLI, no un handler IPC.
 */
function runGit(args: string[]): string {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    cwd: process.cwd(),
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr?.trim() ?? 'unknown error'}`);
  }
  return (result.stdout ?? '').trim();
}

// ---------------------------------------------------------------------------
// getMergedBranches
// ---------------------------------------------------------------------------

/**
 * Retorna el conjunto de nombres de ramas (locales Y remotas) que estan
 * mergeadas en main. Hace fetch primero para traer el estado de origin.
 */
function getMergedBranches(): Set<string> {
  // Fetch para traer el estado remoto actualizado
  try {
    runGit(['fetch', 'origin', '--prune', '--quiet']);
  } catch {
    // fetch puede fallar sin internet — continuar con datos locales
    console.warn('[sync-docs] git fetch fallo - usando datos locales solamente');
  }

  const merged = new Set<string>();

  // Ramas locales mergeadas en main
  try {
    const localOutput = runGit(['branch', '--merged', 'main']);
    for (const line of localOutput.split('\n')) {
      const name = line.replace(/^\*?\s+/, '').trim();
      if (name && name !== 'main') merged.add(name);
    }
  } catch {
    // main puede no existir localmente si solo hay origin/main — ignorar
  }

  // Ramas remotas mergeadas en origin/main
  try {
    const remoteOutput = runGit(['branch', '-r', '--merged', 'origin/main']);
    for (const line of remoteOutput.split('\n')) {
      const name = line.trim().replace(/^origin\//, '');
      if (name && name !== 'main' && name !== 'HEAD') merged.add(name);
    }
  } catch {
    // ignorar si origin/main no existe
  }

  return merged;
}

// ---------------------------------------------------------------------------
// getMergeDate
// ---------------------------------------------------------------------------

/**
 * Retorna la fecha del commit de merge en formato "YYYY-MM-DD".
 * Busca en el log de origin/main el merge commit que menciona la rama.
 * Si no puede determinarlo, retorna la fecha de hoy como fallback.
 */
function getMergeDate(branchName: string): string {
  try {
    const output = runGit([
      'log', 'origin/main',
      '--merges',
      '--grep', branchName,
      '--format=%ad',
      '--date=short',
      '-1',
    ]);
    if (output) return output;
  } catch {
    // fallback a la fecha actual si no se puede determinar
  }
  return new Date().toISOString().split('T')[0]!;
}

// ---------------------------------------------------------------------------
// discoverDocEntries
// ---------------------------------------------------------------------------

/**
 * Escanea docs/features/ y docs/bugs/ y retorna un DocEntry por cada carpeta
 * que contenga un status.md.
 */
function discoverDocEntries(): DocEntry[] {
  const entries: DocEntry[] = [];
  const repoRoot = process.cwd();

  const docsConfig: Array<{ dir: string; kind: DocKind; prefix: string }> = [
    { dir: join(repoRoot, 'docs', 'features'), kind: 'feature', prefix: 'feature/' },
    { dir: join(repoRoot, 'docs', 'bugs'),     kind: 'bug',     prefix: 'bug/'     },
  ];

  for (const { dir, kind, prefix } of docsConfig) {
    if (!existsSync(dir)) continue;

    let slugs: string[];
    try {
      slugs = readdirSync(dir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
    } catch {
      continue;
    }

    for (const slug of slugs) {
      const statusPath = join(dir, slug, 'status.md');
      if (!existsSync(statusPath)) continue;

      entries.push({
        kind,
        slug,
        branchName: `${prefix}${slug}`,
        statusPath,
      });
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// updateStatusFile
// ---------------------------------------------------------------------------

/**
 * Modifica el status.md en disco. Soporta dos formatos de linea de estado:
 *
 * Formato plano (mayoria de los archivos):
 *   Estado: <cualquier-cosa>       →  Estado: MERGEADO
 *   Estado final: <cualquier-cosa> →  Estado final: MERGEADO
 *
 * Formato bold (archivos mas antiguos, ej. delete-agent, prompt-enhancement):
 *   **Estado:** <cualquier-cosa>   →  **Estado:** MERGEADO
 *
 * Ademas, si action === 'mergeado', inserta/actualiza la linea
 * "Fecha merge: YYYY-MM-DD" despues de la linea "Rama:".
 *
 * Si no hay ninguna linea de Estado reconocible, no toca el archivo.
 * La funcion es idempotente.
 */
function updateStatusFile(
  entry: DocEntry,
  action: 'mergeado' | 'archivado',
  mergeDate?: string,
): void {
  const content = readFileSync(entry.statusPath, 'utf8');
  const lines = content.split('\n');

  const nuevoEstado = action === 'mergeado' ? 'MERGEADO' : 'ARCHIVADO';
  let modified = false;
  let ramaLineIndex = -1;
  let fechaMergeLineIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (/^Estado:\s/.test(line)) {
      lines[i] = `Estado: ${nuevoEstado}`;
      modified = true;
    } else if (/^Estado final:\s/.test(line)) {
      lines[i] = `Estado final: ${nuevoEstado}`;
      modified = true;
    } else if (/^\*\*Estado:\*\*\s/.test(line)) {
      // Formato bold usado en archivos anteriores a la estandarizacion del template
      lines[i] = `**Estado:** ${nuevoEstado}`;
      modified = true;
    } else if (/^Rama:\s/.test(line) && ramaLineIndex === -1) {
      ramaLineIndex = i;
    } else if (/^Fecha merge:\s/.test(line)) {
      fechaMergeLineIndex = i;
    }
  }

  // Si no habia ninguna linea de Estado reconocible, no tocar el archivo
  if (!modified) return;

  // Insertar/actualizar "Fecha merge:" solo si action es mergeado
  if (action === 'mergeado' && mergeDate) {
    const fechaLine = `Fecha merge: ${mergeDate}`;
    if (fechaMergeLineIndex !== -1) {
      // Ya existe — sobreescribir (idempotente)
      lines[fechaMergeLineIndex] = fechaLine;
    } else {
      // Insertar despues de la linea Rama: (o despues de la primera linea si no hay Rama:)
      const insertAfter = ramaLineIndex !== -1 ? ramaLineIndex : 0;
      lines.splice(insertAfter + 1, 0, fechaLine);
    }
  }

  writeFileSync(entry.statusPath, lines.join('\n'), 'utf8');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main(): void {
  console.log('[sync-docs] Iniciando sincronizacion de docs con estado git...\n');

  const mergedBranches = getMergedBranches();
  const entries = discoverDocEntries();
  const results: SyncResult[] = [];

  for (const entry of entries) {
    const isMerged = mergedBranches.has(entry.branchName);

    // Verificar si la rama existe (local o remote)
    let branchExists = false;
    try {
      const localCheck = runGit(['branch', '--list', entry.branchName]);
      const remoteCheck = runGit(['branch', '-r', '--list', `origin/${entry.branchName}`]);
      branchExists = localCheck.length > 0 || remoteCheck.length > 0;
    } catch {
      branchExists = false;
    }

    if (isMerged) {
      const mergeDate = getMergeDate(entry.branchName);
      updateStatusFile(entry, 'mergeado', mergeDate);
      results.push({
        slug: entry.slug,
        branchName: entry.branchName,
        action: 'mergeado',
        mergeDate,
      });
    } else if (!branchExists) {
      updateStatusFile(entry, 'archivado');
      results.push({
        slug: entry.slug,
        branchName: entry.branchName,
        action: 'archivado',
      });
    } else {
      results.push({
        slug: entry.slug,
        branchName: entry.branchName,
        action: 'sin-cambios',
        reason: 'rama activa no mergeada',
      });
    }
  }

  // Imprimir resumen
  console.log('=== Resumen sync-docs ===\n');

  const mergeados = results.filter(r => r.action === 'mergeado');
  const archivados = results.filter(r => r.action === 'archivado');
  const sinCambios = results.filter(r => r.action === 'sin-cambios');

  function printGroup(label: string, items: SyncResult[], format: (r: SyncResult) => string): void {
    if (items.length === 0) return;
    console.log(`${label} (${items.length}):`);
    for (const r of items) console.log(`  ${format(r)}`);
    console.log('');
  }

  printGroup('Marcados como MERGEADO', mergeados, r => `[MERGEADO] ${r.branchName} (${r.mergeDate})`);
  printGroup('Marcados como ARCHIVADO', archivados, r => `[ARCHIVADO] ${r.branchName}`);
  printGroup('Sin cambios', sinCambios, r => `[OK] ${r.branchName}`);

  console.log(`Total: ${results.length} entradas procesadas.`);
  console.log(`  ${mergeados.length} mergeadas, ${archivados.length} archivadas, ${sinCambios.length} activas sin cambios.`);
}

main();
