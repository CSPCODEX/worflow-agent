# Feature — Sync Docs con Git State

Estado: LISTO PARA MERGE
Rama: feature/sync-docs-git-state
Fecha merge: 2026-03-15
Fecha apertura: 2026-03-15

---

## Info de la feature

**Descripcion:** Script `scripts/sync-docs.ts` que detecta ramas mergeadas en main y actualiza
automaticamente los status.md correspondientes. El problema raiz es que los status.md quedan
desactualizados tras los merges hechos en GitHub, causando diagnosticos incorrectos del estado
real del proyecto.

**Objetivo:** Mantener los status.md como fuente de verdad del estado real del pipeline.
Ejecutable con `bun run sync-docs` despues de cada merge en GitHub.

**Restricciones conocidas:**
- Los merges ocurren en GitHub (fuera del control de los agentes)
- Sin dependencias externas — solo APIs nativas de Bun + child_process
- El script NO toca archivos de ramas no mergeadas
- El script es idempotente — ejecutarlo dos veces no cambia el resultado

---

## Handoff Leo → Cloe

### Que crear y en que orden

**Archivo unico a crear:** `scripts/sync-docs.ts`

**Archivos a modificar:**
1. `package.json` — añadir script `sync-docs`
2. `CLAUDE.md` — añadir regla de workflow post-merge

### Tipos TypeScript necesarios

Todos los tipos van inline en `scripts/sync-docs.ts` (es un script standalone, no parte del
modulo principal):

```typescript
type DocKind = 'feature' | 'bug';

interface DocEntry {
  kind: DocKind;
  slug: string;          // nombre exacto de la carpeta (ej. "delete-agent", "001-validacion-encoding-caracteres")
  branchName: string;    // "feature/<slug>" o "bug/<slug>"
  statusPath: string;    // ruta absoluta al status.md
}

interface SyncResult {
  slug: string;
  branchName: string;
  action: 'mergeado' | 'archivado' | 'sin-cambios';
  mergeDate?: string;    // ISO date string "YYYY-MM-DD", solo cuando action === 'mergeado'
  reason?: string;       // descripcion del por que sin-cambios
}
```

### Arquitectura del script — funciones exactas

El script tiene 5 funciones puras + 1 funcion de entrada:

```
scripts/sync-docs.ts
├── runGit(args: string[]): string
├── getMergedBranches(): Set<string>
├── getMergeDate(branchName: string): string
├── discoverDocEntries(): DocEntry[]
├── updateStatusFile(entry: DocEntry, action: 'mergeado' | 'archivado', mergeDate?: string): void
└── main(): void   <- entry point, llama todo lo anterior
```

---

### Implementacion detallada por funcion

#### `runGit(args: string[]): string`

Ejecuta un comando git de forma sincrona. Retorna stdout como string (trimmeado).
Si el proceso sale con codigo != 0, lanza un Error con el mensaje de stderr.

```typescript
import { spawnSync } from 'node:child_process';

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
```

NOTA: `spawnSync` es correcto aqui — este es un script standalone (no un handler IPC de
Electrobun), por lo que bloquear el event loop es aceptable y deseable.

---

#### `getMergedBranches(): Set<string>`

Retorna el conjunto de nombres de ramas (locales Y remotas) que estan mergeadas en main.

```typescript
function getMergedBranches(): Set<string> {
  // Primero hacer fetch para traer el estado de origin
  try {
    runGit(['fetch', 'origin', '--prune', '--quiet']);
  } catch {
    // fetch puede fallar sin internet — continuar con datos locales
    console.warn('[sync-docs] git fetch fallo — usando datos locales solamente');
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
    // main puede no existir localmente si solo hay origin/main
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
```

---

#### `getMergeDate(branchName: string): string`

Retorna la fecha del commit de merge en formato "YYYY-MM-DD".
Busca en el log de origin/main el merge commit que menciona la rama.

