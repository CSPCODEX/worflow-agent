## Dashboard de metricas — 2026-03-15
Periodo: inicio — hoy
Features analizadas: 9 | Bugs analizados: 8
Total con metricas: 14

---

### Salud del pipeline

| Indicador                | Valor    | Estado   |
|--------------------------|----------|----------|
| Tasa de rework global    | 11%      | OK       |
| Tasa de confianza baja   | 0%       | OK       |
| Tasa de gaps declarados  | 57%      | OK       |
| Tasa de bloqueo Cipher   | 0%       | OK       |
| Iteraciones promedio     | 1.1      | OK       |

---

### Rework por agente

| Agente   | Sesiones   | Con rework   | Tasa     |
|----------|------------|--------------|----------|
| Leo      | 9          | 0            | 0%       |
| Cloe     | 11         | 2            | 18%      |
| Max      | 11         | 3            | 27%      |
| Ada      | 8          | 0            | 0%       |
| Cipher   | 7          | 0            | 0%       |

---

### Gaps declarados por agente

| Agente   | Total gaps declarados    | Promedio por sesion    |
|----------|--------------------------|------------------------|
| Leo      | 7                        | 0.8                    |
| Cloe     | 4                        | 0.4                    |
| Max      | 11                       | 1.0                    |
| Ada      | 2                        | 0.3                    |
| Cipher   | 2                        | 0.3                    |

Nota: gaps_declarados bajos pueden indicar que los agentes ocultan incertidumbre.

---

### Ahorro de bundle (Ada)

- Sesiones con datos de bundle: 3
- Ahorro total acumulado: 0.6 MB
- Ahorro promedio por feature: 0.2 MB

---

### Seguridad (Cipher)

- Features auditadas: 7
- Vulnerabilidades criticas: 0
- Features bloqueadas: 0
- Tasa de bloqueo: 0%

---

### Sin metricas (pipeline en progreso o sin estructura nueva)

- bug: — Agente retorna Internal error cuando LM Studio no tiene modelos cargados (RESUELTO)
- bug: — "Crear agente" produce RPC request timed out (EN PROGRESO)
- bug: — RPC request timed out al crear un agente (desconocido)

