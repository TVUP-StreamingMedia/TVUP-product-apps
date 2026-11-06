# Errores conocidos

Todos han ocurrido al montar el proceso. Busca el mensaje antes de proponer una solución.

| Mensaje o síntoma | Causa | Solución |
| --- | --- | --- |
| `Hace falta Node 24 y está activo Node 20`, o antes «No se pudo añadir firebase con pnpm» sin más detalle | El Node por defecto de la terminal es anterior al que fija el esqueleto; pnpm 11 pide Node >= 22.13 y ni arranca | `nvm use 24`, o `nvm alias default 24` para que sea el de siempre. Si el repo ya se creó sin `firebase` ni `pnpm-lock.yaml`, añádelos en una rama y PR con Node 24 (`pnpm add firebase`) |
| `no es miembro activo de TVUP-StreamingMedia` | `gh` tiene sesión con la cuenta personal | `gh auth switch` o `gh auth login` con la corporativa |
| `Repository not found` al clonar por SSH | La clave SSH está dada de alta en la cuenta personal | El script ya usa HTTPS con `gh`; si clonas a mano, usa `gh repo clone` |
| `actions ... are not allowed` | Lista blanca de Actions de la organización | Añadir la acción en Organization Settings → Actions → General |
| `is requesting pull-requests: write, but is only allowed none` | Faltan permisos en el job que llama al workflow reutilizable | El `revision.yml` de la plantilla ya los declara; comprueba que el repo usa esa versión |
| `Secret ANTHROPIC_API_KEY is required` | El secreto no está en el repo | `gh secret set ANTHROPIC_API_KEY --repo <org>/<app>` y relanzar la revisión (`gh workflow run revision.yml --repo <org>/<app> --ref main`) |
| `Claude Code is not installed on this repository` | La GitHub App de Claude no ve el repo | Instalarla en la organización con acceso a todos los repos |
| `anthropic-workspace-id is required` | API key vinculada al usuario, no a un workspace | Crear una key nueva seleccionando un workspace |
| `exceeding the configured maximum of N turns` | Límite de turnos corto en el workflow central | Subir `--max-turns` en `revision-tvup.yml` y mover el tag |
| Revisión en verde pero sin informe | Ejecución con un workflow central antiguo | Lanzar con Run workflow, no con Re-run |
| `workflow ... @v1` no encontrado | Falta el tag en el repo central | `git tag v1 && git push origin v1` en `TVUP-product-apps` |
| No se pudo proteger `main` | Plan GitHub Free con repo privado | Requiere GitHub Team; mientras, avisar al usuario |
| `Invalid resource name` | Guion bajo en el nombre del servicio | El script ya lo convierte; si ocurre, revisar `_SERVICE` en `cloudbuild.yaml` |
| `key in the template ... is not a valid built-in substitution` | Variable de shell en un paso de `cloudbuild.yaml` | Escribir el valor directamente en el comando |
| `container failed to start and listen on the port` | Sin script `start` o el servidor no lee `process.env.PORT` | Añadir `start` o corregir el servidor |
| `Posible credencial en el codigo` en Cloud Build | Una clave AIza fuera de `firebase-config.ts` | Mover la config pública de Firebase a `src/lib/firebase-config.ts`; si es otra clave, es un secreto real |
| `Error: Forbidden` al abrir la URL | Falta `allUsers` como invoker | El script lo aplica en `deploy` con N0 o `--login-ok` |
| `auth/unauthorized-domain` | El dominio no está en el proyecto Firebase que usa la app | Comprobar el `projectId` de `firebase-config.ts` contra `FIREBASE_PROJECT`; deben coincidir |
| El repo nuevo no aparece en Cloud Build | La GitHub App de Cloud Build no lo ve | Instalarla con acceso a todos los repos |
| Domain mapping falla por dominio no verificado | La cuenta de gcloud no verificó el dominio de la app ni uno padre (basta `apps.tvup.cloud`) | Verificarlo en Search Console con esa cuenta (`gcloud domains verify apps.tvup.cloud`), o que un propietario la añada como propietaria |
| Merge en `main` sin build pendiente | El repo se renombró en GitHub y el trigger sigue escuchando el nombre antiguo, sin dar error | `promote-app.sh deploy --app <nombre-nuevo> --dry-run`: vincula el repo nuevo y vuelve a apuntar el trigger; el servicio sale de `SERVICIO` en el CLAUDE.md |
| Build con `PERMISSION_DENIED` tras pasar el trigger a `tvup-apps-build` | A la cuenta de mínimo privilegio le falta un permiso que necesita `gcloud run deploy --source` | Volver atrás con `setup-build-sa.sh --apply --trigger <t> --rollback`, añadir al script solo el rol que pide el error (limitado al recurso si se puede) y repetir |
| `does not have storage.buckets.create access` al subir el código (`run-sources-<aleatorio>`) en un servicio nuevo | `tvup-apps-build` no puede listar los buckets del proyecto: gcloud no comprueba que `run-sources-<proyecto>-<región>` es suyo y prueba a crear otro | `setup-build-sa.sh --apply` (concede `roles/storage.bucketViewer`) y relanzar el `deploy`. Los servicios creados con la cuenta de Compute no lo notan |
| `Memory limit of 512 MiB exceeded` y 503 (a veces solo en las rutas de IA) | Sin `Procfile`, Cloud Run arranca con `pnpm start`: pnpm se descarga en cada arranque y lanza el script en otro proceso; con `tsx` son tres procesos | Añadir `Procfile` con un solo proceso de Node: `web: node --import tsx server.ts` (servidor en TS, `tsx` en `dependencies`) o `web: node node_modules/serve/build/main.js -s dist` (estática). `serve` lee `PORT` del entorno. El servidor debe activar Vite solo con `NODE_ENV=development` |
| `Faltan RUNTIME_SA y SOURCE_BUILD_SA` | La plantilla pide las cuentas de ejecución y de build interno y no están en `promote-app.env` | `setup-build-sa.sh --apply` y copiar los valores que indica al final |
| Build con `iam.serviceAccounts.actAs` denegado sobre la cuenta de Compute | El `cloudbuild.yaml` de la app no fija `--service-account` y `--build-service-account`, y ya se ejecutó `--revoke-compute` | Actualizar su `cloudbuild.yaml` por PR como el de la plantilla, o `setup-build-sa.sh --apply --trigger <t> --rollback` mientras tanto |
