# Observabilidad del pipeline de agentes

Este documento explica el sistema de observabilidad del pipeline Leo → Cloe → Max → Ada → Cipher: qué datos se recolectan, cómo se validan los handoffs, y cómo obtener métricas agregadas para mejorar el pipeline a lo largo del tiempo.

Para entender el flujo general de agentes, lee primero [AGENTS.md](./AGENTS.md).

---

## Por qué esto existe

Sin datos, no hay forma de saber si el pipeline funciona bien. Los problemas típicos sin observabilidad son:

- Un agente declara "listo" sin haber verificado realmente (alucinación silenciosa)
- Los handoffs son demasiado vagos y el siguiente agente tiene que adivinar el contexto
- Los mismos bugs o vulnerabilidades reaparecen en cada feature sin que nadie lo note
- No hay forma de saber cuál agente es el cuello de botella

Este sistema ataca esos cuatro problemas con tres mecanismos:

1. **Checklists binarios con evidencia** — anti-alucinación en cada agente
2. **`/validate-handoff`** — validación externa antes de pasar al siguiente agente
3. **`bun run metrics` + `/metrics-dashboard`** — vista agregada histórica

---

## Arquitectura: antes vs ahora

### Antes (v1 — self-reported, sin validación externa)

```
@leo → status.md (prosa libre) → @cloe → status.md (prosa libre) → @max → ...
         ↑                              ↑
    sin checklist                  sin evidencia
    sin gaps declarados            "QA aprobado" sin prueba
         ↓                              ↓
    medición solo con /measure-flow (manual, post-hoc, por feature)
    sin vista agregada entre features
    sin forma de detectar patrones sistémicos
```

**Problemas concretos del modelo anterior:**
- Los agentes se autocalificaban: Max podía escribir "QA aprobado" sin haber ejecutado nada
- Los handoffs eran prosa libre: "implementé la funcionalidad correctamente" no es verificable
- No había declaración de gaps: los agentes presentaban todo como certero
- `measure-flow` era la única métrica y había que ejecutarla manualmente al final
- No había vista agregada: no podías comparar el rendimiento entre features

### Ahora (v2 — checklists con evidencia + validación externa + métricas agregadas)

```
@leo ──→ Checklist Leo + gaps declarados
          ↓
     /validate-handoff <feature> leo  ←── validación externa antes de continuar
          ↓ PASA
@cloe ──→ Manifiesto de archivos (file:line) + Checklist Cloe + gaps declarados
          ↓
     /validate-handoff <feature> cloe
          ↓ PASA
@max ──→ Checklist con evidencia obligatoria + "No verificado por Max"
          ↓
     /validate-handoff <feature> max
          ↓ PASA
@ada ──→ Métricas bundle antes/después + Checklist Ada + "No optimizado"
          ↓
     /validate-handoff <feature> ada
          ↓ PASA
@cipher ─→ Checklist con evidencia (file:line) + Riesgos aceptados
          ↓
     bun run metrics  →  docs/metrics/dashboard-YYYY-MM-DD.md
     (acumula datos de todas las features y bugs)
```

**Diferencias clave:**

| Aspecto | v1 (antes) | v2 (ahora) |
|---|---|---|
| Verificación de handoffs | Ninguna — el agente dice que está listo | `/validate-handoff` detecta campos vacíos y template sin rellenar |
| Calidad de evidencia | Prosa libre ("lo hice bien") | Checklist con evidencia concreta (file:line, output de comando) |
| Incertidumbre | Oculta — los agentes presentan todo como certero | Explícita — sección de gaps obligatoria en cada handoff |
| Métricas | `/measure-flow` manual por feature | `bun run metrics` lee todas las features y bugs, genera historial |
| Vista agregada | Ninguna | Dashboard con tasas de rework, confianza, gaps, bloqueos |
| Detección de patrones | Manual, subjetiva | Automatizada con umbrales (OK / ⚠ / ❌) |
| Anti-alucinación | Ningún mecanismo | 3 mecanismos: checklist + gaps + validación externa |

