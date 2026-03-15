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

## Areas problematicas recurrentes

- Verificación de PATHS en Windows dev mode — siempre requiere runtime check
- Labels sin `for` en formularios generados por innerHTML — pattern común en create views
- Chat sin timeout — patrón de streaming ACP sin recuperación por timeout
- Mensajes de error con tildes en IPC handlers — corrupción garantizada en WebView2
- Cualquier await a subproceso externo dentro de handler IPC — bloquea y causa timeout (usar fire-and-forget)
- sendMessage RPC esperando resultado del agente — siempre debe ser fire-and-forget
- response.content de LM Studio con tokens de razonamiento — siempre filtrar antes de emitir
- Clases CSS de nuevos componentes: verificar que existan en style.css antes de aprobar — BUG #007 confirmado en 2 features distintas

## Checklist de QA — electrobun-migration
- Estado: 2/7 verificables estáticamente, 5/7 requieren runtime
- Build, bundle size y flujos ACP pendientes de verificación con `bun run desktop`

## Notas de accesibilidad
- HTML semántico: usar `<aside>`, `<main>` ✓
- Labels: siempre `for` + `id` matching, nunca solo texto sin for
- Contraste: dark theme (#2d4a7a sobre #1a1a1a) — verificar en runtime
