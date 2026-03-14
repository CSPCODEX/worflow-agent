# Bug #007 — delete-agent-ui-broken

## Status
`verified`

## Description
Al eliminar un agente, la UI queda en un estado roto:
- El header pierde el boton "+ Nuevo" y el titulo "Worflow"
- El sidebar muestra el contenido del agente sin estilos (nombre, descripcion, proveedor, boton "Eliminar" en bruto)
- El dialogo de confirmacion aparece fijo al fondo de la pantalla
- No se resetea al estado vacio correcto ("Sin agentes. Crea uno nuevo.")

## Expected
Despues de eliminar un agente, la UI debe mostrar:
- Sidebar con "+ Nuevo" y "Sin agentes. Crea uno nuevo." (si no quedan agentes)
- Area principal con "El agente ha sido eliminado."

## Reproduction
1. Tener al menos un agente creado
2. Hacer clic en el agente para seleccionarlo
3. Hacer clic en "Eliminar"
4. Confirmar la eliminacion en el dialogo

---

## Root Cause

**Causa principal: las clases CSS del componente `confirm-dialog` no existen en `style.css`.**

`src/renderer/style.css` (397 lineas) no contiene ninguna de las siguientes reglas:
- `.confirm-dialog-overlay`
- `.confirm-dialog`
- `.confirm-dialog-title`
- `.confirm-dialog-message`
- `.confirm-dialog-actions`
- `.btn-danger`

Tambien faltan estilos para clases generadas por `agent-list.ts`:
- `.agent-item-provider`
- `.agent-item-delete`
- `.agent-item-broken-badge`
- `.agent-item-error`

**Efecto en cadena de la falta de estilos del overlay:**

`confirm-dialog.ts` (linea 53) hace `document.body.appendChild(overlay)`. Sin CSS, el `div.confirm-dialog-overlay` no tiene `position: fixed` ni `z-index`. En el DOM queda como un bloque en flujo normal dentro de `<body>`, antes o despues de `<div id="app">`.

El HTML del `body` queda:
```
<body>
  <div id="app">...</div>          <!-- display:flex; height:100vh -->
  <div class="confirm-dialog-overlay">   <!-- SIN position:fixed — ocupa espacio en flujo -->
    <div class="confirm-dialog">
      <h3>Eliminar agente</h3>
      <p>Eliminar "nombre"? Esta accion...</p>
      <button>Cancelar</button>
      <button>Eliminar</button>
    </div>
  </div>
</body>
```

`body` tiene `overflow: hidden`. El `#app` tiene `height: 100vh` con `display: flex`. El overlay sin posicionamiento ocupa altura adicional en el body, pero como `overflow: hidden` esta activo, el contenido de `#app` no se hace scroll — en cambio, el stacking context del body hace que el overlay en flujo quede encima del `#app` visualmente, tapando el sidebar y el header. El resultado:

- El header (`.sidebar-header` con logo y boton) queda cubierto por el bloque del overlay
- El sidebar muestra el contenido bruto del overlay sin estilos (el `<p>` con el mensaje de confirmacion y los botones sin estilo)
- El dialogo aparece "al fondo" porque no tiene estilos de centrado ni fondo semitransparente
- Los botones "Cancelar" y "Eliminar" del dialogo SI son clickables pero tienen estilos de `btn-secondary` y nada para `btn-danger` (el boton de confirmar queda sin estilos)

**Causa secundaria: falta `position: fixed; inset: 0; z-index: alto` en `.confirm-dialog-overlay`.**

Sin `position: fixed`, el overlay no se superpone al contenido — ocupa espacio en el flujo del documento y rompe el layout de `#app`.

**El codigo TypeScript es correcto.** El flujo de `showConfirmDialog` -> `onConfirm` -> `rpc.request.deleteAgent` -> `agent:deleted` -> `refresh()` funciona. El bug es puramente de CSS faltante.

---

## Fix

Cloe debe agregar en `src/renderer/style.css` las reglas CSS del `confirm-dialog` y los estilos faltantes de `agent-list`.

### Bloque 1 — Confirm Dialog (critico, causa principal)

```css
/* Confirm Dialog */
.confirm-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
}

.confirm-dialog {
  background: #1e1e1e;
  border: 1px solid #3a3a3a;
  border-radius: 10px;
  padding: 24px;
  width: 360px;
  max-width: 90vw;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.confirm-dialog-title {
  font-size: 15px;
  font-weight: 600;
  color: #fff;
}

.confirm-dialog-message {
  font-size: 13px;
  color: #aaa;
  line-height: 1.5;
}

.confirm-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

.btn-danger {
  background: #7a2d2d;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
  font-weight: 500;
  transition: background 0.15s;
}

.btn-danger:hover {
  background: #963a3a;
}

.btn-danger:disabled {
  background: #4a2a2a;
  color: #888;
  cursor: not-allowed;
}
```

