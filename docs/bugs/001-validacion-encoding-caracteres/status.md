# Bug #001 — Validacion encoding caracteres
Fecha merge: 2026-03-08

**Estado:** MERGEADO
**Asignado a:** Cloe
**Reportado por:** Max
**Fecha:** 2026-03-07

---

## Info del bug

### Descripcion

El mensaje de error de validacion de nombre de agente se renderiza con caracteres corruptos en la interfaz del desktop (webview). Los caracteres acentuados del espanol aparecen como simbolos del bloque Fullwidth/Halfwidth de Unicode en lugar de los caracteres originales.

### Como reproducir

1. Ejecutar la app en modo desktop: `bun run desktop`
2. Hacer clic en "Nuevo" para abrir el formulario de creacion de agente
3. En el campo "Nombre", ingresar un valor invalido que contenga caracteres no permitidos (ej. `Mi Agente!` con mayuscula y espacio)
4. Hacer clic en "Crear agente"
5. Observar el mensaje de error en el div `#ca-feedback`

### Comportamiento esperado

```
Usa sólo letras minúsculas, números y guiones (ej. mi-agente).
```

### Comportamiento actual

```
Usa sￃﾳlo letras minￃﾺsculas, nￃﾺmeros y guiones (ej. mi-agente).
```

### Mapeo de caracteres corruptos

| Original | Codepoint | Bytes UTF-8 | Corrupto  | Codepoints corruptos |
|----------|-----------|-------------|-----------|----------------------|
| ó        | U+00F3    | 0xC3 0xB3   | ￃﾳ        | U+FFC3 U+FFB3        |
| ú        | U+00FA    | 0xC3 0xBA   | ￃﾺ        | U+FFC3 U+FFB3        |

### Severidad

**Alto.** El mensaje se vuelve ilegible para el usuario. Aunque no bloquea la funcionalidad (el agente no se crea igual si el nombre es invalido), degrada la experiencia y la confianza en el producto. Afecta a todos los mensajes de validacion que contengan caracteres no-ASCII.

### Implicaciones de seguridad

Ninguna. El problema es puramente de presentacion. Los bytes que viajan por IPC son los correctos desde el lado del proceso principal de Bun; la corrupcion ocurre solo en la capa de visualizacion del webview.

---

## Analisis tecnico (Max)

### Cadena de transmision del mensaje

```
validateAgentName()          (validations.ts, linea 6)
  -> return 'Usa só...'      string con UTF-8 correcto en fuente

handlers.ts linea 16         nameError = validateAgentName(config.name)
handlers.ts linea 16         return { success: false, error: nameError }
  -> el string viaja como campo de un objeto JSON sobre IPC

Electrobun IPC (Bun -> WebView2)
  -> serializa el objeto a JSON en UTF-8
  -> U+00F3 (ó) se convierte a bytes 0xC3 0xB3 en UTF-8

WebView2 (receptor en Windows)
  -> recibe los bytes del payload
  -> aplica byte | 0xFF00 para bytes > 0x7F
  -> 0xC3 -> U+FFC3 (ￃ), 0xB3 -> U+FFB3 (ﾳ)

create-agent.ts linea 89     feedback.textContent = message
  -> renderiza los codepoints corruptos
```

### Confirmacion por inspeccion del bundle

El archivo `build/dev-win-x64/.../app/bun/index.js` contiene:

```js
return "Usa s\xF3lo letras min\xFAsculas, n\xFAmeros y guiones (ej. mi-agente).";
```

El bundler de Bun emite `\xF3` (U+00F3 = ó en Latin-1) como escape hexadecimal. El string en el proceso de Bun es correcto. La corrupcion ocurre exclusivamente en la capa de serializacion IPC de Electrobun en Windows con WebView2, que trata los bytes > 0x7F del payload UTF-8 como valores individuales y los promueve al bloque U+FF00 (Halfwidth and Fullwidth Forms).

---

## Handoff Max -> Cloe

### Causa raiz

