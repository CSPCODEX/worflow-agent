---
name: create-pr
description: Crea una Pull Request en GitHub. Solo Max puede invocar esta skill, y solo cuando el usuario lo pida explícitamente.
disable-model-invocation: true
argument-hint: "[titulo personalizado]"
---

# Skill: create-pr

Crea una Pull Request en GitHub. **Solo Max puede invocar esta skill, y solo cuando el usuario lo pida explicitamente.**

## Uso

```
/create-pr
/create-pr "titulo personalizado"
```

---

## GATES — Condiciones obligatorias

### Gate 1 — Solo cuando el usuario lo pide

**Nunca crear una PR de forma proactiva.** Solo ejecutar esta skill cuando el usuario diga explicitamente que quiere crear una PR. Si el usuario no lo pide, no crearla.

### Gate 2 — Agente autorizado

Solo Max puede crear PRs. Si otro agente intenta crear una PR, responder:
```
BLOQUEADO: Solo Max puede crear PRs en este proyecto.
```

### Gate 3 — Commits hechos

La rama debe tener al menos un commit nuevo respecto a main. Verificar con:
```bash
git log main..HEAD --oneline
```
Si no hay commits, no crear la PR.

### Gate 4 — Aprobacion del pipeline

Mismas condiciones que el gate 2 de `/commit`:
- Features: Cipher debe haber aprobado
- Bugs: Max final verification o Cipher (si hay implicaciones de seguridad)

---

## Procedimiento

### 1. Verificar los gates

Ejecutar en paralelo:
```bash
git log main..HEAD --oneline
git status
```

### 2. Recopilar informacion para la PR

Leer el `status.md` de la feature o bug correspondiente para extraer:
- Descripcion del cambio
- Agentes que participaron y sus resultados
- Gaps conocidos declarados
- Decision de Cipher o Max

### 3. Crear la PR con gh

```bash
gh pr create \
  --title "<tipo>(<scope>): <descripcion breve>" \
  --body "$(cat <<'EOF'
## Descripcion

<descripcion del cambio — que problema resuelve y por que>

## Cambios

<lista de archivos principales modificados con su proposito>

## Pipeline completado

| Agente | Estado |
|--------|--------|
| Leo    | ... |
| Cloe   | ... |
| Max    | ... |
| Ada    | ... |
| Cipher | ... |

## Gaps conocidos

<gaps declarados por los agentes, o "Ninguno">

## Test plan

- [ ] bun test — N pass, 0 fail
- [ ] tsc --noEmit — 0 errores nuevos
- [ ] [otros criterios segun la feature]
EOF
)"
```

**Reglas del titulo:**
- Maximo 70 caracteres
- Seguir Conventional Commits: `feat(scope):`, `fix(scope):`, etc.
- En español

**Reglas del body:**
- Nunca incluir "Generated with Claude Code" ni ningun enlace a claude.ai
- No incluir el co-author en el body — solo va en los commits
- Los gaps son informativos, no bloquean la PR

### 4. Confirmar al usuario

Mostrar la URL de la PR creada.

---

## Reglas absolutas

- **NUNCA hacer merge de la PR** — ni con `gh pr merge`, ni con `git merge`, ni de ninguna forma
- **NUNCA crear la PR sin que el usuario lo pida explicitamente**
- **NUNCA crear la PR si el pipeline no esta completo** (Cipher/Max no han aprobado)
- Si el usuario pide hacer merge, responder: "El merge debe hacerlo el usuario directamente en GitHub. Los agentes no pueden hacer merge."