### Bloque 2 — Agent list items faltantes (necesarios para que el sidebar se vea correcto)

```css
.agent-item-provider {
  font-size: 10px;
  color: #666;
  margin-top: 2px;
  text-transform: capitalize;
}

.agent-item-delete {
  display: none;
  margin-top: 6px;
  font-size: 11px;
  background: transparent;
  border: 1px solid #5a2a2a;
  color: #d46a6a;
  border-radius: 4px;
  padding: 3px 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.agent-item:hover .agent-item-delete,
.agent-item.active .agent-item-delete {
  display: inline-block;
}

.agent-item-delete:hover {
  background: #3a1a1a;
}

.agent-item-broken-badge {
  font-size: 10px;
  color: #d46a6a;
  background: #3a1a1a;
  border-radius: 3px;
  padding: 2px 6px;
  margin-top: 4px;
  display: inline-block;
}

.agent-item.broken {
  opacity: 0.65;
  cursor: not-allowed;
}

.agent-item-error {
  font-size: 11px;
  color: #d46a6a;
  margin-top: 4px;
  display: block;
}
```

---

## Files Affected

- `src/renderer/style.css` — faltan TODAS las reglas de `.confirm-dialog-overlay`, `.confirm-dialog`, `.btn-danger` y varios estados de `.agent-item` (causa principal)
- `src/renderer/components/confirm-dialog.ts` — logica correcta, sin cambios requeridos
- `src/renderer/components/agent-list.ts` — logica correcta, sin cambios requeridos
- `src/renderer/app.ts` — logica correcta, sin cambios requeridos
- `src/ipc/handlers.ts` — logica correcta, sin cambios requeridos

---

## Diagnosed by
Max — 2026-03-14

## Fixed by
Cloe — 2026-03-14

---

## Handoff de Max -> Cloe

**Causa raiz confirmada leyendo el CSS real.**

`src/renderer/style.css` no contiene ninguna regla para `.confirm-dialog-overlay` ni para `.confirm-dialog`. El componente `confirm-dialog.ts` existe y es correcto, pero sus clases CSS nunca fueron escritas en el stylesheet.

El efecto: el overlay se inserta en `document.body` como un div en flujo normal (sin `position: fixed`), ocupa espacio vertical, y deforma el layout de `#app` que tiene `height: 100vh`. El resultado visible es el dialogo "flotando" sin estilos en la parte inferior del viewport, el header y sidebar aparentemente rotos porque el overlay en flujo los desplaza.

**Lo que debe hacer Cloe:**

1. Abrir `src/renderer/style.css`
2. Al final del archivo (despues de la linea 397, tras el bloque `@keyframes spin`), agregar los dos bloques CSS del Fix anterior: "Confirm Dialog" y "Agent list items faltantes"
3. No tocar ningun archivo `.ts`
4. No crear archivos nuevos

**Verificacion post-fix:**
1. Crear un agente
2. Hacer click en "Eliminar" en la lista del sidebar
3. Verificar que el overlay aparece centrado con fondo semitransparente, encima de todo el contenido
4. Hacer click en "Eliminar" dentro del dialogo
5. Verificar que el agente desaparece de la lista
6. Verificar que el sidebar muestra "Sin agentes. Crea uno nuevo."
7. Verificar que `main-content` muestra "El agente ha sido eliminado."
8. Verificar que el header (logo "Worflow" + boton "+ Nuevo") sigue visible en todo momento

**Accesibilidad a verificar:**
- El boton "Eliminar" del dialogo recibe foco automatico (ya implementado en confirm-dialog.ts linea 54)
- Escape cierra el dialogo (ya implementado en confirm-dialog.ts linea 42)
- `aria-modal="true"` y `aria-labelledby="cd-title"` ya estan en el markup

---

## Metricas de Max

- Archivos auditados: 7 (`agent-list.ts`, `confirm-dialog.ts`, `app.ts`, `handlers.ts`, `ipc.ts`, `style.css`, `index.html`)
- Bugs encontrados: 1 critico (CSS ausente), 0 en logica TypeScript
- Checklist: 2/7 items bloqueados por el bug CSS (flujo delete, reset de UI)
- Items aprobados: handlers IPC correctos, fire-and-forget correcto, escapeHtml correcto, aria en dialogo correcto, manejo de errores en UI correcto

---

## Verificacion Max — 2026-03-14

**Resultado: fix correcto y completo. Sin observaciones pendientes.**

### Bloque 1 — Confirm Dialog (lineas 400-462 de style.css)

Todas las reglas presentes y con valores correctos:

