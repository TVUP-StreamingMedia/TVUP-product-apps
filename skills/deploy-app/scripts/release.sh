#!/usr/bin/env bash
# release.sh — Despliegues recurrentes de apps ya promocionadas (TVUP)
#
#   status    Qué está en producción y qué espera aprobación
#   summary   Qué cambia en el build pendiente: commits, PR, revisión, ficheros sensibles
#   approve   Aprueba el build, despliega reglas de Firestore si cambiaron y verifica la URL
#   reject    Rechaza el build pendiente
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
# Textos que escribe quien abre el PR (commits, títulos, nombres de fichero): sin caracteres
# de control, para que no puedan alterar lo que se ve en el terminal antes de aprobar.
clean() { tr -d '\000-\010\013-\037\177'; }

usage() {
  cat <<'EOF'
Uso:
  release.sh status   --app <repo>
  release.sh summary  --app <repo> [--build <id>]
  release.sh approve  --app <repo> --build <id> [--rules]
  release.sh reject   --app <repo> --build <id>
  release.sh rollback --app <repo> --yes

--service fija el servicio de Cloud Run; por defecto sale de la línea SERVICIO del CLAUDE.md del repo.

--rules fuerza el despliegue de firestore.rules aunque no hayan cambiado.
approve, reject y rollback cambian producción: decídelo antes de ejecutarlos.
EOF
}

CMD="${1:-}"; [[ $# -gt 0 ]] && shift
APP=""; SVC_ARG=""; BUILD=""; RULES=0; YES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)    APP="$2"; shift 2 ;;
    --service) SVC_ARG="$2"; shift 2 ;;
    --build)  BUILD="$2"; shift 2 ;;
    --rules|--reglas) RULES=1; shift ;;
    --yes)    YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Opción desconocida: $1" ;;
  esac
done
# Nombres antiguos en español, que se mantienen como alias.
case "$CMD" in estado) CMD=status ;; resumen) CMD=summary ;; aprobar) CMD=approve ;; rechazar) CMD=reject ;; esac
[[ "$CMD" =~ ^(status|summary|approve|reject|rollback)$ ]] || { usage; exit 1; }
[[ -n "$APP" ]] || die "Falta --app"
[[ -n "$CONFIG_FILE" && -f "$CONFIG_FILE" ]] || die "No encuentro promote-app.env (define PROMOTE_CONFIG)"
# shellcheck source=/dev/null
source "$CONFIG_FILE"
# Cloud Build va en la región de su conexión con GitHub, que puede no ser la de Cloud Run.
CB_REGION="${CB_REGION:-$REGION}"
need gcloud ""; need gh ""; need jq ""; need curl ""; need perl ""
CHECK_RULES="$SCRIPT_DIR/../../promote-app/scripts/check-rules.pl"
[[ -f "$CHECK_RULES" ]] || die "No encuentro check-rules.pl de promote-app"

REPO="$ORG/$APP"
# El servicio sale del perfil del intake (SERVICIO), no del nombre del repo: TVUP-x puede servir x.
SVC="$SVC_ARG"
if [[ -z "$SVC" ]]; then
  SVC="$(gh api -H "Accept: application/vnd.github.raw" "repos/$REPO/contents/CLAUDE.md" 2>/dev/null \
         | grep -E '^SERVICIO:' | head -1 | awk '{print $2}' || true)"
fi
[[ -n "$SVC" ]] || SVC="$(echo "$APP" | tr '[:upper:]' '[:lower:]' | tr '_' '-' | sed -E 's/[^a-z0-9-]//g; s/^-+//; s/-+$//')"
[[ "$SVC" =~ ^[a-z][a-z0-9-]*$ ]] || die "Nombre de servicio no válido: '$SVC'"
TRIGGER="$SVC-prod"
G=(--project "$GCP_PROJECT")
GOVERNANCE_RE='^(CLAUDE\.md|AGENTS\.md|cloudbuild\.yaml|\.github/|firebase\.json)'

