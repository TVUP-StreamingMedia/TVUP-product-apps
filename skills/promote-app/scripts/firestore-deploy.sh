# firestore-deploy.sh — Despliegue de Firestore de una app (lo cargan promote-app.sh y release.sh)
#
# Del repo de la app solo se usan firestore.rules (ya validadas con check-rules.pl por quien llama)
# y, si existe, firestore.indexes.json. El firebase.json lo escribe este script, con la base de datos
# de la app y nada más (sin hooks predeploy ni bases de datos de otras apps).
#
# firestore.indexes.json lleva los índices compuestos y los fieldOverrides. Un override con
# "ttl": true activa la política TTL de ese campo: Firestore borra el documento cuando pasa esa
# fecha. Es como se declara la retención de datos de una app.
#
# Se despliega sin --force: Firebase no borra índices ni overrides que falten en el fichero, y una
# política TTL que desaparece del fichero sigue activa. Solo "ttl": false la desactiva, y eso avisa.
#
# Necesita jq, firebase y gcloud, y las funciones ok, warn y die de quien lo carga.

# prepare_firestore_deploy <repo> <destino> <base de datos>
# Copia las reglas y los índices del repo a <destino> y escribe allí el firebase.json.
# Deja en FIRESTORE_TTL_FIELDS los campos con TTL ("coleccion.campo", uno por línea).
prepare_firestore_deploy() {
  local repo="$1" dest="$2" database="$3" indexes="$1/firestore.indexes.json" ttl_off
  FIRESTORE_TTL_FIELDS=""
  mkdir -p "$dest"
  cp "$repo/firestore.rules" "$dest/firestore.rules"

  if [[ ! -e "$indexes" && ! -L "$indexes" ]]; then
    jq -n --arg d "$database" '{firestore:[{database:$d, rules:"firestore.rules"}]}' > "$dest/firebase.json"
    return 0
  fi
  [[ -f "$indexes" && ! -L "$indexes" ]] || die "firestore.indexes.json debe ser un fichero normal"
  jq -e 'type == "object"
         and ((keys - ["indexes", "fieldOverrides"]) | length == 0)
         and ((.indexes // []) | type == "array")
         and ((.fieldOverrides // []) | type == "array")
         and all((.fieldOverrides // [])[]; (.collectionGroup | type == "string")
                                            and (.fieldPath | type == "string")
                                            and ((.ttl // false) | type == "boolean"))' \
    "$indexes" >/dev/null 2>&1 \
    || die "firestore.indexes.json no es válido: solo admite 'indexes' y 'fieldOverrides' (con collectionGroup, fieldPath y ttl booleano)"

  ttl_off="$(jq -r '.fieldOverrides[]? | select(.ttl == false) | "\(.collectionGroup).\(.fieldPath)"' "$indexes")"
  [[ -z "$ttl_off" ]] || warn "firestore.indexes.json DESACTIVA el TTL (borrado automático) de: $(tr '\n' ' ' <<<"$ttl_off")"
  FIRESTORE_TTL_FIELDS="$(jq -r '.fieldOverrides[]? | select(.ttl == true) | "\(.collectionGroup).\(.fieldPath)"' "$indexes")"

  cp "$indexes" "$dest/firestore.indexes.json"
  jq -n --arg d "$database" \
    '{firestore:[{database:$d, rules:"firestore.rules", indexes:"firestore.indexes.json"}]}' > "$dest/firebase.json"
}

# verify_firestore_ttl <proyecto> <base de datos>
# Comprueba que cada campo de FIRESTORE_TTL_FIELDS tiene la política TTL creada o activa.
verify_firestore_ttl() {
  local project="$1" database="$2" listed field state missing=""
  [[ -n "$FIRESTORE_TTL_FIELDS" ]] || return 0
  listed="$(gcloud firestore fields ttls list --database="$database" --project="$project" --format=json 2>/dev/null)" \
    || { warn "No se pudo comprobar el TTL. Revísalo: gcloud firestore fields ttls list --database=$database --project=$project"; return 0; }
  while IFS= read -r field; do
    [[ -n "$field" ]] || continue
    state="$(jq -r --arg s "/collectionGroups/${field%%.*}/fields/${field#*.}" \
              '.[] | select(.name | endswith($s)) | .ttlConfig.state' <<<"$listed" | head -1)"
    case "$state" in
      ACTIVE)   ok "TTL activo en $field" ;;
      CREATING) ok "TTL en $field: activándose (puede tardar; el primer borrado, hasta unas 24 h)" ;;
      *)        missing+="$field(${state:-sin política}) " ;;
    esac
  done <<<"$FIRESTORE_TTL_FIELDS"
  [[ -z "$missing" ]] || die "El TTL no quedó activo en: $missing. Sin él no se cumple la retención de la app"
}
