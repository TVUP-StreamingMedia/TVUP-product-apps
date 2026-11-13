# ADR-0002: Qué puede tocar la IA en el entorno de ProductDev

**Estado:** Aceptada (pasos 1 a 4); paso 5 propuesto
**Fecha:** 2026-11-12 (revisada el 2026-11-13)
**Deciden:** Ingeniería (CTO) y Seguridad

## Contexto

Las apps internas se construyen y se publican con Claude Code: Producto lo usa para escribir la
app, e Ingeniería lo usa para lanzar `promote-app.sh` y `release.sh`. Hasta ahora el agente se
ejecutaba **directamente en el portátil de quien lo usaba, con todas sus credenciales**.

Auditoría del 2026-11-12, en el equipo de Ingeniería desde el que se publicó dev-arena:

| Qué | Estado encontrado |
| --- | --- |
| Cuenta de gcloud | `roles/owner` del proyecto y `cloudbuild.builds.approver` |
| GitHub (`gh`) | Administrador de la organización; además, una cuenta personal con sesión abierta |
| AWS | Credenciales locales con acceso a Route 53 |
| DevContainer | No existe en la plantilla ni en este repo |
| Sandbox de Claude Code | No configurado |
| Reglas de permisos | 8 reglas `deny` (`rm -rf`, leer `.env`). Las reglas de Bash no son una barrera de seguridad: se rodean con otro comando |
| Aprobación del build | `promote-app.sh --approve` permitía que **el agente aprobara el build de producción**, y así se aprobó el de dev-arena (con confirmación en el chat, pero con credenciales de Owner) |

El gate de Cloud Build existe para que una persona decida qué llega a producción. Si el agente
tiene las mismas credenciales que esa persona, el gate solo depende de que el agente obedezca sus
instrucciones. Además, cualquier código que el agente ejecute (un script de instalación de una
dependencia, por ejemplo) hereda esas credenciales.

## Decisión

Separar **lo que hace la IA** de **lo que decide una persona**. Revisión del 2026-11-13: los pasos
1, 2 y 4 están hechos, el 3 cambia (sin DevContainer) y el 5 sigue propuesto.

### Hecho

