# Sistema de Agentes — Guia del equipo

Este proyecto usa un equipo de agentes especializados de Claude Code para desarrollar features de forma estructurada. Esta guia explica como funciona el sistema, como usarlo y como contribuir a mejorarlo.

---

## El equipo

| Agente | Rol | Se invoca con |
|---|---|---|
| **Leo** | Arquitecto y PM | `@leo` |
| **Cloe** | Ingeniera de Software | `@cloe` |
| **Max** | QA y SDET | `@max` |
| **Ada** | Optimizadora | `@ada` |
| **Cipher** | DevSecOps y Seguridad | `@cipher` |

---

## El flujo de trabajo

Cada feature sigue este orden obligatorio:

```
@leo → @cloe → @max → @ada → @cipher
```

**Nunca saltes pasos.** Si saltas a Cloe sin que Leo planifique, no hay especificacion. Si no pasa por Max, Ada optimiza codigo con bugs. Si Cipher no audita, el release puede tener vulnerabilidades.

### Cuando invocar cada agente

**`@leo`** — Antes de escribir cualquier linea de codigo. Le describes la feature y el entrega el plan completo.

```
@leo Necesito añadir autenticacion a la app desktop.
Explica el objetivo y restricciones relevantes.
```

**`@cloe`** — Despues de que Leo entregue el plan. No necesita instrucciones detalladas — lee el status.md de la feature.

```
@cloe Implementa la feature de autenticacion.
El plan esta en docs/features/autenticacion/status.md
```

**`@max`** — Despues de que Cloe confirme que termino.

```
@max Verifica la implementacion de autenticacion.
Ver docs/features/autenticacion/status.md para el handoff de Cloe.
```

**`@ada`** — Despues de que Max apruebe.

```
@ada Optimiza la implementacion de autenticacion.
Max aprobo — ver docs/features/autenticacion/status.md
```

**`@cipher`** — Antes de hacer merge a main.

```
@cipher Audita la feature de autenticacion antes del release.
Ver docs/features/autenticacion/status.md
```

---

## Flujo de bugs

Los bugs siguen un flujo distinto al de features: mas corto, sin arquitectura y sin optimizacion.

```
/bug <descripcion> → @max → @cloe → @max
```

### Por que es diferente al flujo de features

| Aspecto | Features | Bugs |
|---|---|---|
| Primer agente | Leo (planifica) | Max (diagnostica) |
| Ada entra | Si (optimiza) | No (prematuro, riesgo de regresion) |
| Cipher entra | Siempre (pre-release) | Solo si hay implicaciones de seguridad |
| Documentacion | `docs/features/<nombre>/` | `docs/bugs/<id>-<slug>/` |
| Trigger | Invocar `@leo` directamente | Skill `/bug <descripcion>` |

### Paso a paso para reportar un bug

**1. Abrir el bug con la skill:**

```
/bug El panel de agentes no carga cuando LM Studio no esta corriendo
```

La skill crea automaticamente la rama `bug/<id>-<slug>` y el archivo `docs/bugs/<id>-<slug>/status.md`.

**2. Invocar a Max para diagnosticar:**

```
@max Diagnostica el bug #042. El status esta en docs/bugs/042-panel-agentes-no-carga-lm-studio/status.md
```

Max investiga la causa raiz, define el fix propuesto y los criterios de verificacion. Completa la seccion "Handoff Max → Cloe" del status.md.

**3. Invocar a Cloe para implementar el fix:**

```
@cloe Implementa el fix del bug #042. Las instrucciones estan en docs/bugs/042-panel-agentes-no-carga-lm-studio/status.md
```

Cloe lee el handoff de Max, implementa el fix y completa la seccion "Handoff Cloe → Max".

**4. Invocar a Max para verificar:**

```
@max Verifica el fix del bug #042. El handoff de Cloe esta en docs/bugs/042-panel-agentes-no-carga-lm-studio/status.md
```

Max verifica que el bug esta resuelto y cierra el ciclo. Si el bug persiste, Max marca REABIERTO y se repite el ciclo Cloe → Max.

**5. Cipher — solo si el bug tiene implicaciones de seguridad:**

Si Max marca "Requiere auditoria de Cipher: SI" en el resultado final:

```
@cipher Audita el bug #042 antes del merge. Ver docs/bugs/042-panel-agentes-no-carga-lm-studio/status.md
```

