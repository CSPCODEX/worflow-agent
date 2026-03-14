# Skill: commit

Genera un commit siguiendo Conventional Commits, stagea los archivos relevantes y usa siempre el co-author correcto.

## Uso

```
/commit
/commit "mensaje personalizado"
/commit --push
```

Si el usuario pasa un mensaje, usarlo como descripcion base. Si no, inferirlo de los cambios.

---

## Procedimiento

### 1. Analizar el estado actual

Ejecutar en paralelo:

```bash
git status
git diff HEAD
git log --oneline -5
```

### 2. Agrupar cambios por scope (OBLIGATORIO)

Antes de stagear nada, clasificar TODOS los archivos modificados/nuevos en grupos. Cada grupo = un commit separado.

**Reglas de agrupación:**

| Grupo | Archivos que incluye |
|---|---|
| `feat(<feature>)` o `fix(<feature>)` | `src/` cambios de implementacion de una sola feature |
| `docs(agents)` | `.claude/agents/*.md` |
| `docs(skills)` | `.claude/skills/*.md` |
| `docs(features/<slug>)` | `docs/features/<slug>/` — un commit por feature si los cambios son sustanciales |
| `docs(bugs/<id>)` | `docs/bugs/<id>-*/` — un commit por bug si los cambios son sustanciales |
| `docs(metrics)` | `docs/metrics/` |
| `chore(config)` | `.claude/settings.json`, `electrobun.config.ts`, `package.json`, etc. |

**Si todos los archivos pertenecen al mismo scope**, crear un único commit.
**Si hay archivos de 2+ scopes distintos**, crear un commit por scope, en orden logico (codigo → docs → chore).

### 3. Stagear y commitear en orden

Para cada grupo identificado en el paso 2:

```bash
git add <archivos del grupo>
git commit -m "..."
```

Nunca mezclar archivos de scopes distintos en un mismo `git add`. Nunca usar `git add -A` o `git add .`.

**Excluir siempre** (de todos los grupos):
- `.env` y cualquier archivo con credenciales o secrets
- `build/`, `dist/`, `.cache/` (artefactos de build)
- `.claude/settings.local.json` (configuracion local)
- Archivos binarios grandes no relacionados al cambio

### 4. Redactar el mensaje de commit

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
| `test` | Tests (aunque no hay en este proyecto aun) |
| `perf` | Mejora de rendimiento |
| `style` | Formato, whitespace (sin logica) |

**Reglas del mensaje:**
- Descripcion: maximo 72 caracteres, en español o ingles segun el estilo del repo (este repo usa español en descripciones y cuerpo)
- Si hay cuerpo, separar del titulo con una linea en blanco
- El cuerpo explica el "por que", no lista archivos
- El co-author es SIEMPRE `devlitus <developercarles@gmail.com>` — nunca omitirlo
- NUNCA añadir `Co-Authored-By: Claude` ni ninguna variante del co-author de Anthropic/Claude

**Ejemplo:**

```
feat(desktop): añadir acpManager para gestionar sesiones ACP

Centraliza el ciclo de vida de las sesiones ACP (spawn, connect,
stream, cleanup) separandolo de los handlers IPC para facilitar
el testing futuro y evitar fugas de procesos hijo.

Co-Authored-By: devlitus <developercarles@gmail.com>
```

### 5. Crear el commit (o los commits)

Siempre pasar el mensaje via HEREDOC para preservar el formato.

Si hay multiples grupos, ejecutar un `git add` + `git commit` por cada grupo, en secuencia:

```bash
# Grupo 1
git add <archivos grupo 1>
git commit -m "$(cat <<'EOF'
<tipo>(<scope1>): <descripcion>

Co-Authored-By: devlitus <developercarles@gmail.com>
EOF
)"

# Grupo 2
git add <archivos grupo 2>
git commit -m "$(cat <<'EOF'
<tipo>(<scope2>): <descripcion>

Co-Authored-By: devlitus <developercarles@gmail.com>
EOF
)"
```

Al terminar, mostrar el resumen de todos los commits creados (hash + titulo).

### 6. Push (solo si el usuario lo pidio con --push)

```bash
git push
```

Si la rama no tiene upstream:

```bash
git push -u origin <rama-actual>
```

### 7. Confirmar al usuario

Mostrar:
- Hash corto del commit
- Rama actual
- Si se hizo push, confirmarlo

---

## Reglas de seguridad

- Nunca committear `.env`, `*.key`, `*.pem`, archivos con passwords o tokens
- Si el usuario pide committear un archivo sospechoso, advertirle antes de proceder
- Nunca usar `--no-verify` salvo que el usuario lo pida explicitamente
- Nunca hacer force push salvo instruccion explicita del usuario
