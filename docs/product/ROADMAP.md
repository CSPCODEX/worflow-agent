# Roadmap del Producto — Workflow Agent

## Vista general

```
Fase 0 (Preparacion)  →  Fase 1 (MVP)  →  Fase 2 (V1)  →  Fase 3 (V2)
   4 semanas              8 semanas        6 semanas        Continuo
```

**Fecha de inicio:** 2026-04-21
**Fecha estimada MVP:** 2026-06-15
**Fecha estimada V1:** 2026-07-27

---

## Fase 0 — Preparacion y Refactorizacion (4 semanas)

**Objetivo:** Adaptar la base de codigo actual al nuevo concepto sin romper lo que funciona.

### 0.1 Reestructuracion de datos

| Tarea | Esfuerzo | Descripcion |
|---|---|---|
| Migracion DB: tabla `pipelines` | 2 dias | Nueva tabla para pipelines con campos: id, name, description, template_id, status, created_at, updated_at |
| Migracion DB: tabla `pipeline_steps` | 2 dias | Pasos de un pipeline: id, pipeline_id, step_order, agent_id, step_name, input_template, output_key |
| Migracion DB: tabla `pipeline_runs` | 2 dias | Ejecuciones: id, pipeline_id, status, input_data, started_at, completed_at, error |
| Migracion DB: tabla `pipeline_step_runs` | 2 dias | Ejecucion de cada paso: id, run_id, step_id, status, input_data, output_data, started_at, completed_at |
| Repositorios para nuevas tablas | 3 dias | CRUD para pipelines, steps, runs, step_runs |
| Migracion DB: renombrar agents → agent_templates | 1 dia | Los agentes pasan a ser templates reutilizables dentro de pipelines |

**Dependencias:** Ninguna. Se puede arrancar inmediatamente.
**Criterio de aceptacion:** Migraciones aplicadas sin perdida de datos existentes. Tests de repositorios pasan.

### 0.2 Refactor de agentes a "roles reutilizables"

| Tarea | Esfuerzo | Descripcion |
|---|---|---|
| Desacoplar agent de pipeline | 3 dias | Un agente puede existir independientemente Y ser usado en multiples pipelines |
| Clonar agente para pipeline | 2 dias | Al ejecutar un pipeline, se clona la config del agente (no se muta el original) |
| Provider config compartido | 2 dias | Los providers se configuran globalmente (settings), no por agente |

**Dependencias:** 0.1 (necesita las nuevas tablas)
**Criterio de aceptacion:** Un agente puede usarse en 2+ pipelines sin conflictos. Cambiar un agente no afecta pipelines ya ejecutados.

### 0.3 Motor de ejecucion de pipelines

| Tarea | Esfuerzo | Descripcion |
|---|---|---|
| PipelineRunner: ejecucion secuencial | 4 dias | Ejecuta los pasos de un pipeline en orden, pasando output de uno como input del siguiente |
| PipelineRunner: manejo de errores | 2 dias | Si un paso falla, el pipeline se detiene con mensaje claro. El usuario puede reintentar desde ese paso |
| PipelineRunner: persistencia de estado | 2 dias | Cada paso guarda su output en la DB. El pipeline se puede reanudar si la app se cierra |
| Input/output de pasos | 3 dias | Cada paso define su input (string template) y produce un output (string). El motor hace la sustitucion |

**Dependencias:** 0.1, 0.2
**Criterio de aceptacion:** Un pipeline de 3 pasos se ejecuta de punta a punta. Si se cierra la app en el paso 2, al reabrir se puede reanudar desde ahi.

### 0.4 Limpiar codigo obsoleto

| Tarea | Esfuerzo | Descripcion |
|---|---|---|
| Remover monitor pipeline interno | 1 dia | El monitor del pipeline de desarrollo (Leo→Cloe→Max...) es meta-herramienta, no producto. Se mueve a un script separado |
| Simplificar renderer | 2 dias | La UI actual es para crear agentes individuales. Se prepara para la nueva estructura |
| Actualizar IPC | 2 dias | Nuevos handlers para pipelines, mantener compatibilidad con los handlers de agentes individuales |

