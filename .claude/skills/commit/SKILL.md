---
name: commit
description: Genera commits siguiendo Conventional Commits con co-author devlitus. Solo Max puede invocar esta skill.
disable-model-invocation: true
argument-hint: "[--push]"
---

# Skill: commit

Genera commits siguiendo Conventional Commits. **Solo Max puede invocar esta skill.**

## Uso

```
/commit
/commit "mensaje personalizado"
/commit --push
```

---

## GATES — Condiciones obligatorias antes de commitear

**Esta skill BLOQUEA si no se cumplen las dos condiciones:**

### Gate 1 — Agente autorizado
Solo Max puede ejecutar esta skill. Si otro agente intenta commitear, responder:
```
BLOQUEADO: Solo Max puede hacer commits en este proyecto.
```

### Gate 2 — Aprobacion del ultimo agente del pipeline

**Para features:** Cipher debe haber escrito `APROBADO` en la seccion "Resultado de Cipher" del status.md correspondiente. Si Cipher no aparece en el status.md o su decision es `BLOQUEADO`, no commitear.

**Para bugs sin implicaciones de seguridad:** Max debe haber escrito "QA aprobado" o "QA aprobado con gaps conocidos" en "Resultado de verificacion (Max)" del status.md. No commitear si el estado es RECHAZADO o REABIERTO.

**Para bugs con implicaciones de seguridad:** Cipher debe haber escrito `APROBADO` o `APROBADO_CON_RIESGOS` en el status.md.

Si el gate no se cumple, responder:
```
BLOQUEADO: <feature/bug> aun no ha sido aprobado por <Cipher/Max>.
Estado actual en status.md: [estado encontrado]
```

---

## Procedimiento

### 1. Verificar los gates

Leer el status.md de la feature o bug activo y confirmar que el gate 2 se cumple antes de continuar.

### 2. Analizar el estado actual

Ejecutar en paralelo:

```bash
git status
git diff HEAD
git log --oneline -5
```

### 3. Agrupar cambios por scope (OBLIGATORIO)

Antes de stagear nada, clasificar TODOS los archivos modificados/nuevos en grupos. Cada grupo = un commit separado.

**Reglas de agrupación:**

| Grupo | Archivos que incluye |
|---|---|
| `feat(<feature>)` o `fix(<bug>)` | `src/` cambios de implementacion de una sola feature/bug |
| `test(<scope>)` | `tests/` — separado del codigo de produccion |
| `docs(agents)` | `.claude/agents/*.md` |
| `docs(skills)` | `.claude/skills/**/*.md` |
| `docs(features/<slug>)` | `docs/features/<slug>/` |
| `docs(bugs/<id>)` | `docs/bugs/<id>-*/` |
| `docs(tasks)` | `docs/tasks/` |
| `chore(config)` | `electrobun.config.ts`, `package.json`, config files |

**Si todos los archivos pertenecen al mismo scope**, crear un unico commit.
**Si hay archivos de 2+ scopes distintos**, crear un commit por scope, en orden logico (codigo → tests → docs → chore).

### 4. Stagear y commitear en orden

Para cada grupo:

```bash
git add <archivos del grupo>
git commit -m "..."
```

**Nunca** usar `git add -A` o `git add .`.

**Excluir siempre** de todos los grupos:
- `.env` y cualquier archivo con credenciales o secrets
- `build/`, `dist/`, `.cache/` (artefactos de build)
- `.claude/settings.local.json`
- Archivos binarios no relacionados al cambio

### 5. Redactar el mensaje de commit

Seguir el formato **Conventional Commits**:

```
<tipo>(<scope>): <descripcion en minusculas, imperativo, sin punto final>

[cuerpo opcional — explicar el "por que", no el "que"]

Co-Authored-By: devlitus <developercarles@gmail.com>
```

**Tipos validos:**

| Tipo | Cuando usarlo |
|---|---|
| `feat` | Nueva funcionalidad |
| `fix` | Correccion de bug |
| `refactor` | Reestructura sin cambiar comportamiento |
| `docs` | Solo documentacion |
| `chore` | Tareas de mantenimiento (deps, config, build) |
| `test` | Tests |
| `perf` | Mejora de rendimiento |
| `style` | Formato, whitespace (sin logica) |

**Reglas del mensaje:**
- Descripcion: maximo 72 caracteres, en español
- Si hay cuerpo, separar del titulo con una linea en blanco
- El cuerpo explica el "por que", no lista archivos
- Co-author es SIEMPRE `devlitus <developercarles@gmail.com>` — nunca omitirlo
- NUNCA añadir `Co-Authored-By: Claude` ni ninguna variante de Anthropic/Claude

### 6. Crear los commits (via HEREDOC)

```bash
git add <archivos grupo 1>
git commit -m "$(cat <<'EOF'
<tipo>(<scope>): <descripcion>

Co-Authored-By: devlitus <developercarles@gmail.com>
EOF
)"
```

Repetir por cada grupo en orden.

### 7. Push (solo si el usuario lo pidio con --push)

```bash
git push
```

Si la rama no tiene upstream:

```bash
git push -u origin <rama-actual>
```

**Nunca hacer push sin que el usuario lo haya pedido explicitamente.**

### 8. Confirmar al usuario

Mostrar:
- Hash corto + titulo de cada commit creado
- Rama actual
- Si se hizo push, confirmarlo

---

## Reglas de seguridad

- Nunca committear `.env`, `*.key`, `*.pem`, archivos con passwords o tokens
- Nunca usar `--no-verify` salvo instruccion explicita del usuario
- Nunca hacer force push salvo instruccion explicita del usuario
- **Nunca hacer merge de ninguna rama** — ni con `git merge`, ni con `gh pr merge`, ni de ninguna otra forma
