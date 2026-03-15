# Bug #012 — Cipher no aparece en la columna HANDOFFS del monitor

Estado: MERGEADO
Rama: bug/012-cipher-falta-columna-handoffs
Fecha merge: 2026-03-15
Fecha apertura: 2026-03-15

---

## Info del bug

**Descripcion:** El monitor muestra la cadena de handoffs como L > C > M > A pero Cipher nunca aparece. La cadena deberia ser L > C > M > A > Ci. El ultimo agente del pipeline (Cipher) queda invisible porque la funcion `handoffIcons` en `monitor-view.ts` renderiza un nodo por handoff (4 nodos para 4 pares) en lugar de un nodo por agente (5 nodos para 5 agentes). El label 'Ci' en el array existe pero nunca se usa porque el map termina en el index 3.

**Como reproducir:**
1. Abrir el monitor de pipeline (tab "Pipeline")
2. Observar la columna "Handoffs" en cualquier feature con al menos una seccion de handoff escrita
3. La cadena muestra L > C > M > A — el nodo Ci no aparece nunca

**Comportamiento esperado:** La columna Handoffs muestra 5 nodos: L > C > M > A > Ci. El ultimo nodo (Ci) refleja el estado del handoff ada->cipher: clase "done" si completed=true, "pending" si false.

**Comportamiento actual:** La columna Handoffs muestra 4 nodos: L > C > M > A. Cipher queda completamente invisible sin importar el estado de la feature.

**Severidad:** MEDIA — es un error de display puro, no afecta datos ni IPC ni filesystem. Cipher existe en la DB y en los datos; solo falta la representacion visual.

**Tiene implicaciones de seguridad:** NO

---

## Handoff Max -> Cloe

**Causa raiz identificada:**
`handoffIcons` en `src/monitor/ui/monitor-view.ts:51-62` itera con `.map()` sobre el array de handoffs, que tiene exactamente 4 elementos (uno por par del pipeline). El array `labels = ['L', 'C', 'M', 'A', 'Ci']` tiene 5 entradas, pero el map produce solo 4 nodos (indices 0..3). `labels[4]` = `'Ci'` nunca se accede porque no hay un quinto elemento en el array de handoffs sobre el que iterar.

El source de datos es correcto: `PIPELINE_PAIRS` en `src/monitor/core/statusParser.ts:77-82` define los 4 pares correctos. El problema es estrictamente de render: se necesita un quinto nodo para el agente destino final.

**Archivos involucrados:**
- `src/monitor/ui/monitor-view.ts` — funcion `handoffIcons` (lineas 51-62) — UNICO archivo a tocar

**Fix propuesto:**
Modificar `handoffIcons` para que, despues del `.map()` sobre los 4 handoffs, anada un quinto nodo extra para Cipher. El estado del nodo Ci se infiere del ultimo handoff (`handoffs[handoffs.length - 1]`):
- Si `lastHandoff.completed === true` → clase `done`
- Si `lastHandoff.hasRework === true` → clase `rework`
- Si no → clase `pending`
- El titulo del nodo: `Ci: destino final del pipeline`
- Sin flecha despues del nodo Ci (ya es el ultimo)

La logica actual del arrow ya es correcta para los nodos intermedios: `i < handoffs.length - 1`. Solo hay que anadir el nodo final fuera del map.

Pseudocodigo del fix:
```
function handoffIcons(handoffs: HandoffStatusIPC[]): string {
  const labels = ['L', 'C', 'M', 'A', 'Ci'];
  const icons = handoffs.map((h, i) => {
    const label = labels[i] ?? '?';
    const cls = h.hasRework ? 'rework' : h.completed ? 'done' : 'pending';
    const title = `${h.from}->${h.to}: ${h.completed ? 'completo' : 'pendiente'}${h.hasRework ? ' (rework)' : ''}`;
    const arrow = '<span class="monitor-handoff-arrow">></span>';  // siempre tiene flecha (hay un nodo mas despues)
    return `<span class="monitor-handoff-icon ${cls}" title="${title}">${label}</span>${arrow}`;
  });

  // Nodo final: Cipher (destino — no es origen de ningun handoff)
  const last = handoffs[handoffs.length - 1];
  const lastCls = last ? (last.hasRework ? 'rework' : last.completed ? 'done' : 'pending') : 'pending';
  icons.push(`<span class="monitor-handoff-icon ${lastCls}" title="Ci: destino final del pipeline">Ci</span>`);

  return `<div class="monitor-handoffs">${icons.join('')}</div>`;
}
```

