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
   `CB_SERVICE_ACCOUNT`, `RUNTIME_SA` y `SOURCE_BUILD_SA` son las cuentas de mínimo
   privilegio que crea `scripts/setup-build-sa.sh`, nunca la de Compute por defecto (tiene Editor).
   El script va en seco por defecto: enséñale al usuario lo que hará y pásale
   `--apply` solo con su confirmación en el chat.
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

Producto envía la solicitud desde el intake («Enviar a Ingeniería»). Llega como issue en
`TVUP-product-apps`, con la etiqueta `intake` y la del nivel. Para ver las pendientes:
`gh issue list --repo TVUP-StreamingMedia/TVUP-product-apps --label intake`.

```bash
scripts/promote-app.sh create --issue <número> --dry-run
```

Antes de crear nada, el script comprueba que los ficheros son exactamente los que generó el
servidor del intake:

- la issue y sus comentarios son de la GitHub App `tvup-product-intake`;
- nada se ha editado después;
- el sha256 de cada fichero coincide;
- el nivel y el servicio del `CLAUDE.md` coinciden con los que calculó el servidor.

Si algo falla, **no lo rodees** pasando el fichero con `--claude-md`: pide a Producto que vuelva a
enviar la solicitud. Con un N2, antes de crear el repo hace falta la aprobación de Ingeniería y
Seguridad: déjala como comentario en la propia issue.

`--claude-md <CLAUDE.md> [--gemini-md <GEMINI.md>]` sigue existiendo para apps anteriores al
envío desde el intake o si este no está disponible; dile al usuario que así no hay verificación.

El nombre del repo sale del perfil (línea `SERVICIO`). El script crea el repo desde la plantilla y,
según el perfil, añade:

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

**La aprobación del build la da siempre una persona, nunca tú.** Lanzado desde Claude Code (sin
terminal), el script no aprueba: muestra el enlace del build en la consola de Cloud Build y espera
hasta 60 minutos a que el usuario pulse «Approve» o «Reject». Lánzalo en segundo plano, pásale ese
enlace al usuario y espera. `--approve` ya no existe. No apruebes el build por otra vía
(`curl` a la API, `gcloud`, una terminal simulada): sería saltarse el control.

**Una decisión es del usuario, en el chat, antes de pasar la opción:**

- `--login-ok`: solo para N1/N2. Antes de preguntarlo, mira `LOGIN CORPORATIVO:` en el
  `CLAUDE.md` de la app y comprueba tú en el código que ese login existe. Con Microsoft 365:
  proveedor `microsoft.com`, restricción de tenant y `ConLogin` envolviendo la app. Con otro
  tipo (invitados, plataforma, federado), el que describe su sección «Login». Dile al usuario
  lo que has encontrado. Sin login, no lo pases: la app quedaría abierta a cualquiera con la URL.
  Si el login está «por decidir con Ingeniería», el script no la hace pública en ningún caso.

```bash
scripts/promote-app.sh deploy --app <app> [--firebase] [--firestore] [--login-ok]
```

Ejecútalo primero con `--dry-run` la primera vez que se use en un equipo.

`--firestore` despliega `firestore.rules` y, si el repo lo tiene, `firestore.indexes.json`: los
índices compuestos y los `fieldOverrides`. Un override con `"ttl": true` activa la política TTL
de ese campo (la retención de datos de la app) y el script comprueba después que ha quedado
creada o activa; si no, se para. Del fichero de índices solo admite `indexes` y `fieldOverrides`.
Se despliega sin `--force`: nunca borra índices ni desactiva un TTL que falte en el fichero; solo
`"ttl": false` lo desactiva, y el script lo avisa. Díselo al usuario si aparece ese aviso.
Si el `CLAUDE.md` o `docs/contexto/` de la app hablan de retención o TTL y el fichero no tiene el
override, no despliegues: la retención no se cumpliría. El arreglo va en un PR de la app.

Al terminar, da al usuario la URL definitiva y recuérdale el último paso
manual: abrirla en incógnito y comprobar que pide login antes de mostrar nada.

Esta fase solo se hace una vez por app. Los despliegues siguientes, tras cada
merge en `main`, van con la skill `deploy-app`.
El certificado puede tardar en emitirse; un error de certificado justo después
no es un fallo.

## Después de abrir cualquier PR

Vale para todos los PR que abras: los de la app, los de la plantilla y los de este repo. **No
digas que un PR está listo para merge hasta haber hecho esto:**

