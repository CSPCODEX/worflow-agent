# Bug #007 — Input y botón cortados fuera del viewport

## Status: FIXED

## Descripción
El área de input y el botón "Enviar" del chat quedan cortados: la mitad inferior queda fuera del viewport.

## Root Cause
Dos problemas en `src/renderer/style.css`:

1. `.chat-view` tiene `flex: 1` en un contenedor flex column pero sin `min-height: 0`. En CSS flex, el `min-height` por defecto es `auto`, lo que significa que el elemento no puede encogerse por debajo del tamaño de su contenido. Cuando hay mensajes, `.chat-view` intenta crecer más allá de `100vh` y el `.chat-input-area` queda fuera del viewport.

2. `.chat-input-area` no tiene `flex-shrink: 0`, lo que permite que el contenedor del input sea comprimido por el flex layout.

## Fix aplicado
- `src/renderer/style.css`:
  - Añadido `min-height: 0` a `.chat-view`
  - Añadido `flex-shrink: 0` a `.chat-input-area`

## Archivos modificados
- `src/renderer/style.css`
