#!/usr/bin/env bash
# release.sh — Despliegues recurrentes de apps ya promocionadas (TVUP)
#
#   estado    Qué está en producción y qué espera aprobación
#   resumen   Qué cambia en el build pendiente: commits, PR, revisión, ficheros sensibles
#   aprobar   Aprueba el build, despliega reglas de Firestore si cambiaron y verifica la URL
#   rechazar  Rechaza el build pendiente
#   rollback  Devuelve el tráfico a la revisión anterior
#
# Usa la misma configuración que promote-app.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${PROMOTE_CONFIG:-}"
if [[ -z "$CONFIG_FILE" ]]; then
  # La configuración es la de promote-app, que vive al lado en el mismo repo.
  for f in "$SCRIPT_DIR/promote-app.env" "$SCRIPT_DIR/../../promote-app/scripts/promote-app.env"; do
    [[ -f "$f" ]] && { CONFIG_FILE="$f"; break; }
  done
fi

c_red=$'\033[31m'; c_grn=$'\033[32m'; c_yel=$'\033[33m'; c_blu=$'\033[34m'; c_off=$'\033[0m'
step() { echo; echo "${c_blu}▶ $*${c_off}"; }
ok()   { echo "${c_grn}✓ $*${c_off}"; }
warn() { echo "${c_yel}⚠ $*${c_off}"; }
die()  { echo "${c_red}✗ $*${c_off}" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "Falta '$1'. $2"; }

usage() {
  cat <<'EOF'
Uso:
  release.sh estado   --app <repo>
  release.sh resumen  --app <repo> [--build <id>]
  release.sh aprobar  --app <repo> --build <id> [--reglas]
  release.sh rechazar --app <repo> --build <id>
  release.sh rollback --app <repo> --yes

--reglas fuerza el despliegue de firestore.rules aunque no hayan cambiado.
aprobar, rechazar y rollback cambian producción: decídelo antes de ejecutarlos.
EOF
}

CMD="${1:-}"; [[ $# -gt 0 ]] && shift
APP=""; BUILD=""; REGLAS=0; YES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)    APP="$2"; shift 2 ;;
    --build)  BUILD="$2"; shift 2 ;;
    --reglas) REGLAS=1; shift ;;
    --yes)    YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Opción desconocida: $1" ;;
  esac
done
[[ "$CMD" =~ ^(estado|resumen|aprobar|rechazar|rollback)$ ]] || { usage; exit 1; }
[[ -n "$APP" ]] || die "Falta --app"
[[ -n "$CONFIG_FILE" && -f "$CONFIG_FILE" ]] || die "No encuentro promote-app.env (define PROMOTE_CONFIG)"
# shellcheck source=/dev/null
source "$CONFIG_FILE"
# Cloud Build va en la región de su conexión con GitHub, que puede no ser la de Cloud Run.
CB_REGION="${CB_REGION:-$REGION}"
need gcloud ""; need gh ""; need jq ""; need curl ""

SVC="$(echo "$APP" | tr '[:upper:]' '[:lower:]' | tr '_' '-' | sed -E 's/[^a-z0-9-]//g; s/^-+//; s/-+$//')"
REPO="$ORG/$APP"
TRIGGER="$SVC-prod"
G=(--project "$GCP_PROJECT")
GOVERNANCE_RE='^(CLAUDE\.md|AGENTS\.md|cloudbuild\.yaml|\.github/|firebase\.json)'

# ---------------------------------------------------------------- datos comunes
trigger_id() {
  gcloud builds triggers describe "$TRIGGER" --region="$CB_REGION" "${G[@]}" --format='value(id)' 2>/dev/null \
    || die "No existe el trigger $TRIGGER. ¿La app está promocionada? (skill promote-app)"
}
builds_json() {
  gcloud builds list --region="$CB_REGION" "${G[@]}" --filter="buildTriggerId=$(trigger_id)" --limit=30 --format=json
}
sha_of() { jq -r --arg id "$1" '.[] | select(.id == $id) | .substitutions.COMMIT_SHA // empty' <<<"$2"; }
last_success() { jq -r '[.[] | select(.status == "SUCCESS")][0].id // empty' <<<"$1"; }
pending_ids() { jq -r '.[] | select(.status == "PENDING") | .id' <<<"$1"; }
# La CLI no aprueba ni rechaza builds regionales: se usa la API de Cloud Build.
decide_build() {
  curl -sf -X POST -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "Content-Type: application/json" \
    -d "{\"approvalResult\":{\"decision\":\"$2\"}}" \
    "https://cloudbuild.googleapis.com/v1/projects/$GCP_PROJECT/locations/$CB_REGION/builds/$1:approve" >/dev/null
}
public_url() {
  local d
  d="$(gcloud beta run domain-mappings list --region="$REGION" "${G[@]}" \
       --filter="spec.routeName=$SVC" --format='value(metadata.name)' 2>/dev/null | head -1 || true)"
  if [[ -n "$d" ]]; then echo "https://$d"
  else gcloud run services describe "$SVC" --region="$REGION" "${G[@]}" --format='value(status.url)'; fi
}

