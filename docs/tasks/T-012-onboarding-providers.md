# T-012 — Onboarding y detección de providers locales

**Status:** DONE
**Phase:** Fase 1
**Agente responsable:** Cloe
**Depende de:** T-011, T-007
**Esfuerzo estimado:** 3 días

## Descripción

Implementar la pantalla de bienvenida (primera vez que se abre la app) y la detección automática de providers locales (LM Studio, Ollama). El usuario debe poder ejecutar su primer pipeline en menos de 2 minutos desde la instalación.

## Solución técnica

**`src/renderer/views/onboarding.ts`** — Pantalla de bienvenida

Mostrar solo la primera vez que se abre la app (check en settings: `onboarding_completed`).

Flujo de 3 pasos:
1. **Bienvenida** — Explicación de qué es FlowTeam en 2 frases + imagen/diagrama simple
2. **Configura tu modelo** — Auto-detectar providers locales via `detectLocalProviders` IPC:
   - Si hay alguno disponible: "¡Listo! Hemos detectado [LM Studio / Ollama]" → paso 3
   - Si ninguno: mostrar dos opciones con links de descarga + opción "Usar API cloud"
3. **¡Empieza!** — Botón "Ejecutar tu primer pipeline" que navega directamente al pipeline Content Creator pre-seleccionado

**Quick-start pipeline**

Botón "Probar con un ejemplo" visible en la pantalla principal (no solo en onboarding):
- Selecciona el template Content Creator
- Navega directamente al modal de variables del pipeline
- El usuario solo escribe el tema y click ejecutar

**Indicador de estado del provider en la UI principal**

Header o sidebar: punto verde/rojo que indica si hay un modelo local disponible:
- Verde: LM Studio u Ollama detectado y respondiendo
- Rojo: ningún provider disponible → tooltip "Configura tu modelo en Settings"
- Se actualiza cada 30 segundos via `detectLocalProviders` en background

## Criterios de aceptación

- [x] El onboarding aparece al abrir la app por primera vez (settings `onboarding_completed` = false)
- [x] El onboarding no vuelve a aparecer tras completarse (`onboarding_completed = true`)
- [x] La detección de LM Studio y Ollama funciona correctamente (verde/rojo según disponibilidad)
- [x] Si ningún provider local está disponible, se muestran los links de descarga
- [x] El botón "Ejecutar tu primer pipeline" lleva directamente al flujo de ejecución del Content Creator
- [x] El indicador de estado del provider en la UI principal se actualiza automáticamente
- [x] "Probar con un ejemplo" funciona desde la pantalla principal sin pasar por onboarding

## Subtareas

- [x] Crear `src/renderer/views/onboarding.ts` con los 3 pasos
- [x] Añadir check de `onboarding_completed` en `src/renderer/app.ts` al arrancar
- [x] Añadir key `onboarding_completed` en `settingsRepository.ts` (ya existe via set/get)
- [x] Implementar indicador de estado del provider en el layout principal
- [x] Añadir polling de 30s para `detectLocalProviders` en background
- [x] Crear botón "Probar con un ejemplo" en la vista principal (pipeline-list o pantalla de inicio)

## Notas

- Los links de descarga de LM Studio y Ollama deben abrirse en el navegador del sistema, no en el webview de la app. Usar `shell.openExternal()` de Electrobun o el equivalente.
- La recomendación de modelo por template (SPECIFICATIONS.md sección 6.4) se muestra aquí: si el modelo detectado es menor al recomendado para el template seleccionado, mostrar aviso no bloqueante.