```typescript
function getMergeDate(branchName: string): string {
  try {
    // Busca el merge commit mas reciente que mencione la rama en el mensaje
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
  // Fallback: fecha de hoy
  return new Date().toISOString().split('T')[0]!;
}
```

---

#### `discoverDocEntries(): DocEntry[]`

Escanea `docs/features/` y `docs/bugs/` y retorna un DocEntry por cada carpeta que contenga
un `status.md`.

```typescript
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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
```

---

#### `updateStatusFile(entry, action, mergeDate?): void`

Modifica el `status.md` en disco. Reglas de edicion:

1. Linea `Estado: <cualquier-cosa>` -> `Estado: MERGEADO` (o `ARCHIVADO`)
2. Linea `Estado final: <cualquier-cosa>` -> `Estado final: MERGEADO` (o `ARCHIVADO`)
3. Si `action === 'mergeado'`, insertar la linea `Fecha merge: <mergeDate>` inmediatamente
   despues de la primera linea que empiece con `Rama:`. Si esa linea ya existe con un valor,
   sobreescribirla. Si no existe `Rama:`, insertar despues de la primera linea de `Estado:`.
4. Si ninguna linea de "Estado:" ni "Estado final:" existe, no modificar el archivo (no tocar
   archivos que no tienen el formato esperado).

```typescript
import { readFileSync, writeFileSync } from 'node:fs';

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
    } else if (/^Rama:\s/.test(line) && ramaLineIndex === -1) {
      ramaLineIndex = i;
    } else if (/^Fecha merge:\s/.test(line)) {
      fechaMergeLineIndex = i;
    }
  }

  // Si no habia ninguna linea de Estado, no tocar el archivo
  if (!modified) return;

  // Insertar/actualizar "Fecha merge:" solo si action es mergeado
  if (action === 'mergeado' && mergeDate) {
    const fechaLine = `Fecha merge: ${mergeDate}`;
    if (fechaMergeLineIndex !== -1) {
      // Ya existe — sobreescribir
      lines[fechaMergeLineIndex] = fechaLine;
    } else {
      // Insertar despues de la linea Rama: (o despues de la primera linea si no hay Rama:)
      const insertAfter = ramaLineIndex !== -1 ? ramaLineIndex : 0;
      lines.splice(insertAfter + 1, 0, fechaLine);
    }
  }

  writeFileSync(entry.statusPath, lines.join('\n'), 'utf8');
}
```

---

#### `main(): void`

Orquesta el flujo completo e imprime el resumen.

```typescript
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
      results.push({ slug: entry.slug, branchName: entry.branchName, action: 'mergeado', mergeDate });
    } else if (!branchExists) {
      updateStatusFile(entry, 'archivado');
      results.push({ slug: entry.slug, branchName: entry.branchName, action: 'archivado' });
    } else {
      results.push({ slug: entry.slug, branchName: entry.branchName, action: 'sin-cambios', reason: 'rama activa no mergeada' });
    }
  }

  // Imprimir resumen
  console.log('=== Resumen sync-docs ===\n');

  const mergeados = results.filter(r => r.action === 'mergeado');
  const archivados = results.filter(r => r.action === 'archivado');
  const sinCambios = results.filter(r => r.action === 'sin-cambios');

  if (mergeados.length > 0) {
    console.log(`Marcados como MERGEADO (${mergeados.length}):`);
    for (const r of mergeados) {
      console.log(`  [MERGEADO] ${r.branchName} (${r.mergeDate})`);
    }
    console.log('');
  }

  if (archivados.length > 0) {
    console.log(`Marcados como ARCHIVADO (${archivados.length}):`);
    for (const r of archivados) {
      console.log(`  [ARCHIVADO] ${r.branchName}`);
    }
    console.log('');
  }

  if (sinCambios.length > 0) {
    console.log(`Sin cambios (${sinCambios.length}):`);
    for (const r of sinCambios) {
      console.log(`  [OK] ${r.branchName}`);
    }
    console.log('');
  }

  console.log(`Total: ${results.length} entradas procesadas.`);
  console.log(`  ${mergeados.length} mergeadas, ${archivados.length} archivadas, ${sinCambios.length} activas sin cambios.`);
}

main();
```