IMPORTANTE: el arrow de los nodos del map debe ser siempre presente (ya no es condicional) porque ahora siempre hay un nodo siguiente (el Ci). La condicion `i < handoffs.length - 1` ya no aplica.

**Reglas que Cloe debe respetar:**
- No romper el flujo CLI existente (bun run dev, bun run chat)
- Solo tocar `src/monitor/ui/monitor-view.ts` — el bug es de render puro, no tocar parser ni types
- No cambiar la logica de `hasAnyRework` — esa funcion es correcta
- No cambiar el CSS de `.monitor-handoff-icon` — las clases `done`, `rework`, `pending` ya existen en monitor-styles.css
- El nodo Ci no lleva flecha despues de el (es el ultimo)
- Si el array `handoffs` esta vacio (caso edge improbable), el fallback debe ser un solo nodo Ci con clase `pending`

**Criterios de verificacion para Max:**
1. Con una feature que tenga el handoff ada->cipher completo: el nodo Ci aparece con clase `done`
2. Con una feature que NO tenga ningun handoff completo: aparecen 5 nodos, todos con clase `pending`
3. Con una feature que tenga rework en ada->cipher: el nodo Ci aparece con clase `rework`
4. La cadena tiene exactamente 4 flechas entre los 5 nodos (no 3 como antes)
5. `bun run tsc --noEmit` sin errores nuevos en `monitor-view.ts`
6. No hay cambios en archivos fuera de `monitor-view.ts`

→ Siguiente: @cloe Implementa el fix del bug #012. Las instrucciones estan en docs/bugs/012-cipher-falta-columna-handoffs/status.md seccion "Handoff Max -> Cloe".

## Metricas de Max (diagnostico)
- archivos_leidos: 5
- bugs_criticos: 0
- bugs_altos: 0
- bugs_medios: 1
- items_checklist_verificados: 3/3
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0

---

## Handoff Cloe → Max (verificacion)

> Cloe: completa esta seccion al terminar el fix. Max la lee para verificar.

**Archivos modificados:**

| Archivo | Operacion | Lineas afectadas |
|---------|-----------|-----------------|
| `src/monitor/ui/monitor-view.ts` | modificado | 71 (guard nulidad en `lastCls`) |

**Descripcion del fix aplicado:**

Rework puntual sobre la linea 71. El error TS era: `Object is possibly 'undefined'` porque `handoffs[handoffs.length - 1]` puede ser `undefined` si el array esta vacio, y TypeScript no puede estrecharlo solo con la asignacion.

Fix aplicado (cambio de 1 linea):

```
// antes (falla tsc — last puede ser undefined):
const lastCls = last.hasRework ? 'rework' : last.completed ? 'done' : 'pending';

// despues (guard nulidad — tsc limpio):
const lastCls = last ? (last.hasRework ? 'rework' : last.completed ? 'done' : 'pending') : 'pending';
```

El guard `last ?` cubre el edge case `handoffs.length === 0` y satisface al type checker sin cambiar el comportamiento en el caso normal (array no vacio).

**Casos borde considerados:**

- `handoffs` vacio: `last` es `undefined`, `lastCls` cae a `'pending'` — correcto.
- `handoffs` con 1 o mas elementos: comportamiento identico al de la primera entrega.

**Advertencias para Max:**

- Los errores de tsc reportados pertenecen a `scripts/metrics.ts` — son preexistentes, no regresiones.
- No se toco ningun archivo fuera de `monitor-view.ts`.

### Checklist Cloe
- [x] Manifiesto completo: cada archivo creado/modificado con ruta absoluta y lineas afectadas
- [x] Tipos TypeScript implementados segun contratos de Leo (o documentado por que difieren)
- [x] bun run tsc --noEmit ejecutado — 0 errores nuevos antes de entregar
- [x] Strings que viajan por IPC son ASCII puro (sin tildes, acentos ni chars > 0x7E)
- [x] Fire-and-forget en todos los handlers IPC que lanzan subprocesos (no aplica — cambio de render puro)
- [x] Input validation en todos los IPC handlers que tocan filesystem o spawn (no aplica)
- [x] DB: si INSERT falla despues de scaffold, rollback del directorio creado (no aplica)
- [x] initDatabase() en try/catch con process.exit(1) si lanza (no aplica)
- [x] Sin `any` sin justificacion escrita en el handoff
- [x] Labels HTML: todos tienen for+id matching, ningun input sin label (no aplica — no hay forms nuevos)
- [x] Si creaste vistas nuevas: todas las clases CSS usadas en innerHTML existen en style.css (no aplica — sin clases nuevas)

