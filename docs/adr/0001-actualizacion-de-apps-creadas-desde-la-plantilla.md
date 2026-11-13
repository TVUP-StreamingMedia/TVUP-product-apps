# ADR-0001: Cómo llegan las actualizaciones a las apps creadas desde la plantilla

**Estado:** Propuesta
**Fecha:** 2026-11-10
**Deciden:** Ingeniería (CTO) y Seguridad

## Contexto

Las apps internas de Producto se crean con `promote-app.sh create` a partir de `TVUP-app-template`
y del `esqueleto/` de este repo. Hoy son dos (`dev-arena` y `TVUP-product-intake`), pero el proceso
está pensado para que haya muchas más.

Una plantilla de GitHub **copia** los ficheros una sola vez: la app no queda conectada a ella. Lo
que cambie después en la plantilla, en el `esqueleto/` o en las skills no llega a las apps que ya
existen. Hoy cada pieza se comporta así:

| Pieza | Dónde vive | ¿Llega sola a las apps existentes? |
| --- | --- | --- |
| Revisión de Claude en los PR | Aquí, `revision-tvup.yml`, que cada app usa con `@v1` | Sí: moviendo el tag `v1` |
| Scripts de promoción y despliegue | Aquí; solo los ejecuta Ingeniería | Sí |
| Node, parches dentro de la versión mayor | `engines.node: "24.x"` + `gcloud run deploy --source` | Sí: cada build toma el último 24.x |
| Node (versión mayor), React, Vite, librerías | `package.json` de cada app | No |
| Login Microsoft 365 (`login.ts`, `ConLogin.tsx`, `server-auth.ts`) | Copiado de `.claude/skills/login-microsoft365/assets/` al crear la app | No |
| Código base de Firestore, `public/serve.json`, cabeceras | Copiados al crear la app | No |
| `cloudbuild.yaml`, `.github/`, `CODEOWNERS`, `.claude/skills/` | Copiados; ficheros de gobierno | No |
| `CLAUDE.md` | Generado por el intake para cada app | No (y no debe: es el perfil de la app) |

Ninguna app tiene Dependabot ni Renovate. Ya hay divergencia: el `esqueleto/` sigue dependiendo de
`serve`, mientras que dev-arena lo sustituyó por un servidor propio.

El riesgo principal es el **login**. Es la única barrera delante de cada app (no hay IAP ni VPN). Si
aparece un fallo en él, el arreglo tiene que llegar a todas las apps de forma rápida y comprobable.

### Restricciones

- Todo cambio en una app pasa por un PR, la revisión de Claude y la aprobación del build en
  `deploy-app`. Ninguna solución puede saltarse ese camino.
- Los ficheros de gobierno solo los cambia Ingeniería (CODEOWNERS).
- Algunas apps se construyen en Google AI Studio, que no lee `.claude/skills/` y no puede instalar
  paquetes privados.
- Las skills son instrucciones para el agente: actúan **al escribir el código**, no mientras la
  app está en producción. Centralizar una skill no cambia el código ya desplegado.

## Decisión

Toda actualización llega a cada app **como un PR automático**, con su revisión, su build y su
aprobación. Nada cambia en producción por una vía compartida en caliente. Tres mecanismos:

1. **Dependencias: Renovate con una política central.** La configuración vive aquí
   (`renovate/default.json`). Cada app tiene un `renovate.json` de una línea que la extiende.
   Política inicial:
   - parches y versiones menores agrupados, un PR por semana;
   - versiones mayores (Node, React, Vite) en un PR aparte con la etiqueta `mayor`;
   - esperar 3 días desde que se publica una versión (`minimumReleaseAge`);
   - alertas de seguridad sin esperas;
   - solo pnpm.
2. **Login y verificación de sesión: paquete `@tvup/app-base`.** El código de
   `login-microsoft365/assets/` (`login.ts`, `ConLogin.tsx`, `server-auth.ts`, `login.css`) pasa a
   ser un paquete versionado (semver) publicado desde este repo. Las apps lo importan en lugar de
   copiarlo, y Renovate abre el PR de cada versión nueva. La skill `login-microsoft365` pasa a decir
   «usa `@tvup/app-base`» en lugar de llevar el código dentro. Firestore y las cabeceras **no** entran
   en el paquete por ahora: cambian menos y dependen más de cada app.
3. **Ficheros de gobierno y skills: comando `promote-app.sh sync --app <app>`.** Compara con la
   versión central `cloudbuild.yaml`, `.github/workflows/revision.yml`, `CODEOWNERS`,
   `public/serve.json` y `.claude/skills/`. Si alguno difiere, abre un PR en la app, igual que ya hace
   `secret`. `CLAUDE.md` queda fuera: si cambian las reglas comunes, se regenera con el intake, que
   conserva el perfil de la app. Con `--all` recorre todas las apps del proceso.

Además:

- `revision-tvup.yml` mantiene el tag `v1` para cambios compatibles. Un cambio que rompa algo
  publica `v2`, y cada app se mueve con un PR de `sync`.
- La plantilla y el `esqueleto/` incluyen `renovate.json` y la dependencia de `@tvup/app-base`,
  para que las apps nuevas nazcan con ellos.

## Opciones consideradas

### A. Skills centralizadas, sin cambiar cómo llega el código

| Dimensión | Valoración |
| --- | --- |
| Complejidad | Baja |
| Coste | Ninguno |
| Escala | Mala: el código desplegado no cambia |
| Conocimiento del equipo | Alto |