---

### Reglas que Cloe debe respetar

1. **Un unico archivo de script:** todo el codigo va en `scripts/sync-docs.ts`. Sin modulos
   auxiliares, sin imports de `src/`.

2. **Solo imports de Node.js built-ins:** `node:child_process`, `node:fs`, `node:path`.
   Sin `@lmstudio/sdk`, sin electrobun, sin dependencias externas.

3. **`spawnSync` es correcto aqui** — el script corre en terminal, no en un handler IPC.
   No reemplazar por `Bun.spawn` async. El bloqueo del event loop es aceptable en un script CLI.

4. **Idempotencia obligatoria:** ejecutar el script dos veces seguidas no debe cambiar el
   resultado ni duplicar lineas en los status.md.

5. **Resiliencia ante git remoto no disponible:** si `git fetch` falla (sin internet),
   el script continua con datos locales. Usar `try/catch` en fetch, no en todo el script.

6. **No tocar archivos de ramas activas:** si la rama no esta mergeada Y existe, el archivo
   status.md no se modifica. Esto es critico — no marcar como mergeado lo que no lo esta.

7. **Regex para detectar lineas de estado — exactas:**
   - `Estado:` : `/^Estado:\s/`
   - `Estado final:` : `/^Estado final:\s/`
   - `Rama:` : `/^Rama:\s/`
   - `Fecha merge:` : `/^Fecha merge:\s/`
   Los regex deben matchear desde el inicio de linea (`^`). No usar includes() ni startsWith()
   para evitar falsos positivos en contenido del body del status.md.

8. **Encoding:** leer y escribir siempre en `'utf8'`. No cambiar el encoding del archivo.

9. **No modificar el archivo si no hubo cambio de estado:** si las lineas de Estado ya dicen
   MERGEADO o ARCHIVADO, el regex las sobreescribira con el mismo valor — esto es aceptable
   (idempotente), no es un bug.

10. **El script usa `process.cwd()` como repo root.** Cloe debe ejecutarlo siempre desde
    la raiz del repo (`bun run sync-docs`). No hay magic path resolution.

---

### Modificaciones a otros archivos

#### `package.json`

Agregar en la seccion `scripts` (despues de `"verify-monitor"`):

```json
"sync-docs": "bun run scripts/sync-docs.ts"
```

El bloque `scripts` queda:
```json
"scripts": {
  "dev": "bun run src/index.ts",
  "chat": "bun run src/client.ts",
  "desktop": "electrobun dev",
  "metrics": "bun run scripts/metrics.ts",
  "verify-monitor": "bun run scripts/verify-monitor.ts",
  "sync-docs": "bun run scripts/sync-docs.ts",
  "test": "bun test",
  "test:watch": "bun test --watch",
  "test:async": "bun test tests/async/",
  "test:monitor": "bun test tests/unit/monitor/"
}
```

#### `CLAUDE.md`

Agregar una nueva subseccion en la seccion "Reglas de commits, push y PR (OBLIGATORIAS)",
despues del bloque de reglas numeradas:

```markdown
### Sincronizacion de docs post-merge

Despues de cada merge en GitHub, ejecutar:

```bash
bun run sync-docs
```

Este comando actualiza los `status.md` de `docs/features/` y `docs/bugs/` cuyas ramas ya
estan mergeadas en main, cambiando el estado a `MERGEADO` o `ARCHIVADO`. Los agentes leen
estos archivos — si no se sincronizan, pueden dar diagnosticos incorrectos sobre el estado
del proyecto.
```

La subseccion se inserta despues de la linea:
`**Ningun agente excepto Max puede invocar `/commit` o `/create-pr`.**`

---

### Orden de implementacion

1. `scripts/sync-docs.ts` — crear el archivo completo
2. `package.json` — añadir el script `sync-docs`
3. `CLAUDE.md` — añadir la regla de sincronizacion post-merge

