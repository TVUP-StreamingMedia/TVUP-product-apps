# aprobacion.sh — La aprobación de un build de producción la da una persona (lo cargan promote-app.sh y release.sh)
#
# Con terminal interactiva, el script pregunta y aprueba con la API: quien responde es una persona.
# Sin terminal (Claude Code, CI), el script NO aprueba: enseña el enlace del build en la consola de
# Cloud Build y espera a que una persona lo apruebe o lo rechace allí. La IA prepara el despliegue y
# una persona lo firma.
#
# Es un control de proceso, no una barrera técnica: mientras la IA trabaje con una cuenta que tenga
# permiso para aprobar builds, podría llamar a la API por su cuenta. La barrera técnica es que esa
# cuenta no tenga el permiso (ADR-0002).
#
# Necesita gcloud, curl, GCP_PROJECT, CB_REGION y las funciones ok y die de quien lo carga.

APPROVAL_TIMEOUT_MIN=60

# human_approval <build> <app>
# Vuelve cuando una persona ha aprobado el build; si lo rechaza o no responde, el script se para.
human_approval() {
  local build="$1" app="$2" answer state i
  local console="https://console.cloud.google.com/cloud-build/builds;region=$CB_REGION/$build?project=$GCP_PROJECT"

  if [[ -t 0 && -t 1 ]]; then
    read -r -p "¿Apruebas el despliegue a producción de $app? [s/N] " answer
    [[ "$answer" =~ ^[sSyY]$ ]] || die "Despliegue no aprobado. El build $build sigue pendiente: $console"
    # La CLI no aprueba builds regionales: se usa la API de Cloud Build.
    curl -sf -X POST -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "Content-Type: application/json" \
      -d '{"approvalResult":{"decision":"APPROVED"}}' \
      "https://cloudbuild.googleapis.com/v1/projects/$GCP_PROJECT/locations/$CB_REGION/builds/$build:approve" >/dev/null \
      || die "No se pudo aprobar (¿falta el rol Cloud Build Approver?). Apruébalo en la consola: $console"
    ok "Build aprobado"
    return 0
  fi

  echo "  La aprobación la da una persona. Abre el build y pulsa «Approve» o «Reject»:"
  echo "  $console"
  echo "  Esperando hasta $APPROVAL_TIMEOUT_MIN minutos…"
  for ((i = 0; i < APPROVAL_TIMEOUT_MIN * 4; i++)); do
    state="$(gcloud builds describe "$build" --region="$CB_REGION" --project="$GCP_PROJECT" \
               --format='value(approval.state)' 2>/dev/null || true)"
    case "$state" in
      APPROVED) ok "Build aprobado en la consola"; return 0 ;;
      REJECTED) die "Build rechazado en la consola: no se despliega nada" ;;
      PENDING|"") sleep 15 ;;
      *) die "Estado de aprobación inesperado ($state). Revisa el build: $console" ;;
    esac
  done
  die "Nadie ha aprobado el build en $APPROVAL_TIMEOUT_MIN minutos. Sigue pendiente: $console"
}