# ---------------------------------------------------------------- estado
cmd_estado() {
  local b ok_id pend
  b="$(builds_json)"
  step "Producción de $APP"
  ok_id="$(last_success "$b")"
  if [[ -n "$ok_id" ]]; then
    echo "  Último despliegue: $(jq -r --arg id "$ok_id" '.[]|select(.id==$id)|"\(.finishTime // .createTime) · commit \(.substitutions.SHORT_SHA // "?")"' <<<"$b")"
  else
    warn "Ningún despliegue con éxito todavía"
  fi
  echo "  Revisión activa:   $(gcloud run services describe "$SVC" --region="$REGION" "${G[@]}" --format='value(status.latestReadyRevisionName)' 2>/dev/null || echo '?')"
  echo "  URL:               $(public_url)"
  step "Pendientes de aprobación"
  pend="$(pending_ids "$b")"
  if [[ -z "$pend" ]]; then echo "  Ninguno"
  else jq -r '.[] | select(.status=="PENDING") | "  \(.id) · \(.createTime) · commit \(.substitutions.SHORT_SHA // "?")"' <<<"$b"; fi
}

# ---------------------------------------------------------------- resumen
cmd_resumen() {
  local b head base cmp files prs
  b="$(builds_json)"
  if [[ -z "$BUILD" ]]; then
    BUILD="$(pending_ids "$b" | head -1)"
    [[ -n "$BUILD" ]] || { ok "No hay builds pendientes de aprobación"; return; }
  fi
  head="$(sha_of "$BUILD" "$b")"; [[ -n "$head" ]] || die "No encuentro el commit del build $BUILD"
  base="$(sha_of "$(last_success "$b")" "$b" || true)"

  step "Build $BUILD · commit ${head:0:7}"
  if [[ -n "$base" ]]; then
    cmp="$(gh api "repos/$REPO/compare/$base...$head")"
    echo "Commits desde el último despliegue (${base:0:7}):"
    jq -r '.commits[] | "  \(.sha[0:7]) \(.commit.message | split("\n")[0])"' <<<"$cmp"
    files="$(jq -r '.files[]?.filename' <<<"$cmp")"
  else
    warn "Primer despliegue: no hay versión anterior con la que comparar"
    files=""
  fi

  step "Pull Request y revisión de Claude"
  prs="$(gh api "repos/$REPO/commits/$head/pulls" --jq '.[].number' 2>/dev/null || true)"
  if [[ -z "$prs" ]]; then
    warn "Este commit NO viene de un PR: se ha subido a main directamente y se ha saltado la revisión"
  else
    local n
    for n in $prs; do
      echo "  PR #$n · $(gh pr view "$n" --repo "$REPO" --json title -q .title)"
      gh pr view "$n" --repo "$REPO" --json statusCheckRollup \
        -q '.statusCheckRollup[] | "    \(.name // .context): \(.conclusion // .state)"' 2>/dev/null || true
    done
  fi

  step "Ficheros sensibles"
  if [[ -n "$files" ]]; then
    if grep -E "$GOVERNANCE_RE" <<<"$files" >/dev/null; then
      warn "Cambian ficheros de gobierno (revisa que los aprobó Ingeniería):"
      grep -E "$GOVERNANCE_RE" <<<"$files" | sed 's/^/    /'
    else ok "Sin cambios en ficheros de gobierno"; fi
    if grep -qx 'firestore.rules' <<<"$files"; then
      warn "Cambian las reglas de Firestore: 'aprobar' las desplegará también"
    fi
  fi

  step "Perfil"
  local tier
  tier="$(gh api -H "Accept: application/vnd.github.raw" "repos/$REPO/contents/CLAUDE.md?ref=$head" 2>/dev/null \
          | grep -E 'TIER DE INTAKE:' | grep -oE 'N[012]' | head -1 || true)"
  echo "  Tier ${tier:-desconocido}"
}

# ---------------------------------------------------------------- reglas de Firestore
deploy_rules() {
  local sha="$1" dir
  need firebase "npm install -g firebase-tools"
  [[ "$FIREBASE_PROJECT" != "CAMBIAR" ]] || die "Configura FIREBASE_PROJECT"
  dir="$(mktemp -d)"
  git clone -q "https://github.com/$REPO.git" "$dir/repo" && git -C "$dir/repo" checkout -q "$sha"
  [[ -f "$dir/repo/firestore.rules" && ! -L "$dir/repo/firestore.rules" ]] || die "Falta firestore.rules en ${sha:0:7}"
  grep -q 'if true' "$dir/repo/firestore.rules" && die "firestore.rules contiene 'if true': no se despliega"
  # Del repo solo se usan las reglas: el firebase.json lo escribe el script, con la base de datos
  # de esta app y nada más (sin hooks predeploy ni bases de datos de otras apps).
  mkdir "$dir/deploy" && cp "$dir/repo/firestore.rules" "$dir/deploy/firestore.rules"
  jq -n --arg d "$SVC" '{firestore:[{database:$d, rules:"firestore.rules"}]}' > "$dir/deploy/firebase.json"
  (cd "$dir/deploy" && firebase deploy --only firestore --project "$FIREBASE_PROJECT" --non-interactive >/dev/null) \
    || die "No se pudieron desplegar las reglas de Firestore"
  rm -rf "$dir"
  ok "Reglas de Firestore desplegadas"
}

# ---------------------------------------------------------------- aprobar
cmd_aprobar() {
  [[ -n "$BUILD" ]] || die "Falta --build (usa 'resumen' para verlo)"
  local b head base status url code changed=0
  b="$(builds_json)"
  [[ "$(jq -r --arg id "$BUILD" '.[]|select(.id==$id)|.status' <<<"$b")" == "PENDING" ]] \
    || die "El build $BUILD no está pendiente de aprobación"
  head="$(sha_of "$BUILD" "$b")"
  base="$(sha_of "$(last_success "$b")" "$b" || true)"
  if [[ -n "$base" ]] && gh api "repos/$REPO/compare/$base...$head" --jq '.files[]?.filename' | grep -qx 'firestore.rules'; then
    changed=1
  fi

  step "Aprobando $BUILD"
  decide_build "$BUILD" APPROVED \
    || die "No se pudo aprobar (¿falta el rol Cloud Build Approver?). Apruébalo en Cloud Build → History y vuelve a 'estado'"
  while :; do
    status="$(gcloud builds describe "$BUILD" --region="$CB_REGION" "${G[@]}" --format='value(status)')"
    case "$status" in
      SUCCESS) ok "Build completado"; break ;;
      FAILURE|INTERNAL_ERROR|TIMEOUT|CANCELLED|EXPIRED)
        die "Build $status. Log: gcloud builds log $BUILD --region=$CB_REGION --project=$GCP_PROJECT" ;;
      *) sleep 15 ;;
    esac
  done

  # Tras un rollback el tráfico queda fijado a una revisión; se devuelve a la última.
  gcloud run services update-traffic "$SVC" --to-latest --region="$REGION" "${G[@]}" >/dev/null
  ok "Tráfico en la revisión nueva"

  if [[ "$changed" == "1" || "$REGLAS" == "1" ]]; then step "Reglas de Firestore"; deploy_rules "$head"; fi

  step "Comprobación"
  url="$(public_url)"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$url" || echo 000)"
  if [[ "$code" =~ ^(2|3) ]]; then ok "$url responde ($code)"
  else warn "$url responde $code. Si la app no funciona: release.sh rollback --app $APP --yes"; fi
}