Si Max marca "Requiere auditoria de Cipher: NO", hacer merge directamente. No invocar Ada.

### Cuando SI invocar Cipher en un bug

Cipher entra en bugs que involucren:
- Exposicion de secretos o credenciales
- Vulnerabilidades de inyeccion (prompt injection, path traversal, etc.)
- Problemas de autenticacion o autorizacion
- Fuga de datos de usuario
- Comunicacion insegura entre procesos

Cipher NO entra en bugs funcionales, de UI, de performance o de integracion sin implicaciones de seguridad.

---

## Como se comunican los agentes

Los agentes no se llaman directamente. Se comunican a traves de `docs/features/<nombre>/status.md`.

### Estructura del status.md

```
docs/features/<nombre>/
└── status.md          ← canal de comunicacion entre agentes
    ├── Handoff Leo → Cloe     (que hacer, reglas, contratos IPC)
    ├── Metricas de Leo
    ├── Handoff Cloe → Max     (archivos tocados, advertencias)
    ├── Metricas de Cloe
    ├── Handoff Max → Ada      (bugs encontrados, checklist)
    ├── Metricas de Max
    ├── Handoff Ada → Cipher   (optimizaciones, bundle)
    ├── Metricas de Ada
    ├── Resultado de Cipher    (vulnerabilidades, decision)
    └── Metricas de Cipher
```

**Regla clave:** el `status.md` debe ser autosuficiente. Cada agente encuentra en el todo lo que necesita para trabajar — sin tener que leer otros docs ni preguntar al usuario.

### Como Leo escribe el handoff para Cloe

El handoff de Leo incluye inline:
- Que crear y en que orden (lista priorizada)
- Reglas que no se pueden romper
- Tipos TypeScript necesarios en codigo
- Como implementar los patrones principales (con ejemplos)

**No** pone "ver plan.md para los detalles" — pone los detalles directamente.

---

## Documentacion por feature

Leo genera documentacion de referencia para humanos (no para agentes) en:

```
docs/features/<nombre>/
├── status.md        ← para agentes (canal de comunicacion)
├── plan.md          ← arquitectura y lista de archivos
├── ipc-contracts.md ← contratos IPC tipados completos
├── data-flows.md    ← flujos de datos en ASCII
└── acceptance.md    ← criterios de aceptacion por componente
```

Los docs de referencia son utiles para:
- Revisar decisiones de arquitectura tomadas
- Onboarding de nuevos miembros
- Auditorias post-release
- Comparar lo planificado vs lo implementado

---

## Skills disponibles

Las skills son procedimientos reutilizables que los agentes invocan con `/nombre-skill`.

| Skill | Quien la usa | Cuando |
|---|---|---|
| `/feature` | Cualquiera | Al iniciar una feature — crea rama, carpeta y status.md |
| `/bug` | Cualquiera | Al detectar un bug — crea rama, carpeta y status.md del bug |
| `/validate-handoff` | Cualquiera | Antes de invocar al siguiente agente — valida que el handoff este completo |
| `/metrics-dashboard` | Cualquiera | Dashboard de metricas agregadas de todas las features y bugs |
| `/electrobun-ipc` | Cloe | Al crear un nuevo canal RPC entre main y webview |
| `/acp-debug` | Max | Cuando un agente ACP no responde |
| `/bundle-check` | Ada | Antes de cada ronda de optimizacion |
| `/scan-secrets` | Cipher | Al inicio de cada auditoria de seguridad |
| `/measure-flow` | Cualquiera | Al finalizar un ciclo completo para medir eficiencia (v1) |

### Como invocar una skill

Desde cualquier conversacion con un agente:

```
/scan-secrets
```

El agente ejecutara el procedimiento definido en `.claude/skills/<nombre>.md`.

---

## Sistema de memoria

Cada agente tiene memoria persistente entre sesiones en:

```
C:\Users\carle\.claude\projects\D--work-worflow-agent\memory\
├── leo-memory.md
├── cloe-memory.md
├── max-memory.md
├── ada-memory.md
└── cipher-memory.md
```

**Que guarda la memoria:**
- Patrones de implementacion estables y reutilizables
- Convenciones del proyecto confirmadas
- Soluciones a problemas recurrentes

**Que NO guarda la memoria:**
- Estado de features especificas (eso va en status.md)
- Bugs puntuales ya resueltos
- Contexto temporal de una sesion

**Limite:** 30 lineas por archivo. Si crece mas, se elimina lo obsoleto.

