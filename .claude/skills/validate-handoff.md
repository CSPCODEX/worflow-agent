# Skill: validate-handoff

Valida que el handoff de un agente esta completo antes de invocar al siguiente. Detecta campos vacios, texto de plantilla sin rellenar, y gaps sin declarar.

## Uso

```
/validate-handoff <nombre-feature> <fase>
```

Donde `<fase>` es: `leo`, `cloe`, `max`, `ada`

Ejemplo:
```
/validate-handoff autenticacion-oauth2 leo
```

Esto valida el handoff de Leo antes de invocar a Cloe.

## Procedimiento

### 1. Leer el status.md

Leer `docs/features/<nombre-feature>/status.md` completo.

### 2. Identificar la seccion a validar

Segun la fase indicada, buscar la seccion correspondiente:
- `leo` → "Handoff Leo → Cloe"
- `cloe` → "Handoff Cloe → Max"
- `max` → "Handoff Max → Ada"
- `ada` → "Handoff Ada → Cipher"

### 3. Verificar campos obligatorios

Para cada campo en la seccion, verificar que:
- No esta vacio
- No contiene texto de plantilla sin rellenar (patrones como "(Leo completa esto)", "(Max completa esto)", "TBD", "pendiente", o parentesis vacios)
- Tiene contenido sustantivo (mas de 10 caracteres)

### 4. Verificar el checklist del agente

Buscar la seccion "Checklist <Agente>" dentro del handoff:
- Contar items marcados `[x]` vs items sin marcar `[ ]`
- Si hay items `[ ]`, reportarlos como bloqueantes a menos que esten en la seccion "No verificado"

### 5. Verificar referencias de archivos (para cloe y max)

Si la fase es `cloe`:
- Buscar el "Manifiesto de archivos" en el handoff
- Para cada archivo listado, verificar que existe en el repo con Glob

Si la fase es `max`:
- Verificar que cada item del checklist tiene evidencia (texto despues de "— evidencia:")
- Evidencias vacias o con solo "pendiente" son bloqueantes

### 6. Verificar gaps declarados

Buscar la seccion "Gaps y dudas de <Agente>" o "No verificado por Max" o "No optimizado por Ada":
- Si la seccion no existe, marcar como WARNING (no FALLO — el agente puede no haber tenido gaps)
- Si existe pero esta vacia sin "Ninguno.", marcar como WARNING

### 7. Generar reporte

```
## Validacion de handoff — <nombre-feature> / fase: <fase>
Fecha: <hoy>
Resultado: PASA / FALLA / PASA_CON_WARNINGS

### Campos verificados
- Campos completos: N/M
- Campos vacios o con plantilla: [lista]

### Checklist del agente
- Items marcados [x]: N/M
- Items sin evidencia (bloqueantes): [lista si los hay]

### Referencias de archivos
- Archivos en manifiesto: N
- Archivos verificados en repo: N
- Archivos no encontrados: [lista si los hay]

### Gaps declarados
- Seccion de gaps: presente / ausente
- Confianza declarada por el agente: alta / media / baja

### Veredicto
PASA: el handoff esta completo. Invocar al siguiente agente.
PASA_CON_WARNINGS: el handoff esta mayormente completo pero hay items menores. Revisar warnings antes de continuar.
FALLA: el handoff tiene campos vacios o evidencias faltantes. El agente debe completarlo antes de continuar.

### Items a completar (si FALLA o PASA_CON_WARNINGS)
- [descripcion concreta de lo que falta]
```

## Reglas de veredicto

- **FALLA** si: hay campos vacios, texto de plantilla sin rellenar, checklist con `[ ]` sin justificacion, o referencias de archivos que no existen en el repo
- **PASA_CON_WARNINGS** si: la seccion de gaps no existe, o la confianza declarada es "baja"
- **PASA** si: todo lo anterior esta completo y correcto

## Cuando invocar esta skill

Invocar despues de que cada agente completa su trabajo y antes de invocar al siguiente:

```
Leo termina → /validate-handoff <feature> leo → si PASA → @cloe
Cloe termina → /validate-handoff <feature> cloe → si PASA → @max
Max termina → /validate-handoff <feature> max → si PASA → @ada
Ada termina → /validate-handoff <feature> ada → si PASA → @cipher
```

Si el resultado es FALLA, volver al agente anterior con la lista de items a completar.
