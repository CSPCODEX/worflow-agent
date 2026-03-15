# Bug #008 — Boton ajustes no visible dentro del viewport

Estado: RESUELTO
Rama: bug/008-boton-ajustes-fuera-viewport
Fecha apertura: 2026-03-15

---

## Info del bug

**Descripcion:** El boton de ajustes (settings) no es visible dentro del viewport. Se puede ver parcialmente cortado en el borde inferior izquierdo del sidebar, fuera del area visible.
**Como reproducir:**
1. Abrir la app en modo desktop (`bun run desktop`)
2. Tener al menos 4-5 agentes creados para que `.agent-list` ocupe espacio vertical
3. Observar el sidebar izquierdo — el boton "Ajustes" en el footer queda cortado o fuera del viewport

**Comportamiento esperado:** El boton de ajustes debe ser visible y accesible dentro del sidebar, anclado al fondo del sidebar sin importar cuantos agentes haya en la lista.
**Comportamiento actual:** El boton aparece parcialmente visible en el borde inferior del sidebar, cortado por el limite del viewport.
**Severidad:** MEDIA
**Tiene implicaciones de seguridad:** NO

---

## Handoff Max → Cloe

> Max: diagnostico completado.

**Causa raiz identificada:**

El sidebar es un flex container vertical (`#sidebar: display:flex; flex-direction:column`). Dentro de el hay tres elementos apilados:

```
#sidebar (flex-direction: column, altura acotada por 100vh)
  ├── .sidebar-header   (tamaño fijo — sin flex-shrink, se mantiene)
  ├── .agent-list       (flex: 1 → consume TODO el espacio libre disponible)
  └── .sidebar-footer   (sin flex-shrink: 0 → se comprime y puede quedar fuera)
```

`.agent-list` tiene `flex: 1` (`style.css:47`), lo que le asigna todo el espacio flexible disponible en el eje principal. `.sidebar-footer` no tiene `flex-shrink: 0` (`style.css:517-520`), lo que significa que es el unico elemento que el algoritmo flexbox puede comprimir cuando hay presion de espacio. En la practica, como `.agent-list` ya consume el 100% del espacio restante con `flex: 1`, el footer es desplazado completamente fuera del area visible del sidebar (empujado beyond 100vh).

Ademas, `#sidebar` no tiene `overflow: hidden`, lo que permite que el footer sea visible parcialmente al asomarse por el borde inferior del viewport — lo que coincide con el reporte visual de "boton cortado en el borde inferior".

**Archivos involucrados:**

- `src/renderer/style.css` — unico archivo a modificar. Las reglas afectadas son:
  - `.agent-list` (linea 46-50): necesita `min-height: 0` ademas del `flex: 1` existente para que el overflow-y funcione correctamente dentro del flex container
  - `.sidebar-footer` (lineas 517-520): necesita `flex-shrink: 0` para que no sea comprimido ni desplazado

**Fix propuesto:**

Dos cambios minimos en `src/renderer/style.css`:

**Cambio 1 — `.agent-list` (linea 46-50):**
Añadir `min-height: 0` a la regla existente. Esto permite que el elemento con `flex: 1` y `overflow-y: auto` pueda encogerse correctamente dentro del flex container, cediendo espacio al footer.

```css
/* ANTES (style.css:46-50) */
.agent-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

/* DESPUES */
.agent-list {
  flex: 1;
  min-height: 0;     /* permite que overflow-y funcione dentro de flexbox */
  overflow-y: auto;
  padding: 8px 0;
}
```

**Cambio 2 — `.sidebar-footer` (lineas 517-520):**
Añadir `flex-shrink: 0` para que el footer siempre mantenga su tamaño y quede anclado al fondo del sidebar.

```css
/* ANTES (style.css:517-520) */
.sidebar-footer {
  padding: 12px 8px;
  border-top: 1px solid #2a2a2a;
}

/* DESPUES */
.sidebar-footer {
  padding: 12px 8px;
  border-top: 1px solid #2a2a2a;
  flex-shrink: 0;    /* ancla el footer al fondo, impide que sea comprimido */
}
```