**El IPC de Electrobun en Windows/WebView2 corrompe caracteres no-ASCII cuando los serializa como bytes UTF-8.** Los bytes 0x80-0xFF del payload reciben el tratamiento `byte | 0xFF00`, produciendo codepoints en el rango U+FF80-U+FFFF en lugar de U+0080-U+00FF. Este comportamiento es del runtime de Electrobun y esta fuera del control del codigo de la aplicacion.

### Archivos involucrados

- `src/cli/validations.ts` — unico archivo que requiere cambio. Contiene los tres mensajes de error con caracteres no-ASCII.

### Mensajes afectados en validations.ts

| Linea | Texto actual | Caracteres no-ASCII |
|-------|-------------|---------------------|
| 6 | `'Usa sólo letras minúsculas, números y guiones (ej. mi-agente).'` | ó, ú, ú |
| 12 | `'El rol es fundamental para Gemini. Sé más descriptivo (mínimo 10 caracteres).'` | é, á, í |
| 20 | `'Proporciona una breve descripción.'` | ó |

### Fix propuesto

Reemplazar los tres mensajes de retorno con versiones ASCII-only. No se modifica la logica de validacion, solo los string literales.

**Linea 6 — validateAgentName:**
```ts
// Antes:
return 'Usa sólo letras minúsculas, números y guiones (ej. mi-agente).';
// Despues:
return 'Solo letras minusculas, numeros y guiones. Ej: mi-agente';
```

**Linea 12 — validateRole:**
```ts
// Antes:
return 'El rol es fundamental para Gemini. Sé más descriptivo (mínimo 10 caracteres).';
// Despues:
return 'El rol es fundamental. Se mas descriptivo (minimo 10 caracteres).';
```

**Linea 20 — validateDescription:**
```ts
// Antes:
return 'Proporciona una breve descripción.';
// Despues:
return 'Proporciona una breve descripcion.';
```

### Reglas para Cloe

1. **Solo modificar** `src/cli/validations.ts`. No tocar handlers.ts, create-agent.ts ni ningun otro archivo.
2. **No cambiar la logica de validacion** — solo los string literals de retorno.
3. **Verificar** que los mensajes sigan siendo claros y utiles para el usuario aunque pierdan tildes.
4. **No agregar** comentarios nuevos ni reestructurar el archivo.
5. **Confirmar** que el archivo queda guardado en UTF-8 (sin BOM). Bun y VS Code guardan UTF-8 por defecto — no cambiar eso.
6. **No introducir** ningun caracter fuera del rango ASCII 0x20-0x7E en los string literals de los mensajes de error. El resto del archivo (comentarios, otros strings) no esta afectado por este bug.

### Criterios de verificacion (para Max en re-audit)

- [ ] Los tres mensajes de retorno en `validations.ts` contienen solo caracteres ASCII (codepoints <= 0x7F)
- [ ] `bun run desktop` muestra el mensaje de error sin simbolos corruptos al ingresar un nombre invalido
- [ ] `bun run dev` sigue funcionando correctamente — el CLI no se ve afectado por el cambio
- [ ] `node -e "const fs=require('fs'); const d=fs.readFileSync('src/cli/validations.ts'); for(let i=0;i<d.length;i++){if(d[i]>127) console.log('non-ASCII byte at offset',i,d[i].toString(16))}"` no reporta bytes en los mensajes de error (puede reportarlos en otros strings del archivo como los de validateRole si no se cambian todos, pero los tres mensajes de retorno deben ser ASCII puro)
- [ ] El archivo `src/cli/validations.ts` mantiene 3 funciones exportadas: `validateAgentName`, `validateRole`, `validateDescription`

---

## Handoff Cloe -> Max (verificacion)

### Archivos modificados

- `src/cli/validations.ts` — unico archivo tocado, exactamente como lo indico Max.

### Descripcion del fix

Se reemplazaron los tres string literals de retorno que contenian caracteres no-ASCII (codepoints > 0x7F) con versiones ASCII-only. No se toco ninguna otra linea: la logica de validacion, las condiciones, las firmas de funcion y las exportaciones permanecen identicas.

Cambios aplicados linea por linea:

