#!/usr/bin/env bash
# setup-build-sa.sh — Cuenta de servicio de mínimo privilegio para los triggers de las apps (TVUP)
#
# Los triggers ejecutan los pasos de cloudbuild.yaml. Con la cuenta de Compute por defecto
# (Editor y run.admin en todo el proyecto), un paso malicioso aprobado podría hacer cualquier
# cosa en el proyecto. Esta cuenta solo puede lo que esos pasos necesitan:
#
#   run.developer                 desplegar revisiones en Cloud Run (sin cambiar quién las invoca)
#   cloudbuild.builds.editor      lanzar el build interno de «gcloud run deploy --source»
#   logging.logWriter             escribir los logs del build
#   serviceusage.serviceUsageConsumer   usar las APIs del proyecto desde gcloud
#   storage.bucketViewer          listar los buckets: gcloud comprueba así que run-sources es del
#                                 proyecto (sin acceso a ficheros ni permiso para crear buckets)
#   storage (solo el bucket run-sources de la región)   subir el código fuente
#   artifactregistry.reader (solo cloud-run-source-deploy)   comprobar el repositorio de imágenes
#   iam.serviceAccountUser (solo sobre la cuenta de ejecución)   desplegar con esa identidad
#
# Uso:
#   setup-build-sa.sh                         muestra lo que haría (por defecto, en seco)
#   setup-build-sa.sh --apply                 crea la cuenta y concede los roles
#   setup-build-sa.sh --apply --trigger <t>   además pasa ese trigger a la cuenta nueva
#   setup-build-sa.sh --apply --trigger <t> --rollback   devuelve el trigger a la cuenta de Compute
#
# Usa la misma configuración que promote-app.sh. Después, pon la cuenta en CB_SERVICE_ACCOUNT
# de promote-app.env para que los triggers nuevos la usen.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${PROMOTE_CONFIG:-$SCRIPT_DIR/promote-app.env}"

c_red=$'\033[31m'; c_grn=$'\033[32m'; c_yel=$'\033[33m'; c_blu=$'\033[34m'; c_off=$'\033[0m'
step() { echo; echo "${c_blu}▶ $*${c_off}"; }
ok()   { echo "${c_grn}✓ $*${c_off}"; }
warn() { echo "${c_yel}⚠ $*${c_off}"; }
die()  { echo "${c_red}✗ $*${c_off}" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "Falta '$1'. $2"; }

APPLY=0; TRIGGER=""; ROLLBACK=0; SA_NAME="tvup-apps-build"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)   APPLY=1; shift ;;
    --trigger) TRIGGER="$2"; shift 2 ;;
    --name)    SA_NAME="$2"; shift 2 ;;
    --rollback) ROLLBACK=1; shift ;;
    -h|--help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Opción desconocida: $1" ;;
  esac
done
run() { if [[ "$APPLY" == "1" ]]; then "$@" >/dev/null; else echo "  [en seco] $*"; fi; }

[[ -f "$CONFIG_FILE" ]] || die "No encuentro la configuración: $CONFIG_FILE"
# shellcheck source=/dev/null
source "$CONFIG_FILE"
CB_REGION="${CB_REGION:-$REGION}"
need gcloud ""; need jq ""; need curl ""
G=(--project "$GCP_PROJECT")

SA="$SA_NAME@$GCP_PROJECT.iam.gserviceaccount.com"
SA_PATH="projects/$GCP_PROJECT/serviceAccounts/$SA"
NUM="$(gcloud projects describe "$GCP_PROJECT" --format='value(projectNumber)')"
RUNTIME_SA="${RUNTIME_SA:-$NUM-compute@developer.gserviceaccount.com}"
BUCKET="run-sources-$GCP_PROJECT-$REGION"
AR_REPO="cloud-run-source-deploy"

[[ "$APPLY" == "1" ]] || warn "En seco: no se cambia nada. Repite con --apply para aplicarlo"
[[ "$ROLLBACK" == "0" || -n "$TRIGGER" ]] || die "--rollback necesita --trigger"

# Cuenta a la que se pasa el trigger: la nueva o, al volver atrás, la de Compute.
TARGET_PATH="$SA_PATH"
[[ "$ROLLBACK" == "1" ]] && TARGET_PATH="projects/$GCP_PROJECT/serviceAccounts/$RUNTIME_SA"

