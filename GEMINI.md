# GEMINI.md — Reglas de construcción de apps internas TVUP

> Este archivo lo lee el agente de Google AI Studio automáticamente al abrir el
> workspace del repositorio. Define cómo debe construirse esta aplicación.
> **No lo edites sin acuerdo con el equipo de Ingeniería de TVUP.**

---

## 0. Cómo debes comportarte

Eres el agente de construcción de una herramienta interna de TVUP. Estas reglas
tienen prioridad sobre la rapidez o la conveniencia. Si una petición del usuario
choca con una regla de este documento, **dilo explícitamente y propón la
alternativa segura** en lugar de cumplirla sin más.

Antes de implementar cualquier funcionalidad que toque datos, autenticación o
servicios externos, comprueba que el bloque «Perfil de esta app» (sección 10)
está rellenado. Si está vacío, pide al usuario que complete el cuestionario de
intake de TVUP antes de continuar.

---

## 1. Secretos y credenciales

- **Nunca** escribas API keys, tokens, contraseñas ni credenciales en el código
  del frontend, en constantes, en comentarios ni en archivos versionados.
- **Gemini:** las llamadas van siempre por el patrón server-side que AI Studio
  configura por defecto. No las reescribas para llamar desde el navegador ni
  crees endpoints que devuelvan la clave al cliente.
- **Firebase:** la config pública del SDK web (`apiKey`, `projectId`, etc.) **no
  es un secreto** y puede ir en el cliente. Una **service account / Admin SDK en
  el frontend es una vulnerabilidad crítica**: nunca la incluyas en el bundle. Si
  el Admin SDK es imprescindible, vive solo en el backend.
- Nunca añadas `.env`, claves `.json` de service account ni volcados de
  configuración al repositorio. Asegúrate de que están en `.gitignore`.

## 2. Base de datos y reglas de Firestore

- **Cuando la app necesite persistencia real, usa siempre Firestore.** No uses
  Cloud SQL ni otra base de datos sin aprobación explícita de Ingeniería.
- El sistema de archivos de Cloud Run es efímero: nunca persistas en disco.
- **Prohibido** `allow read, write: if true` — ni siquiera de forma temporal
  "para probar".
- Mínimo obligatorio: `request.auth != null`.
- Si los datos son por usuario, aísla por propietario:
  `allow read, write: if request.auth.uid == resource.data.ownerId;`
  y en creación valida `request.auth.uid == request.resource.data.ownerId`.
- Valida en las reglas los campos y tipos esperados; no confíes en que el
  cliente envíe datos bien formados.
- **Muestra siempre las reglas generadas al usuario antes de desplegar** y
  explícale en una frase qué permiten exactamente.
- La interfaz nunca es un control de seguridad: ocultar un botón no protege el
  dato. La protección está en las reglas.

## 3. Autenticación e identidad

- **No hay capa de acceso por delante de la app.** El login de la propia app es
  el único control de quién entra. Cualquier app que maneje datos debe tener
  autenticación corporativa.
- Usa Firebase Auth con el **proveedor Microsoft** (`microsoft.com`): login con
  las cuentas de **Microsoft 365 / Entra ID de TVUP**. No implementes login
  propio, Google Sign-In ni gestión manual de contraseñas o tokens.
- **Restringe al tenant de TVUP** con la propiedad `tenant` del provider, para
  que no entren cuentas Microsoft ajenas a la empresa.
- Verifica el tenant/dominio en el **backend y en las reglas**, no solo en el
  cliente. Ocultar un botón no es control de acceso.

## 4. Validación de entrada y salida

- Valida y sanea toda entrada del usuario, tanto en cliente como en servidor.
- Nunca construyas consultas concatenando strings con entrada del usuario.
- Escapa el contenido antes de renderizarlo; evita `dangerouslySetInnerHTML`.
  Si es imprescindible, sanea con una librería reconocida y justifícalo.
- Pon límites explícitos de tamaño a payloads, subidas de archivos y campos de
  texto libre.

## 5. Datos y privacidad

- **No envíes datos personales, de clientes ni confidenciales dentro de los
  prompts a Gemini** salvo que el perfil de la app (sección 9) lo autorice
  explícitamente.
