# Memoria de Cipher — DevSecOps y Seguridad

## Vulnerabilidades encontradas y estado

### electrobun-migration v1.0 (2026-03-07)
- [ALTA -> REMEDIADA] Path traversal en handlers.ts: `config.name` y `agentName` usados en `path.join` sin sanitizar. Fix: importar `validateAgentName` de `src/cli/validations.ts` — reusa regex `/^[a-z0-9-]+$/` del CLI. Aplica en IPC handlers, no en CLI (CLI ya valida en prompts).
- [BAJA -> REMEDIADA] Sin CSP en index.html. Fix: `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none';">` — restrictivo para app Electrobun local (no necesita connect-src ni eval).

### persistencia-sqlite v1.0 (2026-03-08)
- [MEDIA -> REMEDIADA en multi-provider] `role` en saveMessage sin whitelist: ahora validado con `VALID_ROLES` en handlers.ts linea 194.
- [BAJA -> REMEDIADA en remove-agentdir-ipc] `agentDir`/`path` expuestos al renderer: eliminado de `AgentInstallDone` y `AgentEnhanceDone` en ipc.ts, handlerLogic.ts y handlers.ts.

### multi-provider-support v1.0 (2026-03-13)
- [MEDIA -> ACEPTADA] API key en plaintext por IPC renderer→main antes de encriptar. Threat model desktop (proceso local, mismo usuario) — no bloqueante.
- [BAJA -> PENDIENTE] `master.key` no en `.gitignore` — añadir `master.key` y `*.key`.
- [BAJA -> PENDIENTE] `HOME ?? '~'` en `crypto.ts.tpl` lineas 20/22: path invalido si HOME undefined. Fix: throw Error explicito igual que APPDATA en Windows.

### remove-agentdir-ipc v1.0 (2026-03-14)
- [INFORMATIVO -> ACEPTADO] `console.error` con `agent.path` en `handlerLogic.ts:188` cuando `rmSync` falla. Ruta en stderr del proceso principal, no viaja al renderer. Pre-existente a la feature, riesgo bajo.

### devtools-csp-produccion v1.0 (2026-03-14)
- Sin vulnerabilidades nuevas. Feature de seguridad: CSP corregida y DevTools cerrado en prod.
- CSP definitiva: `default-src 'none'; script-src 'self'; style-src 'self'; connect-src ws://localhost:*;`
- `connect-src ws://localhost:*` es el minimo obligatorio para Electrobun IPC (puerto dinamico 50000-65535). No hay alternativa. Riesgo SSRF bajo: solo loopback, renderer no tiene fetch().
- `closeDevTools()` en produccion: limitacion de Electrobun — no previene apertura post-launch via atajos. Riesgo aceptado.

### settings-panel v1.0 (2026-03-14)
- [MEDIA -> RESUELTO en MVP audit 2026-04-19] `params.enhancerModel ?? ''` correcto en handlerLogic.ts:307,313. El fix con `??` esta en su lugar.

### monitor-pipeline-agentes v1.0 (2026-03-15)
- [BAJA -> ACEPTADA] `f.slug` y `b.slug` en `title="${...}"` sin escapeHtml en monitor-view.ts:75,103. Vector: nombre de directorio con comillas en docs/features/. Requiere acceso de escritura al filesystem del repo. En produccion docs/ no existe. No bloqueante.

### monitor-historial-metricas v1.0 (2026-03-15)
- Sin vulnerabilidades nuevas. Auditoria limpia: 0 criticas, 0 altas, 0 medias, 0 bajas.
- SQL injection: IN clause de queryAgentTrends genera placeholders dinamicos correctamente (agentIds.map(() => '?').join(', ')). Patron seguro confirmado.
- Sanitizacion IPC BUG #001: handlers.ts:229-231 aplica .replace(/[^\x20-\x7E]/g, '?') a itemTitle, fromValue, toValue. Patron correcto.
- closeHistoryDb() conectado a process.on('exit') y process.on('SIGINT') en desktop/index.ts:20-21. Cierre limpio confirmado.