| Clase | Propiedad critica | Valor en CSS | Esperado | OK |
|---|---|---|---|---|
| `.confirm-dialog-overlay` | `position` | `fixed` | `fixed` | SI |
| `.confirm-dialog-overlay` | `inset` | `0` | `0` | SI |
| `.confirm-dialog-overlay` | `z-index` | `9999` | `9999` | SI |
| `.confirm-dialog-overlay` | `background` | `rgba(0,0,0,0.6)` | semitransparente | SI |
| `.confirm-dialog-overlay` | `display` | `flex` | `flex` | SI |
| `.confirm-dialog-overlay` | `align-items` | `center` | `center` | SI |
| `.confirm-dialog-overlay` | `justify-content` | `center` | `center` | SI |
| `.confirm-dialog` | presente con layout flex | SI | SI | SI |
| `.confirm-dialog-title` | presente | SI | SI | SI |
| `.confirm-dialog-message` | presente | SI | SI | SI |
| `.confirm-dialog-actions` | presente | SI | SI | SI |
| `.btn-danger` | presente con estados `:hover` y `:disabled` | SI | SI | SI |

### Bloque 2 — Agent list items (lineas 464-514 de style.css)

Todas las reglas presentes:

| Clase | Presente | OK |
|---|---|---|
| `.agent-item-provider` | SI | SI |
| `.agent-item-delete` | SI (con `display: none` por defecto) | SI |
| `.agent-item:hover .agent-item-delete` | SI | SI |
| `.agent-item.active .agent-item-delete` | SI | SI |
| `.agent-item-delete:hover` | SI | SI |
| `.agent-item-broken-badge` | SI | SI |
| `.agent-item.broken` | SI | SI |
| `.agent-item-error` | SI | SI |

### Auditoria de clases CSS usadas en .ts vs reglas en style.css

**confirm-dialog.ts — clases usadas en innerHTML/className:**
- `confirm-dialog-overlay` — regla en CSS: SI (linea 401)
- `confirm-dialog` — regla en CSS: SI (linea 411)
- `confirm-dialog-title` — regla en CSS: SI (linea 423)
- `confirm-dialog-message` — regla en CSS: SI (linea 429)
- `confirm-dialog-actions` — regla en CSS: SI (linea 435)
- `btn-secondary` (boton cancelar) — regla en CSS: SI (linea 125, pre-existente)
- `btn-danger` (boton confirmar) — regla en CSS: SI (linea 442)

**agent-list.ts — clases usadas en innerHTML/className:**
- `agent-item` — regla en CSS: SI (linea 52, pre-existente)
- `agent-item.broken` — regla en CSS: SI (linea 504)
- `agent-item-name` — regla en CSS: SI (linea 72, pre-existente)
- `agent-item-desc` — regla en CSS: SI (linea 77, pre-existente)
- `agent-item-provider` — regla en CSS: SI (linea 465)
- `agent-item-broken-badge` — regla en CSS: SI (linea 494)
- `agent-item-delete` — regla en CSS: SI (linea 472)
- `agent-item-error` (creado por showItemError) — regla en CSS: SI (linea 509)
- `agent-list-empty` — regla en CSS: SI (linea 86, pre-existente)

**Clases faltantes: ninguna.** Cobertura CSS: 100%.

### Puntos de accesibilidad

- `role="dialog"` en `.confirm-dialog`: presente en confirm-dialog.ts linea 17
- `aria-modal="true"`: presente en confirm-dialog.ts linea 17
- `aria-labelledby="cd-title"`: presente en confirm-dialog.ts linea 17
- `id="cd-title"` en `.confirm-dialog-title`: presente en confirm-dialog.ts linea 18
- Foco automatico en boton confirmar (`#cd-confirm`): presente en linea 54
- Escape cierra el dialogo: presente en linea 41-43
- Click fuera del dialogo cierra el overlay: presente en lineas 45-47
- `title="Eliminar agente"` en `.agent-item-delete`: presente en agent-list.ts linea 29
- Listener de keydown se elimina al cerrar (`document.removeEventListener`): presente en linea 34

Todo correcto.

### Observacion — `.agent-item` tiene `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`

El bloque `.agent-item` heredado (lineas 52-61) tiene `white-space: nowrap`. Los elementos hijos `.agent-item-provider`, `.agent-item-broken-badge`, `.agent-item-delete` y `.agent-item-error` son elementos de bloque o inline-block dentro de ese contenedor, por lo que heredan `white-space: nowrap`. En la practica esto no es un problema porque los textos son cortos (nombre del proveedor, "Sin conexion", "Eliminar", mensajes de error breves). No es un bug — es una limitacion estetica aceptable del contenedor pre-existente. Severidad: baja, fuera del scope de este bug.

### Conclusion

El fix implementado por Cloe es correcto, completo y sin regresiones. Los dos bloques CSS agregados al final de `style.css` (despues del bloque `@keyframes spin`, linea 398) cubren el 100% de las clases requeridas por `confirm-dialog.ts` y `agent-list.ts`. El overlay tendra `position: fixed; inset: 0; z-index: 9999` que resuelve la causa raiz del bug. La accesibilidad del dialogo es correcta.

**QA aprobado — listo para Ada.**
