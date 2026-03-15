# Skill: bug

Abre un bug report, crea la rama y el status.md, y encadena el flujo Max → Cloe → Max.

## Uso

```
/bug <descripcion breve del bug>
```

Ejemplo:
```
/bug El panel de agentes no carga cuando LM Studio no esta corriendo
```

## Procedimiento

### 1. Generar el ID del bug

Contar cuantas carpetas existen en `docs/bugs/`:

```bash
ls docs/bugs/ 2>/dev/null | wc -l
```

El ID es ese numero + 1, formateado con tres digitos. Si no existe `docs/bugs/`, el primer ID es `001`.

Ejemplos: `001`, `002`, `042`.

### 2. Generar el slug

A partir de la descripcion del bug, crear un slug lowercase con guiones. Maximo 5 palabras, sin articulos ni preposiciones.

Ejemplo: "El panel de agentes no carga cuando LM Studio no esta corriendo" → `panel-agentes-no-carga-lm-studio`

### 3. Crear la rama git

```bash
git switch -c bug/<id>-<slug>
```

Ejemplo: `git switch -c bug/042-panel-agentes-no-carga-lm-studio`

### 4. Crear la carpeta y el status.md

```bash
mkdir -p docs/bugs/<id>-<slug>
```

Crear `docs/bugs/<id>-<slug>/status.md` con la estructura definida en la seccion "Estructura del status.md" de este documento. Completar solo la seccion "Info del bug" — las demas secciones quedan como plantilla para que Max y Cloe las rellenen.

### 5. Confirmar al usuario

Imprimir en el chat:

```
Bug #<id> registrado.
Rama: bug/<id>-<slug>
Status: docs/bugs/<id>-<slug>/status.md

Siguiente: @max Diagnostica el bug #<id>. El status esta en docs/bugs/<id>-<slug>/status.md
```

---

## Estructura del status.md

```markdown
# Bug #<id> — <descripcion breve>

Estado: ABIERTO
Rama: bug/<id>-<slug>
Fecha apertura: <fecha hoy YYYY-MM-DD>

---

## Info del bug

**Descripcion:** <descripcion completa tal como la dio el usuario>
**Como reproducir:** (Max completa esto)
**Comportamiento esperado:** (Max completa esto)
**Comportamiento actual:** (Max completa esto)
**Severidad:** (Max completa esto — CRITICA / ALTA / MEDIA / BAJA)
**Tiene implicaciones de seguridad:** (Max indica SI o NO)

---

## Handoff Max → Cloe

> Max: completa esta seccion despues de diagnosticar. Cloe lee esto para implementar el fix.

**Causa raiz identificada:**

**Archivos involucrados:**

**Fix propuesto:**

**Reglas que Cloe debe respetar:**
- No romper el flujo CLI existente (bun run dev, bun run chat)
- Mantener type safety en IPC si el fix toca comunicacion main-renderer
- (Max añade reglas especificas del bug)

**Criterios de verificacion para Max:**
- (Max define como va a verificar que el fix funciona)

→ Siguiente: @cloe Implementa el fix del bug #<id>. Las instrucciones estan en docs/bugs/<id>-<slug>/status.md seccion "Handoff Max → Cloe".

## Metricas de Max (diagnostico)
- archivos_leidos:
- bugs_criticos:
- bugs_altos:
- items_checklist_verificados:
- rework: no
- iteraciones: 1
- confianza:
- gaps_declarados:

---

## Handoff Cloe → Max (verificacion)

> Cloe: completa esta seccion al terminar el fix. Max la lee para verificar.

**Archivos modificados:**

**Descripcion del fix aplicado:**

**Casos borde considerados:**

**Advertencias para Max:**

→ Siguiente: @max Verifica el fix del bug #<id>. El handoff de Cloe esta en docs/bugs/<id>-<slug>/status.md seccion "Handoff Cloe → Max".

## Metricas de Cloe
- archivos_leidos:
- archivos_creados:
- archivos_modificados:
- rework: no
- iteraciones: 1
- confianza:
- gaps_declarados:

---

## Resultado de verificacion (Max)

> Max: completa esta seccion al finalizar la verificacion.

**El bug esta resuelto:** SI / NO

**Casos probados:**

**Casos que aun fallan (si los hay):**

**Decision:**

<!-- Si hay implicaciones de seguridad, marcar aqui -->
**Requiere auditoria de Cipher:** SI / NO
<!-- SI solo si "Tiene implicaciones de seguridad" = SI en la seccion Info -->

## Metricas de Max (verificacion)
- archivos_leidos:
- bugs_criticos:
- bugs_altos:
- items_checklist_verificados:
- rework: no
- iteraciones: 1
- confianza:
- gaps_declarados:

---

Estado final: RESUELTO / REABIERTO

DONE. No invocar Ada ni Cipher salvo que "Requiere auditoria de Cipher" sea SI.
```

---

## Reglas del flujo de bugs

- Max diagnostica primero. No invocar Leo — no hay arquitectura que planificar en un bug.
- Ada NO entra en bugs. Optimizar un bugfix es prematuro y arriesga introducir regresiones.
- Cipher entra SOLO si Max marca "Requiere auditoria de Cipher: SI" en el resultado final.
- Si Max cierra el bug como REABIERTO, repetir solo el ciclo Cloe → Max. No reiniciar desde el principio.
- El status.md dirige el flujo. Los agentes no necesitan instrucciones adicionales del usuario.