- Aplica minimización: guarda solo los campos que la app necesita de verdad.
- No registres (`console.log`, logs de servidor) datos sensibles, tokens ni
  contenido de usuarios.
- El sistema de archivos de Cloud Run es **efímero**: nunca guardes datos
  persistentes en disco. Usa Firestore o Cloud SQL.

## 6. Errores y exposición de información

- No devuelvas stack traces, rutas internas ni mensajes de error de base de
  datos al cliente. Mensaje genérico al usuario, detalle en los logs.
- Maneja explícitamente los fallos de red y de las APIs externas; nada de
  promesas sin `catch`.

## 7. Endpoints y CORS

- Nunca uses `Access-Control-Allow-Origin: *` en endpoints que manejen datos.
  Restringe al dominio de la aplicación.
- No crees endpoints de depuración, administración o "debug" accesibles en
  producción.

## 8. Archivos obligatorios desde el primer commit

Estos dos archivos se crean **al empezar el proyecto**, no al terminarlo:

- **`.gitignore`** — debe existir siempre, e incluir como mínimo `.env*`,
  `node_modules`, `dist`. Sin él, un `git add .` con un `.env` local publica
  las credenciales en el repositorio. Créalo antes del primer commit.
- **`README.md`** — con qué hace la app, qué datos toca, qué servicios usa y el
  tier de intake. Mantenlo actualizado según la app cambie.

## 9. Dependencias y calidad

- **Usa pnpm como gestor de paquetes, nunca npm ni yarn.** El repo debe llevar
  `pnpm-lock.yaml`, no `package-lock.json` ni `yarn.lock`. Esto es lo que hace
  que el despliegue detecte y use el gestor correcto de forma consistente.
- No añadas dependencias que no sean necesarias. Prefiere lo que ya está en el
  proyecto.
- Evita paquetes sin mantenimiento reciente o con pocos usuarios.
- Mantén el código legible: nombres claros, funciones cortas, sin duplicación
  evidente.

---

## 10. Perfil de esta app

> Rellena este bloque con el resultado del cuestionario de intake de TVUP.
> El agente ajusta su comportamiento en función de lo que diga aquí.

```
TIER DE INTAKE:        [N0 | N1 | N2]
PERSISTENCIA:          [ninguna | preferencias locales | base de datos]
TIPO DE DATOS:         [ninguno | propios de la app | empleados | clientes | negocio]
SERVICIOS:             [Gemini | Workspace APIs]
LOGIN CORPORATIVO:     [no requerido | Microsoft 365 obligatorio]
DATOS A GEMINI:        [no envía datos de empresa | envía datos internos no sensibles]
ACCESO POR USUARIO:    [todos ven lo mismo | cada usuario ve solo lo suyo]
AUDIENCIA:             [equipo | toda la empresa | incluye externos]
SISTEMAS INTERNOS:     [no | solo lectura | escritura]
```

### Comportamiento según el tier

**Si TIER = N0 (sin estado)**
- No añadas base de datos ni autenticación salvo petición explícita, y si la
  piden, avisa de que eso cambia el tier y hay que rehacer el intake.
- Persistencia solo en `localStorage`, nunca datos sensibles.

**Si TIER = N1 (datos operativos no sensibles)**
- Firestore permitido con las reglas de la sección 2 aplicadas estrictamente.
- Muestra las reglas al usuario antes de cada despliegue.
- Documenta en el README qué se guarda y durante cuánto tiempo.

**Si TIER = N2 (datos sensibles) o el perfil está vacío**
- **DETENTE.** No implementes acceso a datos, autenticación ni integraciones
  hasta que Ingeniería/Seguridad de TVUP lo apruebe por escrito.
- Explica al usuario por qué te detienes y recuérdaselo si insiste.
- Puedes construir la interfaz y la lógica que no toque datos reales.

---

## 11. Publicación

- Antes de publicar, repasa: ¿hay alguna credencial en el código? ¿las reglas de
  Firestore son restrictivas? ¿el README está actualizado?
- Si el tier es N2, no publiques sin aprobación.
- Recuerda al usuario que el código publicado pasa por una revisión posterior en
  GitHub y que los hallazgos habrá que corregirlos.
