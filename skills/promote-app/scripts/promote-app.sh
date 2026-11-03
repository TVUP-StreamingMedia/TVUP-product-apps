#!/usr/bin/env bash
# promote-app.sh — Promoción y despliegue de apps internas de Producto (TVUP)
#
#   create   → paso 0: repo de la app desde la plantilla, con el CLAUDE.md del intake,
#              el código base (login y Firestore según el perfil) y docs/contexto/.
#              Producto lo importa en AI Studio o lo clona con Claude Code.
#   promote  → pasos 7-12: del ZIP de AI Studio al repo de la organización,
#              con gobierno TVUP aplicado y la primera revisión descargada.
#   deploy   → pasos 17-22: del repo corregido a producción en Cloud Run,
#              con dominio propio en apps.tvup.cloud.
#
# Entre ambas fases van los pasos 13-16 (corregir hallazgos y PR), que son humanos.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${PROMOTE_CONFIG:-$SCRIPT_DIR/promote-app.env}"

# ---------------------------------------------------------------- utilidades
c_red=$'\033[31m'; c_grn=$'\033[32m'; c_yel=$'\033[33m'; c_blu=$'\033[34m'; c_off=$'\033[0m'
step()    { echo; echo "${c_blu}▶ $*${c_off}"; }
ok()      { echo "${c_grn}✓ $*${c_off}"; }
warn()    { echo "${c_yel}⚠ $*${c_off}"; }
die()     { echo "${c_red}✗ $*${c_off}" >&2; exit 1; }
confirm() { local a; [[ -t 0 ]] || return 1; read -r -p "$1 [s/N] " a; [[ "$a" =~ ^[sSyY]$ ]]; }
run()     { if [[ "${DRY_RUN:-0}" == "1" ]]; then echo "  [dry-run] $*"; else "$@"; fi; }
need()    { command -v "$1" >/dev/null 2>&1 || die "Falta '$1'. $2"; }
sedi()    { if sed --version >/dev/null 2>&1; then sed -i "$@"; else sed -i '' "$@"; fi; }

usage() {
  cat <<'EOF'
Uso:
  promote-app.sh create  --claude-md <CLAUDE.md> [--gemini-md <GEMINI.md>] [--app <repo>]
  promote-app.sh promote --app <repo> --zip <codigo.zip> --claude-md <CLAUDE.md> [opciones]
  promote-app.sh deploy  --app <repo> [opciones]

Opciones:
  --app <nombre>        Nombre del repo en la organización (p. ej. TVUP-jira-hub)
  --service <nombre>    Servicio de Cloud Run (por defecto, la línea SERVICIO del CLAUDE.md)
  --zip <ruta>          ZIP descargado de Google AI Studio            (promote)
  --claude-md <ruta>    CLAUDE.md generado por el intake              (create, promote)
  --gemini-md <ruta>    GEMINI.md generado por el intake, si se usará AI Studio (create)
  --subdomain <nombre>  Subdominio bajo apps.tvup.cloud (por defecto, el nombre del servicio)
  --firebase            Añade los dominios a Authorized domains de Firebase (deploy)
  --firestore           Crea la base de datos de la app y despliega sus reglas (deploy)
  --approve             Aprueba el build sin preguntar (para uso desde Claude Code)
  --login-ok            Confirma que la app N1/N2 tiene implementado el login de su CLAUDE.md (deploy)
  --sin-dns             No crea el CNAME en Route 53; muestra el registro para crearlo a mano (deploy)
  --reuse-repo          Continúa aunque el repo ya exista                (promote)
  --dry-run             Muestra los comandos sin ejecutarlos
  -h, --help            Esta ayuda

Variables de entorno:
  ANTHROPIC_API_KEY     Opcional: si está, se guarda como secreto del repo; si no, hay que
                        añadirlo a mano o los PRs no tendrán revisión
  PROMOTE_CONFIG        Ruta alternativa al fichero de configuración
EOF
}

# ---------------------------------------------------------------- argumentos
CMD="${1:-}"; [[ $# -gt 0 ]] && shift
APP=""; SVC_ARG=""; ZIP=""; CLAUDE_MD=""; GEMINI_MD=""; SUB=""; FIREBASE=0; FIRESTORE=0; REUSE=0; APPROVE=0; LOGIN_OK=0; SIN_DNS=0; DRY_RUN="${DRY_RUN:-0}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)        APP="$2"; shift 2 ;;
    --service)    SVC_ARG="$2"; shift 2 ;;
    --zip)        ZIP="$2"; shift 2 ;;
    --claude-md)  CLAUDE_MD="$2"; shift 2 ;;
    --gemini-md)  GEMINI_MD="$2"; shift 2 ;;
    --subdomain)  SUB="$2"; shift 2 ;;
    --firebase)   FIREBASE=1; shift ;;
    --firestore)  FIRESTORE=1; shift ;;
    --approve)    APPROVE=1; shift ;;
    --login-ok)   LOGIN_OK=1; shift ;;
    --sin-dns)    SIN_DNS=1; shift ;;
    --reuse-repo) REUSE=1; shift ;;
    --dry-run)    DRY_RUN=1; shift ;;
    -h|--help)    usage; exit 0 ;;
    *)            die "Opción desconocida: $1 (usa --help)" ;;
  esac
done
[[ "$CMD" == "crear" ]] && CMD="create"   # nombre antiguo, se mantiene como alias
[[ "$CMD" =~ ^(create|promote|deploy)$ ]] || { usage; exit 1; }
# En create, el nombre del repo sale por defecto del perfil del intake (línea SERVICIO).
if [[ "$CMD" == "create" && -z "$APP" && -f "$CLAUDE_MD" ]]; then
  APP="$(grep -E '^SERVICIO:' "$CLAUDE_MD" | head -1 | awk '{print $2}')"
fi
[[ -n "$APP" ]] || die "Falta --app"

[[ -f "$CONFIG_FILE" ]] || die "No encuentro la configuración: $CONFIG_FILE (cópiala de promote-app.env.example)"
# shellcheck source=/dev/null
source "$CONFIG_FILE"
# Cloud Build va en la región de su conexión con GitHub, que puede no ser la de Cloud Run.
CB_REGION="${CB_REGION:-$REGION}"