**Dependencias:** 0.1, 0.2, 0.3
**Criterio de aceptacion:** Los tests existentes pasan. Los handlers IPC nuevos responden correctamente.

---

## Fase 1 — MVP (8 semanas)

**Objetivo:** Un usuario puede crear un pipeline, ejecutarlo, y ver los resultados. Todo con modelos locales.

### 1.1 Templates de pipelines predefinidos

| Tarea | Esfuerzo | Descripcion |
|---|---|---|
| Template: Content Creator | 2 dias | Pipeline de 3 pasos: Investigador → Redactor → Revisor. Input: tema. Output: articulo pulido |
| Template: Code Review | 2 dias | Pipeline de 3 pasos: Auditor → Refactorizador → Verificador. Input: codigo. Output: codigo mejorado con explicacion |
| Template: Data Analyst | 2 dias | Pipeline de 3 pasos: Limpiador → Analista → Visualizador (texto). Input: datos CSV. Output: informe de analisis |
| Template: Traductor | 1 dia | Pipeline de 2 pasos: Traductor → Revisor cultural. Input: texto + idioma destino. Output: traduccion revisada |
| Sistema de templates en DB | 2 dias | Tabla `pipeline_templates` con los predefinidos. El usuario puede crear desde template o desde cero |

**Dependencias:** Fase 0 completa
**Criterio de aceptacion:** Los 4 templates se listan en la UI, se seleccionan, y se ejecutan end-to-end con un modelo local.

### 1.2 UI: Pipeline builder

| Tarea | Esfuerzo | Descripcion |
|---|---|---|
| Vista de lista de pipelines | 3 dias | Sidebar muestra pipelines creados. Click abre el detalle. Boton "Nuevo pipeline" |
| Vista de nuevo pipeline | 5 dias | Formulario: nombre, descripcion, seleccion de template (o vacio). Si selecciona template, se pre-llena |
| Editor de pasos del pipeline | 8 dias | Lista vertical de pasos. Cada paso: nombre, agente (selector), input template (texto con {{variables}}). Botones para reordenar, anadir, eliminar pasos |
| Vista de ejecucion | 5 dias | Muestra el pipeline ejecutandose paso a paso. Cada paso muestra: estado (pendiente/ejecutando/completado/error), output en tiempo real |
| Vista de resultados | 3 dias | Una vez completado, muestra el output final + cada paso intermedio expandible |

**Dependencias:** 1.1 (templates para pre-llenar el builder)
**Criterio de aceptacion:** Un usuario puede crear un pipeline de 3 pasos desde la UI, ejecutarlo, y ver el output de cada paso.

### 1.3 UI: Gestión de agentes (roles)

| Tarea | Esfuerzo | Descripcion |
|---|---|---|
| Vista de biblioteca de agentes | 3 dias | Lista de agentes disponibles con nombre, descripcion, provider |
| Formulario crear/editar agente | 3 dias | Nombre, rol (system prompt), provider. Sin workspace ni configuracion avanzada en MVP |
| Preview de agente | 2 dias | Chat de prueba rapido con un agente antes de usarlo en un pipeline |
| Indicador de modelo local disponible | 1 dia | Si LM Studio u Ollama estan corriendo, se muestra indicador verde en la UI |

**Dependencias:** Fase 0 (nueva estructura de datos)
**Criterio de aceptacion:** El usuario puede crear un agente, probarlo en chat rapido, y asignarlo a un paso de pipeline.

### 1.4 Onboarding

