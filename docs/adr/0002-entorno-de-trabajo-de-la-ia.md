# ADR-0002: Qué puede tocar la IA en el entorno de ProductDev

**Estado:** Propuesta
**Fecha:** 2026-11-12
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

Separar **lo que hace la IA** de **lo que decide una persona**, en cinco pasos. Los dos primeros ya
están hechos; los tres siguientes son los que se proponen aquí.

### Hecho

1. **La aprobación del build la da siempre una persona** (PR #25). `--approve` desaparece. Los
   scripts preparan el build y muestran el enlace a la consola de Cloud Build; si se ejecutan sin
   terminal (desde el agente), esperan a que una persona apruebe o rechace allí. Las skills
   `promote-app` y `deploy-app` prohíben aprobar por otras vías.
   *Límite:* es un control de proceso. Mientras el agente use una cuenta con el rol de aprobador,
   podría aprobar llamando a la API. Lo cierra el paso 4.
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
   despliegue están excluidos del sandbox porque necesitan credenciales: se ejecutan con todos los
   permisos de la persona y solo los frena la confirmación de permisos de Claude Code. El sandbox
   protege del resto: dependencias, código que genera el agente y lecturas de ficheros.

### Propuesto

3. **Producto trabaja en un DevContainer sin credenciales de nube.** La plantilla incluye
   `.devcontainer/` con Node 24, pnpm, Java 21 y los emuladores de Firebase (`pnpm local`), y Claude
   Code con el sandbox ya activado. Dentro no hay gcloud, AWS ni Firebase reales. El acceso a GitHub
   es un token *fine-grained* limitado al repo de la app (contenido y PR, sin administración). Producto
   no necesita más: no despliega, y las reglas de Firestore se prueban en el emulador.
4. **Cuenta de despliegue con mínimo privilegio, sin rol de aprobador.** Ingeniería deja de lanzar
   los scripts con su cuenta personal de Owner. Se crea una cuenta de servicio de despliegue con solo
   lo que necesitan los scripts (Cloud Build, Cloud Run, Firestore reglas e índices, Firebase Auth
   dominios autorizados, Secret Manager por app). El rol `cloudbuild.builds.approver` queda solo en
   un grupo de personas, y esa cuenta no lo tiene. Así la aprobación humana pasa de ser una regla a
   ser un permiso de IAM.
5. **El despliegue sale de CI, no del portátil.** `release.sh` se ejecuta desde GitHub Actions con
   Workload Identity Federation (sin claves de cuenta de servicio) y un *environment* `produccion`
   con revisor obligatorio. El agente puede preparar y proponer; la ejecución con credenciales queda
   en un sistema auditado.

## Opciones consideradas

### A. Portátil + sandbox de Claude Code (estado actual tras los pasos 1 y 2)

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

### B. DevContainer para Producto (paso 3)

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

- **Comodidad frente a aislamiento.** Cada paso añade fricción: más confirmaciones, un contenedor,
  un CI. Se acepta porque los permisos actuales permiten a un error borrar o publicar en producción.
- **Reglas frente a permisos.** Los pasos 1 y 2 reducen el riesgo, pero dependen de la configuración
  local y de que el agente siga sus instrucciones. Solo los pasos 4 y 5 lo convierten en algo que el
  sistema impone (IAM y revisores obligatorios).
- **Producto e Ingeniería tienen necesidades distintas.** Producto no necesita credenciales de nube
  (paso 3). Ingeniería sí, pero no las de Owner ni el rol de aprobador en la misma cuenta que usa el
  agente (pasos 4 y 5).

## Consecuencias

- **Más fácil:** explicar y auditar quién aprobó cada despliegue; incorporar a alguien nuevo de
  Producto sin darle acceso a la nube.
- **Más difícil:** depurar un problema de producción desde la sesión del agente (no verá los logs
  sin la cuenta adecuada); mantener la imagen del DevContainer y la cuenta de despliegue.
- **Mientras no estén los pasos 3 a 5:** el sandbox y la aprobación humana son la protección. Los
  comandos excluidos (`gcloud`, `gh`, `firebase`, `aws`) siguen pidiendo confirmación: hay que leerla
  antes de aceptarla, no aceptarla siempre.

## Riesgos y preguntas abiertas

1. **Permisos exactos de la cuenta de despliegue.** Hay que medirlos ejecutando `promote-app.sh` y
   `release.sh` con una cuenta sin roles y añadiendo solo lo que falle. `setup-build-sa.sh` ya crea
   cuentas de mínimo privilegio para el build y la ejecución; puede ampliarse.
2. **Route 53.** El DNS está en AWS. ¿Se mantiene como paso manual de Ingeniería (como en dev-arena)
   o se da a la cuenta de despliegue un rol de AWS limitado a la zona `apps.tvup.cloud`?
3. **Cuentas personales.** Hay una cuenta personal de GitHub con sesión abierta en el mismo equipo.
   Conviene separarla del entorno de trabajo.
4. **Docker en Producto.** Confirmar licencias y que los equipos de Producto pueden ejecutarlo.

## Acciones

1. [x] Aprobación humana del build en los scripts y las skills (PR #25).
2. [x] Sandbox de Claude Code en el equipo de Ingeniería.
3. [ ] Distribuir la configuración del sandbox como configuración gestionada a todos los equipos que
       usen Claude Code.
4. [ ] Añadir `.devcontainer/` a la plantilla y al `esqueleto/`, con guía para Producto.
5. [ ] Crear la cuenta de despliegue de mínimo privilegio y quitar el rol de aprobador a las cuentas
       que usa el agente.
6. [ ] Mover `release.sh` a GitHub Actions con Workload Identity Federation y revisor obligatorio.
7. [ ] Retirar las credenciales de Owner del portátil desde el que trabaja el agente.