# ---------------------------------------------------------------- rechazar
cmd_rechazar() {
  [[ -n "$BUILD" ]] || die "Falta --build"
  decide_build "$BUILD" REJECTED \
    || die "No se pudo rechazar (¿falta el rol Cloud Build Approver?). Recházalo en Cloud Build → History"
  ok "Build $BUILD rechazado"
}

# ---------------------------------------------------------------- rollback
cmd_rollback() {
  local current prev
  current="$(gcloud run services describe "$SVC" --region="$REGION" "${G[@]}" \
             --format=json | jq -r '[.status.traffic[]? | select(.percent == 100)][0].revisionName // .status.latestReadyRevisionName')"
  prev="$(gcloud run revisions list --service="$SVC" --region="$REGION" "${G[@]}" \
          --sort-by='~metadata.creationTimestamp' --format='value(metadata.name)' \
          | awk -v cur="$current" 'found {print; exit} $0 == cur {found=1}')"
  [[ -n "$prev" ]] || die "No hay una revisión anterior a $current"
  echo "  De $current → $prev"
  [[ "$YES" == "1" ]] || die "Añade --yes para confirmar la vuelta atrás"
  gcloud run services update-traffic "$SVC" --to-revisions="$prev=100" --region="$REGION" "${G[@]}" >/dev/null
  ok "Tráfico al 100 % en $prev"
  warn "Las reglas de Firestore no se revierten solas. El siguiente 'aprobar' devuelve el tráfico a la última versión"
}

case "$CMD" in
  estado) cmd_estado ;; resumen) cmd_resumen ;; aprobar) cmd_aprobar ;;
  rechazar) cmd_rechazar ;; rollback) cmd_rollback ;;
esac
