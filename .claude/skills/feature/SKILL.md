# Skill: feature

Abre una nueva feature, crea la rama y el status.md inicial, y encadena el flujo Leo → Cloe → Max → Ada → Cipher.

## Uso

```
/feature <descripcion breve de la feature>
```

Ejemplo:
```
/feature Añadir autenticacion con OAuth2 a la app desktop
```

## Procedimiento

### 1. Generar el slug

A partir de la descripcion de la feature, crear un slug lowercase con guiones. Maximo 5 palabras, sin articulos ni preposiciones.

Ejemplo: "Añadir autenticacion con OAuth2 a la app desktop" → `autenticacion-oauth2-app-desktop`

### 2. Crear la rama git

```bash
git switch -c feature/<slug>
```

Ejemplo: `git switch -c feature/autenticacion-oauth2-app-desktop`

### 3. Crear la carpeta y el status.md inicial

```bash
mkdir -p docs/features/<slug>
```

Crear `docs/features/<slug>/status.md` con la estructura definida en la seccion "Estructura del status.md" de este documento. Completar solo la seccion "Info de la feature" — las demas secciones quedan como plantilla para que los agentes las rellenen.

### 4. Confirmar al usuario

Imprimir en el chat:

```
Feature registrada.
Rama: feature/<slug>
Status: docs/features/<slug>/status.md

Siguiente: @leo <descripcion de la feature>. El status esta en docs/features/<slug>/status.md
```

---

## Estructura del status.md

```markdown
# Feature — <descripcion breve>

Estado: EN PLANIFICACION
Rama: feature/<slug>
Fecha apertura: <fecha hoy YYYY-MM-DD>

---

## Info de la feature

**Descripcion:** <descripcion completa tal como la dio el usuario>
**Objetivo:** (Leo completa esto)
**Restricciones conocidas:** (anotar si el usuario menciono alguna)

---

## Handoff Leo → Cloe

> Leo: completa esta seccion con el plan de implementacion. Cloe lee esto para implementar.

**Que crear y en que orden:**

**Reglas que Cloe debe respetar:**
- No romper el flujo CLI existente (bun run dev, bun run chat)
- Mantener type safety en IPC si la feature toca comunicacion main-renderer
- (Leo añade reglas especificas de la feature)

**Tipos TypeScript necesarios:**

**Patrones de implementacion clave:**

→ Siguiente: @cloe Implementa la feature. Las instrucciones estan en docs/features/<slug>/status.md seccion "Handoff Leo → Cloe".

## Metricas de Leo
- archivos_leidos:
- archivos_creados:
- archivos_modificados:
- rework: no
- iteraciones: 1
- confianza:
- gaps_declarados:

---

## Handoff Cloe → Max

> Cloe: completa esta seccion al terminar la implementacion. Max la lee para verificar.

**Archivos creados/modificados:**

**Descripcion de lo implementado:**

**Casos borde considerados:**

**Advertencias para Max:**

→ Siguiente: @max Verifica la feature. El handoff de Cloe esta en docs/features/<slug>/status.md seccion "Handoff Cloe → Max".

## Metricas de Cloe
- archivos_leidos:
- archivos_creados:
- archivos_modificados:
- rework: no
- iteraciones: 1
- confianza:
- gaps_declarados:

---

## Handoff Max → Ada

> Max: completa esta seccion al aprobar la implementacion. Ada la lee para optimizar.

**Resultado de la verificacion:** APROBADO / RECHAZADO

**Casos probados:**

**Issues encontrados (si los hay):**

**Tiene implicaciones de seguridad:** SI / NO

→ Siguiente: @ada Optimiza la feature. Max aprobo — ver docs/features/<slug>/status.md seccion "Handoff Max → Ada".

## Metricas de Max
- archivos_leidos:
- bugs_criticos:
- bugs_altos:
- items_checklist_verificados:
- rework: no
- iteraciones: 1
- confianza:
- gaps_declarados:

---

## Handoff Ada → Cipher

> Ada: completa esta seccion al terminar la optimizacion. Cipher la lee para auditar.

**Optimizaciones aplicadas:**

**Bundle size antes/despues:**

**Deuda tecnica eliminada:**

→ Siguiente: @cipher Audita la feature antes del release. Ver docs/features/<slug>/status.md seccion "Handoff Ada → Cipher".

## Metricas de Ada
- archivos_leidos:
- archivos_modificados:
- bundle_antes_mb:
- bundle_despues_mb:
- optimizaciones_aplicadas:
- optimizaciones_descartadas:
- rework: no
- iteraciones: 1
- confianza:
- gaps_declarados:

---

## Resultado de Cipher

> Cipher: completa esta seccion al finalizar la auditoria.

**Vulnerabilidades encontradas:**

**Decision:** APROBADO PARA MERGE / BLOQUEADO

## Metricas de Cipher
- archivos_leidos:
- vulnerabilidades_criticas:
- vulnerabilidades_altas:
- vulnerabilidades_medias:
- riesgos_aceptados:
- rework: no
- iteraciones: 1
- confianza:
- gaps_declarados:
- decision: APROBADO / APROBADO_CON_RIESGOS / BLOQUEADO

---

Estado final: EN PLANIFICACION / EN IMPLEMENTACION / EN QA / EN OPTIMIZACION / EN AUDITORIA / LISTO PARA MERGE
```

---

## Reglas del flujo de features

- Leo planifica primero. No invocar Cloe sin que Leo entregue el handoff.
- Cloe implementa siguiendo estrictamente el handoff de Leo.
- Max verifica antes de pasar a Ada. Si rechaza, repetir ciclo Cloe → Max sin reiniciar desde Leo.
- Ada optimiza solo despues de que Max apruebe. No refactorizar codigo con bugs no resueltos.
- Cipher audita siempre, antes de cualquier merge a main.
- El status.md dirige el flujo. Los agentes no necesitan instrucciones adicionales del usuario.