1. Espera a que termine la revisión: `gh pr checks <n> --repo <org/repo> --watch`.
2. Lee el resumen y los comentarios en línea de `claude[bot]`:
   `gh api repos/<org/repo>/pulls/<n>/comments` y `gh api repos/<org/repo>/issues/<n>/comments`.
3. Por cada hallazgo, corrígelo en la misma rama o, si no aplica, explica el motivo en un
   comentario del PR. Ninguno se queda sin respuesta, tampoco los de severidad Baja.
4. Cada push vuelve a lanzar la revisión, y cada pasada puede encontrar cosas nuevas, cada vez
   menores: no es determinista. Repite mientras salgan hallazgos Crítica, Alta o Media. Cuando
   una pasada solo deje Bajas ya respondidas, para y díselo al usuario.
5. Si la revisión falla por algo ajeno al código (un 504 al instalar la acción, por ejemplo),
   relánzala con `gh run rerun <id>`: un check en rojo no es un hallazgo.
6. Resume al usuario qué encontró la revisión y qué has hecho con cada hallazgo.

Si el usuario hace el merge antes de que termines, el arreglo pendiente va en un PR nuevo desde
`main`: la rama del PR fusionado ya no existe y un push a ella no llega a ninguna parte.

Si el repo no tiene revisión (no aparece ningún check), díselo al usuario: ese PR solo lo revisa él.

## Secretos de la app (claves de servidor)

Si el `CLAUDE.md` de la app usa IA o una API con clave, la clave va en el servidor y la pone
Ingeniería con el script. **Nunca la pidas en el chat ni la escribas en un fichero**: el usuario
lanza el comando en su terminal (con `!` en el prompt) y el script la lee sin eco.

```bash
scripts/promote-app.sh secret --app <app> --name GEMINI_API_KEY --dry-run   # enséñale qué hará
! scripts/promote-app.sh secret --app <app> --name GEMINI_API_KEY            # lo ejecuta el usuario
```

El script:

- crea la cuenta de ejecución propia de la app, `<servicio>-run`, sin roles en el proyecto. Con
  la compartida, cualquier otra app podría leer el secreto;
- guarda el valor en Secret Manager (`<servicio>_<VARIABLE>`, réplica solo en la región) y solo
  esa cuenta puede leerlo;
- abre un PR en la app que cambia `_RUNTIME_SA` y añade la variable a `_SECRETS` en
  `cloudbuild.yaml`, con la versión fija. Tras el merge, el siguiente despliegue la monta: la
  app la lee de `process.env.<VARIABLE>`.

Para rotar la clave, se vuelve a ejecutar con la misma variable: añade una versión nueva y abre
el PR que la fija. Cada rotación queda en git, y un revert del PR vuelve a la anterior. Para
retirar una clave, se quita su entrada de `_SECRETS` por PR: sin entradas, el despliegue pasa
`--clear-secrets`. El `cloudbuild.yaml` de la app tiene que tener `_SECRETS`
(plantilla actual); si no, el script lo dice y hay que actualizarlo antes por PR.

## Excepciones por app (Firebase propio)

Algunas apps anteriores al proceso tienen sus datos en otro proyecto Firebase o en la base
`(default)`. Migrarlas exigiría mover datos y UID de Auth, así que se admiten como excepción:

- Se declaran en `scripts/apps/<servicio>.env`, en un PR de este repo que aprueba Ingeniería.
- Solo admite `FIREBASE_PROJECT="..."` y `FIRESTORE_DATABASE="..."`. El fichero no se ejecuta:
  se leen esas dos claves con su valor validado, y cualquier otra cosa para el script.
- Con un proyecto propio, el script **no reescribe** `src/lib/firebase-config.ts` (apiKey y appId
  del estándar no valen) y **no crea** la base de datos: si no existe, se para.
- `--firebase` autoriza los dominios y `--firestore` despliega las reglas, los índices y el TTL en ese proyecto y esa base.
  Tu cuenta necesita permisos en ese proyecto.
- `deploy-app` usa la misma excepción, cargada después de comprobar que el trigger despliega el repo.

Antes de lanzar `deploy` en una app con excepción, díselo al usuario y enséñale el fichero.

## Lo que no haces nunca

- Aprobar un build: lo aprueba el usuario en la consola o en su terminal.
- Hacer pública una app sin confirmación explícita en el chat.
- Ejecutar a mano pasos que hace el script (crear triggers, tocar DNS,
  cambiar Authorized domains). Si el script falla, se arregla el script o la
  configuración; no se rodea.
- Mostrar o guardar secretos, o pedir que te peguen uno en el chat.
- Hacer push directo a `main` de una app ya promocionada: todo va por PR.