### graficas-evolucion-metricas-agentes v1.0 (2026-03-15)
- Sin vulnerabilidades nuevas. Auditoria limpia: 0 criticas, 0 altas, 0 medias, 0 bajas.
- SQL injection: prepared statement con ? posicional en timelineRepository.ts:17-23. agentId nunca en el string SQL.
- VALID_AGENTS whitelist como constante de modulo (Ada refactor) — patron de referencia para handlers de consulta por agentId.
- escapeHtml en etiquetas SVG eje X (monitor-view.ts:220) — slugs del filesystem correctamente escapados.
- s.agentId sin escapeHtml en data-agent, data-agent-toggle, id= — filesystem local controlado, produccion sin docs/. Aceptado.

### metricas-comportamiento-agentes-tab v1.0 (2026-03-17)
- [BAJA -> ACEPTADA] Path traversal limitado en behaviorParser.ts:74: regex /[a-zA-Z0-9/_.-]+/ permite '..' en path extraido de status.md. existsSync(join(repoRoot, ref)) puede consultar rutas fuera del repo. Solo filtra existencia de archivo, no contenido. Requiere acceso de escritura a docs/. En produccion docs/ no existe. Fix: const resolved = path.resolve(repoRoot, ref); guard !resolved.startsWith(path.resolve(repoRoot) + path.sep).

### compliance-tracking-diff-rework v1.0 (2026-03-17)
- [BAJA -> ACEPTADA] ComplianceScoreIPC sin sanitizeForIpc: getComplianceScores retorna branch, featureSlug, baseRef sin sanitizar (handlers.ts:322). getRejectionPatterns si aplica sanitizeForIpc (handlers.ts:347-357). Asimetria del patron BUG #001. Impacto: corrupcion visual si rama tiene non-ASCII. En practica ramas siempre ASCII por convencion. No bloqueante.
- YAML parsing safety: extractYamlList usa RegExp con key hardcoded (caller control), no con input del usuario. Sin riesgo de ReDoS.
- spawnSync en compliance-check.ts: usa array de args (sin shell), sin command injection. baseRef y branch sin validacion de formato — aceptado para CLI de developer.
- escapeHtml completo en tab Compliance: todos los campos de texto libre (featureSlug, branch, agentAtFault, instructionViolated, instructionSource, agentId, mostFrequentViolation) con escapeHtml en monitor-view.ts. Correcto.
- INSERT OR IGNORE correctness: unique index es (feature_slug, agent_at_fault, instruction_violated) — sin recorded_at. Semanticamente correcto: mismo rechazo no se duplica aunque el poller re-parsee.