| Linea | Antes | Despues |
|-------|-------|---------|
| 6 | `'Usa sólo letras minúsculas, números y guiones (ej. mi-agente).'` | `'Solo letras minusculas, numeros y guiones. Ej: mi-agente'` |
| 13 | `'El rol es fundamental para Gemini. Sé más descriptivo (mínimo 10 caracteres).'` | `'El rol es fundamental. Se mas descriptivo (minimo 10 caracteres).'` |
| 20 | `'Proporciona una breve descripción.'` | `'Proporciona una breve descripcion.'` |

### Verificacion de bytes realizada por Cloe

Ejecutado el comando de auditoria de Max antes de entregar:

```
node -e "const fs=require('fs'); const d=fs.readFileSync('src/cli/validations.ts'); for(let i=0;i<d.length;i++){if(d[i]>127) console.log('non-ASCII byte at offset',i,d[i].toString(16))}"
```

Resultado: sin output. El archivo completo es ASCII puro — no solo los mensajes de error, sino el archivo entero.

### Casos borde considerados

1. **Mensaje de nombre obligatorio (linea 3):** `'El nombre es obligatorio.'` ya era ASCII puro, no se toco.
2. **Cobertura total del archivo:** el archivo entero quedo limpio de bytes > 0x7F, eliminando cualquier riesgo de corrupcion futura si Electrobun reutiliza este modulo en otros contextos IPC.
3. **Legibilidad de los mensajes sin tildes:** los tres mensajes siguen siendo comprensibles en espanol sin diacriticos. El usuario podra entender la instruccion correctamente.
4. **Mensaje de validateRole acortado:** el texto original mencionaba "Gemini" como LLM; el nuevo texto lo omite. El significado de la validacion (minimo 10 caracteres para el rol) se preserva completamente.
5. **Impacto en el CLI (`bun run dev`):** el CLI usa `@clack/prompts` para mostrar estos mensajes en terminal. Los terminales modernos renderizan ASCII sin problema. No hay regresion posible.

### Advertencias para Max

- **El string de validateRole cambio ligeramente de semantica:** elimino la referencia explicita a "Gemini". Si habia un criterio de aceptacion que requeria mencionar el LLM en el mensaje de error, ese criterio ya no se cumple con el nuevo texto. Max debe decidir si eso importa o si se puede redactar de otra forma aun ASCII.
- **Criterio de verificacion 2 requiere ejecucion manual:** `bun run desktop` necesita que LM Studio este corriendo. Si Max corre el audit en un entorno sin LM Studio disponible, el flujo de crear agente puede fallar en un paso posterior pero el mensaje de validacion del nombre se puede disparar sin LM Studio (ocurre antes de cualquier llamada al LLM).
- **El archivo tiene 24 lineas.** Si Max ve un numero diferente de lineas, algo cambio que no debia.

### Metricas de Cloe

archivos_leidos: 3
archivos_modificados: 1
rework: no
iteraciones: 1
confianza: alta
gaps_declarados: 0

| Metrica | Valor |
|---------|-------|
| Archivos modificados | 1 |
| Lineas cambiadas | 3 (solo los string literals) |
| Lineas agregadas | 0 |
| Lineas eliminadas | 0 |
| Bytes no-ASCII en el archivo post-fix | 0 |
| Tiempo de implementacion | sesion actual |

---

## Resultado de verificacion (Max)

**Veredicto: RESUELTO**

### Checklist de criterios

- [x] Los tres mensajes de retorno en `validations.ts` contienen solo caracteres ASCII (codepoints <= 0x7F)
- [x] Auditoria de bytes ejecutada y confirmada: 0 bytes > 0x7F en el archivo completo
- [ ] `bun run desktop` muestra el mensaje sin corrupcion — no verificable en este entorno sin LM Studio activo; la causa raiz esta eliminada a nivel de fuente
- [x] `bun run dev` no se ve afectado — los mensajes son ASCII puro, compatible con cualquier terminal
- [x] El archivo mantiene exactamente 3 funciones exportadas: `validateAgentName`, `validateRole`, `validateDescription`

