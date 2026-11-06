#!/usr/bin/env bash
# setup-build-sa.sh — Cuentas de servicio de mínimo privilegio para desplegar las apps (TVUP)
#
# Sin ellas todo corre como la cuenta de Compute, con Editor y run.admin en el proyecto: el
# trigger, el build interno de «gcloud run deploy --source» y la propia app. Un paso malicioso
# aprobado en cloudbuild.yaml podría hacer cualquier cosa. Este script crea tres cuentas, y la
# del trigger solo puede actuar como las otras dos, que no tienen poder sobre el proyecto:
#
#   tvup-apps-build         ejecuta el trigger (los pasos de cloudbuild.yaml)
#     run.developer                 desplegar revisiones (sin cambiar quién las invoca)
#     cloudbuild.builds.editor      lanzar el build interno de «gcloud run deploy --source»
#     logging.logWriter             escribir los logs del build
#     serviceusage.serviceUsageConsumer   usar las APIs del proyecto desde gcloud
#     storage.bucketViewer          listar los buckets: gcloud comprueba así que run-sources es del
#                                   proyecto (sin acceso a ficheros ni permiso para crear buckets)
#     storage (solo el bucket run-sources de la región)   subir el código fuente
#     artifactregistry.reader (solo cloud-run-source-deploy)   comprobar el repositorio de imágenes
#     actuar como tvup-apps-runtime y tvup-apps-source-build, y solo como ellas
#
#   tvup-apps-source-build  ejecuta el build interno que construye la imagen
#     logging.logWriter (proyecto), storage.objectViewer (solo el bucket run-sources),
#     artifactregistry.writer (solo cloud-run-source-deploy)
#
#   tvup-apps-runtime       identidad de las apps en Cloud Run, sin roles en el proyecto.
#     Una app que necesite permisos de servidor tendrá su propia cuenta de ejecución.
#
# Los cloudbuild.yaml de las apps deben usar las dos últimas en «gcloud run deploy»
# (--service-account y --build-service-account). Hasta que todos lo hagan, tvup-apps-build
# conserva el permiso para actuar como la cuenta de Compute; --revoke-compute lo quita,
# después de comprobar que ningún trigger de tvup-apps-build lo necesita.
#
# Uso:
#   setup-build-sa.sh                         muestra lo que haría (por defecto, en seco)
#   setup-build-sa.sh --apply                 crea las cuentas y concede los roles
#   setup-build-sa.sh --apply --trigger <t>   además pasa ese trigger a tvup-apps-build
#   setup-build-sa.sh --apply --trigger <t> --rollback   devuelve el trigger a la cuenta de Compute
#   setup-build-sa.sh --apply --revoke-compute           quita a tvup-apps-build el permiso
#                                                        para actuar como la cuenta de Compute
#
# Usa la misma configuración que promote-app.sh y, al terminar, indica los valores de
# CB_SERVICE_ACCOUNT, RUNTIME_SA y SOURCE_BUILD_SA para promote-app.env.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${PROMOTE_CONFIG:-$SCRIPT_DIR/promote-app.env}"

c_red=$'\033[31m'; c_grn=$'\033[32m'; c_yel=$'\033[33m'; c_blu=$'\033[34m'; c_off=$'\033[0m'
step() { echo; echo "${c_blu}▶ $*${c_off}"; }
ok()   { echo "${c_grn}✓ $*${c_off}"; }
warn() { echo "${c_yel}⚠ $*${c_off}"; }
die()  { echo "${c_red}✗ $*${c_off}" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "Falta '$1'. $2"; }

APPLY=0; TRIGGER=""; ROLLBACK=0; REVOKE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)          APPLY=1; shift ;;
    --trigger)        TRIGGER="$2"; shift 2 ;;
    --rollback)       ROLLBACK=1; shift ;;
    --revoke-compute) REVOKE=1; shift ;;
    -h|--help) sed -n '2,41p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Opción desconocida: $1" ;;
  esac
done
run() { if [[ "$APPLY" == "1" ]]; then "$@" >/dev/null; else echo "  [en seco] $*"; fi; }

[[ -f "$CONFIG_FILE" ]] || die "No encuentro la configuración: $CONFIG_FILE"
# shellcheck source=/dev/null
source "$CONFIG_FILE"
CB_REGION="${CB_REGION:-$REGION}"
need gcloud ""; need jq ""; need curl ""; need gh ""
G=(--project "$GCP_PROJECT")