### MVP-audit-completo v1.0 (2026-04-19)
- [ALTA -> REMEDIADA en bug #020] openExternal sin validacion de URL en handlers.ts:268-275. Fix verificado: `new URL(params.url)` + whitelist `['https:', 'http:']` antes de `Utils.openExternal()`. Bug cerrado 2026-04-19.
- [BAJA -> ACEPTADA] agentId en pipeline steps sin validacion UUID en handlerLogic.ts:357-361. Falla segura via findById retornando null. Deuda tecnica pre-V1.
- [MEDIA -> ACEPTADA para MVP] acpManager.setMessageCallback singleton sobreescrito por pipelineRunner en pipelineRunner.ts:249. Chat y pipeline no concurrentes en MVP secuencial. Refactor necesario en V1.
- [BAJA -> ACEPTADA] console.log docsDir/repoRoot en produccion en handlers.ts:63-64. Paths de filesystem en stdout. Fix: guard NODE_ENV !== 'production'.
- [BAJA -> ACEPTADA] Gemini API key en query param de URL en handlerLogic.ts:667. Usar cabecera x-goog-api-key en su lugar.

## Patron recurrente detectado — validacion asimetrica de params IPC

En handleSaveSettings, `lmstudioHost` usa optional chaining `params?.lmstudioHost?.trim()` (linea 225) pero `enhancerModel` no usa `?.` en la validacion de longitud (linea 231). Este patron de validacion asimetrica es un vector recurrente: al añadir nuevos campos opcionales a un handler IPC, los campos que no son el "campo principal" tienden a omitirse de la defensa con optional chaining. Verificar sistematicamente que TODOS los campos de params usan `?.` o tienen un guard explicito de null/undefined antes de acceder a propiedades.

## Patron recurrente — sanitizeForIpc asimetrico entre handlers del mismo modulo

Cuando un handler aplica sanitizeForIpc() a campos de texto libre y otro handler del mismo modulo no lo hace, es el patron de "sanitizacion asimetrica entre handlers". Detectado en compliance-tracking-diff-rework: getRejectionPatterns sanitiza, getComplianceScores no. Al añadir un nuevo handler IPC de consulta, verificar que TODOS los campos de texto libre del resultado pasan por sanitizeForIpc() si pueden contener non-ASCII. Los campos numericos (score, filesOk, filesSpec, filesViol) y ISO 8601 (recordedAt) son siempre ASCII — no requieren sanitizacion.

## Patron recurrente — escapeHtml incompleto en atributos HTML

En renderizadores que usan template literals para innerHTML, es facil olvidar escapeHtml en atributos HTML (title=, data-*=) mientras si se aplica al contenido de texto. Checklist: auditar TODOS los `${...}` en template literals que van a innerHTML, no solo los del contenido visible — especialmente atributos como title, data-x, value, href. Los campos enum-bounded (AgentId, FeatureState, BugState, reworkTrend) son seguros sin escape porque TypeScript garantiza los valores posibles. Los campos de texto libre del filesystem (slug, branch, title, id) requieren escapeHtml sin excepcion.

## Patron recurrente — IN clause dinamica en SQL

Cuando se construye un IN clause con N elementos dinamicos, el patron seguro es: `ids.map(() => '?').join(', ')` para generar los placeholders, nunca interpolar los valores directamente. Verificado en historyRepository.ts:156-159 (queryAgentTrends). El riesgo es bajo cuando los ids provienen de datos internos (no del renderer), pero el patron debe aplicarse igualmente.

## Patron recurrente — path traversal en parsers de contenido textual

Cuando un parser extrae paths de texto libre (regex sobre markdown/txt) y luego los usa en operaciones de filesystem, el regex debe prohibir explicitamente '..'. Patron inseguro: /[a-zA-Z0-9/_.-]+/ (permite '..' porque '.' esta en la clase). Patron seguro: verificar confinamiento post-join: `const r = path.resolve(root, ref); if (!r.startsWith(path.resolve(root) + path.sep)) return;`. Alternativa: `if (ref.includes('..')) continue;` antes del join. Aplica a cualquier parser que extraiga nombres de archivo de contenido no confiable.

## Patron recurrente — openExternal sin validacion de protocolo

Cada vez que se exponga un handler IPC que llame Utils.openExternal() o equivalente, validar el protocolo de la URL ANTES de la llamada. Patron minimo obligatorio: `const parsed = new URL(params.url); if (!['https:', 'http:'].includes(parsed.protocol)) return { success: false };`. Sin esta validacion, el renderer puede invocar protocolos del OS (file:, smb:, javascript:, etc.). El renderer actual solo usa URLs hardcodeadas, pero el IPC es una superficie expuesta. Detectado en handlers.ts:268-275 en MVP audit 2026-04-19. REMEDIADO en bug #020 (2026-04-19).

## Riesgos aceptados

- `(rpc as any).send.xxx` — cast de TypeScript por limitacion del generics de Electrobun, no es vulnerabilidad
- stderr inherit en acpManager — logs de agente visibles en proceso principal, aceptable en desktop local
- `console.log viewUrl` en main.ts — ruta de archivo local, sin datos sensibles
- Permisos del archivo `worflow.db` heredados del umask del proceso — aceptable en `%APPDATA%` / `~/Library`
- API key plaintext en memoria JS entre IPC y encriptacion — inherente al runtime JS, no mitigable
- API key plaintext en IPC local renderer→main — aceptable en threat model desktop local
- `agent.path` en `console.error` de `handlerLogic.ts:188` — stderr del proceso local, no viaja al renderer
- `closeDevTools()` no previene apertura manual post-launch — limitacion de Electrobun, mitigacion maxima posible
- `connect-src ws://localhost:*` wildcard de puerto — inevitable para IPC Electrobun, solo loopback, renderer sin fetch()
- `lmstudioHost` sin validacion de formato URL en settings — SDK maneja el error de conexion WebSocket con fallback
- `dataDir` (USER_DATA_DIR) viaja por IPC como campo informativo readonly — ruta del filesystem, no secret
- Strings non-ASCII en lmStudioEnhancer.ts:24,51 — capturados en stderr por promptEnhancer, no viajan por IPC
- slug sin escapeHtml en title= (monitor-view.ts:75,103) — filesystem local controlado, produccion sin docs/
- itemSlug no sanitizado a ASCII en IPC del historial — slug del repo es siempre ASCII por convencion; produccion sin docs/
- h.from / h.to y s.agentId sin escapeHtml en template literals — valores enum hardcoded de PIPELINE_PAIRS/PIPELINE_ORDER, nunca input del usuario
- s.agentId sin escapeHtml en data-agent, data-agent-toggle, id="mon-charts-..." (monitor-view.ts:294,321,324) — nombre de directorio del repo, nunca input externo; produccion sin docs/
- behaviorParser.ts:74 existsSync sin confinamiento al repo — solo filtra existencia de archivo, no contenido; requiere acceso previo a docs/; produccion sin docs/
- ComplianceScoreIPC branch/featureSlug sin sanitizeForIpc en getComplianceScores (handlers.ts:322) — ramas siempre ASCII por convencion; impacto solo corrupcion visual BUG #001
- acpManager.setMessageCallback singleton sobreescrito en pipelineRunner.ts:249 — MVP es secuencial (no hay chat+pipeline concurrente), refactor en V1
- console.log docsDir/repoRoot en handlers.ts:63-64 produccion — paths informativos en stdout local, sin secrets
- Gemini API key como query param en handlerLogic.ts:667 — HTTPS sin proxy en desktop local, impacto bajo
- agentId en pipeline steps sin validacion UUID handlerLogic.ts:357-361 — falla segura via findById null, deuda tecnica

## Superficies de ataque del proyecto

1. **IPC handlers (main process)**: punto critico — datos del renderer llegan sin tipo en runtime. Mitigacion: validar todos los params antes de operaciones de filesystem o spawn. Patron: optional chaining `?.` en TODOS los accesos a campos de params, no solo en el campo principal.
2. **agentName -> path.join**: principal vector de path traversal. Siempre validar con `/^[a-z0-9-]+$/` antes de usar en rutas.
3. **innerHTML en renderer**: XSS si se descuida. Patron seguro: `textContent` para user input, `escapeHtml()` para datos del backend en innerHTML. Template literals estaticos en innerHTML son seguros solo si no tienen interpolaciones `${}` con datos externos. CRITICO: auditar tambien atributos HTML (title=, data-*=), no solo el contenido de texto.
4. **spawn en acpManager**: ejecuta `bun run start` en directorio del agente — el agentName valida que el path sea seguro.
5. **SYSTEM_ROLE en templates**: inyectado como string en codigo TypeScript. agentGenerator.ts escapa `"` y `\n` — suficiente para el contexto de template string.
6. **Campos de texto libre en DB**: no causan SQL injection por prepared statements. `role` ya tiene whitelist en handlers.ts.
7. **agentDir en IPC messages**: REMEDIADO en remove-agentdir-ipc. Patron: nunca incluir paths del filesystem en payloads IPC que el renderer no consuma.
8. **API key en IPC plaintext**: viaja del renderer al main antes de encriptarse. Aceptado en threat model desktop local.
9. **handleListAgents**: `r.path` (ruta del filesystem) correctamente excluido del mapper — solo se expone id, name, description, hasWorkspace, status, createdAt, provider. Verificar en futuras features que nuevos campos de DB no filtren paths al renderer.
10. **getHistory/getAgentTrends/getAgentTimeline/getAgentBehaviorTimeline/getComplianceScores/getRejectionPatterns**: handlers IPC de consulta con whitelist VALID_AGENTS y regex /^[a-z0-9-]+$/ para featureSlug. Patron de referencia para futuros handlers de consulta.
11. **Parsers de contenido textual -> filesystem**: regex que extrae paths de markdown/texto libre debe prohibir '..' o verificar confinamiento post-join. Patron detectado en behaviorParser.ts.
12. **spawnSync en scripts CLI**: usar siempre array de args (no string), sin shell:true. Elimina command injection incluso si los args contienen caracteres especiales.
13. **openExternal IPC handler**: REMEDIADO bug #020 — whitelist ['https:', 'http:'] via new URL(params.url).protocol en handlers.ts:268-279. Patron obligatorio para cualquier futuro handler que llame Utils.openExternal().

## Quirks de Electrobun relevantes para auditoria

- No hay `webPreferences.devTools: false` — el unico mecanismo es `win.webview.closeDevTools()` en runtime.
- CSP via `<meta http-equiv>` en index.html. El IPC usa `ws://localhost:<puerto-dinamico>` — `connect-src ws://localhost:*` es obligatorio.
- `default-src 'none'` cubre implicitamente `object-src` — no es necesario declararlo explicitamente cuando no hay plugins.
- El `define` de Bun en `build.bun` solo aplica al bundle del main process — NO al bundle del renderer (build.views.main).

## Historial de auditorias

| Fecha | Feature | Version | Resultado |
|---|---|---|---|
| 2026-03-07 | electrobun-migration | 1.0 | APROBADO — 2 vulns remediadas, 0 criticas |
| 2026-03-08 | persistencia-sqlite | 1.0 | APROBADO CON OBSERVACIONES — 0 criticas, 0 altas, 1 media pendiente |
| 2026-03-08 | prompt-enhancement | 1.0 | APROBADO CON OBSERVACIONES — 0 criticas, 0 altas, 1 media pendiente |
| 2026-03-13 | multi-provider-support | 1.0 | APROBADO CON OBSERVACIONES — 0 criticas, 0 altas, 1 media aceptada, 2 bajas pendientes |
| 2026-03-14 | remove-agentdir-ipc | 1.0 | APROBADO — 0 criticas, 0 altas, 0 medias, 0 bajas nuevas. Fix correcto y completo. |
| 2026-03-14 | devtools-csp-produccion | 1.0 | APROBADO — 0 criticas, 0 altas, 0 medias, 0 bajas. 2 riesgos aceptados (limitaciones de framework). |
| 2026-03-14 | settings-panel | 1.0 | APROBADO_CON_RIESGOS — 0 criticas, 0 altas, 1 media (TypeError enhancerModel sin optional chaining). |
| 2026-03-15 | monitor-pipeline-agentes | 1.0 | APROBADO_CON_RIESGOS — 0 criticas, 0 altas, 0 medias, 1 baja aceptada (slug sin escapeHtml en title=). |
| 2026-03-15 | monitor-historial-metricas | 1.0 | APROBADO — 0 criticas, 0 altas, 0 medias, 0 bajas. 3 riesgos aceptados (todos enum-bounded o produccion sin docs/). |
| 2026-03-15 | graficas-evolucion-metricas-agentes | 1.0 | APROBADO — 0 criticas, 0 altas, 0 medias, 0 bajas. 1 riesgo aceptado (agentId en atributos data-*, filesystem local). |
| 2026-03-15 | sync-docs-git-state | 1.0 | APROBADO — 0 criticas, 0 altas, 0 medias, 0 bajas. 1 riesgo informativo aceptado (path traversal via slug requiere acceso previo al repo). |
| 2026-03-17 | metricas-comportamiento-agentes-tab | 1.0 | APROBADO_CON_RIESGOS — 0 criticas, 0 altas, 0 medias, 1 baja (path traversal en verifyFileRefs). 4 riesgos aceptados. |
| 2026-03-17 | compliance-tracking-diff-rework | 1.0 | APROBADO_CON_RIESGOS — 0 criticas, 0 altas, 0 medias, 1 baja (ComplianceScoreIPC sin sanitizeForIpc). 4 riesgos aceptados. |
| 2026-04-19 | MVP-audit-completo (T-001 a T-013) | 1.0 | APROBADO_CON_RIESGOS — 0 criticas, 1 alta (openExternal sin validacion URL), 1 media (acpManager callback singleton), 4 bajas. 5 riesgos aceptados. |
| 2026-04-19 | bug #020 openExternal protocolo | 1.0 | APROBADO — 0 criticas, 0 altas, 0 medias, 0 bajas. Fix remedia el unico bloqueante de release. |
