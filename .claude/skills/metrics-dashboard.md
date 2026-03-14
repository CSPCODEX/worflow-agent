# Skill: metrics-dashboard

Genera un dashboard agregado de metricas del pipeline de agentes leyendo todos los status.md de features y bugs completados.

## Uso

```
/metrics-dashboard
```

Opcional — filtrar por rango de fechas:
```
/metrics-dashboard --desde 2026-01-01 --hasta 2026-03-31
```

## Procedimiento

### 1. Descubrir todos los status.md

```bash
# Features
find docs/features -name "status.md" 2>/dev/null

# Bugs
find docs/bugs -name "status.md" 2>/dev/null
```

O ejecutar el script agregado:
```bash
bun run scripts/metrics.ts
```

### 2. Si el script esta disponible

Ejecutar `bun run scripts/metrics.ts` y mostrar su output directamente.

### 3. Si el script no esta disponible (fallback manual)

Leer cada status.md y extraer los bloques "Metricas de X". Calcular manualmente los indicadores de la seccion siguiente.

### 4. Calcular indicadores agregados

**Tasa de rework por agente:**
- (features con rework: si en agente X) / (total features con ese agente) * 100

**Archivos promedio leidos por agente:**
- suma(archivos_leidos de cada sesion) / numero de sesiones

**Tasa de confianza baja:**
- (sesiones con confianza: baja) / total sesiones * 100

**Tasa de gaps declarados:**
- (sesiones con gaps_declarados > 0) / total sesiones * 100
- Un valor bajo aqui es una señal de alerta — los agentes pueden estar ocultando incertidumbre

**Distribucion de bugs por fase donde se detectaron:**
- Cuantos bugs encontro Max que Cloe no detecto
- Cuantos encontro Cipher que pasaron por Max
- (bugs en produccion no detectados = riesgo sistematico)

**Tasa de bloqueo de Cipher:**
- (features bloqueadas por Cipher) / (features auditadas) * 100

**Velocidad del pipeline:**
- Promedio de iteraciones por agente (> 1 indica cuellos de botella)

### 5. Generar reporte

```
## Dashboard de metricas — <fecha>
Periodo: <desde> — <hasta>
Features analizadas: N | Bugs analizados: N

### Salud del pipeline
| Indicador                        | Valor  | Estado   |
|----------------------------------|--------|----------|
| Tasa de rework global            | X%     | OK / ⚠ / ❌ |
| Tasa de confianza baja           | X%     | OK / ⚠ / ❌ |
| Tasa de gaps declarados          | X%     | OK / ⚠ / ❌ |
| Tasa de bloqueo Cipher           | X%     | OK / ⚠ / ❌ |
| Iteraciones promedio por agente  | X      | OK / ⚠ / ❌ |

### Rework por agente
| Agente | Sesiones | Con rework | Tasa |
|--------|----------|------------|------|
| Leo    | N        | N          | X%   |
| Cloe   | N        | N          | X%   |
| Max    | N        | N          | X%   |
| Ada    | N        | N          | X%   |
| Cipher | N        | N          | X%   |

### Contexto por agente (archivos promedio leidos)
| Agente | Min | Promedio | Max | Estado     |
|--------|-----|----------|-----|------------|
| Leo    | N   | N        | N   | EFICIENTE / ACEPTABLE / EXCESIVO |
| ...    |     |          |     |            |

### Gaps declarados por agente
| Agente | Total gaps declarados | Promedio por sesion |
|--------|-----------------------|---------------------|
| Leo    | N                     | X                   |
| ...    |                       |                     |
Nota: gaps_declarados bajos pueden indicar que los agentes ocultan incertidumbre.

### Patrones de fallo recurrentes
(extraidos de las secciones "No verificado" y "Riesgos aceptados" de los status.md)
1. [patron mas comun]
2. [segundo patron]

### Cuellos de botella
(agentes con iteraciones > 1 en mas de una feature)
- [agente]: [descripcion del patron]

### Recomendaciones
1. [cambio concreto al flujo o prompt del agente con mayor tasa de rework]
2. [cambio para el agente con mas gaps no declarados]
```

### 6. Guardar el reporte

Escribir en `docs/metrics/dashboard-<fecha-hoy>.md`.

Crear la carpeta si no existe:
```bash
mkdir -p docs/metrics
```

---

## Umbrales de estado

| Indicador | OK | WARNING ⚠ | CRITICO ❌ |
|---|---|---|---|
| Tasa de rework | < 20% | 20-40% | > 40% |
| Tasa confianza baja | < 10% | 10-25% | > 25% |
| Tasa gaps declarados | > 30% | 15-30% | < 15% |
| Tasa bloqueo Cipher | < 15% | 15-30% | > 30% |
| Iteraciones promedio | <= 1.2 | 1.2-1.5 | > 1.5 |

La tasa de gaps declarados ALTA es buena — significa que los agentes son honestos sobre su incertidumbre. Una tasa BAJA es señal de alerta.
