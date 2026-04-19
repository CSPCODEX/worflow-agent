# T-011 — UI — Gestión de agentes (roles)

**Status:** TODO
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

- [ ] La lista de agentes muestra los 6 agentes por defecto y los creados por el usuario
- [ ] Los agentes con `is_default = 1` no muestran botón de eliminar
- [ ] El formulario de creación/edición funciona con los campos simplificados
- [ ] Crear un agente nuevo lo muestra inmediatamente en la lista
- [ ] Editar un agente actualiza los datos en DB y en la lista
- [ ] "Probar agente" abre el chat de preview y recibe respuesta en tiempo real
- [ ] Los agentes creados desde esta vista están disponibles en el selector de pasos del pipeline builder (T-009)

## Subtareas

- [ ] Actualizar `src/renderer/components/agent-list.ts` con nueva estructura y sección en sidebar
- [ ] Simplificar `src/renderer/views/create-agent.ts` eliminando campos no necesarios para MVP
- [ ] Crear `src/renderer/views/agent-preview.ts` con chat efímero
- [ ] Añadir indicador visual de agente por defecto (badge o icono)
- [ ] Verificar que los agentes nuevos aparecen en el selector de agentes del pipeline builder

## Notas

- El chat de preview puede reutilizar `src/renderer/views/chat.ts` con una sesión que no se persiste. Revisar si es posible antes de crear `agent-preview.ts` desde cero.
- El override de provider por agente (configurar un provider diferente al global para un agente concreto) queda para V1. En el formulario de MVP: mostrar el provider global como read-only con nota "Configurable en V1".
