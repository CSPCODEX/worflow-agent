---
name: bundle-check
description: Analiza y audita el bundle de Electrobun — tamaño de artefactos, dependencias innecesarias y tree-shaking. Usar tras optimizaciones o antes de un release.
---

# Skill: bundle-check

Procedimiento para analizar y auditar el bundle de Electrobun. Ejecutar despues de cada ronda de optimizacion o antes de un release para verificar que el tamaño esta bajo control.

## Objetivo de tamaño

| Componente | Limite aceptable | Limite critico |
|---|---|---|
| Bundle total de produccion | < 15 MB | > 20 MB |
| Main process (Bun runtime incluido) | < 10 MB | > 15 MB |
| Renderer (webview assets) | < 2 MB | > 5 MB |

## Procedimiento

### 1. Generar el build de produccion

```bash
bunx electrobun build
```

Observar la salida: Electrobun reporta el tamaño de los artefactos generados.

### 2. Analizar dependencias del main process

Listar las dependencias en `package.json` y evaluar cada una:

```bash
cat package.json | grep -A 20 '"dependencies"'
```

Para cada dependencia preguntar:
- ¿Se usa realmente en produccion o solo en dev?
- ¿Hay una alternativa mas ligera nativa de Bun/Web?
- ¿Se importa el paquete completo o solo lo que se necesita?

Dependencias a vigilar en este proyecto:
- `@agentclientprotocol/sdk` — necesaria, no hay alternativa
- `@lmstudio/sdk` — necesaria, no hay alternativa
- `dotenv` — reemplazable por `Bun.env` nativo (Bun carga `.env` automaticamente)

### 3. Detectar imports innecesarios en el renderer

El renderer (webview) no debe importar nada del main process ni de Node.js. Verificar:

```bash
grep -r "import.*from.*node:" src/renderer/
grep -r "require(" src/renderer/
```

Si hay imports de Node en el renderer, deben moverse al main process y exponerse via IPC.

### 4. Verificar tree-shaking

Bun hace tree-shaking automaticamente, pero solo si los imports son especificos:

```typescript
// Bien — tree-shakeable
import { copyTemplateAndInject } from './fileSystem';

// Malo — importa todo el modulo
import * as fs from './fileSystem';
```

Buscar imports con `* as` y evaluar si pueden ser mas especificos.

### 5. Detectar dependencias de dev en produccion

```bash
grep -E "(devDependencies|dependencies)" package.json -A 30
```

Asegurarse de que herramientas de desarrollo (tipos, linters, test runners) esten en `devDependencies` y no en `dependencies`.

`dotenv` puede moverse a devDependencies si se usa solo para desarrollo (Bun nativo maneja `.env` en produccion).

### 6. Analizar assets del renderer

```bash
find src/renderer -type f | xargs ls -lh | sort -k5 -rh | head -20
```

Imagenes, fonts o assets grandes deben:
- Estar comprimidos (WebP en lugar de PNG, woff2 en lugar de ttf)
- Cargarse lazy si no son criticos para el primer render

## Reporte de resultados

```
## Bundle Check — [fecha]
- Build exitoso: si/no
- Tamaño total: X MB
- Main process: X MB
- Renderer: X MB
- Estado: OK / ADVERTENCIA / CRITICO

## Hallazgos
- [dependencia o archivo]: [problema y sugerencia]

## Acciones tomadas
- [que se optimizo]
```

Actualizar `.claude/agent-memory/ada/MEMORY.md` con las metricas y los hallazgos.