if [[ "$ROLLBACK" == "0" ]]; then
step "Cuenta de servicio $SA"
if gcloud iam service-accounts describe "$SA" "${G[@]}" >/dev/null 2>&1; then
  ok "Ya existe"
else
  run gcloud iam service-accounts create "$SA_NAME" --display-name="Builds de apps de Producto" \
    --description="Triggers de Cloud Build de las apps internas. Mínimo privilegio: ver setup-build-sa.sh" "${G[@]}"
  ok "Creada"
fi

step "Roles en el proyecto"
# storage.bucketViewer: antes de subir el código, «gcloud run deploy --source» lista los
# buckets del proyecto para comprobar que run-sources es suyo. Sin él, la comprobación da 403,
# gcloud intenta crear un bucket con nombre aleatorio y el build falla (storage.buckets.create).
for role in roles/run.developer roles/cloudbuild.builds.editor roles/logging.logWriter roles/serviceusage.serviceUsageConsumer roles/storage.bucketViewer; do
  run gcloud projects add-iam-policy-binding "$GCP_PROJECT" --member="serviceAccount:$SA" --role="$role" --condition=None
  ok "$role"
done

step "Permisos limitados a un recurso"
run gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$SA" --role=roles/storage.objectAdmin
run gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$SA" --role=roles/storage.legacyBucketReader
ok "Bucket $BUCKET: subir el código fuente"
run gcloud artifacts repositories add-iam-policy-binding "$AR_REPO" --location="$REGION" \
  --member="serviceAccount:$SA" --role=roles/artifactregistry.reader "${G[@]}"
ok "Artifact Registry $AR_REPO: lectura"
run gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --member="serviceAccount:$SA" \
  --role=roles/iam.serviceAccountUser "${G[@]}"
ok "Actuar como $RUNTIME_SA (cuenta de ejecución y del build interno), y solo como ella"
fi

if [[ -n "$TRIGGER" ]]; then
  step "Trigger $TRIGGER"
  current="$(gcloud builds triggers describe "$TRIGGER" --region="$CB_REGION" "${G[@]}" --format='value(serviceAccount)')"
  if [[ "$current" == "$TARGET_PATH" ]]; then
    ok "Ya usa ${TARGET_PATH##*/}"
  elif [[ "$APPLY" != "1" ]]; then
    echo "  [en seco] cambiaría la cuenta del trigger: ${current##*/} → ${TARGET_PATH##*/}"
  else
    # gcloud no actualiza bien los triggers de 2.ª generación: se envía el trigger completo
    # por la API, cambiando solo la cuenta (ver el paso 19 de promote-app.sh).
    tid="$(gcloud builds triggers describe "$TRIGGER" --region="$CB_REGION" "${G[@]}" --format='value(id)')"
    api="https://cloudbuild.googleapis.com/v1/projects/$GCP_PROJECT/locations/$CB_REGION/triggers/$tid"
    token="$(gcloud auth print-access-token)"
    curl -sf -H "Authorization: Bearer $token" "$api" \
      | jq --arg sa "$TARGET_PATH" 'del(.createTime) | .serviceAccount = $sa' \
      | curl -sf -X PATCH -H "Authorization: Bearer $token" -H "Content-Type: application/json" \
          --data-binary @- "$api" >/dev/null \
      || die "No se pudo cambiar la cuenta del trigger $TRIGGER"
    [[ "$(gcloud builds triggers describe "$TRIGGER" --region="$CB_REGION" "${G[@]}" --format='value(serviceAccount)')" == "$TARGET_PATH" ]] \
      || die "El trigger $TRIGGER no quedó con la cuenta ${TARGET_PATH##*/}"
    [[ "$(gcloud builds triggers describe "$TRIGGER" --region="$CB_REGION" "${G[@]}" --format='value(approvalConfig.approvalRequired)')" == "True" ]] \
      || die "El trigger $TRIGGER ha perdido la aprobación obligatoria: revísalo en Cloud Build"
    ok "Trigger $TRIGGER con la cuenta ${TARGET_PATH##*/}"
    [[ "$ROLLBACK" == "1" ]] || echo "  Si el siguiente build falla por permisos: setup-build-sa.sh --apply --trigger $TRIGGER --rollback"
  fi
fi

[[ "$ROLLBACK" == "1" ]] && exit 0
step "Siguiente paso"
echo "  En promote-app.env: CB_SERVICE_ACCOUNT=\"$SA_PATH\""
echo "  Así los triggers nuevos ya nacen con esta cuenta."
