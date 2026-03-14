## Dashboard de metricas — 2026-03-14
Periodo: inicio — hoy
Features analizadas: 6 | Bugs analizados: 7
Total registros con metricas: 10

---

### Salud del pipeline

| Indicador                          | Valor    | Estado |
|------------------------------------|----------|--------|
| Tasa de rework global              | 14%      | OK     |
| Tasa de confianza baja             | 0%       | OK     |
| Tasa de gaps declarados            | 31%      | OK     |
| Tasa de bloqueo Cipher             | 0%       | OK     |
| Iteraciones promedio               | 1.1      | OK     |

---

### Rework por agente

| Agente   | Sesiones   | Con rework   | Tasa     |
|----------|------------|--------------|----------|
| Leo      | 6          | 0            | 0%       |
| Cloe     | 7          | 2            | 29%      |
| Max      | 7          | 2            | 29%      |
| Ada      | 5          | 0            | 0%       |
| Cipher   | 4          | 0            | 0%       |

---

### Contexto por agente (archivos promedio leidos)

| Agente   | Promedio archivos leidos | Estado |
|----------|----------------------|--------|
| Leo      | 9.3                  | ACEPTABLE |
| Cloe     | 7.9                  | ACEPTABLE |
| Max      | 7.4                  | ACEPTABLE |
| Ada      | 7.6                  | ACEPTABLE |
| Cipher   | 11.0                 | EXCESIVO |

---

### Gaps declarados por agente

| Agente   | Total gaps declarados    | Promedio por sesion    |
|----------|--------------------------|------------------------|
| Leo      | 3                        | 0.5                    |
| Cloe     | 1                        | 0.1                    |
| Max      | 4                        | 0.6                    |
| Ada      | 1                        | 0.2                    |
| Cipher   | 0                        | 0.0                    |

Nota: gaps_declarados bajos pueden indicar que los agentes ocultan incertidumbre.

---

### Ahorro de bundle (Ada)

- Sesiones con datos de bundle: 1
- Ahorro total acumulado: 0.6 MB
- Ahorro promedio por feature: 0.6 MB

---

### Seguridad (Cipher)

- Features auditadas: 4
- Vulnerabilidades criticas encontradas: 0
- Features bloqueadas: 0
- Tasa de bloqueo: 0%

---

### Sin metricas (pipeline en progreso o sin estructura nueva)

- bug: Agente retorna Internal error cuando LM Studio no tiene modelos cargados (RESUELTO)
- bug: "Crear agente" produce RPC request timed out (EN PROGRESO)
- bug: RPC request timed out al crear un agente (desconocido)
