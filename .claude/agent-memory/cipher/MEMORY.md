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

## Riesgos aceptados

- `(rpc as any).send.xxx` — cast de TypeScript por limitacion del generics de Electrobun, no vulnerabilidad
- stderr inherit en acpManager — logs de agente visibles en proceso principal, aceptable en desktop local
- `console.log viewUrl` en main.ts — ruta de archivo local, sin datos sensibles
- Permisos del archivo `worflow.db` heredados del umask del proceso — aceptable en `%APPDATA%` / `~/Library`
- DevTools y CSP deshabilitados en produccion — pendiente de release, documentado desde electrobun-migration
- API key plaintext en memoria JS entre IPC y encriptacion — inherente al runtime JS, no mitigable
- API key plaintext en IPC local renderer→main — aceptable en threat model desktop local
- `agent.path` en `console.error` de `handlerLogic.ts:188` — stderr del proceso local, no viaja al renderer

## Superficies de ataque del proyecto

1. **IPC handlers (main process)**: punto critico — datos del renderer llegan sin tipo en runtime. Mitigacion: validar todos los params antes de operaciones de filesystem o spawn.
2. **agentName -> path.join**: principal vector de path traversal. Siempre validar con `/^[a-z0-9-]+$/` antes de usar en rutas.
3. **innerHTML en renderer**: XSS si se descuida. Patron seguro: `textContent` para user input, `escapeHtml()` para datos del backend en innerHTML.
4. **spawn en acpManager**: ejecuta `bun run start` en directorio del agente — el agentName valida que el path sea seguro.
5. **SYSTEM_ROLE en templates**: inyectado como string en codigo TypeScript. agentGenerator.ts escapa `"` y `\n` — suficiente para el contexto de template string.
6. **Campos de texto libre en DB**: no causan SQL injection por prepared statements. `role` ya tiene whitelist en handlers.ts.
7. **agentDir en IPC messages**: REMEDIADO en remove-agentdir-ipc. Patron: nunca incluir paths del filesystem en payloads IPC que el renderer no consuma.
8. **API key en IPC plaintext**: viaja del renderer al main antes de encriptarse. Aceptado en threat model desktop local.
9. **handleListAgents**: `r.path` (ruta del filesystem) correctamente excluido del mapper — solo se expone id, name, description, hasWorkspace, status, createdAt, provider. Verificar en futuras features que nuevos campos de DB no filtren paths al renderer.

## Historial de auditorias

| Fecha | Feature | Version | Resultado |
|---|---|---|---|
| 2026-03-07 | electrobun-migration | 1.0 | APROBADO — 2 vulns remediadas, 0 criticas |
| 2026-03-08 | persistencia-sqlite | 1.0 | APROBADO CON OBSERVACIONES — 0 criticas, 0 altas, 1 media pendiente |
| 2026-03-08 | prompt-enhancement | 1.0 | APROBADO CON OBSERVACIONES — 0 criticas, 0 altas, 1 media pendiente |
| 2026-03-13 | multi-provider-support | 1.0 | APROBADO CON OBSERVACIONES — 0 criticas, 0 altas, 1 media aceptada, 2 bajas pendientes |
| 2026-03-14 | remove-agentdir-ipc | 1.0 | APROBADO — 0 criticas, 0 altas, 0 medias, 0 bajas nuevas. Fix correcto y completo. |