# ---------------------------------------------------------------- datos comunes
# ID de GitHub de un repo. Se conserva al renombrar, así que identifica el repo mejor que el nombre.
gh_repo_id() { gh api "repos/$1" --jq .id 2>/dev/null || true; }
# ID de GitHub del repo enlazado a un recurso de Cloud Build (projects/.../connections/C/repositories/R).
linked_repo_id() {
  local conn uri
  conn="$(sed -E 's#.*/connections/([^/]+)/repositories/.*#\1#' <<<"$1")"
  uri="$(gcloud builds repositories describe "${1##*/}" --connection="$conn" --region="$CB_REGION" "${G[@]}" \
         --format='value(remoteUri)' 2>/dev/null || true)"
  uri="${uri#https://github.com/}"; uri="${uri%.git}"
  if [[ -n "$uri" ]]; then gh_repo_id "$uri"; fi
}
# SERVICIO lo puede editar cualquiera con escritura en el repo: solo se acepta si el trigger de ese
# servicio despliega este mismo repo. Si no, se actuaría sobre la producción de otra app.
check_binding() {
  local path mine theirs
  path="$(gcloud builds triggers describe "$TRIGGER" --region="$CB_REGION" "${G[@]}" \
          --format='value(repositoryEventConfig.repository)' 2>/dev/null || true)"
  [[ -n "$path" ]] || die "No existe el trigger $TRIGGER. ¿La app está promocionada? (skill promote-app)"
  mine="$(gh_repo_id "$REPO")"; theirs="$(linked_repo_id "$path")"
  [[ -n "$mine" && "$mine" == "$theirs" ]] \
    || die "El trigger $TRIGGER no despliega $REPO. Revisa SERVICIO en su CLAUDE.md o usa --service"
}
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
# La API de comparación corta a 300 ficheros y 250 commits. Si la respuesta llega cortada,
# la lista de ficheros no es fiable y quien llama decide por el lado seguro.
compare_json() { gh api "repos/$REPO/compare/$1...$2"; }
truncated() { jq -e '(.files | length) >= 300 or (.commits | length) < .total_commits' <<<"$1" >/dev/null; }
has_rules() { gh api "repos/$REPO/contents/firestore.rules?ref=$1" --jq .type >/dev/null 2>&1; }
pr_numbers() { gh api "repos/$REPO/commits/$1/pulls" --jq '.[].number' 2>/dev/null || true; }
public_url() {
  local d
  d="$(gcloud beta run domain-mappings list --region="$REGION" "${G[@]}" \
       --filter="spec.routeName=$SVC" --format='value(metadata.name)' 2>/dev/null | head -1 || true)"
  if [[ -n "$d" ]]; then echo "https://$d"
  else gcloud run services describe "$SVC" --region="$REGION" "${G[@]}" --format='value(status.url)'; fi
}