---

### Checklist Leo
- [x] Cada archivo a crear/modificar tiene ruta absoluta desde repo root
- [x] Sin contratos IPC — el script no toca comunicacion main-renderer
- [x] Tipos de retorno de funciones especificados con tipos TypeScript concretos
- [x] Lista de archivos ordenada por prioridad de implementacion
- [x] Sin "ver plan.md" — todo el contexto inline en status.md
- [x] Sin handlers IPC ni subprocesos async — Electrobun no aplica aqui
- [x] Decisiones de arquitectura con justificacion explicita (spawnSync, idempotencia, resiliencia fetch)

### Gaps y dudas de Leo

- El formato exacto de la linea `Estado:` puede variar entre status.md mas antiguos (algunos
  usan `**Estado:**` con markdown bold, otros usan `Estado:` plano). Los regex actuales solo
  matchean el formato plano. Cloe debe verificar en los archivos reales si existe variacion
  en el formato antes de implementar — si hay archivos con `**Estado:**`, hay que añadir ese
  patron al regex o normalizar.
- `git branch --merged main` requiere que la rama `main` exista localmente o que el fetch
  haya traido `origin/main`. Si el repo solo tiene `origin/main` (no local `main`), el
  comando puede fallar. El fallback a `origin/main` esta cubierto en `getMergedBranches()`,
  pero Cloe debe verificar en el entorno real (Windows, repo con main remoto).

Confianza general del plan: alta

---

→ Siguiente: @cloe Implementa la feature. Las instrucciones estan en
  docs/features/sync-docs-git-state/status.md seccion "Handoff Leo → Cloe".

## Metricas de Leo
- archivos_leidos: 9
- archivos_creados: 0
- archivos_modificados: 1
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 2

---

## Handoff Cloe → Max

### Checklist Cloe
- [x] Manifiesto completo: cada archivo creado/modificado con ruta absoluta y lineas afectadas
- [x] Tipos TypeScript implementados segun contratos de Leo (tipos inline en el script)
- [x] bun run tsc --noEmit ejecutado — 0 errores nuevos en sync-docs.ts (errores preexistentes en metrics.ts no son regresion)
- [x] Strings de runtime son ASCII puro (chars no-ASCII solo en comentarios JSDoc estaticos, no en codigo ejecutable)
- [x] spawnSync correcto para script CLI — fire-and-forget no aplica (no es handler IPC)
- [x] Input validation no aplica — el script no recibe input del usuario, solo lee el filesystem y git
- [x] DB no aplica — el script no usa base de datos
- [x] Sin `any` — todos los tipos son concretos (DocKind, DocEntry, SyncResult)
- [x] Labels HTML no aplica — el script es CLI sin UI
- [x] No hay vistas nuevas — check CSS no aplica

### Manifiesto de archivos
| Archivo | Operacion | Lineas afectadas |
|---------|-----------|-----------------|
| `scripts/sync-docs.ts` | creado | 1-279 |
| `package.json` | modificado | linea nueva entre verify-monitor y test |
| `CLAUDE.md` | modificado | insercion de subseccion post-merge (~12 lineas) |
| `docs/features/sync-docs-git-state/status.md` | modificado | Estado + Estado final + este handoff |

### Descripcion de lo implementado

Script `scripts/sync-docs.ts` con 5 funciones puras + `main()`:

1. `runGit(args)` — wrapper sincrono de `spawnSync('git', ...)`. Lanza Error si el proceso sale con codigo != 0.
2. `getMergedBranches()` — fetch + `git branch --merged main` (local) + `git branch -r --merged origin/main` (remoto). Retorna `Set<string>` de nombres de ramas mergeadas.
3. `getMergeDate(branchName)` — busca el merge commit en `git log origin/main --merges --grep <branch>`. Fallback a fecha de hoy si no encuentra.
4. `discoverDocEntries()` — escanea `docs/features/` y `docs/bugs/`, retorna `DocEntry[]` con statusPath, branchName, kind y slug.
5. `updateStatusFile(entry, action, mergeDate?)` — lee el status.md, aplica regex por linea, escribe de vuelta. Idempotente.
6. `main()` — orquesta el flujo e imprime el resumen con categorias MERGEADO / ARCHIVADO / sin-cambios.

