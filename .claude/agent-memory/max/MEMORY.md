# Memoria de Max — QA y SDET

## Patrones de fallo recurrentes

### Electrobun PATHS
- `PATHS.VIEWS_FOLDER` solo funciona correctamente dentro del binario compilado
- En dev mode con bun run directo, la ruta apunta a `../Resources/` relativo a cwd (incorrecto)
- SIEMPRE añadir fallback `existsSync` que use build output cuando VIEWS_FOLDER no existe

### ACP stdio
- acpManager debe usar `stdio: ['pipe', 'pipe', 'inherit']` no `['pipe','pipe','pipe']`
- stderr pipe silencia los logs de debug del agente LM Studio

### IPC handlers — validación
- Leo requiere validar params antes de spawn/fs ops
- `createSession` es el handler más propenso a omitir validación de agentName

### Encoding IPC en Electrobun/WebView2 (Windows) — BUG #001
- Electrobun IPC en Windows aplica `byte | 0xFF00` a bytes > 0x7F del payload UTF-8
- Resultado: U+00F3 (ó) -> bytes 0xC3 0xB3 -> U+FFC3 U+FFB3 (garbled)
- Afecta CUALQUIER string con caracteres no-ASCII que viaje por IPC (RPC response, send)
- FIX PERMANENTE: usar solo ASCII 0x20-0x7E en todos los strings de mensajes de usuario que pasen por IPC
- Archivos de riesgo: validations.ts, cualquier handler que retorne error strings con tildes/acentos