email()   { echo "$1@$GCP_PROJECT.iam.gserviceaccount.com"; }
sa_path() { echo "projects/$GCP_PROJECT/serviceAccounts/$1"; }
BUILD_SA="$(email tvup-apps-build)"
SOURCE_SA="$(email tvup-apps-source-build)"
RUN_SA="$(email tvup-apps-runtime)"
NUM="$(gcloud projects describe "$GCP_PROJECT" --format='value(projectNumber)')"
COMPUTE_SA="$NUM-compute@developer.gserviceaccount.com"
BUCKET="run-sources-$GCP_PROJECT-$REGION"
AR_REPO="cloud-run-source-deploy"

[[ "$APPLY" == "1" ]] || warn "En seco: no se cambia nada. Repite con --apply para aplicarlo"
[[ "$ROLLBACK" == "0" || -n "$TRIGGER" ]] || die "--rollback necesita --trigger"

create_sa() {
  if gcloud iam service-accounts describe "$(email "$1")" "${G[@]}" >/dev/null 2>&1; then
    ok "$1 ya existe"
  else
    run gcloud iam service-accounts create "$1" --display-name="$2" \
      --description="Apps internas de Producto. Mínimo privilegio: ver setup-build-sa.sh" "${G[@]}"
    ok "$1: $2"
  fi
}
project_role() {
  run gcloud projects add-iam-policy-binding "$GCP_PROJECT" --member="serviceAccount:$1" --role="$2" --condition=None
  ok "$2 (proyecto)"
}
bucket_role() {
  run gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$1" --role="$2"
  ok "$2 (solo $BUCKET)"
}
repo_role() {
  run gcloud artifacts repositories add-iam-policy-binding "$AR_REPO" --location="$REGION" \
    --member="serviceAccount:$1" --role="$2" "${G[@]}"
  ok "$2 (solo $AR_REPO)"
}
# ¿Puede tvup-apps-build actuar como la cuenta de Compute?
acts_as_compute() {
  gcloud iam service-accounts get-iam-policy "$COMPUTE_SA" "${G[@]}" --format=json 2>/dev/null \
    | jq -e --arg m "serviceAccount:$BUILD_SA" \
        '[.bindings[]? | select(.role == "roles/iam.serviceAccountUser") | .members[]] | index($m) != null' >/dev/null
}

if [[ "$ROLLBACK" == "0" && "$REVOKE" == "0" ]]; then
  step "Cuentas de servicio"
  create_sa tvup-apps-build "Trigger de despliegue de las apps"
  create_sa tvup-apps-source-build "Build interno que construye la imagen"
  create_sa tvup-apps-runtime "Identidad de las apps en Cloud Run, sin roles"

  step "tvup-apps-build · ejecuta los pasos de cloudbuild.yaml"
  # storage.bucketViewer: antes de subir el código, «gcloud run deploy --source» lista los
  # buckets del proyecto para comprobar que run-sources es suyo. Sin él, la comprobación da 403,
  # gcloud intenta crear un bucket con nombre aleatorio y el build falla (storage.buckets.create).
  for role in roles/run.developer roles/cloudbuild.builds.editor roles/logging.logWriter \
              roles/serviceusage.serviceUsageConsumer roles/storage.bucketViewer; do
    project_role "$BUILD_SA" "$role"
  done
  bucket_role "$BUILD_SA" roles/storage.objectAdmin
  bucket_role "$BUILD_SA" roles/storage.legacyBucketReader
  repo_role "$BUILD_SA" roles/artifactregistry.reader
  # actAs solo sobre cuentas sin poder: así lanzar builds o desplegar no sirve para escalar.
  for target in "$RUN_SA" "$SOURCE_SA"; do
    run gcloud iam service-accounts add-iam-policy-binding "$target" --member="serviceAccount:$BUILD_SA" \
      --role=roles/iam.serviceAccountUser "${G[@]}"
    ok "Actuar como ${target%%@*}"
  done

  step "tvup-apps-source-build · construye la imagen"
  project_role "$SOURCE_SA" roles/logging.logWriter
  bucket_role "$SOURCE_SA" roles/storage.objectViewer
  repo_role "$SOURCE_SA" roles/artifactregistry.writer

  step "tvup-apps-runtime · identidad de las apps"
  ok "Sin roles en el proyecto"

  if acts_as_compute; then
    warn "tvup-apps-build aún puede actuar como la cuenta de Compute (Editor). Cuando todos los"
    warn "cloudbuild.yaml usen las cuentas nuevas: setup-build-sa.sh --apply --revoke-compute"
  fi
fi