# Nombre del servicio Cloud Run: minúsculas, números y guiones; máximo 49 caracteres.
# Sale de la línea SERVICIO del perfil del intake, no del nombre del repo: el repo puede
# llamarse TVUP-x y el servicio x. Orden: --service, CLAUDE.md local, CLAUDE.md del repo y,
# si no hay perfil, el nombre del repo.
# ID de GitHub de un repo. Se conserva al renombrar, así que identifica el repo mejor que el nombre.
# Solo devuelve un ID numérico: un error o un "null" no pueden coincidir y dar el repo por bueno.
gh_repo_id() { local id; id="$(gh api "repos/$1" --jq .id 2>/dev/null)" && [[ "$id" =~ ^[0-9]+$ ]] && echo "$id" || true; }
# ID de GitHub del repo enlazado a un recurso de Cloud Build (projects/.../connections/C/repositories/R).
linked_repo_id() {
  local conn uri
  conn="$(sed -E 's#.*/connections/([^/]+)/repositories/.*#\1#' <<<"$1")"
  uri="$(gcloud builds repositories describe "${1##*/}" --connection="$conn" --region="$CB_REGION" "${G[@]}" \
         --format='value(remoteUri)' 2>/dev/null || true)"
  uri="${uri#https://github.com/}"; uri="${uri%.git}"
  if [[ -n "$uri" ]]; then gh_repo_id "$uri"; fi
}
servicio_de() { grep -E '^SERVICIO:' "$1" 2>/dev/null | head -1 | awk '{print $2}' || true; }
SVC="$SVC_ARG"
[[ -z "$SVC" && -f "$CLAUDE_MD" ]] && SVC="$(servicio_de "$CLAUDE_MD")"
if [[ -z "$SVC" ]] && command -v gh >/dev/null 2>&1; then
  perfil_tmp="$(mktemp)"
  gh api -H "Accept: application/vnd.github.raw" "repos/$ORG/$APP/contents/CLAUDE.md" > "$perfil_tmp" 2>/dev/null \
    && SVC="$(servicio_de "$perfil_tmp")"
  rm -f "$perfil_tmp"
fi
[[ -n "$SVC" ]] || SVC="$(echo "$APP" | tr '[:upper:]' '[:lower:]' | tr '_' '-' | sed -E 's/[^a-z0-9-]//g; s/^-+//; s/-+$//')"
[[ "$SVC" =~ ^[a-z][a-z0-9-]*$ && ${#SVC} -le 49 ]] || die "Nombre de servicio no válido: '$SVC'"
# Excepciones aprobadas para esta app (apps/<servicio>.env): proyecto Firebase y base de datos.
# shellcheck source=app-overrides.sh
source "$SCRIPT_DIR/app-overrides.sh"
load_app_overrides "$SVC"
SUB="${SUB:-$SVC}"
FQDN="$SUB.$APPS_DOMAIN"
REPO="$ORG/$APP"
REPO_DIR="$WORK_DIR/$APP"
REPORT_DIR="$WORK_DIR/informes/$APP"

# Lee el tier del bloque de perfil. Si sigue el placeholder "[N0 | N1 | N2]", devuelve vacío.
# Tipo de login del perfil del intake. Falla cerrado: cualquier valor que no sea «no requerido»
# (o una línea ausente) cuenta como login obligatorio.
login_from() {
  local v
  v="$(grep -E '^LOGIN CORPORATIVO:' "$1" | head -1 | sed -E 's/^LOGIN CORPORATIVO:[[:space:]]*//' || true)"
  case "$v" in
    "no requerido") echo ninguno ;;
    *Microsoft*)    echo m365 ;;
    *"por decidir"*) echo pendiente ;;
    *)              echo otro ;;
  esac
}

tier_from() {
  local line
  line="$(grep -E 'TIER DE INTAKE:' "$1" | head -1 || true)"
  [[ -z "$line" || "$line" == *"|"* ]] && { echo ""; return; }
  echo "$line" | grep -oE 'N[012]' | head -1 || true
}

# Escribe src/lib/firebase-config.ts con el proyecto Firebase estándar y la base de datos de la app.
# Se usa al crear el repo y al promocionar (el ZIP de AI Studio puede traer la config de otro proyecto).
write_firebase_config() {
  local f="src/lib/firebase-config.ts"
  # Con un proyecto Firebase propio, apiKey y appId del estándar no valen: no se reescribe.
  if [[ "$FIREBASE_OVERRIDE" == "1" ]]; then
    warn "La app usa el proyecto Firebase $FIREBASE_PROJECT (excepción): $f no se reescribe"
    return 0
  fi
  mkdir -p src/lib
  cat > "$f" <<CFG
// Config pública del SDK web de Firebase. NO es un secreto: identifica el proyecto, y la
// protección de los datos la dan las reglas y el login. Es el ÚNICO fichero donde puede estar.
// La escribe el script de Ingeniería: no la cambies a mano.
export const firebaseConfig = {
  apiKey: "$FIREBASE_API_KEY",
  authDomain: "$FIREBASE_AUTH_DOMAIN",
  projectId: "$FIREBASE_PROJECT",
  appId: "$FIREBASE_APP_ID",
};

// Base de datos propia de esta app = nombre del servicio, salvo excepción aprobada.
export const DATABASE_ID = "$FIRESTORE_DATABASE";

// Login corporativo. Mantener DOMINIO_CORPORATIVO igual que en firestore.rules.
export const DOMINIO_CORPORATIVO = "$DOMINIO_CORPORATIVO";
export const MICROSOFT_TENANT_ID = "$MICROSOFT_TENANT_ID";
CFG
  if grep -q CAMBIAR "$f"; then warn "Faltan valores de Firebase en $CONFIG_FILE: firebase-config.ts lleva CAMBIAR"
  else ok "src/lib/firebase-config.ts apunta al proyecto estándar ($FIREBASE_PROJECT), base '$FIRESTORE_DATABASE'"; fi
}

# Rellena cloudbuild.yaml y README.md de la plantilla con los valores de la app.
fill_governance() {
  local tier="$1"
  [[ -f cloudbuild.yaml ]] && sedi "s|CAMBIAR-nombre-servicio|$SVC|; s|CAMBIAR-region|$REGION|" cloudbuild.yaml
  [[ -f README.md ]] && sedi "s|^# \[Nombre de la app\]|# $APP|; s|\[N0 \| N1 \| N2\]|$tier|; s|\[nombre-del-servicio\]|$SVC|; s|\[europe-west1\]|$REGION|; s|\[subdominio\]\.apps\.tvup\.cloud|$FQDN|" README.md
  return 0
}

