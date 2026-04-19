#!/usr/bin/env bun
/**
 * compliance-check.ts
 *
 * Calcula el compliance score de una feature comparando el git diff
 * contra el contrato de Leo definido en el status.md.
 *
 * Uso:
 *   bun run compliance-check <feature-slug> [--base <ref>] [--json]
 *
 * Opciones:
 *   --base <ref>   Rama base para el diff (default: main)
 *   --json         Emitir resultado como JSON a stdout
 *
 * Exit codes:
 *   0  Sin errores (incluso si no hay contrato)
 *   1  Error: slug invalido, archivo no encontrado, git diff fallo
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseLeoContract } from '../src/dev-tools/monitor/core/complianceParser';

// ── Parse args ──

const args = process.argv.slice(2);
const featureSlug = args.find(a => !a.startsWith('--'));
const baseRef = args.includes('--base')
  ? args[args.indexOf('--base') + 1] ?? 'main'
  : 'main';
const jsonMode = args.includes('--json');

if (!featureSlug) {
  console.error('Uso: bun run compliance-check <feature-slug> [--base <ref>] [--json]');
  process.exit(1);
}

// Validar slug: solo letras minusculas, numeros y guiones
if (!/^[a-z0-9-]+$/.test(featureSlug)) {
  console.error(`[compliance-check] Slug invalido: "${featureSlug}". Solo se permiten a-z, 0-9 y guiones.`);
  process.exit(1);
}

// ── Localizar status.md ──

const repoRoot = resolve(process.cwd());
const statusPath = join(repoRoot, 'docs', 'features', featureSlug, 'status.md');

if (!existsSync(statusPath)) {
  console.error(`[compliance-check] No encontrado: ${statusPath}`);
  process.exit(1);
}

const content = readFileSync(statusPath, 'utf8');

// ── Leer el contrato ──

const contract = parseLeoContract(content);

if (!contract) {
  if (jsonMode) {
    console.log(JSON.stringify({ featureSlug, hasContract: false }));
  } else {
    console.log(`[compliance-check] ${featureSlug}: Sin contrato definido (no hay bloque "### Leo Contract").`);
  }
  process.exit(0);
}

// ── Leer rama del status.md ──

const branchMatch = content.match(/^Rama:\s*(.+)$/m);
const branch = branchMatch?.[1]?.trim() ?? featureSlug;

// ── Correr git diff ──

function runGit(gitArgs: string[]): string {
  const result = spawnSync('git', gitArgs, { encoding: 'utf8', cwd: repoRoot });
  if (result.status !== 0) {
    throw new Error(`git ${gitArgs.join(' ')} fallo: ${result.stderr?.trim() ?? 'error desconocido'}`);
  }
  return (result.stdout ?? '').trim();
}

let diffFiles: Set<string>;

try {
  const diffOutput = runGit(['diff', `${baseRef}...${branch}`, '--name-only']);
  diffFiles = new Set(
    diffOutput.split('\n').map(l => l.trim()).filter(Boolean)
  );
} catch (e) {
  console.error(`[compliance-check] Error al correr git diff: ${(e as Error).message}`);
  process.exit(1);
}

// ── Calcular score ──

const allSpecified = [...contract.create, ...contract.modify];
const filesSpec = allSpecified.length;
const filesOk = allSpecified.filter(f => diffFiles.has(f)).length;
const filesViol = contract.no_touch.filter(f => diffFiles.has(f)).length;
const rawScore = filesSpec > 0 ? filesOk / filesSpec : 1.0;
const score = Math.max(0, Math.round((rawScore - filesViol * 0.1) * 100) / 100);

// ── Output ──

if (jsonMode) {
  console.log(JSON.stringify({
    featureSlug,
    hasContract: true,
    score,
    filesSpec,
    filesOk,
    filesViol,
    branch,
    baseRef,
  }));
  process.exit(0);
}

// ASCII table output
const pct = Math.round(score * 100);
const bar = '#'.repeat(Math.floor(pct / 5)) + '-'.repeat(20 - Math.floor(pct / 5));
console.log(`\n=== Compliance Check: ${featureSlug} ===\n`);
console.log(`Score:       ${pct}% [${bar}]`);
console.log(`Archivos OK: ${filesOk} / ${filesSpec} especificados`);
console.log(`Violaciones: ${filesViol} (archivos no_touch modificados)`);
console.log(`Branch:      ${branch} vs ${baseRef}`);
console.log('');

if (filesViol > 0) {
  console.log('Archivos en no_touch que aparecen en el diff:');
  for (const f of contract.no_touch.filter(f => diffFiles.has(f))) {
    console.log(`  [VIOLACION] ${f}`);
  }
  console.log('');
}

const missing = allSpecified.filter(f => !diffFiles.has(f));
if (missing.length > 0) {
  console.log('Archivos especificados que NO aparecen en el diff:');
  for (const f of missing) {
    console.log(`  [FALTANTE]  ${f}`);
  }
  console.log('');
}