### Operaciones lentas en IPC handlers — BUG #003, #004, #006
- Cualquier operacion que tarde >10 s dentro de un handler RPC provoca "RPC request timed out."
- `spawnSync` bloquea el hilo completamente (BUG #003) — reemplazar por `Bun.spawn`
- PERO: `await proc.exited` con `Bun.spawn` dentro del handler sigue bloqueando el handler RPC (BUG #006)
- `bun install` sin caché puede tardar 15-45 s → siempre excede el timeout de 10 s de Electrobun
- FIX CORRECTO: el handler debe retornar inmediatamente tras las ops de fs rápidas (mkdir/writeFile)
- El `bun install` debe lanzarse sin await (fire-and-forget) y notificar al renderer vía evento IPC al terminar
- Regla: ningun await que involucre un subproceso externo puede vivir dentro de un handler RPC

### sendMessage RPC no debe esperar respuesta del agente — BUG #005 (sintoma 1)
- `acpManager.sendMessage()` hace `await connection.prompt()` que no retorna hasta que el agente termina
- El agente tarda tanto como LM Studio en generar la respuesta (puede ser varios segundos)
- El RPC de Electrobun agota su timeout antes de que el agente responda -> "RPC request timed out."
- FIX: `sendMessage` debe ser fire-and-forget — iniciar `connection.prompt()` sin await y retornar `{ success: true }` de inmediato; los chunks y errores llegan por el canal de streaming (callbacks existentes)
- Archivo de riesgo: `src/ipc/acpManager.ts` metodo `sendMessage`

### Channel tags de modelos con extended thinking — BUG #005 (sintoma 2)
- Modelos con razonamiento estructurado emiten `<|channel|>analysis...`, `<|channel|>final<|message|>...`, `<|end|>` en `response.content`
- `@lmstudio/sdk` no filtra esos tokens — los devuelve crudos en `response.content`
- La plantilla del agente pasa `response.content` directamente al sessionUpdate sin limpiar
- FIX en plantilla: extraer solo el contenido del canal `final` con regex antes de emitir el chunk
- Regex: `/\<\|channel\|\>final\<\|message\|\>([\s\S]*?)(?:\<\|end\|\>|$)/` grupo 1; fallback al contenido completo si no hay match
- Archivo de riesgo: `src/templates/basic-agent/index.ts.tpl` linea donde se asigna `responseText`

### Componentes renderer sin CSS — BUG #007
- Un componente `.ts` puede existir y ser logicamente correcto pero tener CERO clases CSS en style.css
- Patron: Cloe crea el componente TypeScript pero no agrega las reglas CSS al stylesheet
- Efecto critico si el componente usa clases que no existen: layout roto dentro de `#main-content` (`display: flex; flex-direction: column; height: 100vh`)
- El hijo sin `flex: 1` queda colapsado en la esquina superior — no ocupa el espacio disponible
- Verificar SIEMPRE con grep que cada clase usada en `.innerHTML` o `createElement` exista en `style.css`
- Comando de verificacion: grep de todas las clases CSS del componente contra style.css antes de aprobar
- Confirmado en feature settings-panel: `.settings-view`, `.btn-settings`, `.sidebar-footer` — ninguna existia en style.css

### Registro de callback antes de primer scan — patron poller
- Si poller.start() se llama en scope del modulo (fuera de createRpc), el scan inmediato ocurre ANTES de que onSnapshot() se registre
- El primer push no llega al renderer — el renderer debe hacer request explicito al abrir la vista
- No es un bug funcional si la vista siempre llama getPipelineSnapshot() al arrancar (patron correcto)
- Verificar siempre que la vista pide snapshot explicito al montarse, no solo espera el push

### Non-null assertion sobre cache potencialmente null
- `cachedSnapshot!` en poller.ts es peligroso si scan() falla en la primera llamada
- Si buildSnapshot lanza (muy raro) y cachedSnapshot es null, el type assertion engana al caller
- Pattern seguro: retornar snapshot vacio por defecto en lugar de usar `!`

### bun:sqlite query API — patron de parametros — BUG recurrente en nueva DB
- Cloe usa `db.query<T, []>(...).get([])` y `.all([...params])` — INCORRECTO: TS2554 / TS2345
- La API de bun:sqlite pasa parametros como argumentos posicionales, NO como array wrapeado
- FIX: `.get()` sin argumentos para queries sin params, `.get(...params)` con spread para queries con params
- Lo mismo para `.all()`: `.all(...params)` o `.all(singleParam)`
- SIEMPRE verificar con git stash que los errores son nuevos y no preexistentes antes de reportar
- Confirmado en feature monitor-historial-metricas: historyRepository.ts:129,133,153 eran errores nuevos
  aunque Cloe los reporto como preexistentes — la prueba con baseline lo desmiente

### Estado efimero del poller no persiste entre reinicios — BUG #009
- `cachedSnapshot = null` en cada arranque: el primer scan siempre compara contra nada
- `detectChanges(null, snapshot)` trata TODOS los items como nuevos — duplicados garantizados
- La deduplicacion por ventana de tiempo (alternativa B) es una mala solucion: ventana arbitraria, falsos negativos para cambios reales rapidos, no resuelve la causa raiz
- FIX correcto (alternativa A): seedear `cachedSnapshot` en `PipelinePoller.start()` desde la DB antes del primer scan
- Requiere nueva funcion `loadLastKnownStates(db)` en historyRepository.ts — query por ultimo estado de cada item
- Caso de primer arranque (DB vacia): el snapshot seeded queda con arrays vacios, comportamiento correcto sin logica extra
- changeDetector.ts es una funcion pura correcta — NO tocar al resolver este bug

### Cobertura de FEATURE_STATE_MAP — BUG #010 y #011
- El mapa de strings -> enum DEBE cubrir TODAS las variantes usadas en los status.md reales del repo
- Variantes comunes no mapeadas: `LISTO PARA MERGE`, `APROBADO PARA MERGE` (semanticamente identicos)
- Variantes con sufijo compuesto (`AUDITADO — listo para merge`) son problematicas: el strip `/[^A-Z\s]/g` convierte el em-dash en espacio, produciendo `AUDITADO  LISTO PARA MERGE` — NO esta en el mapa
- Al auditar un bug de parser: SIEMPRE extraer todos los valores de "Estado final:" y "Estado:" de todos los status.md y compararlos contra el mapa completo — no solo el valor reportado
- BUG_STATE_MAP tiene el mismo problema: `EN PROGRESO` no esta mapeado (BUG #003 seria DESCONOCIDO)
- stateBadge() en monitor-view.ts es generica (usa la clase CSS dinamicamente) — NO necesita cambio cuando se añade un estado nuevo; SOLO necesita CSS nuevo en monitor-styles.css
- Nuevo estado a añadir al enum: `LISTO_PARA_MERGE` (distinto de `AUDITADO` — estado post-auditoria pre-merge; distinto de `MERGEADO` — aun en rama de feature)

### Formato inconsistente de status.md — causa de DESCONOCIDO en parser — BUG #011
- El parser usa `^Estado:\s*(.+)$` — NO captura `**Estado:** valor` (formato bold de markdown)
- Cinco features usan bold: delete-agent, multi-provider-support, persistence, prompt-enhancement, y bug/001
- Tres bugs usan formato completamente diferente (clave `Status` en ingles + valor entre backticks): 004, 005, 006
- Un archivo usa `**Fase:**` en lugar de `**Estado:**`: electrobun-migration — no hay fix pragmatico
- FIX correcto: ampliar regex de `extractLine` a `^\*{0,2}Estado:\*{0,2}\s*(.+)$` (captura con y sin bold)
- Para bugs: anadir fallback `extractLine(content, 'Status')` y limpiar backticks del valor raw
- Valores especificos no mapeados: `OPTIMIZADO` (mapear a `EN_AUDITORIA`), `IMPLEMENTADO` (mapear a `EN_VERIFICACION`), `CORRECCION COMPLETADA` (mapear a `EN_VERIFICACION`), `RESOLVED` y `VERIFIED` en BUG_STATE_MAP (mapear a `RESUELTO`)
- Todos los mapeos son al enum existente — NO se necesitan estados nuevos en types.ts

## Areas problematicas recurrentes

- Verificación de PATHS en Windows dev mode — siempre requiere runtime check
- Labels sin `for` en formularios generados por innerHTML — pattern común en create views
- Chat sin timeout — patrón de streaming ACP sin recuperación por timeout
- Mensajes de error con tildes en IPC handlers — corrupción garantizada en WebView2
- Cualquier await a subproceso externo dentro de handler IPC — bloquea y causa timeout (usar fire-and-forget)
- sendMessage RPC esperando resultado del agente — siempre debe ser fire-and-forget
- response.content de LM Studio con tokens de razonamiento — siempre filtrar antes de emitir
- Clases CSS de nuevos componentes: verificar que existan en style.css antes de aprobar — BUG #007 confirmado en 2 features distintas
- Typos en nombres de campo: `gapsDeclados` en lugar de `gapsDeclarados` — revisar nomenclatura en tipos al aprobar
- bun:sqlite params como array vs spread: Cloe reincide en este patron — verificar siempre en features con DB nueva
- Estado efimero en pollers con persistencia: si el poller tiene DB de respaldo, SIEMPRE seedear su cache desde la DB al arrancar
- Maps de strings a enum: auditar cobertura contra TODOS los status.md reales del repo, no solo contra el enum — BUG #010 y #011
- Formato bold `**Clave:**` en status.md antiguos no capturado por regex de parser — BUG #011

## Checklist de QA — electrobun-migration
- Estado: 2/7 verificables estáticamente, 5/7 requieren runtime
- Build, bundle size y flujos ACP pendientes de verificación con `bun run desktop`

## Notas de accesibilidad
- HTML semántico: usar `<aside>`, `<main>` ✓
- Labels: siempre `for` + `id` matching, nunca solo texto sin for
- Contraste: dark theme (#2d4a7a sobre #1a1a1a) — verificar en runtime