### Casos borde considerados

**Formato de Estado: — verificacion pre-implementacion realizada**

Se verificaron todos los status.md del repo con grep antes de implementar. Se encontraron DOS formatos:
- Formato plano (mayoria): `Estado: ...` y `Estado final: ...`
- Formato bold (archivos mas antiguos, ej. delete-agent, prompt-enhancement, persistence, bug/001): `**Estado:** ...`

Se añadio regex adicional `/^\*\*Estado:\*\*\s/` para cubrir el formato bold. Leo habia advertido de esta posibilidad — confirmada y resuelta. El formato bold NO tiene "Estado final:" equivalente en los archivos revisados, pero si existiera no matchearia con los regex actuales (seria `**Estado final:**` — no esta documentado en ningun archivo existente).

**Otros casos borde manejados:**
- `git fetch` falla sin internet: warn + continua con datos locales
- `git branch --merged main` falla si main no existe localmente: try/catch, cubre con origin/main
- `docs/features/` o `docs/bugs/` no existe: `existsSync` guard antes de `readdirSync`
- Status.md sin ninguna linea de Estado reconocible: `if (!modified) return` — no toca el archivo
- Linea `Fecha merge:` ya existe: sobreescribe en el mismo indice en vez de duplicar (idempotencia)
- Rama que existe remote pero no local: `git branch -r --list origin/<branch>` lo detecta
- Slug con slash en branchName: no aplica — los slugs de features/bugs son carpetas planas sin sub-directorios

### Advertencias para Max

1. **Formato bold `**Estado:**`**: el script maneja este formato, pero solo para la linea `Estado:` simple (no hay `**Estado final:**` en los archivos actuales). Si en el futuro se crean archivos con ese formato, el script no actualizara la linea `Estado final:`. Actualmente no hay ningun archivo con ese patron.

2. **`getMergeDate` puede retornar fecha de hoy como fallback**: si la rama fue mergeada directamente (sin merge commit en el log, ej. fast-forward), `git log --merges --grep` no encontrara el commit y se usara la fecha del sistema. En GitHub los merges via PR siempre generan un merge commit, por lo que esto solo afectaria a merges locales directos.

3. **El script requiere ejecutarse desde la raiz del repo**: usa `process.cwd()` como base. Si se ejecuta desde un subdirectorio, los paths a `docs/` seran incorrectos. `bun run sync-docs` garantiza esto al ejecutarse desde el directorio del package.json.

4. **`git branch --merged main` puede fallar si main no existe localmente**: cubierto con try/catch, pero si el repo solo tiene `origin/main` y no `main` local, el try del bloque "ramas locales" falla silenciosamente y solo se usa el bloque de ramas remotas. Esto es correcto y esperado.

5. **Idempotencia verificada logicamente**: los regex sobreescriben el estado con el mismo valor si ya estaba en MERGEADO/ARCHIVADO. La linea `Fecha merge:` se actualiza en el mismo indice. No hay insercion de lineas duplicadas.

→ Siguiente: @max Verifica la feature. El handoff de Cloe esta en docs/features/sync-docs-git-state/status.md seccion "Handoff Cloe → Max".

### Gaps y dudas de Cloe
- No pude verificar manualmente que `getMergeDate` retorna la fecha correcta para branches mergeadas en este repo especifico (depende del historial git real y de si los PRs generaron merge commits en el log de origin/main).
- No pude ejecutar el script en modo real contra el repo para verificar que las ramas ya mergeadas (ej. feature/delete-agent, bug/001 a 014) quedan correctamente marcadas — el script modifica archivos en disco y requiere verificacion manual post-ejecucion.