| Tarea | Esfuerzo | Descripcion |
|---|---|---|
| Pantalla de bienvenida | 2 dias | Al abrir la app por primera vez: explicacion de 3 pasos (1. Configura tu modelo local, 2. Crea un pipeline, 3. Ejecuta) |
| Deteccion de modelos locales | 2 dias | Auto-detectar si LM Studio u Ollama estan corriendo y mostrar guia si no |
| Quick-start pipeline | 1 dia | Boton "Probar con un ejemplo" que crea y ejecuta un pipeline predefinido con un click |

**Dependencias:** 1.1, 1.2, 1.3
**Criterio de aceptacion:** Un usuario nuevo puede ejecutar su primer pipeline en menos de 2 minutos desde que abre la app (asumiendo que tiene LM Studio u Ollama corriendo).

### 1.5 Settings simplificado

| Tarea | Esfuerzo | Descripcion |
|---|---|---|
| Provider setup asistido | 3 dias | Settings muestra: "Modelo local" (auto-detectado) o "Cloud" (input de API key). Elimina configuracion tecnica |
| Validacion de conexion | 1 dia | Boton "Probar conexion" que verifica que el modelo local responde |
| Persistencia de provider preferido | 1 dia | El provider se configura una vez y todos los agentes lo usan por defecto |

**Dependencias:** Fase 0
**Criterio de aceptacion:** El usuario configura su provider en 1 minuto. Si tiene LM Studio corriendo, la configuracion es automatica.

---

## Fase 2 — V1 (6 semanas)

**Objetivo:** Pulir la experiencia, anadir flexibilidad, preparar para distribucion.

### 2.1 Pipelines avanzados

| Tarea | Esfuerzo | Descripcion |
|---|---|---|
| Variables de input | 3 dias | El usuario define variables al crear un pipeline (ej: {{tema}}, {{idioma}}). Se le piden al ejecutar |
| Re-ejecutar pipeline | 2 dias | Boton para re-ejecutar un pipeline con diferentes inputs. Se guarda el historial |
| Exportar resultado | 2 dias | Boton para copiar o guardar el output final como archivo de texto |
| Historial de ejecuciones | 3 dias | Vista de todas las ejecuciones de un pipeline con fecha, input, output, estado |

**Dependencias:** Fase 1 completa
**Criterio de aceptacion:** El usuario puede ejecutar el mismo pipeline multiples veces con diferentes inputs y comparar resultados.

### 2.2 Biblioteca de templates

| Tarea | Esfuerzo | Descripcion |
|---|---|---|
| Templates del usuario | 2 dias | Guardar un pipeline como template reutilizable |
| Compartir templates (export/import) | 3 dias | Exportar un template como archivo JSON. Importar desde archivo |
| Categorias de templates | 2 dias | Agrupar templates por categoria: Contenido, Codigo, Datos, Traduccion, Otro |

**Dependencias:** 2.1
**Criterio de aceptacion:** El usuario puede guardar, exportar e importar templates.

### 2.3 Mejoras de UI/UX

| Tarea | Esfuerzo | Descripcion |
|---|---|---|
| Busqueda en pipelines | 1 dia | Filtro por nombre en la lista de pipelines |
| Drag-and-drop reordenar pasos | 3 dias | Reordenar pasos del pipeline arrastrando en vez de botones |
| Tema claro/oscuro | 2 dias | Toggle de tema en settings |
| Notificaciones de estado | 2 dias | Toast notifications para: pipeline completado, pipeline con error, modelo local desconectado |
| Atajos de teclado | 2 dias | Ctrl+N: nuevo pipeline, Ctrl+E: ejecutar, Ctrl+S: guardar |

**Dependencias:** Fase 1
**Criterio de aceptacion:** La UI se siente pulida y responde rapidamente a todas las interacciones.

### 2.4 Distribucion