---

## Como medir la eficiencia del flujo

Al finalizar un ciclo completo (todos los agentes pasaron por la feature):

```
/measure-flow <nombre-feature>
```

Genera `docs/features/<nombre>/flow-report.md` con:

| Indicador | Verde | Amarillo | Rojo |
|---|---|---|---|
| Contexto por agente | <= 5 archivos leidos | 6-10 | > 10 |
| Calidad de handoffs | Sin rework | Rework en 1 agente | Rework en 2+ |
| Ciclo limpio | 1 iteracion por agente | - | > 1 iteracion |
| Calidad de impl. | 0 bugs criticos | - | Bugs criticos |
| Seguridad | 0 vulns criticas | - | Vulns criticas |

Tras 2-3 features, los reportes revelan patrones sistematicos para mejorar el flujo.

---

## Iniciar una feature nueva — paso a paso

**1. Abrir la feature con la skill:**

```
/feature <descripcion de la feature>
```

La skill crea automaticamente la rama `feature/<slug>` y el archivo `docs/features/<slug>/status.md`.

**2. Invocar a Leo para planificar:**

```
@leo <descripcion de la feature>. El status esta en docs/features/<slug>/status.md
```

Leo escribe el plan completo en el status.md (handoff Leo → Cloe).

**3. Invocar a Cloe para implementar:**

```
@cloe Implementa <nombre>. Plan en docs/features/<slug>/status.md
```

**4. Invocar a Max para verificar:**

```
@max Verifica <nombre>. Handoff en docs/features/<slug>/status.md
```

**5. Invocar a Ada para optimizar:**

```
@ada Optimiza <nombre>. Max aprobo — ver docs/features/<slug>/status.md
```

**6. Invocar a Cipher para auditar:**

```
@cipher Audita <nombre> antes del release. Ver docs/features/<slug>/status.md
```

**7. Medir el ciclo:**

```
/measure-flow <nombre>
```

**8. Merge a main si Cipher aprueba.**

---

## Añadir un agente nuevo

1. Crear `.claude/agents/<nombre>.md` con el frontmatter:

```markdown
---
name: nombre
description: Cuando usar este agente (una linea clara y especifica)
tools: [Read, Write, Edit, Bash, Glob, Grep]  # solo los necesarios
---
```

2. Definir en el system prompt:
   - Rol y responsabilidad
   - Stack que conoce
   - Flujo de trabajo (leer status.md → trabajar → escribir handoff → actualizar metricas)
   - Lo que NO hace (limites claros)

3. Crear su archivo de memoria en el directorio del proyecto.

4. Actualizar `docs/README.md` y `CLAUDE.md` con el nuevo agente.

---

## Añadir una skill nueva

1. Crear `.claude/skills/<nombre>.md` con:
   - Descripcion breve
   - Procedimiento paso a paso
   - Que agente la usa y cuando
   - Formato del resultado

2. Referenciar la skill en el system prompt del agente que la usa.

3. Documentarla en esta guia.

---

## Archivos del sistema

```
.claude/
├── agents/
│   ├── leo.md
│   ├── cloe.md
│   ├── max.md
│   ├── ada.md
│   └── cipher.md
└── skills/
    ├── feature.md
    ├── bug.md
    ├── validate-handoff.md
    ├── metrics-dashboard.md
    ├── electrobun-ipc.md
    ├── acp-debug.md
    ├── bundle-check.md
    ├── scan-secrets.md
    └── measure-flow.md

docs/
├── README.md           ← indice de features
├── AGENTS.md           ← esta guia
├── OBSERVABILITY.md    ← sistema de metricas y anti-alucinacion (arquitectura antes/despues)
├── metrics/
│   └── dashboard-YYYY-MM-DD.md  (generado por bun run metrics)
├── features/
│   └── <nombre>/
│       ├── status.md
│       ├── plan.md
│       ├── ipc-contracts.md
│       ├── data-flows.md
│       ├── acceptance.md
│       └── flow-report.md  (generado por /measure-flow)
└── bugs/
    └── <id>-<slug>/
        └── status.md       (creado por /bug, rellenado por Max y Cloe)

memory/ (C:\Users\carle\.claude\projects\D--work-worflow-agent\memory\)
├── leo-memory.md
├── cloe-memory.md
├── max-memory.md
├── ada-memory.md
└── cipher-memory.md
```