**A favor:** los agentes siempre trabajan con el estándar vigente.
**En contra:** no actualiza nada en producción y no sirve para AI Studio. Se mantiene como
complemento (punto 3 de la decisión), no como solución.

### B. Paquete `@tvup/app-base` + Renovate + `sync` (elegida)

| Dimensión | Valoración |
| --- | --- |
| Complejidad | Media: registro de paquetes, versionado, autenticación en Cloud Build |
| Coste | Bajo: GitHub Packages y la app de Renovate entran en el plan actual (por confirmar) |
| Escala | Buena: el esfuerzo por actualización es revisar y aprobar un PR por app |
| Conocimiento del equipo | Medio |

**A favor:** el login se arregla una sola vez y llega a todas con trazabilidad. Cada app se prueba y
se aprueba por separado. Se reutilizan los patrones que ya existen (PR desde script, revisión, gate).
**En contra:** N PR y N aprobaciones por cada cambio. Hay que mantener el paquete. Las apps de AI
Studio necesitan un tratamiento aparte (ver Riesgos).

### C. Login cargado en caliente desde una URL central

| Dimensión | Valoración |
| --- | --- |
| Complejidad | Baja |
| Coste | Bajo |
| Escala | Inmediata |
| Conocimiento del equipo | Alto |

**A favor:** un cambio llega a todas las apps al momento.
**En contra (descartada):** un único punto de fallo para todas las apps. El cambio llega a
producción sin revisión ni aprobación de ninguna app. Quien comprometa ese fichero controla el login
de todas. Y la CSP de la plantilla no lo frenaría: hoy solo informa (`Report-Only`) y su
`script-src` admite cualquier origen `https:`.

### D. Fusionar periódicamente la plantilla en cada app (`git merge`)

**Descartada:** los historiales no comparten ancestro (la plantilla de GitHub no lo conserva) y
cada fusión chocaría con el código propio de cada app.

### E. Monorepo con todas las apps

**Descartada por ahora:** un cambio sí llega a todas, pero se pierde el aislamiento por repo. Hoy
cada repo tiene sus CODEOWNERS, su trigger de Cloud Build y su acceso para Producto y AI Studio.

## Análisis de los compromisos

- **Velocidad frente a control.** C es la más rápida, pero se salta el gate. Es justo lo que el
  proceso N1/N2 existe para impedir. B acepta N PR a cambio de que cada despliegue siga revisado y
  aprobado.
- **Paquete frente a copia.** Una copia es más sencilla mientras haya pocas apps. El paquete se
  adelanta solo para el login porque es la pieza de seguridad cuyo arreglo no puede depender de que
  alguien se acuerde de copiarlo N veces. El código ya está aislado en `assets/`, así que extraerlo
  cuesta poco.
- **Renovate frente a Dependabot.** Dependabot no admite una configuración compartida entre repos:
  habría que copiar y mantener `dependabot.yml` en cada app. Renovate permite extender una
  configuración central.

## Consecuencias

- **Más fácil:** arreglar el login en todas las apps; mantener las dependencias al día; ver qué
  versión de cada pieza lleva cada app (`package.json` y PR).
- **Más difícil:** Cloud Build necesita leer el registro de paquetes (un token de solo lectura en
  Secret Manager para la cuenta de build). El paquete necesita su propio proceso de publicación y
  sus pruebas.
- **Carga de trabajo:** Ingeniería revisará y aprobará más PR. Agrupar parches y menores en un PR
  semanal lo mantiene acotado. Si con muchas apps la carga crece demasiado, se revisará si los
  parches de dependencias con la revisión en verde pueden desplegarse con una aprobación por lotes.
- **A revisar:** con 8–10 apps, valorar meter también en el paquete el código base de Firestore y
  las cabeceras de seguridad.

## Riesgos y preguntas abiertas

1. **AI Studio y paquetes privados.** AI Studio no puede instalar paquetes de un registro privado.
   Opciones: (a) publicar `@tvup/app-base` en npm de forma pública (el login no contiene secretos:
   la config y el tenant están en `firebase-config.ts` de cada app); (b) que `promote` copie el
   paquete dentro de la app (*vendoring*) y `sync` lo actualice. Decidirlo en la prueba de concepto.
2. **`gcloud run deploy --source` y registro privado.** Hay que comprobar que los buildpacks de
   Node instalan desde GitHub Packages con un `.npmrc` y un token montado en el build, sin que el
   token acabe en la imagen.
3. **Cambios incompatibles en el paquete.** Una versión mayor de `@tvup/app-base` puede exigir
   cambios en la app. Renovate la separa con la etiqueta `mayor` y no se agrupa con nada más.

## Acciones

1. [ ] Instalar la app de Renovate en la organización y crear `renovate/default.json` aquí.
2. [ ] Añadir `renovate.json` a la plantilla, al `esqueleto/` y, por PR, a `dev-arena` y `TVUP-product-intake`.
3. [ ] Prueba de concepto de `@tvup/app-base`: publicar, instalar en Cloud Build con `--source` y
       decidir el registro (riesgos 1 y 2).
4. [ ] Migrar `dev-arena` al paquete como primera app y actualizar la skill `login-microsoft365`.
5. [ ] Implementar `promote-app.sh sync` (con `--dry-run` y `--all`) y documentarlo en la skill.
6. [ ] Alinear el `esqueleto/` con lo aprendido en dev-arena (por ejemplo, `serve` frente a servidor propio).
7. [ ] Documentar en la skill `deploy-app` cómo se aprueban los PR de Renovate y de `sync`.