if [[ "$REVOKE" == "1" ]]; then
  step "Quitar a tvup-apps-build el permiso para actuar como la cuenta de Compute"
  # Un trigger de tvup-apps-build cuyo cloudbuild.yaml no fije las dos cuentas usaría la de
  # Compute y fallaría: se comprueba el cloudbuild.yaml de main de cada uno antes de quitarlo.
  pending=0
  while IFS=$'\t' read -r name repo; do
    [[ -n "$name" ]] || continue
    uri="$(gcloud builds repositories describe "${repo##*/}" --connection="$(sed -E 's#.*/connections/([^/]+)/.*#\1#' <<<"$repo")" \
           --region="$CB_REGION" "${G[@]}" --format='value(remoteUri)')"
    gh_repo="${uri#https://github.com/}"; gh_repo="${gh_repo%.git}"
    yaml="$(gh api -H "Accept: application/vnd.github.raw" "repos/$gh_repo/contents/cloudbuild.yaml" 2>/dev/null || true)"
    if grep -q -- "--service-account=" <<<"$yaml" && grep -q -- "--build-service-account=" <<<"$yaml"; then
      ok "$name ($gh_repo): cloudbuild.yaml usa las cuentas nuevas"
    else
      warn "$name ($gh_repo): su cloudbuild.yaml aún no fija --service-account y --build-service-account"
      pending=1
    fi
  done < <(gcloud builds triggers list --region="$CB_REGION" "${G[@]}" --format=json \
             | jq -r --arg sa "$(sa_path "$BUILD_SA")" '.[] | select(.serviceAccount == $sa)
                 | [.name, .repositoryEventConfig.repository] | @tsv')
  [[ "$pending" == "0" ]] || die "Primero actualiza esos cloudbuild.yaml (por PR) y despliégalos"
  if acts_as_compute; then
    run gcloud iam service-accounts remove-iam-policy-binding "$COMPUTE_SA" --member="serviceAccount:$BUILD_SA" \
      --role=roles/iam.serviceAccountUser "${G[@]}"
    ok "tvup-apps-build ya no puede actuar como $COMPUTE_SA"
  else
    ok "tvup-apps-build ya no podía actuar como $COMPUTE_SA"
  fi
fi

if [[ -n "$TRIGGER" ]]; then
  step "Trigger $TRIGGER"
  target_path="$(sa_path "$BUILD_SA")"
  [[ "$ROLLBACK" == "1" ]] && target_path="$(sa_path "$COMPUTE_SA")"
  current="$(gcloud builds triggers describe "$TRIGGER" --region="$CB_REGION" "${G[@]}" --format='value(serviceAccount)')"
  if [[ "$current" == "$target_path" ]]; then
    ok "Ya usa ${target_path##*/}"
  elif [[ "$APPLY" != "1" ]]; then
    echo "  [en seco] cambiaría la cuenta del trigger: ${current##*/} → ${target_path##*/}"
  else
    # gcloud no actualiza bien los triggers de 2.ª generación: se envía el trigger completo
    # por la API, cambiando solo la cuenta (ver el paso 19 de promote-app.sh).
    tid="$(gcloud builds triggers describe "$TRIGGER" --region="$CB_REGION" "${G[@]}" --format='value(id)')"
    api="https://cloudbuild.googleapis.com/v1/projects/$GCP_PROJECT/locations/$CB_REGION/triggers/$tid"
    token="$(gcloud auth print-access-token)"
    curl -sf -H "Authorization: Bearer $token" "$api" \
      | jq --arg sa "$target_path" 'del(.createTime) | .serviceAccount = $sa' \
      | curl -sf -X PATCH -H "Authorization: Bearer $token" -H "Content-Type: application/json" \
          --data-binary @- "$api" >/dev/null \
      || die "No se pudo cambiar la cuenta del trigger $TRIGGER"
    [[ "$(gcloud builds triggers describe "$TRIGGER" --region="$CB_REGION" "${G[@]}" --format='value(serviceAccount)')" == "$target_path" ]] \
      || die "El trigger $TRIGGER no quedó con la cuenta ${target_path##*/}"
    [[ "$(gcloud builds triggers describe "$TRIGGER" --region="$CB_REGION" "${G[@]}" --format='value(approvalConfig.approvalRequired)')" == "True" ]] \
      || die "El trigger $TRIGGER ha perdido la aprobación obligatoria: revísalo en Cloud Build"
    ok "Trigger $TRIGGER con la cuenta ${target_path##*/}"
    [[ "$ROLLBACK" == "1" ]] || echo "  Si el siguiente build falla por permisos: setup-build-sa.sh --apply --trigger $TRIGGER --rollback"
  fi
fi

[[ "$ROLLBACK" == "1" || "$REVOKE" == "1" ]] && exit 0
step "Siguiente paso: en promote-app.env"
echo "  CB_SERVICE_ACCOUNT=\"$(sa_path "$BUILD_SA")\""
echo "  RUNTIME_SA=\"$RUN_SA\""
echo "  SOURCE_BUILD_SA=\"$(sa_path "$SOURCE_SA")\""
echo "  Así los triggers y los cloudbuild.yaml nuevos ya nacen con estas cuentas."
