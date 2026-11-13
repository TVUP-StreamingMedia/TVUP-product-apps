---
name: deploy-app
description: Despliega a producción los cambios de una app interna de TVUP ya promocionada. Enseña qué entra (commits, PR, resultado de la revisión de Claude, ficheros de gobierno), prepara el build de Cloud Build para que lo apruebe el usuario en la consola, despliega las reglas y los índices de Firestore (con su TTL) si cambiaron, verifica la URL y permite volver atrás. Úsala siempre que Ingeniería diga "despliega", "publica los cambios", "aprueba el build", "¿qué hay pendiente?", "sube a producción jira-hub", "vuelve atrás" o "rollback", aunque no mencione la skill. Para la primera vez que una app llega a producción, usa promote-app.
---

# Desplegar cambios de una app ya promocionada

Cuando se hace merge de un PR en `main`, el trigger de Cloud Build crea un
build que **espera aprobación**. Esta skill es ese momento de aprobación: tu
trabajo es que el usuario apruebe sabiendo exactamente qué entra. **Quien aprueba es el usuario,
nunca tú.**

Todo pasa por `scripts/release.sh`. No apruebes builds, no muevas tráfico ni
despliegues reglas, índices ni TTL con comandos sueltos.

Los subcomandos son `status`, `summary`, `approve`, `reject` y `rollback`. Los nombres
antiguos en español (`estado`, `resumen`, `aprobar`, `rechazar`) siguen funcionando como alias.

Si el trigger no existe, la app no está promocionada: usa `promote-app`.

Solo la usa Ingeniería.

## 1. Ver qué hay

```bash
scripts/release.sh status --app <app>
```

Si no hay builds pendientes y el usuario esperaba uno, lo más probable es que
el PR no se haya mergeado todavía o que el trigger haya fallado al arrancar.
Dilo así; no lances builds por tu cuenta.

## 2. Resumir lo que entra

```bash
scripts/release.sh summary --app <app> [--build <id>]
```

Presenta al usuario, en pocas líneas:

- Qué cambia, en lenguaje de producto (a partir de los mensajes de commit y
  el título del PR), no la lista literal de commits.
- El resultado de la revisión de Claude en el PR.
- Las alertas, si las hay, cada una en una línea.

Hay tres alertas que **paran la recomendación**. Si aparece alguna, no
recomiendes aprobar hasta que el usuario la haya resuelto o la acepte
explícitamente:

| Alerta | Por qué importa |
| --- | --- |
| El commit no viene de un PR | Alguien subió a `main` sin pasar por la revisión |
| La revisión no está en verde | Hay hallazgos sin resolver |
| Cambian ficheros de gobierno | `CLAUDE.md`, `cloudbuild.yaml`, `.github/` o `firebase.json` solo debe cambiarlos Ingeniería |

Un cambio en `firestore.rules` o `firestore.indexes.json` no para la recomendación, pero avisa: se
desplegará junto con la app. Si la app tiene excepción en
`promote-app/scripts/apps/<servicio>.env`, las reglas van a ese proyecto y esa base
de datos (el script lo avisa): dilo en el resumen. Si puedes, lee el diff de las reglas y explica
qué permiten de nuevo.

## 3. Aprobar o rechazar

**Pregunta siempre antes, con el resumen delante.** Aprobar cambia producción.

`approve` prepara y valida lo necesario (reglas, índices), pero **no aprueba el build**. Desde
Claude Code (sin terminal), muestra el enlace del build en la consola de Cloud Build y espera hasta
60 minutos a que el usuario pulse «Approve» o «Reject». Después termina el despliegue: tráfico,
reglas, índices, TTL y comprobación. Lánzalo en segundo plano y pásale el enlace al usuario. No
apruebes el build por otra vía (`curl` a la API, `gcloud`, una terminal simulada). `reject` sí puedes
lanzarlo con confirmación, porque no cambia producción.

```bash
scripts/release.sh approve --app <app> --build <id>
scripts/release.sh reject  --app <app> --build <id>
```

`approve` espera a que termine el build, devuelve el tráfico a la versión nueva,
despliega las reglas y los índices de Firestore si cambiaron, comprueba que cada campo con
`"ttl": true` tiene su política TTL activa y que la URL responde.

Si cambian las reglas o los índices de Firestore, `approve` los valida **antes** de aprobar el build:
deben venir de un PR, cada `allow` debe exigir login (`check-rules.pl`) y el fichero de índices
solo puede tener `indexes` y `fieldOverrides`. Si no pasan, no se aprueba nada. Si el script
avisa de que el fichero **desactiva un TTL** (`"ttl": false`), dilo en el resumen antes de aprobar:
deja de borrarse lo que la app debía borrar. Explica al usuario qué regla falla; el arreglo va en un PR nuevo.

Si el build falla, lee el log que indica el script y busca la causa en
`../promote-app/references/errores.md`. Lo habitual es que el arreglo vaya en
un PR nuevo, no en tocar la infraestructura.

## 4. Volver atrás

Si tras desplegar la app no funciona:

```bash
scripts/release.sh rollback --app <app> --yes
```

Con la cuenta de despliegue (`tvup-deploy`) el script no puede mover el tráfico: es a propósito, porque
esos permisos le dejarían publicar sin aprobación (ADR-0002). El script se para y da el enlace para que
el usuario lo haga en la consola de Cloud Run con su cuenta («Manage traffic» → 100 % a la revisión
anterior). Díselo así; no pidas más permisos para la cuenta.

Pide confirmación antes de pasar `--yes`. Explica dos cosas al usuario:

- La vuelta atrás afecta al código, **no a las reglas, los índices ni el TTL de Firestore,
  ni a los datos**. Si el problema estaba en las reglas, hay que corregirlas con un PR.
- El tráfico queda fijado a la versión anterior hasta el siguiente `approve`.

## Lo que no haces nunca

- Aprobar un build: lo aprueba el usuario en la consola de Cloud Build, con su cuenta personal (también
  el rechazo: `reject` necesita el mismo permiso). La
  cuenta de despliegue (`tvup-deploy`) no puede aprobar, así que desde la terminal la API lo rechaza
  y el script remite a la consola (ADR-0002).
- Rechazar o volver atrás sin confirmación explícita en el chat.
- Aprobar con alguna de las tres alertas sin que el usuario la haya aceptado.
- Lanzar builds, cambiar triggers o tocar Cloud Run fuera del script.
- Hacer merge de PRs: eso lo decide quien revisa el PR.
