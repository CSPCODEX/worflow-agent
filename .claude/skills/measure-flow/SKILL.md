---
name: measure-flow
description: Lee el status.md de una feature o bug y genera un reporte de eficiencia del flujo de agentes — rework, iteraciones, cuellos de botella y gaps.
argument-hint: "[nombre-feature-o-bug]"
---

# Skill: measure-flow

Lee el status.md de una feature y genera un reporte de eficiencia del flujo de agentes.

## Uso

Invocar con el nombre de la feature o bug:
```
/measure-flow electrobun-migration
/measure-flow 007-delete-agent-ui-broken
```

## Procedimiento

### 1. Leer el status.md

Intentar leer en este orden:
1. `docs/features/<nombre>/status.md`
2. `docs/bugs/<nombre>/status.md`

### 2. Extraer metricas por agente

Para cada agente que completo su fase, extraer del bloque "Metricas de X":
- `archivos_leidos` — proxy de carga de contexto
- `archivos_creados` / `archivos_modificados` — volumen de trabajo
- `rework` — si tuvo que repetir trabajo (indica calidad del handoff anterior)
- `iteraciones` — cuantas veces entro el agente a esta feature
- campos especificos de cada rol (bugs, bundle, vulnerabilidades)

### 3. Calcular indicadores

**Indicador de contexto por agente:**
- <= 5 archivos leidos: EFICIENTE
- 6-10 archivos leidos: ACEPTABLE
- > 10 archivos leidos: EXCESIVO — revisar el handoff

**Indicador de calidad de handoff:**
- rework: no en todos los agentes = HANDOFF EXCELENTE
- rework: si en 1 agente = HANDOFF MEJORABLE
- rework: si en 2+ agentes = HANDOFF DEFICIENTE — revisar status.md

**Indicador de eficiencia del ciclo:**
- iteraciones = 1 en todos = CICLO LIMPIO
- iteraciones > 1 en algun agente = CUELLO DE BOTELLA — identificar agente

**Indicador de calidad de implementacion:**
- bugs_criticos de Max = 0: BUENA IMPLEMENTACION
- bugs_criticos > 0: IMPLEMENTACION A MEJORAR
- vulnerabilidades_criticas de Cipher = 0: SEGURIDAD OK
- vulnerabilidades_criticas > 0: BLOQUEO DE RELEASE

### 4. Generar reporte

Formato del reporte:

```
## Reporte de flujo — <nombre>
Fecha: <hoy>
Fases completadas: X/5

### Resumen por agente
| Agente | Archivos leidos | Rework | Iteraciones | Estado |
|--------|----------------|--------|-------------|--------|
| Leo    | X              | no     | 1           | OK     |
| Cloe   | X              | si/no  | X           | OK/⚠   |
| Max    | X              | si/no  | X           | OK/⚠   |
| Ada    | X              | si/no  | X           | OK/⚠   |
| Cipher | X              | si/no  | X           | OK/⚠   |

### Indicadores del ciclo
- Contexto: EFICIENTE / ACEPTABLE / EXCESIVO
- Handoffs: EXCELENTE / MEJORABLE / DEFICIENTE
- Ciclo: LIMPIO / con cuellos de botella en [agente]
- Calidad: bugs criticos X, vulnerabilidades criticas X

### Cuellos de botella detectados
- [descripcion del problema y que agente lo causo]

### Recomendaciones
- [cambios concretos al flujo o a los prompts de los agentes para mejorar]
```

### 5. Guardar el reporte

Escribir el reporte en `docs/features/<nombre>/flow-report.md` o `docs/bugs/<nombre>/flow-report.md` segun corresponda.

Si el reporte revela problemas sistematicos (rework en 2+ features, contexto excesivo recurrente), proponer cambios al sistema de agentes.