| Tarea | Esfuerzo | Descripcion |
|---|---|---|
| Build de produccion | 3 dias | Configurar build de Electrobun para distribucion (icono, nombre, sin DevTools) |
| Auto-updater basico | 3 dias | Verificar si hay nueva version al abrir la app. Notificar al usuario |
| Instalador Linux | 2 dias | .deb o AppImage para distribucion en Linux |
| Instalador Windows | 2 dias | .exe installer basico (si Electrobun lo soporta en la version actual) |
| Documentacion de usuario | 3 dias | Guia de inicio rapido + FAQ + troubleshooting |

**Dependencias:** 2.1, 2.2, 2.3
**Criterio de aceptacion:** Un usuario puede descargar, instalar y ejecutar su primer pipeline sin leer documentacion tecnica.

---

## Fase 3 — V2 (continuo)

**Objetivo:** Expandir capacidades basado en feedback de usuarios reales.

### Posibles features (priorizar con feedback)

| Feature | Descripcion | Prioridad tentativa |
|---|---|---|
| Ejecucion paralela de pasos | Pasos que no dependen entre si se ejecutan en paralelo | Alta |
| Bifurcacion condicional | Si el output del paso 2 cumple X, ir al paso 3A; si no, al 3B | Media |
| Integracion con APIs externas | Pasos que llamen a URLs, lean archivos, etc. | Media |
| Agentes con herramientas (MCP) | Agentes que puedan usar herramientas MCP en sus pasos | Alta |
| Colaboracion multiusuario | Compartir pipelines entre usuarios de la misma red | Baja |
| Marketplace de templates | Biblioteca publica de templates creados por la comunidad | Baja |
| Soporte macOS y Windows | Builds nativos para otras plataformas | Alta |
| Pipeline de pipelines | Un paso puede ejecutar otro pipeline completo | Media |
| Exportar como script | Generar un script Bun que replique el pipeline sin la UI | Baja |

---

## Dependencias entre fases

```
Fase 0.1 (DB) ──── Fase 0.2 (Roles) ──── Fase 0.3 (Motor) ──── Fase 0.4 (Limpieza)
                                                                      │
                                                                      ▼
                                              Fase 1.1 (Templates) ──── Fase 1.2 (Builder UI)
                                                      │                       │
                                                      ▼                       ▼
                                              Fase 1.3 (Agentes UI) ──── Fase 1.4 (Onboarding)
                                                      │                       │
                                                      ▼                       ▼
                                              Fase 1.5 (Settings) ◄──────────┘
                                                      │
                                                      ▼
                                              Fase 2.1 (Avanzados) ──── Fase 2.2 (Biblioteca)
                                                      │                       │
                                                      ▼                       ▼
                                              Fase 2.3 (UI/UX) ──── Fase 2.4 (Distribucion)
```

---

## Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigacion |
|---|---|---|---|
| Electrobun no soporta UI compleja (drag-drop, etc.) | Media | Alto | Evaluar en Fase 0.4 si el renderer nativo es suficiente. Si no, migrar a webview con framework ligero |
| Modelos locales no producen resultados utiles para pipelines complejos | Media | Alto | Mostrar modelo recomendado por template en UI. Prompts muy directivos en templates predefinidos. Nunca bloquear, solo informar |
| Performance de multiples agentes ejecutandose en secuencia | Baja | Medio | Los pipelines son secuenciales, nunca hay 2 agentes corriendo a la vez |
| El auto-detect de LM Studio/Ollama es fragil | Alta | Bajo | Siempre permitir configuracion manual como fallback |
| Usuario no entiende el concepto de pipeline | Media | Alto | Onboarding agresivo + templates predefinidos que se ejecutan con 1 click |
| Pipeline secuencial se queda corto rapido para usuarios avanzados | Media | Medio | El schema de DB esta disenado para soportar bifurcaciones futuras (ver ARCHITECTURE.md Decision 7). No bloquea la evolucion |
| Nadie descubre la app tras el lanzamiento | Alta | Alto | Ver secuencia de distribucion en VISION.md. No lanzar publicamente hasta tener 10 usuarios recurrentes organicos |
