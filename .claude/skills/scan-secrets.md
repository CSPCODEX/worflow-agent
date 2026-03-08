# Skill: scan-secrets

Escanea el codebase completo buscando secrets expuestos, credenciales hardcodeadas y configuraciones inseguras antes de un commit o release.

## Procedimiento

### 1. Buscar patrones de secrets en el codigo fuente

Busca en todos los archivos `.ts`, `.js`, `.json`, `.tpl`, `.md`:

- Claves API hardcodeadas: patrones como `sk-`, `AIza`, `ghp_`, `gho_`, `Bearer `, `api_key`, `apiKey`, `API_KEY`
- Tokens y passwords: `password`, `secret`, `token`, `private_key`, `access_key`
- URLs con credenciales embebidas: `://usuario:password@`
- Claves de LM Studio o servicios locales expuestas como strings literales

### 2. Verificar archivos .env

- Confirmar que `.env` existe en `.gitignore`
- Confirmar que ningun `.env` esta commiteado en git history: `git log --all --full-history -- "**/.env"`
- Verificar que `.env.example` (si existe) no contiene valores reales, solo placeholders

### 3. Verificar variables de entorno en IPC

- Buscar cualquier lugar donde `process.env` se pase completo al renderer via IPC
- Solo deben exponerse al renderer las variables estrictamente necesarias, una por una

### 4. Revisar logs

- Buscar `console.log` y `console.error` que impriman variables de entorno o configuracion sensible
- Especialmente en `src/generators/agentGenerator.ts` y `src/client.ts`

### 5. Revisar templates de agentes generados

- Verificar que `src/templates/basic-agent/index.ts.tpl` no hardcodea credenciales
- Confirmar que el `.env` generado para cada agente solo contiene `LM_STUDIO_MODEL=""` sin valores reales

### 6. Git history check

```bash
git log --all -p | grep -i "api_key\|secret\|password\|token" | head -50
```

## Reporte de resultados

Por cada hallazgo:
- Archivo y linea exacta
- Tipo de secret (API key, token, password, etc.)
- Severidad (critico si esta en git history, alto si esta en codigo activo)
- Accion requerida

Si no hay hallazgos: confirmar "scan-secrets: sin hallazgos — codigo limpio".

## Despues del scan

Actualizar `cipher-memory.md` con la fecha del scan y el resultado.