# Protección de main: exige PR (y el check de revisión si está configurado).
protect_main() {
  local checks='null'
  [[ -n "$REQUIRED_CHECK" ]] && checks="$(jq -n --arg c "$REQUIRED_CHECK" '{strict:false,contexts:[$c]}')"
  if jq -n --argjson checks "$checks" \
      '{required_status_checks:$checks, enforce_admins:false,
        required_pull_request_reviews:{required_approving_review_count:0}, restrictions:null}' \
     | gh api -X PUT "repos/$REPO/branches/main/protection" --input - >/dev/null 2>&1; then
    ok "main exige PR"
  else
    warn "No se pudo proteger main (en repos privados requiere GitHub Team). La revisión depende de la disciplina"
  fi
}

# ---------------------------------------------------------------- comprobaciones GitHub
has_review_secret() {
  gh secret list --repo "$REPO" --json name -q '.[].name' 2>/dev/null | grep -qx ANTHROPIC_API_KEY
}

# La clave solo sirve para la revisión en GitHub Actions; el script no llama a Claude.
set_review_secret() {
  if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
    printf '%s' "$ANTHROPIC_API_KEY" | gh secret set ANTHROPIC_API_KEY --repo "$REPO" && ok "Secreto guardado en el repo"
  elif has_review_secret; then
    ok "El repo ya tiene el secreto ANTHROPIC_API_KEY"
  else
    warn "Falta el secreto ANTHROPIC_API_KEY: añádelo a mano (gh secret set ANTHROPIC_API_KEY --repo $REPO); sin él los PRs no tienen revisión"
  fi
}

preflight_github() {
  step "Comprobaciones de GitHub"
  need gh "Instala GitHub CLI: https://cli.github.com"
  need git ""; need jq "brew install jq"

  local user state
  user="$(gh api user --jq .login)" || die "gh no tiene sesión. Ejecuta: gh auth login"
  state="$(gh api "orgs/$ORG/memberships/$user" --jq .state 2>/dev/null || true)"
  [[ "$state" == "active" ]] || die "La cuenta '$user' no es miembro activo de $ORG. ¿Es la cuenta corporativa? (gh auth switch)"
  ok "Sesión de gh: $user, miembro de $ORG"

  # Usar las credenciales de gh para git por HTTPS evita el lío de claves SSH personal/corporativa.
  gh auth setup-git >/dev/null 2>&1 || true

  gh repo view "$ORG/$TEMPLATE_REPO" >/dev/null 2>&1 || die "No existe el repo plantilla $ORG/$TEMPLATE_REPO"
  gh repo view "$ORG/$CENTRAL_REPO"  >/dev/null 2>&1 || die "No existe el repo central $ORG/$CENTRAL_REPO"
  gh api "repos/$ORG/$CENTRAL_REPO/git/ref/tags/$CENTRAL_TAG" >/dev/null 2>&1 \
    || warn "El repo central no tiene el tag '$CENTRAL_TAG'; el workflow de revisión de la app fallará hasta crearlo"

  # Apps instaladas a nivel de organización (requiere scope admin:org; si no, solo avisa).
  local apps
  if apps="$(gh api "orgs/$ORG/installations" --jq '.installations[] | "\(.app_slug):\(.repository_selection)"' 2>/dev/null)"; then
    for slug in claude google-cloud-build; do
      if echo "$apps" | grep -q "^$slug:all$"; then ok "App '$slug' instalada con acceso a todos los repos"
      elif echo "$apps" | grep -q "^$slug:"; then warn "App '$slug' instalada solo en repos seleccionados: añade $APP a mano"
      else warn "App '$slug' no instalada en $ORG"; fi
    done
  else
    warn "No se pudieron comprobar las GitHub Apps (falta scope admin:org: gh auth refresh -s admin:org)"
  fi
}


