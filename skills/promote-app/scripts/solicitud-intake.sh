# solicitud-intake.sh — Lee una solicitud del intake (issue de TVUP-product-apps) y comprueba que
# los ficheros son exactamente los que generó el servidor del intake (lo carga promote-app.sh).
#
# Por qué se puede confiar en ellos:
# - La issue y sus comentarios los publica la GitHub App del intake (INTAKE_BOT). Su clave solo la
#   tiene el servidor del intake, en Secret Manager: ni Producto, ni Ingeniería, ni la IA pueden
#   publicar con esa identidad.
# - Nada se ha editado después: quien tenga permisos en el repo podría editar el texto de un
#   comentario del bot sin cambiar su autor, así que cualquier edición invalida la solicitud.
# - El sha256 de cada fichero, calculado por el servidor, coincide con el contenido del comentario.
# - El nivel y el servicio del bloque del servidor coinciden con el perfil del CLAUDE.md.
#
# Formato (servidor del intake, server/solicitud.ts):
#   cuerpo, línea 1:  <!-- intake-solicitud:v1 {"servicio":..,"tier":..,"ficheros":[{"id","nombre","sha256"}],..} -->
#   comentario:       <!-- intake-fichero:v1 <id> -->\n<valla>markdown\n<fichero>\n<valla>\n
#
# Necesita gh y jq, y las funciones ok, warn y die de quien lo carga.

INTAKE_REPO="TVUP-StreamingMedia/TVUP-product-apps"
INTAKE_BOT="tvup-product-intake"   # login de la App; en GraphQL el autor aparece sin «[bot]»

sha256_de() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | awk '{print $1}'; }

