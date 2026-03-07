# Bug #001 — Mensaje de validación muestra caracteres corruptos

Estado: ABIERTO
Rama: bug/001-validacion-encoding-caracteres
Fecha apertura: 2026-03-07

---

## Info del bug

**Descripcion:** El mensaje de validación "Usa sólo letras minúsculas, números y guiones (ej. mi-agente)" se renderiza con caracteres corruptos: "Usa sￃﾳlo letras minￃﾺsculas, nￃﾺmeros y guiones". Síntoma típico de doble-encoding UTF-8.
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

→ Siguiente: @cloe Implementa el fix del bug #001. Las instrucciones estan en docs/bugs/001-validacion-encoding-caracteres/status.md seccion "Handoff Max → Cloe".

---

## Handoff Cloe → Max (verificacion)

> Cloe: completa esta seccion al terminar el fix. Max la lee para verificar.

**Archivos modificados:**

**Descripcion del fix aplicado:**

**Casos borde considerados:**

**Advertencias para Max:**

→ Siguiente: @max Verifica el fix del bug #001. El handoff de Cloe esta en docs/bugs/001-validacion-encoding-caracteres/status.md seccion "Handoff Cloe → Max".

---

## Resultado de verificacion (Max)

> Max: completa esta seccion al finalizar la verificacion.

**El bug esta resuelto:** SI / NO

**Casos probados:**

**Casos que aun fallan (si los hay):**

**Decision:**

**Requiere auditoria de Cipher:** SI / NO

---

Estado final: RESUELTO / REABIERTO

DONE. No invocar Ada ni Cipher salvo que "Requiere auditoria de Cipher" sea SI.