Razonamiento: `flex-shrink: 0` en `.sidebar-footer` garantiza que el footer no sea comprimido. `min-height: 0` en `.agent-list` es necesario porque los navegadores (incluido el engine de WebView2) tratan por defecto `min-height: auto` en flex items, lo que impide que el scrolling funcione correctamente cuando el contenido supera el espacio disponible. Sin este fix, incluso con `flex-shrink: 0` en el footer, la lista podria desbordarse visualmente.

**Reglas que Cloe debe respetar:**
- No romper el flujo CLI existente (bun run dev, bun run chat) — este fix es solo CSS, sin impacto en el CLI
- Mantener type safety en IPC — este fix no toca IPC ni TypeScript
- Solo modificar `src/renderer/style.css` — no tocar HTML, TS, ni ningun otro archivo
- No cambiar valores de propiedades existentes (padding, border-top, etc.) — solo AÑADIR las propiedades faltantes
- No añadir `overflow: hidden` al `#sidebar` — no es necesario y podria ocultar otros elementos

**Criterios de verificacion para Max:**
- `.agent-list` en `style.css` tiene `min-height: 0` en su regla — evidencia: grep o lectura directa del archivo
- `.sidebar-footer` en `style.css` tiene `flex-shrink: 0` — evidencia: grep o lectura directa del archivo
- Ninguna propiedad existente fue modificada (solo adicion) — evidencia: diff del archivo
- El boton `#btn-settings` sigue presente en `index.html` dentro de `.sidebar-footer` — sin cambios en HTML

→ Siguiente: @cloe Implementa el fix del bug #008. Las instrucciones estan en docs/bugs/008-boton-ajustes-fuera-viewport/status.md seccion "Handoff Max → Cloe".

## Metricas de Max (diagnostico)
- archivos_leidos: 5
- bugs_criticos: 0
- bugs_altos: 0
- items_checklist_verificados: 3/3
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0

---

## Handoff Cloe → Max (verificacion)

> Cloe: fix aplicado.

**Archivos modificados:**

- `src/renderer/style.css` — linea 48: añadido `min-height: 0` a `.agent-list`; linea 521: añadido `flex-shrink: 0` a `.sidebar-footer`

**Descripcion del fix aplicado:**

Dos adiciones minimas de propiedades CSS, sin modificar ninguna propiedad existente:

1. `.agent-list` (linea 48): `min-height: 0` — necesario para que un flex item con `flex: 1` y `overflow-y: auto` pueda encogerse por debajo de su contenido cuando el contenedor tiene altura acotada. Sin este valor, WebView2 aplica `min-height: auto` implicito, impidiendo que la lista ceda espacio al footer.

2. `.sidebar-footer` (linea 521): `flex-shrink: 0` — garantiza que el footer no sea comprimido por el algoritmo flexbox, anclandolo siempre al fondo del sidebar visible.

**Verificacion ejecutada:**

- `grep -n "min-height: 0" src/renderer/style.css` → linea 48 confirmada
- `grep -n "flex-shrink: 0" src/renderer/style.css` → linea 521 confirmada
- `bun run tsc --noEmit` → 0 errores nuevos (errores existentes son todos en `scripts/metrics.ts`, preexistentes y no relacionados con este fix)
- No se tocaron archivos HTML, TypeScript ni ningun otro archivo

**Casos borde considerados:**

- Sidebar con 0 agentes: `.agent-list` vacia, footer visible correctamente (sin cambio de comportamiento)
- Sidebar con muchos agentes (lista larga): `.agent-list` hace scroll interno con `overflow-y: auto`, footer queda anclado fuera del scroll — comportamiento corregido
- Ventana muy pequena en altura: `min-height: 0` permite que la lista se comprima hasta 0px antes de comprimir el footer, que mantiene su altura por `flex-shrink: 0`

**Advertencias para Max:**

- Ninguna. Fix puramente aditivo en CSS; ninguna propiedad existente fue modificada.
- Los errores de TypeScript reportados por `tsc --noEmit` son preexistentes en `scripts/metrics.ts` y no guardan relacion con este bug.