# descargar_solicitud <número> <directorio>
# Deja en <directorio> los ficheros de la solicitud (CLAUDE.md y, si hay, GEMINI.md) y en
# SOLICITUD_SERVICIO y SOLICITUD_TIER lo que calculó el servidor. Si algo no cuadra, para.
descargar_solicitud() {
  local num="$1" dir="$2" datos bloque n i id nombre esperado obtenido cuerpo
  [[ "$num" =~ ^[0-9]+$ ]] || die "--issue debe ser un número: $num"
  local owner="${INTAKE_REPO%%/*}" repo="${INTAKE_REPO##*/}"

  datos="$(gh api graphql -F owner="$owner" -F repo="$repo" -F num="$num" -f query='
    query($owner: String!, $repo: String!, $num: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $num) {
          state body lastEditedAt author { login __typename }
          labels(first: 20) { nodes { name } }
          comments(first: 20) { totalCount nodes { body lastEditedAt author { login __typename } } }
        }
      }
    }' --jq '.data.repository.issue')" || die "No se pudo leer la issue #$num de $INTAKE_REPO"
  [[ -n "$datos" && "$datos" != "null" ]] || die "La issue #$num no existe en $INTAKE_REPO"

  # Autor, etiqueta y sin ediciones.
  jq -e --arg bot "$INTAKE_BOT" '.author.login == $bot and .author.__typename == "Bot"' <<<"$datos" >/dev/null \
    || die "La issue #$num no la creó el intake ($INTAKE_BOT): no se usa"
  jq -e '[.labels.nodes[].name] | index("intake")' <<<"$datos" >/dev/null || die "La issue #$num no tiene la etiqueta intake"
  jq -e '.lastEditedAt == null' <<<"$datos" >/dev/null || die "La issue #$num se ha editado después de crearla: no se usa"
  [[ "$(jq -r '.state' <<<"$datos")" == "OPEN" ]] || die "La issue #$num está cerrada"
  (( $(jq -r '.comments.totalCount' <<<"$datos") <= 20 )) || die "La issue #$num tiene demasiados comentarios para revisarla"

  # Bloque legible por máquina (primera línea del cuerpo).
  bloque="$(jq -r '.body | split("\n")[0]' <<<"$datos" | sed -n 's/^<!-- intake-solicitud:v1 \(.*\) -->$/\1/p')"
  [[ -n "$bloque" ]] && jq -e '.version == 1' <<<"$bloque" >/dev/null 2>&1 || die "La issue #$num no tiene el bloque intake-solicitud:v1"
  SOLICITUD_SERVICIO="$(jq -r '.servicio' <<<"$bloque")"
  SOLICITUD_TIER="$(jq -r '.tier' <<<"$bloque")"
  [[ "$SOLICITUD_SERVICIO" =~ ^[a-z]([a-z0-9-]*[a-z0-9])?$ ]] || die "Servicio no válido en la solicitud: $SOLICITUD_SERVICIO"
  [[ "$SOLICITUD_TIER" =~ ^N[0-2]$ ]] || die "Nivel no válido en la solicitud: $SOLICITUD_TIER"

  mkdir -p "$dir"
  n="$(jq -r '.ficheros | length' <<<"$bloque")"
  (( n >= 1 )) || die "La solicitud #$num no trae ficheros"
  for ((i = 0; i < n; i++)); do
    id="$(jq -r ".ficheros[$i].id" <<<"$bloque")"
    nombre="$(jq -r ".ficheros[$i].nombre" <<<"$bloque")"
    esperado="$(jq -r ".ficheros[$i].sha256" <<<"$bloque")"
    [[ "$id" =~ ^[a-z]+$ ]] || die "Identificador de fichero no válido: $id"
    case "$nombre" in CLAUDE.md|GEMINI.md|INSTRUCTIONS.md) ;; *) die "Fichero no esperado en la solicitud: $nombre" ;; esac
    [[ "$esperado" =~ ^[0-9a-f]{64}$ ]] || die "Hash no válido para $nombre"

    # Exactamente un comentario del bot, sin editar, con la marca de este fichero.
    cuerpo="$(jq -r --arg bot "$INTAKE_BOT" --arg marca "<!-- intake-fichero:v1 $id -->" '
      [.comments.nodes[] | select(.author.login == $bot and .author.__typename == "Bot"
                                  and .lastEditedAt == null and (.body | split("\n")[0]) == $marca)]
      | if length == 1 then .[0].body else empty end' <<<"$datos")"
    [[ -n "$cuerpo" ]] || die "No hay un único comentario del intake, sin editar, con $nombre"

    # Contenido entre la valla de apertura (línea 2, «<valla>markdown») y su cierre.
    printf '%s\n' "$cuerpo" | tr -d '\r' | awk '
      NR == 2 { if ($0 !~ /^```+markdown$/) exit 3; valla = substr($0, 1, length($0) - 8); next }
      NR > 2 && $0 == valla { cerrada = 1; exit }
      NR > 2 { print }
      END { if (!cerrada) exit 4 }' > "$dir/$nombre" || die "El comentario de $nombre no tiene el formato esperado"

    obtenido="$(sha256_de "$dir/$nombre")"
    [[ "$obtenido" == "$esperado" ]] || die "El hash de $nombre no coincide con el del servidor del intake: no se usa"
    ok "$nombre verificado (autor $INTAKE_BOT, sin ediciones, sha256 ${esperado:0:12}…)"
  done

  [[ -f "$dir/CLAUDE.md" ]] || die "La solicitud #$num no trae CLAUDE.md"
  local perfil_svc perfil_tier
  perfil_svc="$(grep -E '^SERVICIO:' "$dir/CLAUDE.md" | head -1 | awk '{print $2}')"
  perfil_tier="$(grep -E '^TIER DE INTAKE:' "$dir/CLAUDE.md" | head -1 | awk '{print $4}')"
  [[ "$perfil_svc" == "$SOLICITUD_SERVICIO" ]] || die "El SERVICIO del CLAUDE.md ($perfil_svc) no coincide con la solicitud ($SOLICITUD_SERVICIO)"
  [[ "$perfil_tier" == "$SOLICITUD_TIER" ]] || die "El nivel del CLAUDE.md ($perfil_tier) no coincide con la solicitud ($SOLICITUD_TIER)"
  ok "Solicitud #$num: $SOLICITUD_SERVICIO ($SOLICITUD_TIER)"
}