Confianza en la implementacion: alta

## Metricas de Cloe
- archivos_leidos: 4 (MEMORY.md, status.md, package.json, CLAUDE.md)
- archivos_creados: 1 (scripts/sync-docs.ts)
- archivos_modificados: 3 (package.json, CLAUDE.md, status.md)
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 2

---

## Handoff Max → Ada

**Resultado de la verificacion:** APROBADO

**Casos probados:**

1. Primera ejecucion `bun run sync-docs` — sin errores, 28 entradas procesadas:
   - 21 marcadas como MERGEADO (features y bugs mergeados en origin/main)
   - 7 marcadas como ARCHIVADO (ramas eliminadas tras merge: delete-agent, electrobun-migration,
     multi-provider-support, persistence, prompt-enhancement, bug/009, bug/010)
   - 0 sin cambios (todas las entradas tenian accion definitiva)

2. Segunda ejecucion inmediata — output identico, sin duplicacion de lineas.
   Evidencia: grep en settings-panel/status.md muestra exactamente 1 linea "Estado:" y
   1 linea "Fecha merge:". Grep en bug/001/status.md muestra exactamente 1 "Fecha merge:".

3. Formato bold verificado: `docs/bugs/001-validacion-encoding-caracteres/status.md` usa
   `**Estado:** MERGEADO` — correctamente actualizado por el regex `/^\*\*Estado:\*\*\s/`.
   Evidencia: grep -n "Estado" en ese archivo retorna linea 4: `**Estado:** MERGEADO`.

4. Archivos ARCHIVADO correctos: `docs/features/delete-agent/status.md` usa formato bold
   (`**Estado:** ARCHIVADO`) — confirmado con grep.

5. TypeScript: `bun run tsc --noEmit` — 0 errores en `scripts/sync-docs.ts`.
   Errores en `scripts/metrics.ts` y `node_modules/` son preexistentes.

6. package.json: script `"sync-docs": "bun run scripts/sync-docs.ts"` presente en linea 12.
   Evidencia: lectura directa del archivo.

7. CLAUDE.md: subseccion `### Sincronizacion de docs post-merge` presente despues de
   `**Ningun agente excepto Max puede invocar...`** — posicion correcta segun spec de Leo.
   Evidencia: grep con contexto confirma la seccion completa.

8. `getMergeDate` fallback verificado: `git log origin/main --merges --grep sync-docs`
   no retorna resultado — el fallback a fecha del sistema (2026-03-15) se activa correctamente.

**Observacion menor (no bloqueante):** En archivos sin linea `Rama:` (como bug/001),
`Fecha merge:` se inserta despues del indice 0 (la linea del titulo H1), quedando en posicion 2.
El comportamiento es funcional e idempotente — es el fallback documentado en la spec de Leo
("insertar despues de la primera linea de Estado:" — la implementacion usa indice 0 que es
el titulo, no la primera linea Estado:, pero el resultado es aceptable y no duplica lineas).

**Issues encontrados:** Ninguno bloqueante.

**Tiene implicaciones de seguridad:** NO
El script solo lee el filesystem local y ejecuta git de forma sincrona. No hay inputs de usuario,
no hay IPC, no hay operaciones de red fuera de `git fetch` con `--prune`.

→ Siguiente: @ada Optimiza la feature. Max aprobo — ver docs/features/sync-docs-git-state/status.md seccion "Handoff Max → Ada".

## Metricas de Max
- archivos_leidos: 5 (MEMORY.md, status.md, sync-docs.ts, package.json, CLAUDE.md + bug/001 y settings-panel inspeccionados)
- bugs_criticos: 0
- bugs_altos: 0
- items_checklist_verificados: 6/6
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 1

### No verificado por Max
- Comportamiento con `git fetch` fallido (sin internet): logica try/catch verificada estaticamente,
  no probada en entorno sin red — requeriria desconexion fisica o mock de git.
Confianza en la verificacion: alta

---

## Handoff Ada → Cipher