1. **La aprobación del build la da siempre una persona** (PR #25). `--approve` desaparece. Los
   scripts preparan el build y muestran el enlace a la consola de Cloud Build; si se ejecutan sin
   terminal (desde el agente), esperan a que una persona apruebe o rechace allí. Las skills
   `promote-app` y `deploy-app` prohíben aprobar por otras vías.
   Desde el paso 4 ya no es solo un control de proceso: la cuenta que usa el agente no tiene el
   permiso de aprobar.
2. **Sandbox de Claude Code** (configuración local, `~/.claude/settings.json`). Los comandos del
   agente se ejecutan en un aislamiento del sistema operativo (Seatbelt en macOS):
   - no puede leer `~/.aws`, `~/.config/gcloud`, `~/.config/gh`, `~/.config/configstore` ni `~/.ssh`;
   - solo escribe en la carpeta de los repos y en las cachés de pnpm y Firebase;
   - solo sale a la red hacia npm y GitHub (`strictAllowlist`);
   - no puede ejecutar nada fuera del sandbox (`allowUnsandboxedCommands: false`) ni modificar su
     propia configuración.

   Verificado el 2026-11-12: leer credenciales, escribir fuera de los repos y conectar con un dominio
   no autorizado quedan bloqueados.
   *Límite:* `gcloud`, `gh`, `firebase`, `aws`, `git push/pull/fetch/clone` y los scripts de
   despliegue están excluidos del sandbox porque necesitan credenciales. Desde el paso 4, `gcloud`
   solo tiene los permisos de la cuenta de despliegue.
4. **Cuenta de despliegue con mínimo privilegio, sin rol de aprobador** (2026-11-13).
   - El equipo de Ingeniería solo tiene sesión de gcloud con `deploy@tvup.media`. Es una cuenta
     nominal de uso técnico: la usa solo el CTO, tiene verificación en dos pasos y ningún rol en el
     proyecto. Lo único que puede hacer es hacerse pasar por la cuenta de servicio `tvup-deploy`
     (configuración `deploy` con `auth/impersonate_service_account`, y ADC igual para `firebase`).
   - `tvup-deploy` tiene `cloudbuild.builds.viewer`, `cloudbuild.connectionViewer`, `logging.viewer`,
     `run.developer`, `firebaserules.admin`, `datastore.indexAdmin` y
     `serviceusage.serviceUsageConsumer`. **No puede aprobar ni rechazar builds, ni leer o cambiar IAM**
     (verificado: `getIamPolicy` denegado).
   - **Sin `serviceAccountUser` sobre las cuentas de ejecución de las apps.** Con ese permiso y
     `run.developer` podría desplegar en Cloud Run una revisión con cualquier imagen
     (`gcloud run deploy --image`), sin pasar por Cloud Build ni por la aprobación, y con la cuenta
     que lee los secretos de la app. Se dio por error el 2026-11-13 y se retira. Hay que comprobar que
     el rollback (`update-traffic`) funciona sin él; si no, el rollback se hace desde la consola o
     con un rol propio que no cree revisiones.
   - La cuenta personal de Owner salió del portátil (`gcloud auth revoke`). Se usa solo en el
     navegador: aprobar en la consola de Cloud Build y, en **Cloud Shell**, lo que crea recursos o
     permisos (`promote-app` `create`, `promote`, `deploy` y `secret`, y `setup-build-sa.sh`).
   - `release.sh` avisa si gcloud no usa la cuenta de despliegue (`DEPLOY_SA`).
   - Si otra persona de Ingeniería tiene que desplegar, tendrá su propia cuenta nominal. Nunca se
     comparte `deploy@`.

### Cambia: Producto con el sandbox, sin DevContainer

3. **Producto trabaja con el sandbox de Claude Code impuesto por configuración gestionada**
   (`/Library/Application Support/ClaudeCode/managed-settings.json`, que el usuario no puede cambiar),
   con la misma política del paso 2. En sus equipos solo tienen su usuario normal de GitHub, sin
   gcloud ni AWS, así que el riesgo que queda es menor que en Ingeniería.

   Se probó un DevContainer en dev-arena (PR #8, en borrador). Funcionó, pero se descarta para
   Producto por dos motivos:
   - **Fricción:** Docker, VS Code, un token por repo y reconstrucciones, para personas que no
     trabajan habitualmente en entornos de desarrollo.
   - **Aislamiento incompleto:** con la carpeta del Mac montada, el contenedor puede dejar ficheros que
     luego se ejecutan en el Mac (`.git/`, `.claude/settings.local.json`, `.envrc`). Además, VS Code
     comparte con el contenedor las credenciales de git del Mac.

   Para que fuera una frontera real habría que clonar el repo dentro de un volumen del contenedor y
   desactivar el reenvío de credenciales. Queda anotado en el PR #8 por si se retoma para Ingeniería.

### Propuesto

5. **El despliegue sale de CI, no del portátil.** `release.sh` se ejecuta desde GitHub Actions con
   Workload Identity Federation (sin claves de cuenta de servicio) y un *environment* `produccion`
   con revisor obligatorio. El agente puede preparar y proponer; la ejecución con credenciales queda
   en un sistema auditado. *Pendiente:* el revisor obligatorio de los environments tampoco está
   disponible en repos privados con el plan actual de GitHub (ver riesgo 5).
## Opciones consideradas

### A. Portátil + sandbox de Claude Code (elegida para Producto, con configuración gestionada)

| Dimensión | Valoración |
| --- | --- |
| Complejidad | Baja |
| Coste | Ninguno |
| Aislamiento | Medio: protege ficheros y red; los comandos excluidos tienen todos los permisos |
| Conocimiento del equipo | Alto |

**A favor:** ya funciona, sin cambiar cómo se trabaja.
**En contra:** la configuración es de cada persona y de cada equipo; nadie garantiza que esté
puesta. Se puede imponer con la configuración gestionada de Claude Code
(`/Library/Application Support/ClaudeCode/managed-settings.json` en macOS), que el usuario no puede
cambiar.

### B. DevContainer para Producto (descartada el 2026-11-13: ver paso 3)

| Dimensión | Valoración |
| --- | --- |
| Complejidad | Media: imagen, emuladores, token por repo |
| Coste | Bajo (Docker Desktop o equivalente; revisar licencia) |
| Aislamiento | Alto: las credenciales no están dentro del contenedor |
| Conocimiento del equipo | Bajo en Producto: necesita una guía de arranque |

**A favor:** el entorno es igual para todos y viaja con la plantilla. Si el agente se equivoca o una
dependencia es maliciosa, el daño se limita al contenedor y a un repo.
**En contra:** requiere Docker en los equipos de Producto. No aplica a las apps de AI Studio, que ya
se ejecutan fuera del equipo.

### C. Entorno en la nube (Codespaces o Claude Code en la web)

**A favor:** nada se ejecuta en el portátil; el entorno se crea y se destruye por tarea.
**En contra:** coste por uso, y los datos de ejemplo y el código salen a un servicio más. Se deja
como alternativa si B resulta difícil de mantener en los equipos de Producto.

### D. No hacer nada más (confiar en las instrucciones del agente)

**Descartada:** las instrucciones (CLAUDE.md, skills) orientan al agente, pero no son un control. Un
error, una instrucción inyectada en un fichero o una dependencia comprometida actúan con las
credenciales de Owner.

## Análisis de los compromisos

- **Comodidad frente a aislamiento.** Cada paso añade fricción: más confirmaciones, Cloud Shell
  para crear apps, un CI. Se acepta porque con los permisos anteriores un error podía borrar o
  publicar en producción. Por la misma razón, para Producto pesa más la fricción del DevContainer
  que el aislamiento extra que da.
- **Reglas frente a permisos.** Los pasos 1 y 2 reducen el riesgo, pero dependen de la configuración
  local y de que el agente siga sus instrucciones. Solo los pasos 4 y 5 lo convierten en algo que el
  sistema impone (IAM y revisores obligatorios).
- **Producto e Ingeniería tienen necesidades distintas.** Producto no necesita credenciales de nube
  (paso 3). Ingeniería sí, pero no las de Owner ni el rol de aprobador en la misma cuenta que usa el
  agente (pasos 4 y 5).

## Consecuencias

- **Más fácil:** explicar y auditar quién aprobó cada despliegue; incorporar a alguien nuevo de
  Producto sin darle acceso a la nube.
- **Más difícil:**
  - Depurar producción desde la sesión del agente: solo ve lo que permite `tvup-deploy`.
  - Crear una app nueva: los pasos con permisos se hacen en Cloud Shell, que necesita una vez el repo,
    `gh` con sesión, `promote-app.env` y Node 24.
  - Mantener la configuración gestionada en los equipos de Producto.
- **Mientras no esté el paso 5:** la protección es la combinación del sandbox, la cuenta de
  despliegue sin aprobador y la aprobación en la consola. Los comandos excluidos del sandbox
  (`gcloud`, `gh`, `firebase`, `aws`) siguen pidiendo confirmación: hay que leerla antes de aceptarla.

## Riesgos y preguntas abiertas

1. ~~Permisos exactos de la cuenta de despliegue.~~ Medidos para `deploy-app` (paso 4). Si falta
   alguno, se añade solo el permiso que pida el error. Nunca se da Owner ni aprobador.
2. **Route 53.** El DNS está en AWS y sigue siendo un paso manual de Ingeniería, como en dev-arena.
   La alternativa es un rol de AWS limitado a la zona `apps.tvup.cloud`.
3. **Cuentas personales en GitHub.** El agente usa la sesión de `gh` del CTO, que es administrador de
   la organización. Puede crear PR, comentar y hacer push con esa cuenta. Separarlo necesita una
   identidad propia para el agente.
4. **La cuenta `deploy@` es de una persona.** Una segunda persona de Ingeniería tendrá su propia
   cuenta nominal; si no, la auditoría no distingue quién desplegó.
5. **El plan de GitHub no protege `main` en repos privados** (la API de protección de ramas responde
   403). Sin GitHub Team, `CODEOWNERS` no obliga, cualquier cuenta con escritura puede hacer push a
   `main` y no hay revisores obligatorios en los *environments*. **Se acepta de momento (2026-11-13).**
   Producción sigue protegida porque cada build espera a que una persona lo apruebe en la consola, y
   la cuenta del agente no puede aprobar. Hay que revisarlo si aumenta el número de apps o de
   personas con escritura.

## Acciones

1. [x] Aprobación humana del build en los scripts y las skills (PR #25).
2. [x] Sandbox de Claude Code en el equipo de Ingeniería.
3. [ ] Distribuir la configuración del sandbox como configuración gestionada a los equipos de Producto.
4. [x] ~~DevContainer en la plantilla~~: descartado para Producto. Piloto en dev-arena #8, en borrador.
5. [x] Cuenta de despliegue `tvup-deploy` sin aprobador, usada desde `deploy@tvup.media` (2026-11-13).
6. [ ] Mover `release.sh` a GitHub Actions con Workload Identity Federation (paso 5).
7. [x] Credenciales de Owner fuera del portátil desde el que trabaja el agente (2026-11-13).
8. [ ] Preparar Cloud Shell para `promote-app`: clonar el repo, `gh auth login`, `promote-app.env` y Node 24.