---

## Los tres mecanismos en detalle

### 1. Checklists binarios con evidencia (en cada agente)

Cada agente tiene un checklist específico a su rol que debe completar antes de pasar al siguiente. La diferencia con listas genéricas es que **cada item requiere evidencia concreta**.

**Leo — checklist de planificación:**
```
- [ ] Cada archivo a crear/modificar tiene ruta absoluta desde repo root
- [ ] Contratos IPC escritos con tipos TypeScript completos inline
- [ ] Lista de archivos ordenada por prioridad de implementación
- [ ] Sin "ver plan.md" — todo el contexto inline en status.md
- [ ] Limitaciones de Electrobun verificadas (fire-and-forget en handlers)
- [ ] Decisiones de arquitectura con justificación explícita
```

**Cloe — manifiesto de archivos + checklist:**
```
### Manifiesto de archivos
| Archivo                  | Operación  | Líneas afectadas |
|--------------------------|------------|-----------------|
| src/ipc/handlers.ts      | modificado | 45-89           |
| src/renderer/chat.ts     | creado     | 1-120           |

- [ ] Fire-and-forget en todos los handlers IPC que lanzan subprocesos
- [ ] Input validation en todos los IPC handlers que tocan filesystem o spawn
```

**Max — checklist con evidencia obligatoria (el más crítico):**
```
- [ ] Flujo completo de generación de agente funciona — evidencia: [descripción del resultado]
- [ ] Chat con agente via ACP funciona — evidencia: [output observado]
- [ ] Cada archivo del manifiesto de Cloe verificado con file:line — evidencia: [lista]
```

**Ada — métricas antes/después:**
```
- [ ] bundle-check ejecutado ANTES — medición de base registrada
- [ ] bundle-check ejecutado DESPUÉS — comparación antes/después registrada
```

**Cipher — evidencia por cada item de seguridad:**
```
- [ ] agentName validado con /^[a-z0-9-]+$/ — evidencia: [file:line de la validación]
- [ ] Sin innerHTML con user input sin sanitizar — evidencia: [archivos auditados]
```

**Sección de gaps (todos los agentes):**

Cada agente declara explícitamente lo que no pudo verificar:
```
### Gaps y dudas de <Agente>
- [lo que no puedes confirmar]
Confianza general: alta / media / baja
```

Una confianza baja o gaps declarados no bloquean el pipeline — los registran para que el siguiente agente los verifique específicamente.

---

### 2. Skill `/validate-handoff` — validación externa

Antes de invocar al siguiente agente, ejecutar:

```
/validate-handoff <nombre-feature> <fase>
```

La skill lee el `status.md` y verifica:
- Todos los campos obligatorios tienen contenido real (no texto de plantilla)
- El checklist del agente tiene todos los `[x]` marcados
- Las referencias a archivos existen en el repo (para Cloe y Max)
- Los items del checklist de Max tienen evidencia en la columna derecha

**Posibles resultados:**
- `PASA` → invocar al siguiente agente
- `PASA_CON_WARNINGS` → revisar warnings, luego continuar
- `FALLA` → volver al agente con la lista de items a completar

**Flujo con validación:**
```
Leo termina  → /validate-handoff <f> leo  → PASA → @cloe
Cloe termina → /validate-handoff <f> cloe → PASA → @max
Max termina  → /validate-handoff <f> max  → PASA → @ada
Ada termina  → /validate-handoff <f> ada  → PASA → @cipher
```

---

### 3. Script de métricas agregadas

**Ejecutar:**
```bash
bun run metrics
# o con filtro de fechas:
bun run metrics --desde 2026-01-01 --hasta 2026-03-31
# o en JSON para procesar:
bun run metrics --json
```

**El script lee** todos los `docs/features/*/status.md` y `docs/bugs/*/status.md` y extrae los bloques `## Metricas de X`.