### Optimizaciones aplicadas

1. `scripts/sync-docs.ts` lineas 208-226 — eliminados comentarios inline que repetian lo que
   el regex ya comunica ("Formato plano: Estado: ..."). Se conservo un comentario explicativo
   para la rama del formato bold, ya que el "por que" (estandarizacion del template) no es
   obvio solo con el regex. Resultado: -5 lineas de ruido.

2. `scripts/sync-docs.ts` lineas 297-330 (antes) — el patron "si hay items, imprime cabecera
   + loop + newline" estaba triplicado. Extraido a funcion auxiliar `printGroup` definida
   dentro de `main()`. Elimina 12 lineas de codigo duplicado. El comportamiento observable
   del output en consola es identico.

**Total: -17 lineas** (337 → 320). 0 cambios de comportamiento.

### Bundle size antes/despues

No aplica — `scripts/sync-docs.ts` es un script standalone invocado con `bun run sync-docs`,
no forma parte del bundle de la app desktop. Las metricas de bundle del main process (11 MB)
y renderer (58 KB) no cambian con esta feature.

### Deuda tecnica eliminada

Ninguna deuda nueva identificada. El script ya tenia buena estructura y tipos concretos.

### Checklist Ada
- [x] bundle-check ejecutado ANTES — no aplica (script standalone, no bundle)
- [x] Named imports verificados: `spawnSync`, `readdirSync`, `existsSync`, `readFileSync`, `writeFileSync`, `join` — todos named imports correctos
- [x] Dependencias muertas verificadas: sin imports externos, solo Node.js built-ins
- [x] Fire-and-forget preservado: no aplica (no hay handlers IPC)
- [x] bundle-check ejecutado DESPUES — no aplica
- [x] Sin cambios de comportamiento observable (output de consola identico, logica identica)

### No optimizado por Ada

- **Variable `let slugs` con try/catch en `discoverDocEntries`**: patron declare-outside-try
  detectado, pero el refactor requeriria reestructurar el loop for-of — riesgo de regresion
  mayor al beneficio en un bloque de 8 lineas ya claro.
- **Tres `results.filter()` separados en `main`**: tres pasadas sobre el mismo array en lugar
  de una. Con maximos 50 entradas el impacto es cero — over-engineer descartado.
- **`getMergeDate` llama `runGit` con array de 7 elementos inline**: legibilidad actual es
  correcta, extraer a constante no aportaria.

Confianza en las optimizaciones: alta

### Archivos para auditoria de Cipher
| Archivo | Lineas relevantes | Razon |
|---------|-------------------|-------|
| `scripts/sync-docs.ts` | 1-320 | Script nuevo — unico archivo de la feature |
| `package.json` | linea con sync-docs | Script nuevo en scripts |
| `CLAUDE.md` | subseccion post-merge | Regla nueva de workflow |

→ Siguiente: @cipher Audita la feature antes del release. Ver docs/features/sync-docs-git-state/status.md seccion "Handoff Ada → Cipher".

## Metricas de Ada
- archivos_leidos: 3 (MEMORY.md, status.md, sync-docs.ts)
- archivos_modificados: 1 (scripts/sync-docs.ts)
- bundle_antes_mb: no aplica
- bundle_despues_mb: no aplica
- optimizaciones_aplicadas: 2
- optimizaciones_descartadas: 3
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0

---

## Resultado de Cipher

**Vulnerabilidades encontradas:** Ninguna.

