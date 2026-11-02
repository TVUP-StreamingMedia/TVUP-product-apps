---
name: deploy-app
description: Despliega a producción los cambios de una app interna de TVUP ya promocionada. Enseña qué entra (commits, PR, resultado de la revisión de Claude, ficheros de gobierno), aprueba el build de Cloud Build tras confirmación explícita, despliega las reglas de Firestore si cambiaron, verifica la URL y permite volver atrás. Úsala siempre que Ingeniería diga "despliega", "publica los cambios", "aprueba el build", "¿qué hay pendiente?", "sube a producción jira-hub", "vuelve atrás" o "rollback", aunque no mencione la skill. Para la primera vez que una app llega a producción, usa promote-app.
---

# Desplegar cambios de una app ya promocionada

Cuando se hace merge de un PR en `main`, el trigger de Cloud Build crea un
build que **espera aprobación**. Esta skill es ese momento de aprobación: tu
trabajo es que el usuario apruebe sabiendo exactamente qué entra.

Todo pasa por `scripts/release.sh`. No apruebes builds, no muevas tráfico ni
despliegues reglas con comandos sueltos.

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

Un cambio en `firestore.rules` no para la recomendación, pero avisa: se
desplegará junto con la app. Si puedes, lee el diff de las reglas y explica
qué permiten de nuevo.

## 3. Aprobar o rechazar

**Pregunta siempre antes, con el resumen delante.** Aprobar cambia producción.

```bash
scripts/release.sh approve --app <app> --build <id>
scripts/release.sh reject  --app <app> --build <id>
```

`approve` espera a que termine el build, devuelve el tráfico a la versión nueva,
despliega las reglas de Firestore si cambiaron y comprueba que la URL responde.

Si el build falla, lee el log que indica el script y busca la causa en
`../promote-app/references/errores.md`. Lo habitual es que el arreglo vaya en
un PR nuevo, no en tocar la infraestructura.

## 4. Volver atrás

Si tras desplegar la app no funciona:

```bash
scripts/release.sh rollback --app <app> --yes
```

Pide confirmación antes de pasar `--yes`. Explica dos cosas al usuario:

- La vuelta atrás afecta al código, **no a las reglas de Firestore ni a los
  datos**. Si el problema estaba en las reglas, hay que corregirlas con un PR.
- El tráfico queda fijado a la versión anterior hasta el siguiente `approve`.

## Lo que no haces nunca

- Aprobar, rechazar o volver atrás sin confirmación explícita en el chat.
- Aprobar con alguna de las tres alertas sin que el usuario la haya aceptado.
- Lanzar builds, cambiar triggers o tocar Cloud Run fuera del script.
- Hacer merge de PRs: eso lo decide quien revisa el PR.