### Gaps y dudas de Cloe

Sin gaps porque: fix de 1 linea — guard nulidad en ternario, tsc limpio, sin logica nueva ni CSS ni IPC.

Confianza en la implementacion: alta

→ Siguiente: @max Verifica el fix del bug #012 (rework). Cambio en linea 71 de `src/monitor/ui/monitor-view.ts`. El handoff de Cloe esta en docs/bugs/012-cipher-falta-columna-handoffs/status.md.

## Metricas de Cloe
- archivos_leidos: 2
- archivos_creados: 0
- archivos_modificados: 1
- rework: si (iteracion 2 — guard nulidad en lastCls)
- iteraciones: 2
- confianza: alta
- gaps_declarados: 0

---

## Resultado de verificacion (Max)

**El bug esta resuelto:** SI

**Casos probados (analisis estatico):**

1. handoff ada->cipher con `completed=true`, `hasRework=false`:
   - `last` = `{ completed: true, hasRework: false, ... }`
   - `lastCls` = `'done'` (ternario: `last.hasRework` false → `last.completed` true → `'done'`)
   - Nodo Ci renderiza con clase `done` — CORRECTO
   - Evidencia: `monitor-view.ts:71`

2. 4 handoffs todos con `completed=false`, `hasRework=false`:
   - Map produce 4 nodos + 4 flechas (arrow constante, no condicional)
   - Nodo Ci extra agregado con `lastCls='pending'`
   - Total: 5 nodos, 4 flechas — CORRECTO
   - Evidencia: `monitor-view.ts:54,61-67,72`

3. handoff ada->cipher con `hasRework=true`:
   - `lastCls` = `'rework'` (primer branch del ternario) — CORRECTO
   - Evidencia: `monitor-view.ts:71`

4. `handoffs.length === 0` (edge case):
   - Guard en linea 56 retorna early: `<div class="monitor-handoffs"><span class="monitor-handoff-icon pending"...>Ci</span></div>`
   - Un solo nodo Ci con clase `pending` — CORRECTO
   - Evidencia: `monitor-view.ts:56-59`

5. Conteo de flechas: arrow constante `'<span class="monitor-handoff-arrow">></span>'` se incluye en TODOS los nodos del map (4 nodos), pero NO en el nodo Ci. Total = 4 flechas. Antes eran 3 (con `i < handoffs.length - 1`). — CORRECTO
   - Evidencia: `monitor-view.ts:54,66`

**Casos que aun fallan:** Ninguno.

**Checklist Max — bloques activos: ESTATICO**

## ESTATICO
- [x] Archivo del manifiesto verificado con file:line — evidencia: `src/monitor/ui/monitor-view.ts:51-75` leido completo
- [x] bun run tsc --noEmit — 0 errores nuevos en `src/monitor/` — evidencia: `grep "src/monitor"` sobre output tsc → sin resultados
- [x] Sin logica de negocio rota en los archivos modificados — evidencia: los 5 criterios de aceptacion verificados estaticamente arriba; la logica de `hasAnyRework` (linea 77-79) no fue tocada; CSS classes `done`, `rework`, `pending`, `monitor-handoffs`, `monitor-handoff-arrow` existen en `monitor-styles.css:199,205,217,222,227,232`

### No verificado por Max
- Verificacion runtime en el monitor del desktop (`bun run desktop`): el worktree tiene cambios de otras features no commitadas que impiden un arranque limpio del build para este bug en aislamiento. El analisis estatico cubre los 5 criterios de aceptacion con certeza logica.

Confianza en la verificacion: alta

**Decision:** QA aprobado — bug #012 resuelto. El fix es correcto, minimo (1 linea de rework sobre la primera entrega), tsc limpio, CSS consistente, todos los casos de aceptacion pasan por analisis estatico.

**Requiere auditoria de Cipher:** NO — es un bug de display puro, sin cambios en IPC, filesystem, DB ni secrets.

## Metricas de Max (verificacion)
- archivos_leidos: 3
- bugs_criticos: 0
- bugs_altos: 0
- items_checklist_verificados: 3/3
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 1

---

Estado final: MERGEADO