**Genera** `docs/metrics/dashboard-YYYY-MM-DD.md` con:
- Tasa de rework global y por agente
- Archivos promedio leídos por agente (proxy de contexto)
- Tasa de confianza baja (señal de alerta)
- Tasa de gaps declarados (umbral invertido: más alto es mejor)
- Tasa de bloqueo de Cipher
- Ahorro de bundle acumulado por Ada
- Vulnerabilidades críticas encontradas por Cipher

**También disponible como skill:**
```
/metrics-dashboard
/metrics-dashboard --desde 2026-01-01
```

---

## Cómo interpretar las métricas

### Umbrales

| Indicador | OK | ⚠ Warning | ❌ Crítico |
|---|---|---|---|
| Tasa de rework | < 20% | 20-40% | > 40% |
| Tasa confianza baja | < 10% | 10-25% | > 25% |
| **Tasa de gaps declarados** | **> 30%** | **15-30%** | **< 15%** |
| Tasa de bloqueo Cipher | < 15% | 15-30% | > 30% |
| Iteraciones promedio | ≤ 1.2 | 1.2-1.5 | > 1.5 |

> **Nota sobre gaps declarados:** el umbral está invertido. Una tasa alta de gaps declarados significa que los agentes son honestos sobre su incertidumbre — eso es bueno. Una tasa baja significa que declaran todo como certero, lo que es una señal de alucinación sistemática.

### Señales de alerta sistémicas

| Lo que ves | Qué significa | Qué hacer |
|---|---|---|
| Rework alto en Leo | Los planes de Leo son incompletos o incompatibles con el código real | Revisar si los gaps de Leo se mencionan en el handoff de Cloe |
| Rework alto en Cloe | Cloe no sigue las specs de Leo o las specs son ambiguas | Revisar calidad del checklist de Leo |
| Rework alto en Max | Max devuelve a Cloe frecuentemente — bugs sistemáticos | Revisar si Max está declarando evidencia o solo dice "falla" |
| Gaps bajos en todos | Los agentes no declaran incertidumbre — sospechoso | Revisar si los handoffs tienen la sección de gaps |
| Cipher bloquea > 30% | Vulnerabilidades recurrentes que llegan al final del pipeline | Añadir checks de seguridad en el checklist de Cloe |
| Archivos leídos > 10 en Leo | Leo explora demasiado antes de planificar | Revisar si el status.md anterior era incompleto |

---

## Dónde vive cada parte del sistema

```
.claude/
├── agents/
│   ├── leo.md          ← checklist de planificación + sección de gaps
│   ├── cloe.md         ← manifiesto de archivos + checklist + gaps
│   ├── max.md          ← checklist con evidencia obligatoria + "No verificado"
│   ├── ada.md          ← métricas antes/después + checklist + "No optimizado"
│   └── cipher.md       ← checklist con evidencia + riesgos aceptados
└── skills/
    ├── validate-handoff.md   ← validación externa pre-agente
    ├── metrics-dashboard.md  ← genera dashboard desde status.md files
    ├── measure-flow.md       ← reporte por feature individual (v1, sigue disponible)
    └── ...

scripts/
└── metrics.ts          ← script Bun que parsea todos los status.md

docs/
├── metrics/
│   └── dashboard-YYYY-MM-DD.md   ← generado por bun run metrics
├── features/*/status.md          ← fuente de datos (bloques ## Metricas de X)
└── bugs/*/status.md              ← fuente de datos
```

---

## Compatibilidad con el sistema anterior

El sistema v2 es completamente compatible hacia atrás:

- **`/measure-flow`** sigue funcionando igual — genera reporte por feature individual
- Los `status.md` existentes sin bloques de métricas estructuradas son ignorados por el script (no fallan)
- Los agentes que no tengan las secciones nuevas siguen funcionando — las secciones son aditivas
- El flujo `@leo → @cloe → @max → @ada → @cipher` no cambia — solo se añade `/validate-handoff` entre pasos

Los status.md generados a partir de ahora (con el template actualizado en `/feature` y `/bug`) tendrán la estructura completa. Los status.md antiguos seguirán siendo legibles pero no aportarán datos al dashboard.