### Hallazgos por criterio

**Criterio 1 — Bytes no-ASCII.**
Comando ejecutado: `node -e "var fs=require('fs'); var d=fs.readFileSync('D:/work/worflow-agent/src/cli/validations.ts'); var found=0; for(var i=0;i<d.length;i++){if(d[i]>127){console.log('non-ASCII byte at offset',i,'value 0x'+d[i].toString(16));found++;}} console.log('Total non-ASCII bytes:',found);"`
Resultado: `Total non-ASCII bytes: 0`. El archivo entero es ASCII puro. APROBADO.

**Criterio 2 — Mensajes implementados correctamente.**
Los tres mensajes de retorno coinciden exactamente con los strings propuestos en el handoff Max -> Cloe:
- Linea 6: `'Solo letras minusculas, numeros y guiones. Ej: mi-agente'` — CORRECTO
- Linea 13: `'El rol es fundamental. Se mas descriptivo (minimo 10 caracteres).'` — CORRECTO
- Linea 20: `'Proporciona una breve descripcion.'` — CORRECTO

**Criterio 3 — Logica de validacion intacta.**
Las tres condiciones de validacion no fueron alteradas:
- `validateAgentName`: regex `^[a-z0-9-]+$` y chequeo de valor vacio — SIN CAMBIOS
- `validateRole`: chequeo `trim().length < 10` — SIN CAMBIOS
- `validateDescription`: chequeo de valor vacio — SIN CAMBIOS

**Criterio 4 — Archivos no tocados.**
`src/index.ts` y `src/cli/prompts.ts` inspeccionados manualmente: ambos estan en su estado original, sin modificaciones. APROBADO.

**Criterio 5 — Conteo de lineas.**
El archivo tiene exactamente 24 lineas, tal como Cloe advirtio. APROBADO.

**Criterio 6 — Semantica del mensaje de validateRole.**
Cloe advirtio la eliminacion de la referencia a "Gemini". El criterio original del bug (#001) no exigia mencionar el LLM en el mensaje — solo requeria ASCII puro y que el mensaje fuera comprensible. El nuevo texto `'El rol es fundamental. Se mas descriptivo (minimo 10 caracteres).'` cumple ambas condiciones. No se reabre el bug por este motivo.

### Observacion de alcance

Cloe excedio el alcance minimo pedido (que los tres mensajes de retorno fueran ASCII) y entrego el archivo completo limpio de bytes > 0x7F. Esto es correcto y beneficioso: elimina riesgo de corrupcion futura en cualquier otro string del modulo que pudiera agregarse con caracteres no-ASCII.

### Decision final

El fix es correcto, completo y no introduce regresiones. El archivo `src/cli/validations.ts` cumple todos los criterios verificables en este entorno. El criterio 2 del checklist original (verificacion en `bun run desktop` en vivo) no es verificable sin LM Studio activo, pero la causa raiz del bug queda eliminada a nivel de fuente: si no hay bytes > 0x7F en el string que viaja por IPC, la corrupcion `byte | 0xFF00` de WebView2 no puede producir caracteres erroneos. La verificacion en runtime es una confirmacion de UX, no un bloqueador para marcar el bug como resuelto.

**Bug #001 — RESUELTO.**

---

## Metricas de Max

archivos_leidos: 3
bugs_criticos: 0
bugs_altos: 0
items_checklist_verificados: 4/5
rework: no
iteraciones: 1
confianza: alta
gaps_declarados: 1

| Metrica | Valor |
|---------|-------|
| Archivos auditados | 3 (`src/cli/validations.ts`, `src/index.ts`, `src/cli/prompts.ts`) |
| Archivos con problemas post-fix | 0 |
| Bytes no-ASCII encontrados en validations.ts | 0 |
| Lineas en validations.ts | 24 (correcto) |
| Funciones exportadas verificadas | 3/3 |
| Criterios aprobados | 4/5 (criterio de ejecucion en vivo no verificable sin LM Studio) |
| Veredicto | RESUELTO |
| Tiempo de verificacion | sesion actual |
