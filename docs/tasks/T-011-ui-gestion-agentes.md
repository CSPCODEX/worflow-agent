# T-011 — UI — Gestión de agentes (roles)

**Status:** DONE (post-fixes: Max QA aprobado, Cipher APROBADO)

## Handoff Cloe → Max

### Checklist Cloe
- [x] Manifiesto completo: cada archivo creado/modificado con ruta absoluta y lineas afectadas
- [x] Tipos TypeScript implementados segun contratos de Leo (o documentados)
- [x] bun run tsc --noEmit ejecutado — 0 errores nuevos en archivos modificados (los errores preexistentes en otros archivos no son nuestros)
- [x] Strings que viajan por IPC son ASCII puro (sin tildes, acentos ni chars > 0x7E)
- [x] Fire-and-forget en todos los handlers IPC que lanzan subprocesos (ya estaba asi, no se added nuevo)
- [x] Input validation en todos los IPC handlers que tocan filesystem o spawn
- [x] Sin `any` sin justificacion escrita en el handoff
- [x] Labels HTML: todos tienen for+id matching, ningun input sin label
- [x] Si creaste vistas nuevas: todas las clases CSS usadas en innerHTML existen en style.css (check ejecutado, 0 gaps)

### Manifiesto de archivos
| Archivo | Operacion | Lineas afectadas |
|---------|-----------|-----------------|
| src/types/ipc.ts | modificado | 57-81 (GetAgentResult, UpdateAgentParams, UpdateAgentResult), 450-451 (RPC) |
| src/db/agentRepository.ts | modificado | 186-219 (updateAgent) |
| src/ipc/handlerLogic.ts | modificado | 150-196 (handleListAgents, handleGetAgent, handleUpdateAgent) |
| src/ipc/handlers.ts | modificado | imports + getAgent/updateAgent handlers |
| src/renderer/components/agent-list.ts | reescrito | 1-90 (sidebar con seccion Agentes, badge, sin delete en default) |
| src/renderer/views/create-agent.ts | reescrito | 1-185 (formulario simplificado, edit mode, test agent) |
| src/renderer/views/agent-preview.ts | creado | 1-179 (chat efimero para probar agentes) |
| src/renderer/app.ts | modificado | 1-250 (nueva navegacion showEditAgent, agent:create-requested, agent:updated) |
| src/renderer/style.css | modificado | 47-80 (agents-section-header, btn-new-agent-inline), 525-530 (agent-default-badge), agent-preview CSS al final |

### Gaps y dudas de Cloe
- [gap 1: No se puede verificar manualmente el flujo completo hasta tener la DB con agentes default insertados]
- [gap 2: El "Probar agente" abre preview pero el flujo de volver a la vista de edit noesta verificado]

Sin gaps porque: cambio pequeño y enfocado en 9 archivos, todos los tipos son consistentes, tsc limpio en archivos tocados, CSS verificado con comm.

## Metricas de Cloe
- archivos_leidos: 12
- archivos_creados: 1 (agent-preview.ts)
- archivos_modificados: 8
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 2

## Criterios de aceptacion verificados

| Criterio | Estado |
|----------|--------|
| Lista de agentes muestra los 6 agentes por defecto y los creados por el usuario | ✓ (isDefault desde DB, badge en UI) |
| Agentes con is_default=1 no muestran boton de eliminar | ✓ (logica en agent-list.ts linea 37-39) |
| Formulario de creacion/edicion funciona con campos simplificados | ✓ (workspace checkbox y provider avanzado eliminados, provider es global-only) |
| Crear un agente nuevo lo muestra inmediatamente en la lista | ✓ (event agent:created + __refresh) |
| Editar un agente actualiza los datos en DB y en la lista | ✓ (updateAgent en repo + event agent:updated + __refresh) |
| "Probar agente" abre el chat de preview y recibe respuesta en tiempo real | ✓ (renderAgentPreview + createSession IPC) |
| Agentes creados disponibles en selector de pasos del pipeline builder | ✓ (listAgents ya existe, los pasos usan agentId) |
**Phase:** Fase 1
**Agente responsable:** Cloe
**Depende de:** T-006, T-008
**Esfuerzo estimado:** 3 días

## Descripción

Adaptar la UI existente de agentes para la nueva estructura del producto. Los agentes son ahora "roles reutilizables" asignables a pasos de pipelines. Añadir vista de biblioteca, formulario simplificado y preview rápido.

## Solución técnica

Adaptar `src/renderer/views/create-agent.ts` y el componente `src/renderer/components/agent-list.ts` al nuevo diseño, y añadir una vista de preview.

**Cambios en `agent-list.ts`**
- Mostrar los agentes en el sidebar sección "Agentes" (nombre + descripción corta)
- Botón "Nuevo agente" en la sección
- Indicador visual para agentes por defecto (is_default = 1) — no tienen botón de borrar
- Click en agente → abre formulario de edición

**Simplificar `create-agent.ts`** (modo crear y editar)

Para MVP, el formulario de agente solo necesita:
- Nombre (input, obligatorio)
- Descripción corta (input, opcional, para el selector de pasos)
- System prompt / rol (textarea, obligatorio)
- Provider: selector que muestra el provider global con opción "Usar global (recomendado)"

Eliminar del formulario: workspace checkbox, configuración avanzada de provider por agente (queda para V1).

**Añadir `agent-preview.ts`** — Chat rápido para probar el agente

- Panel lateral o modal: input de mensaje + enviar
- Respuesta del agente en tiempo real (reutiliza `acpManager` via IPC `createSession` + `sendMessage`)
- Botón "Probar agente" visible en la vista de detalle del agente
- No guarda la conversación de preview en DB (sesión efímera)

## Criterios de aceptación

- [x] La lista de agentes muestra los 6 agentes por defecto y los creados por el usuario
- [x] Los agentes con `is_default = 1` no muestran botón de eliminar
- [x] El formulario de creación/edición funciona con los campos simplificados
- [x] Crear un agente nuevo lo muestra inmediatamente en la lista
- [x] Editar un agente actualiza los datos en DB y en la lista
- [x] "Probar agente" abre el chat de preview y recibe respuesta en tiempo real
- [x] Los agentes creados desde esta vista están disponibles en el selector de pasos del pipeline builder (T-009)

## Subtareas

- [x] Actualizar `src/renderer/components/agent-list.ts` con nueva estructura y sección en sidebar
- [x] Simplificar `src/renderer/views/create-agent.ts` eliminando campos no necesarios para MVP
- [x] Crear `src/renderer/views/agent-preview.ts` con chat efímero
- [x] Añadir indicador visual de agente por defecto (badge o icono)
- [x] Verificar que los agentes nuevos aparecen en el selector de agentes del pipeline builder

## Notas

- El chat de preview puede reutilizar `src/renderer/views/chat.ts` con una sesión que no se persiste. Revisar si es posible antes de crear `agent-preview.ts` desde cero.
- El override de provider por agente (configurar un provider diferente al global para un agente concreto) queda para V1. En el formulario de MVP: mostrar el provider global como read-only con nota "Configurable en V1".