### Checklist Cloe
- [x] Manifiesto completo: `src/renderer/style.css` modificado, lineas 48 y 521
- [x] Tipos TypeScript implementados — N/A (fix CSS puro)
- [x] bun run tsc --noEmit ejecutado — 0 errores nuevos
- [x] Strings que viajan por IPC — N/A (no hay IPC en este fix)
- [x] Fire-and-forget — N/A
- [x] Input validation — N/A
- [x] Sin `any` — N/A
- [x] Labels HTML — N/A (no se modifico HTML)
- [x] Clases CSS: solo propiedades nuevas en reglas existentes, sin clases nuevas

→ Siguiente: @max Verifica el fix del bug #008. El handoff de Cloe esta en docs/bugs/008-boton-ajustes-fuera-viewport/status.md seccion "Handoff Cloe → Max".

## Metricas de Cloe
- archivos_leidos: 2
- archivos_creados: 0
- archivos_modificados: 1
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 0

Sin gaps porque: fix de 2 lineas CSS aditivas en reglas existentes, tsc limpio, sin nueva logica, verificacion directa por grep confirma ambas propiedades en sus lineas correctas.

---

## Resultado de verificacion (Max)

> Max: verificacion completada.

**El bug esta resuelto:** SI

**Casos probados:**

1. Criterio: `.agent-list` tiene `min-height: 0`
   - Evidencia: `src/renderer/style.css:48` — `min-height: 0;     /* permite que overflow-y funcione dentro de flexbox */`
   - Propiedades existentes intactas: `flex: 1` (linea 47), `overflow-y: auto` (linea 49), `padding: 8px 0` (linea 50) — sin modificacion

2. Criterio: `.sidebar-footer` tiene `flex-shrink: 0`
   - Evidencia: `src/renderer/style.css:521` — `flex-shrink: 0;    /* ancla el footer al fondo, impide que sea comprimido */`
   - Propiedades existentes intactas: `padding: 12px 8px` (linea 519), `border-top: 1px solid #2a2a2a` (linea 520) — sin modificacion

3. Criterio: ninguna propiedad existente fue modificada
   - Evidencia: lectura directa de las reglas `.agent-list` (lineas 46-51) y `.sidebar-footer` (lineas 518-522) en `style.css` — solo se añadieron lineas 48 y 521 respectivamente; todos los valores previos (flex, overflow-y, padding, border-top) permanecen identicos

4. Criterio: `#btn-settings` sigue dentro de `.sidebar-footer` en index.html
   - Evidencia: `src/renderer/index.html:18-20` — `<div class="sidebar-footer"><button id="btn-settings" class="btn-settings">Ajustes</button></div>` — sin ningun cambio en HTML

### Checklist Max — ESTATICO | RENDERER

## ESTATICO
- [x] Cada archivo del manifiesto verificado con file:line — evidencia: `style.css:48` y `style.css:521` leidos directamente; `index.html:18-20` leido directamente
- [x] Sin logica de negocio rota en los archivos modificados — evidencia: fix puramente aditivo en CSS, sin logica de negocio, sin afectar TypeScript ni IPC

## RENDERER
- [x] Archivos CSS referenciados en el manifiesto revisados — evidencia: `style.css` leido completo, reglas `.agent-list` (lineas 46-51) y `.sidebar-footer` (lineas 518-522) verificadas
- [x] User input usa textContent o escapeHtml, no innerHTML — evidencia: no se modifico ningun archivo TS ni HTML que maneje user input

### No verificado por Max
- Prueba visual en entorno de ejecucion real (WebView2 activo con agentes cargados): entorno de escritorio no disponible en esta sesion. La correccion CSS es determinista — `min-height: 0` + `flex-shrink: 0` es el patron estandar documentado para este problema de flexbox.

Confianza en la verificacion: alta

**Casos que aun fallan (si los hay):** Ninguno.

**Decision:** Fix aprobado. Los dos cambios CSS son exactamente los especificados en el diagnostico, son puramente aditivos, no rompen ninguna propiedad existente, y el HTML permanece sin cambios.

**Requiere auditoria de Cipher:** NO

## Metricas de Max (verificacion)
- archivos_leidos: 3
- bugs_criticos: 0
- bugs_altos: 0
- items_checklist_verificados: 6/6
- rework: no
- iteraciones: 1
- confianza: alta
- gaps_declarados: 1

---

Estado final: RESUELTO

DONE. No invocar Ada ni Cipher salvo que "Requiere auditoria de Cipher" sea SI.