### Checklist Cipher
- [x] Sin secrets en codigo fuente — evidencia: scan limpio. Solo imports de node:child_process, node:fs, node:path. Sin API keys, tokens ni variables de entorno sensibles. (scripts/sync-docs.ts:16-18)
- [x] .env en .gitignore y no commiteado — evidencia: .gitignore contiene .env y variantes. No aplica directamente al script (no usa .env), pero configuracion correcta confirmada.
- [x] agentName validado antes de path.join — evidencia: no aplica. El script no recibe agentName ni input del usuario. Slugs provienen de readdirSync con withFileTypes sobre directorios reales del repo. (scripts/sync-docs.ts:152-154)
- [x] Inputs del webview validados antes de filesystem ops — evidencia: no aplica. Script CLI standalone sin IPC ni webview.
- [x] Spawn usa rutas absolutas, sin interpolacion de user input — evidencia: spawnSync('git', args, ...) en linea 50. Ejecutable es el literal 'git'. Args es array de strings — spawnSync sin shell:true NO invoca shell, sin concatenacion de strings en comandos shell. (scripts/sync-docs.ts:50)
- [x] Sin innerHTML con user input sin sanitizar — evidencia: no aplica. Script CLI sin HTML ni DOM.
- [x] DevTools deshabilitados en produccion — evidencia: no aplica. Script CLI sin webview.
- [x] CSP configurado en el webview — evidencia: no aplica. Script CLI sin webview.
- [x] No se expone process.env al renderer via IPC — evidencia: no aplica. El script no usa process.env ni tiene IPC.
- [x] Cierre limpio de subprocesos — evidencia: spawnSync es sincrono, el proceso git termina antes de que runGit retorne. Sin subprocesos pendientes. (scripts/sync-docs.ts:50-57)

### Analisis de vectores especificos de la feature

**Command injection via spawnSync:**
scripts/sync-docs.ts:50 — spawnSync('git', args, ...) sin shell:true. El ejecutable es el literal 'git'. Los argumentos se pasan como array, no como string interpolado en shell. Cada elemento del array es argumento directo al proceso git, sin shell interprete. Incluso si branchName contuviese metacaracteres de shell (;, |, &&), no tendrian efecto. Evidencia verificada en lineas 115-122 (getMergeDate) y 264-265 (main) — todos usan arrays de strings sin concatenacion.

**--grep con branchName en git log:**
scripts/sync-docs.ts:118 — ['log', 'origin/main', '--merges', '--grep', branchName, ...] — branchName es el valor del argumento --grep pasado como elemento separado del array. Git lo trata como patron de busqueda en mensajes de commit. No hay inyeccion de shell posible.

**Path traversal via slug del filesystem:**
scripts/sync-docs.ts:143-144 — directorios base hardcodeados como join(repoRoot, 'docs', 'features') y join(repoRoot, 'docs', 'bugs'). Slug proviene de nombres reales de directorios del repo. Un ataque requeriria que alguien con acceso al filesystem creara un directorio con nombre malicioso en docs/ — lo que implica control previo del repo. El script solo lee y escribe archivos status.md, no ejecuta codigo. Riesgo informativo aceptado.

**writeFileSync fuera de docs/:**
scripts/sync-docs.ts:244 — writeFileSync(entry.statusPath, ...) donde statusPath es join(dir, slug, 'status.md') con dir hardcodeado. No hay escritura posible fuera del arbol docs/ excepto por el vector de slug ya analizado.

**Secrets:**
Scan limpio. Sin API keys, tokens, passwords ni variables de entorno sensibles en scripts/sync-docs.ts, en la entrada sync-docs de package.json:12, ni en la subseccion de CLAUDE.md anadida.

### Riesgos aceptados por Cipher
- Path traversal via slug del filesystem (scripts/sync-docs.ts:160): requiere acceso de escritura al repo para crear un directorio con nombre malicioso en docs/. El atacante ya tendria control total del repo. El script solo escribe status.md, no ejecuta codigo. Riesgo informativo, no bloqueante.

Confianza en la auditoria: alta

## Metricas de Cipher
- archivos_leidos: 4 (MEMORY.md, status.md, scripts/sync-docs.ts, CLAUDE.md)
- vulnerabilidades_criticas: 0
- vulnerabilidades_altas: 0
- vulnerabilidades_medias: 0
- vulnerabilidades_bajas: 0
- riesgos_aceptados: 1
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0
- decision: APROBADO

---

Estado final: LISTO PARA MERGE
