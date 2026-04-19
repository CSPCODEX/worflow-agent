# Vision del Producto — Workflow Agent

## Mision

Permitir que cualquier persona defina un equipo virtual de agentes IA, les asigne roles, y ejecute tareas complejas de forma colaborativa, sin escribir codigo ni configurar infraestructura.

## Propuesta de valor

**"Tu equipo de agentes IA en un click."**

Workflow Agent transforma la interaccion uno-a-uno con un LLM en un sistema multi-agente donde cada agente tiene un rol especializado y los agentes colaboran en secuencia (pipelines) para resolver tareas complejas.

### Que resuelve

| Problema | Como lo resuelve Workflow Agent |
|---|---|
| Chatbots individuales no manejan tareas complejas | Pipelines secuenciales donde cada paso lo ejecuta un agente especializado |
| Orquestacion multi-agente requiere programacion | UI visual para definir pipelines sin codigo |
| Dependencia de APIs cloud costosas | Modelos locales (LM Studio, Ollama) como opcion por defecto, sin API keys |
| Herramientas de agentes son para desarrolladores | UI de escritorio intuitiva, cero terminal, cero archivos de configuracion |

## Publico objetivo

### Primario: Profesionales sin conocimientos tecnicos

- Marketeros que quieren un pipeline de creacion de contenido (investigar, redactar, revisar, publicar)
- Analistas de datos que quieren limpiar, analizar y visualizar datos automaticamente
- Escritores y creadores que quieren un equipo de revisores con diferentes perspectivas
- Pequenos empresarios que automatizan tareas con IA sin contratar desarrolladores

### Secundario: Desarrolladores y equipos tecnicos

- Quieren orquestar agentes sin configurar infraestructura
- Necesitan prototipar flujos multi-agente rapidamente
- Prefieren modelos locales por privacidad o costo

### No es publico objetivo (por ahora)

- Empresas que necesitan escalabilidad horizontal (miles de pipelines concurrentes)
- Usuarios que requieren integracion con APIs externas complejas (CRM, ERP)
- Equipos que necesitan colaboración en tiempo real multiusuario

## Diferenciadores vs competencia

| Aspecto | Workflow Agent | CrewAI | AutoGen / LangGraph | ChatGPT / Claude |
|---|---|---|---|---|
| **Tipo de usuario** | No tecnico | Desarrollador Python | Desarrollador Python | Cualquiera (1 agente) |
| **Modelos locales** | Nativo, gratis | Posible pero manual | Posible pero manual | No |
| **UI** | Desktop visual | Solo codigo | Solo codigo | Web chat |
| **Offline** | Completo | No | No | No |
| **Pipelines predefinidos** | Si (templates) | No | No | No |
| **Precio base** | Gratis (local) | Gratis (libreria) | Gratis (libreria) | Freemium (cloud) |
| **Curva de aprendizaje** | Minima | Media-alta | Alta | Minima |

### Ventajas competitivas clave

1. **Modelos locales como first-class citizen**: No es un add-on. La experiencia completa funciona sin internet.
2. **Pipelines predefinidos**: El usuario no parte de cero. Selecciona un template (contenido, codigo, datos) y lo personaliza.
3. **Desktop app**: No requiere servidor, no requiere navegador, no requiere cuenta. Descarga y usa.
4. **Pipeline visual**: Definir un flujo de agentes es tan simple como arrastrar y conectar bloques.

## Modelo de negocio potencial

### Gratis (MVP y siempre)

- Pipelines ilimitados con modelos locales
- Hasta 5 agentes simultaneos
- Templates basicos

### Pro (futuro, cuando haya demanda validada)

- Templates premium (industry-specific: legal, marketing tecnico, educacion)
- Integracion con APIs cloud como opcion premium
- Exportar/importar pipelines
- Colaboracion basica (compartir templates)

### Consideraciones

- El modelo de negocio NO es bloquear funcionalidad detras de un paywall
- La experiencia gratuita debe ser completa y funcional
- El revenue viene de conveniencia (templates premium) y escalado (cloud APIs), no de limitar lo local

## Nombre del producto

El nombre actual "Worflow Agent" (con el typo) es confuso y dificil de comunicar. Se propone:

**FlowTeam** — "Tu equipo de agentes IA"

Razones:
- Corto y memorable
- Comunica el concepto central: flujos + equipo
- Funciona como sustantivo ("Abre FlowTeam") y como verbo ("FlowTeamalo")
- Disponible como dominio y handles (pendiente verificar)

## Distribución y go-to-market

El riesgo principal no es técnico sino de adopción. La app puede ser perfecta y que nadie la descubra.

### Estrategia por fases

**Corto plazo — primeros 100 usuarios (lanzamiento MVP)**
- Reddit: r/LocalLLaMA, r/MachineLearning, r/productivity. El público de LLMs locales ya existe y busca herramientas.
- Hacker News: Show HN con demo en video de 60 segundos. El concepto se entiende viendo cómo funciona.
- No lanzar en Product Hunt hasta tener retención demostrada (10+ usuarios que lo usen voluntariamente cada semana).

**Medio plazo — tracción orgánica**
- Crear demos específicas por perfil: una para marketeros (Content Creator), una para devs (Code Review), una para escritores (Traductor). Publicar en YouTube/X.
- Templates como vector de distribución: publicar los JSON de templates en GitHub para que la comunidad los comparta y adapte.

**Largo plazo — comunidad**
- Marketplace de templates creados por usuarios: el contenido generado por la comunidad produce distribución orgánica.
- Integraciones con herramientas donde ya está el público objetivo (Obsidian, VS Code).

### Secuencia correcta

```
MVP funcional → 5-10 usuarios reales (red cercana) → feedback real → distribución pública
```

No lanzar públicamente hasta tener al menos 10 personas que lo usen sin que se les pida. Ese es el indicador de que hay valor real.

## Principios de producto

1. **Zero-config onboarding**: El primer pipeline debe ejecutarse en menos de 2 minutos desde la instalacion.
2. **Local-first**: Todo funciona sin internet. Las APIs cloud son un bonus, no un requisito.
3. **Progresivo**: El usuario puede empezar con un template y personalizarlo gradualmente. No hay cliff de complejidad.
4. **Transparente**: El usuario ve que hace cada agente en cada paso. No hay "magia" oculta.
5. **Recuperable**: Todo se guarda automaticamente. Si la app se cierra, el pipeline se puede reanudar.