# ---------------------------------------------------------------- CREAR (paso 0)
cmd_create() {
  [[ -f "$CLAUDE_MD" ]] || die "Falta --claude-md o no existe: $CLAUDE_MD"
  need pnpm "npm install -g pnpm"
  CLAUDE_MD="$(cd "$(dirname "$CLAUDE_MD")" && pwd)/$(basename "$CLAUDE_MD")"
  if [[ -n "$GEMINI_MD" ]]; then
    [[ -f "$GEMINI_MD" ]] || die "No existe $GEMINI_MD"
    GEMINI_MD="$(cd "$(dirname "$GEMINI_MD")" && pwd)/$(basename "$GEMINI_MD")"
  fi

  local tier perfil_svc login=0 db=0
  tier="$(tier_from "$CLAUDE_MD")"
  [[ -n "$tier" ]] || die "El CLAUDE.md no tiene el perfil del intake relleno (TIER DE INTAKE)"
  perfil_svc="$(grep -E '^SERVICIO:' "$CLAUDE_MD" | head -1 | awk '{print $2}')"
  if [[ -n "$perfil_svc" && "$perfil_svc" != "$SVC" ]]; then
    die "El intake dice SERVICIO '$perfil_svc' y --service dice '$SVC'. Quita --service o rehaz el intake con el nombre correcto"
  fi
  local login_tipo; login_tipo="$(login_from "$CLAUDE_MD")"
  [[ "$login_tipo" == "m365" ]] && login=1
  grep -qE '^PERSISTENCIA:.*base de datos' "$CLAUDE_MD" && db=1
  ok "Perfil: tier $tier · login $login_tipo · base de datos $([[ $db == 1 ]] && echo sí || echo no)"
  if [[ "$login_tipo" == "otro" || "$login_tipo" == "pendiente" ]]; then
    warn "El perfil pide un login que no es Microsoft 365: create NO trae código de login para él."
    warn "La app no se puede hacer pública hasta que Ingeniería implemente ese login (deploy no lo hará)."
  fi

  preflight_github
  local ASSETS_DIR; ASSETS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

  step "Repo $REPO desde la plantilla"
  if gh repo view "$REPO" >/dev/null 2>&1; then
    [[ "$REUSE" == "1" ]] || die "El repo $REPO ya existe. Usa --reuse-repo si quieres completar uno a medias"
    warn "El repo ya existe; se completa"
  else
    run gh repo create "$REPO" --template "$ORG/$TEMPLATE_REPO" --private
    [[ "$DRY_RUN" == "1" ]] || sleep 5
  fi
  mkdir -p "$WORK_DIR"
  if [[ -d "$REPO_DIR/.git" ]]; then (cd "$REPO_DIR" && run git pull --ff-only)
  else run git clone "https://github.com/$REPO.git" "$REPO_DIR"; fi
  [[ "$DRY_RUN" == "1" ]] && { warn "dry-run: el resto de create necesita el repo clonado"; return; }
  cd "$REPO_DIR"

  step "Reglas del intake"
  cp "$CLAUDE_MD" CLAUDE.md; ok "CLAUDE.md"
  if [[ -n "$GEMINI_MD" ]]; then cp "$GEMINI_MD" GEMINI.md; ok "GEMINI.md (para importar en AI Studio)"; fi
  fill_governance "$tier"

  step "Esqueleto de la app"
  if [[ -f package.json ]]; then
    warn "Ya hay package.json: no se toca el esqueleto"
  else
    cp -R "$ASSETS_DIR/esqueleto/." .
    if [[ "$login" == "1" ]]; then mv src/main.login.tsx src/main.tsx; rm -f src/main.plain.tsx
    else mv src/main.plain.tsx src/main.tsx; rm -f src/main.login.tsx; fi
    local f
    for f in package.json index.html src/App.tsx; do sedi "s|__SVC__|$SVC|g; s|__APP__|$APP|g" "$f"; done
    ok "Vite + React + TypeScript, con script start para Cloud Run"
  fi

  if [[ "$login" == "1" || "$db" == "1" ]]; then
    step "Código base de Firebase"
    local SK=".claude/skills"
    [[ -d "$SK" ]] || die "La plantilla no trae .claude/skills: no se puede copiar el código base"
    write_firebase_config
    cp "$SK/firestore-tvup/assets/firebase.ts" src/lib/firebase.ts
    if [[ "$login" == "1" ]]; then
      mkdir -p src/components src/assets
      cp "$SK/login-microsoft365/assets/login.ts" src/lib/login.ts
      cp "$SK/login-microsoft365/assets/ConLogin.tsx" src/components/ConLogin.tsx
      cp "$SK/login-microsoft365/assets/login.css" src/components/login.css
      cp "$SK/login-microsoft365/assets/tvup-logo.png" src/assets/tvup-logo.png
      sedi "s|__APP__|$APP|g" src/components/ConLogin.tsx
      ok "Login Microsoft 365 con la pantalla de TVUP: src/lib/login.ts y src/components/ConLogin.tsx, envolviendo la app"
    fi
    if [[ "$db" == "1" ]]; then
      cp "$SK/firestore-tvup/assets/firestore.ts" src/lib/firestore.ts
      cp "$SK/firestore-tvup/assets/firestore.rules" firestore.rules
      jq --arg d "$FIRESTORE_DATABASE" '.firestore[0].database = $d' "$SK/firestore-tvup/assets/firebase.json" > firebase.json
      local dom_re; dom_re="$(printf '%s' "$DOMINIO_CORPORATIVO" | sed 's/\./[.]/g')"
      sedi "s|tvup\\[\\.\\]media|$dom_re|" firestore.rules
      ok "Firestore: src/lib/firestore.ts, firestore.rules y firebase.json (base '$FIRESTORE_DATABASE')"
    fi
    (pnpm add firebase >/dev/null 2>&1 && ok "Dependencia firebase añadida") || warn "No se pudo añadir firebase con pnpm"
  fi
  if [[ ! -f pnpm-lock.yaml && -f package.json ]]; then
    pnpm install --lockfile-only >/dev/null 2>&1 && ok "pnpm-lock.yaml generado" || warn "No se pudo generar pnpm-lock.yaml"
  fi

  step "Contexto de la app (docs/contexto/)"
  if [[ -d docs/contexto ]]; then
    warn "docs/contexto/ ya existe: no se toca"
  else
    mkdir -p docs/contexto
    cp "$ASSETS_DIR/contexto/"{README,arquitectura,decisiones,glosario}.md docs/contexto/
    [[ "$db" == "1" ]] && cp "$ASSETS_DIR/contexto/modelo-de-datos.md" docs/contexto/
    [[ "$login" == "1" ]] || sedi '/Login Microsoft 365/d' docs/contexto/arquitectura.md
    sedi "s|__SVC__|$SVC|g; s|__FECHA__|$(date +%Y-%m-%d)|g; s|__TIER__|$tier|g" docs/contexto/*.md
    ok "Arquitectura, decisiones y glosario$([[ $db == 1 ]] && echo ', y modelo de datos')"
  fi

  step "Commit y push a main"
  git add -A
  if git diff --cached --quiet; then warn "Nada que commitear"
  else git commit -q -m "Arranque de $APP desde la plantilla (tier $tier)"; git push -q origin HEAD:main; ok "Subido a main"; fi

  step "Secreto y protección de main"
  set_review_secret
  protect_main

  cat <<EOF

${c_grn}Repo listo:${c_off} https://github.com/$REPO
  · Con Claude Code: gh repo clone $REPO   (Producto trabaja en ramas y abre PRs)
  · Con AI Studio:   Build → + → Import from GitHub → $REPO
                     y pegar el INSTRUCTIONS.md del intake en Custom instructions.
                     Al terminar el prototipo: $0 promote --app $APP --zip <zip> --claude-md <CLAUDE.md>
EOF
}

# ---------------------------------------------------------------- PROMOTE (pasos 7-12)
cmd_promote() {
  [[ -f "$ZIP" ]]       || die "Falta --zip o no existe: $ZIP"
  [[ -f "$CLAUDE_MD" ]] || die "Falta --claude-md o no existe: $CLAUDE_MD"
  # Rutas absolutas: más adelante se cambia de directorio al repo clonado.
  ZIP="$(cd "$(dirname "$ZIP")" && pwd)/$(basename "$ZIP")"
  CLAUDE_MD="$(cd "$(dirname "$CLAUDE_MD")" && pwd)/$(basename "$CLAUDE_MD")"
  need unzip ""; need rsync ""; need pnpm "npm install -g pnpm"

  local tier; tier="$(tier_from "$CLAUDE_MD")"
  [[ -n "$tier" ]] || die "El CLAUDE.md no tiene el perfil del intake relleno (TIER DE INTAKE)"
  ok "CLAUDE.md con tier $tier"

  preflight_github

  # Paso 7 — repo desde la plantilla
  step "Paso 7 · Crear $REPO desde la plantilla"
  if gh repo view "$REPO" >/dev/null 2>&1; then
    ok "El repo ya existe (creado con 'create'): el código del ZIP se añade a él"
  else
    run gh repo create "$REPO" --template "$ORG/$TEMPLATE_REPO" --private
    [[ "$DRY_RUN" == "1" ]] || sleep 5   # GitHub tarda unos segundos en poblar la plantilla
  fi
  mkdir -p "$WORK_DIR"
  if [[ -d "$REPO_DIR/.git" ]]; then (cd "$REPO_DIR" && run git pull --ff-only)
  else run git clone "https://github.com/$REPO.git" "$REPO_DIR"; fi
  [[ "$DRY_RUN" == "1" ]] && { warn "dry-run: el resto de promote necesita el repo clonado"; return; }
  cd "$REPO_DIR"

  # Código del ZIP encima de la plantilla, sin pisar los ficheros de gobierno
  step "Paso 7 · Copiar el código del ZIP"
  local tmp src
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' RETURN
  unzip -q "$ZIP" -d "$tmp/src"; rm -rf "$tmp/src/__MACOSX"
  # Un enlace simbólico en el ZIP podría copiar ficheros de esta máquina (p. ej. ~/.ssh) al repo.
  find "$tmp/src" -type l | grep -q . && die "El ZIP contiene enlaces simbólicos: no se procesa"
  src="$tmp/src"
  if [[ "$(find "$src" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" == "1" ]]; then
    local only; only="$(find "$src" -mindepth 1 -maxdepth 1)"
    [[ -d "$only" ]] && src="$only"
  fi
  rsync -a --no-links \
    --exclude='.git' --exclude='.github' --exclude='node_modules' --exclude='dist' \
    --exclude='cloudbuild.yaml' --exclude='CLAUDE.md' --exclude='AGENTS.md' --exclude='GEMINI.md' \
    --exclude='.gitleaks.toml' --exclude='public/serve.json' --exclude='.claude' \
    --exclude='.gitignore' --exclude='README.md' \
    --exclude='.pnpmfile.cjs' --exclude='.pnpmfile.mjs' --exclude='.npmrc' --exclude='.yarnrc*' \
    --exclude='pnpm-workspace.yaml' \
    --include='.env.example' --exclude='.env*' \
    "$src"/ ./
  if [[ -f "$src/README.md" ]]; then mkdir -p docs; cp "$src/README.md" docs/README-ai-studio.md; fi
  if find "$src" -maxdepth 1 -name '.env*' ! -name '.env.example' | grep -q .; then
    warn "El ZIP traía ficheros .env: NO se han copiado. Revisa qué variables necesita la app"
  fi
  ok "Código copiado"

  # CLAUDE.md del intake
  cp "$CLAUDE_MD" CLAUDE.md
  ok "CLAUDE.md del intake añadido"

  # cloudbuild.yaml y README con los valores de esta app
  step "Paso 7 · Configurar SERVICE, REGION y README"
  [[ -f cloudbuild.yaml ]] || die "La plantilla no trae cloudbuild.yaml"
  fill_governance "$tier"
  ok "Servicio $SVC en $REGION, dominio $FQDN"
  # El ZIP de AI Studio puede traer la config del Firebase que aprovisiona AI Studio.
  if [[ -f src/lib/firebase-config.ts ]]; then write_firebase_config; fi

  # Paso 8 — .gitignore con lo mínimo obligatorio (fusiona el del ZIP si lo había)
  step "Paso 8 · .gitignore"
  touch .gitignore
  [[ -f "$src/.gitignore" ]] && cat "$src/.gitignore" >> .gitignore
  for l in '.env' '.env.*' '!.env.example' 'node_modules' 'dist'; do
    grep -qxF -- "$l" .gitignore || echo "$l" >> .gitignore
  done
  awk 'NF==0 || !seen[$0]++' .gitignore > .gitignore.tmp && mv .gitignore.tmp .gitignore
  ok ".gitignore listo"

  # pnpm, script start y puerto
  step "Gestor de paquetes y arranque"
  if [[ -f package.json ]]; then
    if   [[ -f package-lock.json ]]; then pnpm import >/dev/null && rm -f package-lock.json; ok "package-lock.json convertido a pnpm"
    elif [[ -f yarn.lock ]];         then pnpm import >/dev/null && rm -f yarn.lock;         ok "yarn.lock convertido a pnpm"
    elif [[ ! -f pnpm-lock.yaml ]];  then pnpm install --lockfile-only --ignore-pnpmfile --ignore-scripts >/dev/null; ok "pnpm-lock.yaml generado"
    fi
    rm -f bun.lock bun.lockb

    local server=""; for f in server.ts server.js src/server.ts src/server.js; do [[ -f "$f" ]] && { server="$f"; break; }; done
    if [[ -z "$(jq -r '.scripts.start // empty' package.json)" ]]; then
      if [[ -n "$server" ]]; then
        warn "Hay $server pero no script 'start': añade uno que lo arranque antes de desplegar"
      else
        pnpm add serve --ignore-scripts >/dev/null
        jq '.scripts.start = "serve -s dist -l $PORT"' package.json > package.json.tmp && mv package.json.tmp package.json
        ok "Añadido script start que sirve dist/ en \$PORT"
      fi
    fi
    if [[ -n "$server" ]] && ! grep -q 'process.env.PORT' "$server"; then
      warn "$server no lee process.env.PORT: Cloud Run no podrá arrancarlo"
    fi
  else
    warn "No hay package.json: revisa cómo se construye la app"
  fi

  # Avisos tempranos de los errores que ya hemos visto
  step "Avisos previos a la revisión"
  if grep -rEnI --exclude-dir=node_modules --exclude-dir=.git --exclude='firebase-config.ts' 'AIza[0-9A-Za-z_-]{35}' . >/dev/null 2>&1; then
    warn "Hay una clave AIza fuera de src/lib/firebase-config.ts. Si es la config pública de Firebase, muévela ahí (skill firestore-tvup); si no, es un secreto: el check-secrets de cloudbuild bloqueará el despliegue"
  fi
  if ls vite.config.* >/dev/null 2>&1 && grep -nE 'process\.env\.[A-Z_]*(KEY|SECRET|TOKEN)' vite.config.* >/dev/null; then
    warn "vite.config expone una variable secreta al bundle (define). La revisión lo marcará como Alta"
  fi
  [[ -f ".github/workflows/$REVIEW_WORKFLOW_FILE" ]] || warn "La plantilla no trae .github/workflows/$REVIEW_WORKFLOW_FILE"

  # Commit inicial
  step "Commit y push a main"
  git add -A
  if git diff --cached --quiet; then warn "Nada que commitear"
  else git commit -q -m "Promoción desde AI Studio: código inicial y gobierno TVUP (tier $tier)"; git push -q origin HEAD:main; ok "Subido a main"; fi

  # Paso 9 — secreto
  step "Paso 9 · Secreto ANTHROPIC_API_KEY"
  set_review_secret

  protect_main

  # Paso 12 — revisión manual del código completo
  step "Paso 12 · Lanzar la revisión completa"
  if ! has_review_secret; then
    warn "Sin el secreto ANTHROPIC_API_KEY la revisión fallaría. Añádelo y lánzala: gh workflow run $REVIEW_WORKFLOW_FILE --repo $REPO --ref main"
    return
  fi
  gh workflow run "$REVIEW_WORKFLOW_FILE" --repo "$REPO" --ref main
  sleep 8
  local run_id
  run_id="$(gh run list --repo "$REPO" --workflow "$REVIEW_WORKFLOW_FILE" --event workflow_dispatch --limit 1 --json databaseId -q '.[0].databaseId')"
  [[ -n "$run_id" ]] || die "No encuentro la ejecución del workflow"
  echo "  Ejecución $run_id — esperando (puede tardar varios minutos)…"
  gh run watch "$run_id" --repo "$REPO" --exit-status >/dev/null || warn "La revisión terminó con error; revisa el log en GitHub"
  mkdir -p "$REPORT_DIR"; rm -f "$REPORT_DIR/INFORME-REVISION.md"
  if gh run download "$run_id" --repo "$REPO" -n informe-revision -D "$REPORT_DIR" >/dev/null 2>&1; then
    ok "Informe: $REPORT_DIR/INFORME-REVISION.md"
    grep -E 'RIESGO GLOBAL' "$REPORT_DIR/INFORME-REVISION.md" || true
  else
    warn "No se pudo descargar el informe; está en la pestaña Summary de la ejecución"
  fi

  cat <<EOF

${c_grn}Promoción terminada.${c_off} Siguientes pasos (13-16, manuales):
  1. cd $REPO_DIR && git checkout -b fix/revision
  2. Abrir Claude Code y pedirle que aplique la sección "Instrucciones para corregir" del informe
  3. Abrir un PR; la revisión comentará el diff. Merge cuando esté en verde
  4. Después: $0 deploy --app $APP [--firebase] [--firestore]
EOF
}

# ---------------------------------------------------------------- DEPLOY (pasos 17-22)
cmd_deploy() {
  need gcloud "https://cloud.google.com/sdk/docs/install"
  need aws "https://aws.amazon.com/cli/"
  need gh ""; need jq ""; need curl ""
  [[ "$GCP_PROJECT" != "CAMBIAR" ]] || die "Configura GCP_PROJECT en $CONFIG_FILE"
  local G=(--project "$GCP_PROJECT")

  step "Comprobaciones"
  gh repo view "$REPO" >/dev/null 2>&1 || die "No existe $REPO"
  ok "gcloud: $(gcloud config get-value account 2>/dev/null) · proyecto $GCP_PROJECT"
  # Verificar un dominio en Search Console cubre sus subdominios (p. ej. apps.tvup.cloud).
  local dominio verificado=0
  while read -r dominio; do
    [[ -n "$dominio" && ( "$FQDN" == "$dominio" || "$FQDN" == *".$dominio" ) ]] && verificado=1
  done < <(gcloud domains list-user-verified --format='value(id)' 2>/dev/null)
  [[ "$verificado" == "1" ]] \
    || warn "Tu cuenta de gcloud no tiene verificado $FQDN ni un dominio padre en Search Console: el domain mapping fallará"

  local perfil_file tier login_tipo
  perfil_file="$(mktemp)"
  gh api -H "Accept: application/vnd.github.raw" "repos/$REPO/contents/CLAUDE.md" > "$perfil_file" 2>/dev/null || true
  tier="$(tier_from "$perfil_file")"; login_tipo="$(login_from "$perfil_file")"; rm -f "$perfil_file"
  [[ -n "$tier" ]] || { warn "No se pudo leer el tier del CLAUDE.md; se trata como N2"; tier="N2"; }
  ok "Tier $tier · login $login_tipo"

  # Paso 18 — vincular repo a Cloud Build
  step "Paso 18 · Vincular el repo a Cloud Build"
  local cb_repo="$ORG-$APP"
  local cb_path="projects/$GCP_PROJECT/locations/$CB_REGION/connections/$CB_CONNECTION/repositories/$cb_repo"
  if gcloud builds repositories describe "$cb_repo" --connection="$CB_CONNECTION" --region="$CB_REGION" "${G[@]}" >/dev/null 2>&1; then
    ok "Ya vinculado"
  else
    run gcloud builds repositories create "$cb_repo" --remote-uri="https://github.com/$REPO.git" \
      --connection="$CB_CONNECTION" --region="$CB_REGION" "${G[@]}"
    ok "Vinculado como $cb_repo"
  fi

  # Paso 19 — trigger con aprobación obligatoria
  step "Paso 19 · Trigger de despliegue con aprobación"
  local trigger="$SVC-prod"
  local trigger_repo
  if trigger_repo="$(gcloud builds triggers describe "$trigger" --region="$CB_REGION" "${G[@]}" \
                       --format='value(repositoryEventConfig.repository)' 2>/dev/null)"; then
    if [[ "$trigger_repo" == "$cb_path" ]]; then
      ok "El trigger $trigger ya existe"
    else
      # Solo si es el mismo repo renombrado (mismo ID de GitHub). SERVICIO sale del CLAUDE.md, que
      # puede editar quien escribe en el repo: sin esta comprobación, se robaría el trigger de otra app.
      local mine; mine="$(gh_repo_id "$REPO")"
      [[ -n "$mine" && "$mine" == "$(linked_repo_id "$trigger_repo")" ]] \
        || die "El trigger $trigger despliega otro repo (${trigger_repo##*/}), no $REPO. Revisa SERVICIO en el CLAUDE.md o usa --service"
      warn "El repo se renombró: el trigger $trigger escucha ${trigger_repo##*/}; se cambia a $cb_repo"
      # gcloud manda la máscara de 1.ª generación (github.push.branch) y la API rechaza también un
      # PATCH parcial con updateMask=repositoryEventConfig. Sí acepta el trigger completo: se lee,
      # se cambia solo el repositorio y se envía entero, con su aprobación y su cuenta de servicio.
      if [[ "$DRY_RUN" == "1" ]]; then
        echo "  [dry-run] PATCH triggers/$trigger (trigger completo, repositorio → $cb_repo)"
      else
        local api token tid
        # Por ID, como en la llamada que se probó a mano: con el nombre no está comprobado.
        tid="$(gcloud builds triggers describe "$trigger" --region="$CB_REGION" "${G[@]}" --format='value(id)')"
        api="https://cloudbuild.googleapis.com/v1/projects/$GCP_PROJECT/locations/$CB_REGION/triggers/$tid"
        token="$(gcloud auth print-access-token)"
        curl -sf -H "Authorization: Bearer $token" "$api" \
          | jq --arg r "$cb_path" 'del(.createTime) | .repositoryEventConfig.repository = $r' \
          | curl -sf -X PATCH -H "Authorization: Bearer $token" -H "Content-Type: application/json" \
              --data-binary @- "$api" >/dev/null \
          || die "No se pudo cambiar el repositorio del trigger $trigger"
        [[ "$(gcloud builds triggers describe "$trigger" --region="$CB_REGION" "${G[@]}" \
              --format='value(repositoryEventConfig.repository)')" == "$cb_path" ]] \
          || die "El trigger $trigger no quedó apuntando a $cb_repo"
        [[ "$(gcloud builds triggers describe "$trigger" --region="$CB_REGION" "${G[@]}" \
              --format='value(approvalConfig.approvalRequired)')" == "True" ]] \
          || die "El trigger $trigger ha perdido la aprobación obligatoria: revísalo en Cloud Build"
      fi
      ok "Trigger $trigger apuntando a $cb_repo"
    fi
  else
    # Un servicio que ya existe sin trigger de este proceso es de otra app (o de un despliegue antiguo).
    if gcloud run services describe "$SVC" --region="$REGION" "${G[@]}" >/dev/null 2>&1; then
      die "Ya existe el servicio $SVC y ningún trigger de este proceso lo despliega. Revisa SERVICIO o, si es una migración, coordínala con Ingeniería"
    fi
    local args=(builds triggers create github --name="$trigger" --region="$CB_REGION" --repository="$cb_path"
                --branch-pattern='^main$' --build-config=cloudbuild.yaml --require-approval "${G[@]}")
    [[ -n "$CB_SERVICE_ACCOUNT" ]] && args+=(--service-account="$CB_SERVICE_ACCOUNT")
    run gcloud "${args[@]}"
    ok "Trigger $trigger creado (push a main → espera aprobación)"
  fi

  [[ "$DRY_RUN" == "1" ]] && { warn "dry-run: el resto de deploy necesita un build real"; return; }

  # Paso 17 — primer despliegue a través del gate
  step "Paso 17 · Lanzar el despliegue"
  local build_id status
  build_id="$(gcloud builds triggers run "$trigger" --region="$CB_REGION" --branch=main "${G[@]}" --format='value(metadata.build.id)')"
  [[ -n "$build_id" ]] || die "No se obtuvo el ID del build"
  echo "  Build $build_id en espera de aprobación"
  [[ "$APPROVE" == "1" ]] || confirm "¿Apruebas el despliegue a producción de $APP?" \
    || die "Despliegue no aprobado. Build $build_id queda pendiente (usa --approve para aprobarlo)"
  # La CLI no aprueba builds regionales: se usa la API de Cloud Build.
  curl -sf -X POST -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "Content-Type: application/json" \
    -d '{"approvalResult":{"decision":"APPROVED"}}' \
    "https://cloudbuild.googleapis.com/v1/projects/$GCP_PROJECT/locations/$CB_REGION/builds/$build_id:approve" >/dev/null || {
    warn "No se pudo aprobar automáticamente (¿falta el rol Cloud Build Approver?). Apruébalo en Cloud Build → History"
    confirm "¿Ya lo has aprobado en la consola?" || die "Despliegue no aprobado"
  }
  while :; do
    status="$(gcloud builds describe "$build_id" --region="$CB_REGION" "${G[@]}" --format='value(status)')"
    case "$status" in
      SUCCESS) ok "Build completado"; break ;;
      FAILURE|INTERNAL_ERROR|TIMEOUT|CANCELLED|EXPIRED)
        die "Build $status. Log: gcloud builds log $build_id --region=$CB_REGION --project=$GCP_PROJECT" ;;
      *) sleep 15 ;;
    esac
  done

  local run_url run_host
  run_url="$(gcloud run services describe "$SVC" --region="$REGION" "${G[@]}" --format='value(status.url)')"
  run_host="${run_url#https://}"
  ok "Servicio: $run_url"

  # Firestore: una base de datos con nombre por app dentro del proyecto Firebase estándar.
  # Cada base tiene sus propias reglas, así que las apps no se pisan entre sí.
  if [[ "$FIRESTORE" == "1" ]]; then
    step "Firestore · base de datos '$FIRESTORE_DATABASE' ($FIREBASE_PROJECT) y sus reglas"
    need firebase "npm install -g firebase-tools"
    [[ "$FIREBASE_PROJECT" != "CAMBIAR" ]] || die "Configura FIREBASE_PROJECT en $CONFIG_FILE"
    if ! gcloud firestore databases describe --database="$FIRESTORE_DATABASE" --project "$FIREBASE_PROJECT" >/dev/null 2>&1; then
      # Una excepción apunta a una base que ya tiene datos: si no existe, algo está mal configurado.
      [[ "$FIREBASE_OVERRIDE" == "0" && "$FIRESTORE_DATABASE" == "$SVC" ]] \
        || die "No existe la base '$FIRESTORE_DATABASE' en $FIREBASE_PROJECT: revisa apps/$SVC.env"
      gcloud firestore databases create --database="$FIRESTORE_DATABASE" --location="$REGION" --type=firestore-native \
        --project "$FIREBASE_PROJECT" >/dev/null
      ok "Base de datos '$FIRESTORE_DATABASE' creada en $REGION"
    else
      ok "La base de datos '$FIRESTORE_DATABASE' ya existe"
    fi
    local fsdir; fsdir="$(mktemp -d)"
    git clone -q --depth 1 "https://github.com/$REPO.git" "$fsdir/repo"
    [[ -f "$fsdir/repo/firestore.rules" && ! -L "$fsdir/repo/firestore.rules" ]] \
      || die "El repo debe tener firestore.rules (skill firestore-tvup)"
    perl "$SCRIPT_DIR/check-rules.pl" "$fsdir/repo/firestore.rules" \
      || die "firestore.rules deja datos accesibles sin login: no se despliega"
    # Del repo solo se usan las reglas: el firebase.json lo escribe el script, con la base de datos
    # de esta app y nada más (sin hooks predeploy ni bases de datos de otras apps).
    mkdir "$fsdir/deploy" && cp "$fsdir/repo/firestore.rules" "$fsdir/deploy/firestore.rules"
    jq -n --arg d "$FIRESTORE_DATABASE" '{firestore:[{database:$d, rules:"firestore.rules"}]}' > "$fsdir/deploy/firebase.json"
    (cd "$fsdir/deploy" && firebase deploy --only firestore --project "$FIREBASE_PROJECT" --non-interactive >/dev/null) \
      || die "No se pudieron desplegar las reglas de Firestore"
    rm -rf "$fsdir"
    ok "Reglas de Firestore desplegadas"
  fi

  # Acceso público: solo N0 o con login confirmado. El binding persiste entre despliegues.
  step "Acceso público"
  if [[ "$login_tipo" == "pendiente" ]]; then
    warn "El login de la app está por decidir con Ingeniería: no se hace pública, ni con --login-ok."
  elif [[ "$tier" == "N0" || "$LOGIN_OK" == "1" ]] || confirm "La app es $tier. ¿Tiene implementado el login que pide su CLAUDE.md ($login_tipo)?"; then
    gcloud run services add-iam-policy-binding "$SVC" --region="$REGION" "${G[@]}" \
      --member=allUsers --role=roles/run.invoker >/dev/null
    ok "Servicio accesible (el control de acceso lo hace el login de la app)"
  else
    warn "No se hace público. Cuando el login esté, repite: $0 deploy --app $APP --login-ok"
  fi

  # Paso 20 — Authorized domains de Firebase
  if [[ "$FIREBASE" == "1" ]]; then
    step "Paso 20 · Authorized domains de Firebase ($FIREBASE_PROJECT)"
    [[ "$FIREBASE_PROJECT" != "CAMBIAR" ]] || die "Configura FIREBASE_PROJECT en $CONFIG_FILE"
    local token api cfg body
    token="$(gcloud auth print-access-token)"
    api="https://identitytoolkit.googleapis.com/admin/v2/projects/$FIREBASE_PROJECT/config"
    cfg="$(curl -fsS -H "Authorization: Bearer $token" -H "x-goog-user-project: $FIREBASE_PROJECT" "$api")" \
      || die "No se pudo leer la configuración de Firebase de $FIREBASE_PROJECT"
    # La llamada reemplaza la lista entera: se lee la actual y se añaden los dominios nuevos.
    body="$(echo "$cfg" | jq --arg a "$run_host" --arg b "$FQDN" '{authorizedDomains: (((.authorizedDomains // []) + [$a, $b]) | unique)}')"
    curl -fsS -X PATCH -H "Authorization: Bearer $token" -H "x-goog-user-project: $FIREBASE_PROJECT" \
      -H "Content-Type: application/json" "$api?updateMask=authorizedDomains" -d "$body" >/dev/null \
      || die "No se pudieron actualizar los Authorized domains"
    ok "Autorizados: $run_host y $FQDN"
  fi

  # Paso 21 — domain mapping
  step "Paso 21 · Domain mapping $FQDN"
  if ! gcloud beta run domain-mappings describe --domain="$FQDN" --region="$REGION" "${G[@]}" >/dev/null 2>&1; then
    gcloud beta run domain-mappings create --service="$SVC" --domain="$FQDN" --region="$REGION" "${G[@]}" >/dev/null
  fi
  local cname
  cname="$(gcloud beta run domain-mappings describe --domain="$FQDN" --region="$REGION" "${G[@]}" --format=json \
          | jq -r '.status.resourceRecords[]? | select(.type=="CNAME") | .rrdata' | head -1)"
  cname="${cname:-ghs.googlehosted.com.}"
  ok "CNAME → $cname"

  # Paso 22 — Route 53
  step "Paso 22 · Route 53"
  if [[ "$SIN_DNS" == "1" ]]; then
    warn "--sin-dns: crea a mano el registro CNAME  $FQDN.  →  $cname  (TTL 300) en la zona de $ROOT_DOMAIN"
  else
    local zone="${ROUTE53_ZONE_ID:-}"
    if [[ -z "$zone" ]]; then
      zone="$(aws route53 list-hosted-zones-by-name --dns-name "$ROOT_DOMAIN." \
              --query "HostedZones[?Name=='$ROOT_DOMAIN.'].Id | [0]" --output text)"
    fi
    zone="${zone#/hostedzone/}"
    [[ -n "$zone" && "$zone" != "None" ]] || die "No encuentro la zona alojada de $ROOT_DOMAIN en Route 53"
    aws route53 change-resource-record-sets --hosted-zone-id "$zone" --change-batch "$(
      jq -n --arg n "$FQDN." --arg v "$cname" \
        '{Changes:[{Action:"UPSERT",ResourceRecordSet:{Name:$n,Type:"CNAME",TTL:300,ResourceRecords:[{Value:$v}]}}]}'
    )" >/dev/null
    ok "Registro $FQDN creado en la zona $zone"
  fi

  cat <<EOF

${c_grn}Despliegue terminado.${c_off}
  URL provisional: $run_url
  URL definitiva:  https://$FQDN  (el certificado puede tardar en emitirse; normalmente minutos, a veces horas)

  Último paso manual: abrir https://$FQDN en incógnito y comprobar que pide login antes de mostrar nada.
EOF
}

case "$CMD" in
  create)  cmd_create ;;
  promote) cmd_promote ;;
  deploy)  cmd_deploy ;;
esac
