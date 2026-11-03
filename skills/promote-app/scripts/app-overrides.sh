# app-overrides.sh — Excepciones por app a la configuración estándar (lo cargan promote-app.sh y release.sh)
#
# Algunas apps anteriores al proceso no usan el proyecto Firebase estándar ni una base de datos
# con el nombre del servicio (p. ej. product-portal usa la base "(default)" de su propio proyecto).
# La excepción se declara en apps/<servicio>.env, aprobada por Ingeniería en un PR de este repo.
#
# El fichero NO se ejecuta: solo se leen líneas CLAVE="valor" de una lista cerrada de claves,
# con el valor validado. Así una excepción no puede cambiar nada más de la configuración.
#
# Tras load_app_overrides quedan definidos:
#   FIREBASE_PROJECT    el de la excepción, o el de promote-app.env
#   FIRESTORE_DATABASE  el de la excepción, o el nombre del servicio
#   FIREBASE_OVERRIDE   1 si la app usa un proyecto Firebase distinto del estándar

load_app_overrides() {
  local svc="$1" file key value line_no=0
  local dir; dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  file="$dir/apps/$svc.env"
  FIRESTORE_DATABASE="$svc"
  FIREBASE_OVERRIDE=0
  [[ -f "$file" ]] || return 0
  [[ ! -L "$file" ]] || die "La excepción $file es un enlace simbólico: no se usa"

  local standard_project="$FIREBASE_PROJECT"
  local blank_re='^[[:space:]]*(#.*)?$'
  local entry_re='^([A-Z_]+)="([^"]*)"[[:space:]]*$'
  while IFS= read -r line || [[ -n "$line" ]]; do
    line_no=$((line_no + 1))
    [[ "$line" =~ $blank_re ]] && continue
    [[ "$line" =~ $entry_re ]] \
      || die "apps/$svc.env:$line_no no tiene el formato CLAVE=\"valor\""
    key="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"
    case "$key" in
      FIREBASE_PROJECT)
        [[ "$value" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] \
          || die "apps/$svc.env:$line_no FIREBASE_PROJECT no es un ID de proyecto válido"
        FIREBASE_PROJECT="$value" ;;
      FIRESTORE_DATABASE)
        [[ "$value" == "(default)" || "$value" =~ ^[a-z][a-z0-9-]{2,61}[a-z0-9]$ ]] \
          || die "apps/$svc.env:$line_no FIRESTORE_DATABASE no es un nombre de base de datos válido"
        FIRESTORE_DATABASE="$value" ;;
      *) die "apps/$svc.env:$line_no clave no permitida: $key (solo FIREBASE_PROJECT y FIRESTORE_DATABASE)" ;;
    esac
  done < "$file"

  [[ "$FIREBASE_PROJECT" != "$standard_project" ]] && FIREBASE_OVERRIDE=1
  warn "Excepción de $svc (apps/$svc.env): Firebase $FIREBASE_PROJECT, base de datos $FIRESTORE_DATABASE"
}