# ---------------------------------------------------------------- status
cmd_status() {
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

# ---------------------------------------------------------------- summary
cmd_summary() {
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
    cmp="$(compare_json "$base" "$head")"
    echo "Commits desde el último despliegue (${base:0:7}):"
    jq -r '.commits[] | "  \(.sha[0:7]) \(.commit.message | split("\n")[0])"' <<<"$cmp" | clean
    files="$(jq -r '.files[]?.filename' <<<"$cmp" | clean)"
    if truncated "$cmp"; then
      warn "El cambio es demasiado grande para la API de GitHub: las listas de commits y ficheros están incompletas."
      warn "Revísalo en el repo; 'approve' desplegará las reglas de Firestore por si acaso"
    fi
  else
    warn "Primer despliegue: no hay versión anterior con la que comparar"
    files=""
  fi

  step "Pull Request y revisión de Claude"
  prs="$(pr_numbers "$head")"
  if [[ -z "$prs" ]]; then
    warn "Este commit NO viene de un PR: se ha subido a main directamente y se ha saltado la revisión"
  else
    local n
    for n in $prs; do
      echo "  PR #$n · $(gh pr view "$n" --repo "$REPO" --json title -q .title | clean)"
      { gh pr view "$n" --repo "$REPO" --json statusCheckRollup \
          -q '.statusCheckRollup[] | "    \(.name // .context): \(.conclusion // .state)"' 2>/dev/null || true; } | clean
    done
  fi

  step "Ficheros sensibles"
  if [[ -n "$files" ]]; then
    if grep -E "$GOVERNANCE_RE" <<<"$files" >/dev/null; then
      warn "Cambian ficheros de gobierno (revisa que los aprobó Ingeniería):"
      grep -E "$GOVERNANCE_RE" <<<"$files" | sed 's/^/    /'
    else ok "Sin cambios en ficheros de gobierno"; fi
    if grep -qx 'firestore.rules' <<<"$files"; then
      warn "Cambian las reglas de Firestore: 'approve' las desplegará también"
    fi
  fi

  step "Perfil"
  local tier
  tier="$(gh api -H "Accept: application/vnd.github.raw" "repos/$REPO/contents/CLAUDE.md?ref=$head" 2>/dev/null \
          | grep -E 'TIER DE INTAKE:' | grep -oE 'N[012]' | head -1 || true)"
  echo "  Tier ${tier:-desconocido}"
}

# ---------------------------------------------------------------- reglas de Firestore
# Se preparan y validan ANTES de aprobar el build: si no son válidas, no se despliega nada.
RULES_DIR=""
prepare_rules() {
  local sha="$1" dir
  need firebase "npm install -g firebase-tools"
  [[ "$FIREBASE_PROJECT" != "CAMBIAR" ]] || die "Configura FIREBASE_PROJECT"
  [[ -n "$(pr_numbers "$sha")" ]] \
    || die "Las reglas de Firestore cambian en un commit que no viene de un PR: no se despliegan sin revisión"
  dir="$(mktemp -d)"
  git clone -q "https://github.com/$REPO.git" "$dir/repo" && git -C "$dir/repo" checkout -q "$sha"
  [[ -f "$dir/repo/firestore.rules" && ! -L "$dir/repo/firestore.rules" ]] || die "Falta firestore.rules en ${sha:0:7}"
  perl "$CHECK_RULES" "$dir/repo/firestore.rules" \
    || die "firestore.rules deja datos accesibles sin login: no se despliega (ni el build)"
  # Del repo solo se usan las reglas: el firebase.json lo escribe el script, con la base de datos
  # de esta app y nada más (sin hooks predeploy ni bases de datos de otras apps).
  mkdir "$dir/deploy" && cp "$dir/repo/firestore.rules" "$dir/deploy/firestore.rules"
  jq -n --arg d "$SVC" '{firestore:[{database:$d, rules:"firestore.rules"}]}' > "$dir/deploy/firebase.json"
  rm -rf "$dir/repo"
  RULES_DIR="$dir"
  ok "Reglas de Firestore válidas"
}
deploy_rules() {
  (cd "$RULES_DIR/deploy" && firebase deploy --only firestore --project "$FIREBASE_PROJECT" --non-interactive >/dev/null) \
    || die "No se pudieron desplegar las reglas de Firestore"
  rm -rf "$RULES_DIR"
  ok "Reglas de Firestore desplegadas"
}

# ---------------------------------------------------------------- approve
cmd_approve() {
  [[ -n "$BUILD" ]] || die "Falta --build (usa 'summary' para verlo)"
  local b head base cmp status url code changed=0
  b="$(builds_json)"
  [[ "$(jq -r --arg id "$BUILD" '.[]|select(.id==$id)|.status' <<<"$b")" == "PENDING" ]] \
    || die "El build $BUILD no está pendiente de aprobación"
  head="$(sha_of "$BUILD" "$b")"
  base="$(sha_of "$(last_success "$b")" "$b" || true)"
  if [[ -n "$base" ]]; then
    cmp="$(compare_json "$base" "$head")"
    if truncated "$cmp"; then
      # Lista incompleta: si la app tiene reglas, se despliegan por si han cambiado.
      has_rules "$head" && changed=1
    elif jq -r '.files[]?.filename' <<<"$cmp" | grep -qx 'firestore.rules'; then
      changed=1
    fi
  fi
  if [[ "$changed" == "1" || "$RULES" == "1" ]]; then step "Reglas de Firestore"; prepare_rules "$head"; fi

  step "Aprobando $BUILD"
  decide_build "$BUILD" APPROVED \
    || die "No se pudo aprobar (¿falta el rol Cloud Build Approver?). Apruébalo en Cloud Build → History y vuelve a 'status'"
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

  if [[ -n "$RULES_DIR" ]]; then step "Reglas de Firestore"; deploy_rules; fi

  step "Comprobación"
  url="$(public_url)"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$url" || echo 000)"
  if [[ "$code" =~ ^(2|3) ]]; then ok "$url responde ($code)"
  else warn "$url responde $code. Si la app no funciona: release.sh rollback --app $APP --yes"; fi
}

# ---------------------------------------------------------------- reject
cmd_reject() {
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
  warn "Las reglas de Firestore no se revierten solas. El siguiente 'approve' devuelve el tráfico a la última versión"
}

check_binding
case "$CMD" in
  status) cmd_status ;; summary) cmd_summary ;; approve) cmd_approve ;;
  reject) cmd_reject ;; rollback) cmd_rollback ;;
esac
