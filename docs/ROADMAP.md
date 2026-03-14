# Roadmap

Estado actual del proyecto y proximas mejoras priorizadas.

---

## Fase 1 — Estabilidad (Alta prioridad)

### 1.1 Suite de tests
- **Que:** Implementar tests unitarios e de integracion
- **Alcance minimo:** handlers IPC, migraciones DB, validaciones de input (`src/cli/validations.ts`)
- **Por que:** Cero cobertura actual. Cualquier regresion pasa desapercibida.
- **Agentes:** Leo (plan) → Cloe (implementacion) → Max (verificacion)

### 1.2 Carga de historial de conversaciones
- **Que:** Verificar y conectar `getMessages` del IPC handler con el renderer al abrir un chat
- **Alcance:** `src/ipc/handlers.ts` → `src/renderer/chat.ts` (o equivalente)
- **Por que:** La DB persiste mensajes pero no esta confirmado que el renderer los cargue al reabrir una sesion.
- **Agentes:** Max (diagnostico) → Cloe (fix si aplica)

### 1.3 Error boundary en renderer
- **Que:** Componente o handler global de errores en el SPA
- **Alcance:** `src/renderer/` — captura errores no manejados, muestra UI de fallback en vez de pantalla blanca
- **Por que:** Si el renderer crashea actualmente no hay manejo graceful.
- **Agentes:** Cloe (implementacion) → Max (verificacion)

### 1.4 README de usuario
- **Que:** Guia de quickstart orientada a usuarios finales (no desarrolladores)
- **Alcance:** `README.md` en raiz — instalacion, primer agente, providers disponibles, FAQ basico
- **Por que:** `CLAUDE.md` es documentacion interna. No hay punto de entrada para usuarios nuevos.
- **Agentes:** Leo (estructura) → Cloe (redaccion)

---

## Fase 2 — Seguridad y pulido (Prioridad media)

### 2.1 Remover `agentDir` de mensajes IPC
- **Que:** Eliminar la ruta del filesystem de los eventos `AgentInstallDone` y `AgentEnhanceDone`
- **Alcance:** `src/ipc/handlers.ts` + tipos en `src/types/ipc.ts`
- **Por que:** Cipher lo marco como exposicion innecesaria de rutas internas del sistema.
- **Agentes:** Cloe (cambio) → Cipher (re-auditoria puntual)

### 2.2 DevTools deshabilitado y CSP estricto en produccion
- **Que:** Deshabilitar DevTools en build de produccion de Electrobun; reforzar Content Security Policy en el HTML del webview
- **Alcance:** `electrobun.config.ts` + `src/renderer/index.html`
- **Por que:** Pendiente desde la migracion a Electrobun. Riesgo en builds distribuidos.
- **Agentes:** Cloe (config) → Cipher (auditoria)

### 2.3 Panel de settings
- **Que:** UI para configurar host de LM Studio, modelo por defecto, y directorio de datos
- **Alcance:** Nueva vista en `src/renderer/` + handler IPC `saveSettings` / `loadSettings` + persistencia en DB o archivo de config
- **Por que:** Actualmente cambiar el host de LM Studio o el modelo requiere editar `.env` manualmente.
- **Agentes:** Leo (plan) → Cloe (implementacion) → Max (verificacion)

### 2.4 Busqueda y filtro en lista de agentes
- **Que:** Input de busqueda en el sidebar de agentes que filtre por nombre/descripcion
- **Alcance:** `src/renderer/` — filtro en cliente, sin nuevo handler IPC necesario
- **Por que:** Con muchos agentes la lista se vuelve inutilizable sin busqueda.
- **Agentes:** Cloe (implementacion) → Max (verificacion)

---

## Estado de features completadas

| Feature | Estado |
|---|---|
| Migracion a Electrobun (GUI desktop) | Completado |
| Persistencia SQLite | Completado |
| Soporte multi-provider (LM Studio, Ollama, OpenAI, Anthropic, Gemini) | Completado |
| Mejora de prompts (enhancer) | Completado |
| Eliminar agente | Completado |

---

## Notas

- Las features de **Fase 1** se pueden arrancar en cualquier orden; son independientes entre si.
- Las features de **Fase 2** conviene arrancarlas despues de tener tests (Fase 1.1) para evitar regresiones.
- Cada feature sigue el flujo estandar del proyecto: `@leo → @cloe → @max → @ada → @cipher`.
- Los bugs se documentan en `docs/bugs/` y siguen el flujo ligero: `@max → @cloe → @max`.
