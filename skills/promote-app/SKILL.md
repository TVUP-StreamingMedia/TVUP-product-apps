---
name: promover-app
description: Crea y promociona las apps internas de Producto de TVUP siguiendo el proceso gobernado. Crea el repo de una app nueva desde la plantilla con los ficheros del intake y su código base, y lleva el ZIP de Google AI Studio hasta producción en apps.tvup.cloud (revisión de Claude, gate de Cloud Build, dominio y Firebase). Úsala siempre que alguien de Ingeniería diga "crea el repo", "arranca la app", entregue los ficheros del intake (CLAUDE.md, GEMINI.md), diga "promociona", "pasa a producción", entregue un ZIP de AI Studio o pida aplicar las correcciones de un INFORME-REVISION.md, aunque no mencione la skill.
---

# Promover una app de Producto a producción

Esta skill orquesta `scripts/promote-app.sh`. **El script ejecuta todos los
cambios de infraestructura; tú no improvisas comandos de gcloud, aws ni de la
API de GitHub para esos pasos.** Tu trabajo es recoger los datos, lanzar el
script, interpretar lo que pase y llevar la parte que requiere criterio: aplicar
las correcciones de la revisión.

Solo la usa Ingeniería. Si quien te habla es de Producto, explícale que la
promoción la hace Ingeniería y ofrécele preparar el repo para ella.

## Antes de empezar

Comprueba, sin preguntar lo que puedas averiguar tú:

1. `scripts/promote-app.env` existe (si no, cópialo de `promote-app.env.example`;
   está en `.gitignore` y nunca se commitea) y tiene `GCP_PROJECT`,
   `FIREBASE_PROJECT` y el resto de `CAMBIAR` rellenos. Si faltan, pídeselos al
   usuario y escríbelos. En proyectos nuevos, `CB_SERVICE_ACCOUNT` es obligatorio,
   y `CB_REGION` debe ser la región de la conexión de Cloud Build con GitHub.
2. `ANTHROPIC_API_KEY` es **opcional**. El script no llama a Claude: solo la
   guarda como secreto del repo para la revisión de los PRs en GitHub Actions.
   Si no está en el entorno, el script sigue, avisa y no lanza la revisión del
   paso 12; recuerda al usuario que añada el secreto a mano
   (`gh secret set ANTHROPIC_API_KEY --repo <org>/<app>`). **Nunca la imprimas,
   ni la escribas en un fichero, ni le pidas al usuario que te la pegue.**
3. Necesitas: nombre del repo (`--app`), la ruta del ZIP y el `CLAUDE.md`
   generado por el intake. Si falta el `CLAUDE.md`, la promoción no puede
   seguir: el tier sale de ahí.
4. Pregunta si la app usa Firebase Auth (`--firebase`) y Firestore
   (`--firestore`). Si tienes el código, compruébalo tú buscando
   `firebase/auth` y `firebase/firestore`.

## Fase 0 — Crear el repo de la app

Cuando Producto entrega los ficheros del intake (antes de construir nada):

```bash
scripts/promote-app.sh create --claude-md <CLAUDE.md> [--gemini-md <GEMINI.md>] --dry-run
```

`--gemini-md` solo si la app se construirá en AI Studio. El nombre del repo sale del perfil
(línea `SERVICIO`). El script crea el repo desde la plantilla y, según el perfil, añade:

- el esqueleto de la app (Vite + React + TypeScript, con arranque para Cloud Run);
- el login Microsoft 365 ya funcionando, envolviendo la app;
- Firestore con su base de datos propia, reglas y `firebase.json`;
- `src/lib/firebase-config.ts` apuntando al proyecto estándar;
- `docs/contexto/` para que Producto describa lo que va construyendo.

Después dile al usuario qué tiene que hacer Producto: con Claude Code, clonar el repo; con
AI Studio, importarlo (Build → + → Import from GitHub) y pegar el `INSTRUCTIONS.md`.

Las apps N0 de AI Studio no llevan repo: les basta con el `INSTRUCTIONS.md`.

## Fase 1 — Promoción (pasos 7 a 12)

Ejecuta primero en seco y enseña al usuario qué va a pasar:

```bash
scripts/promote-app.sh promote --app <app> --zip <zip> --claude-md <CLAUDE.md> --dry-run
```

Si el repo se creó con `create` (lo normal), el código del ZIP se añade a ese mismo repo. El
script no deja que el ZIP pise los ficheros de gobierno y reescribe `firebase-config.ts` con el
proyecto estándar, porque AI Studio puede haberlo apuntado a su propio Firebase. Si el usuario
pregunta por qué cambió ese fichero, explícaselo.

Si está conforme, sin `--dry-run`. Al terminar, el informe queda en
`~/tvup-apps/informes/<app>/INFORME-REVISION.md`. Léelo y resume al usuario:
el riesgo global y los hallazgos Crítica y Alta, en una línea cada uno.

Si el script se para con un error, consulta `references/errores.md` antes de
proponer nada.

## Fase 2 — Corrección (pasos 13 a 16)

Esta es la parte que el script no hace.

1. `cd ~/tvup-apps/<app> && git checkout -b fix/revision`
2. Aplica los hallazgos del informe, de mayor a menor severidad. Sigue las
   reglas del `CLAUDE.md` del repo. Para el login usa la skill
   `login-microsoft365`; para datos, `firestore-tvup` (vienen en el repo,
   en `.claude/skills/`).
3. **No toques** `CLAUDE.md`, `cloudbuild.yaml` ni `.github/`: están bajo
   `CODEOWNERS` y no forman parte de las correcciones de la app.
4. Si un hallazgo te parece un falso positivo, no lo ignores en silencio:
   díselo al usuario con el motivo.
5. Commit, push y `gh pr create`. La revisión se lanza sola sobre el PR.
   Espera al resultado (`gh pr checks --watch`) y repasa los comentarios.
6. El merge lo decide el usuario. No hagas `gh pr merge` sin que te lo pida.

## Fase 3 — Despliegue (pasos 17 a 22)

**Dos decisiones son siempre del usuario, en el chat, antes de pasar la opción:**

- `--approve`: aprobar el build de producción. Pregúntalo explícitamente.
- `--login-ok`: solo para N1/N2. Antes de preguntarlo, comprueba tú en el
  código que existe el login de Microsoft 365 (proveedor `microsoft.com`,
  restricción de tenant) y dile lo que has encontrado. Sin login, no lo pases:
  la app quedaría abierta a cualquiera con la URL.

```bash
scripts/promote-app.sh deploy --app <app> [--firebase] [--firestore] [--approve] [--login-ok]
```

Ejecútalo primero con `--dry-run` la primera vez que se use en un equipo.

Al terminar, da al usuario la URL definitiva y recuérdale el último paso
manual: abrirla en incógnito y comprobar que pide login antes de mostrar nada.

Esta fase solo se hace una vez por app. Los despliegues siguientes, tras cada
merge en `main`, van con la skill `deploy-app`.
El certificado puede tardar en emitirse; un error de certificado justo después
no es un fallo.

## Lo que no haces nunca

- Aprobar un build o hacer pública una app sin confirmación explícita en el chat.
- Ejecutar a mano pasos que hace el script (crear triggers, tocar DNS,
  cambiar Authorized domains). Si el script falla, se arregla el script o la
  configuración; no se rodea.
- Mostrar o guardar secretos.
- Hacer push directo a `main` de una app ya promocionada: todo va por PR.
