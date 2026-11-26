# familiaMU
Productos Tienda Familia AcuerdosAPP

Web de la familia en GitHub Pages: `https://fammarroquin.github.io/familiaMU/`

## Secciones
| Ruta | Estado |
|---|---|
| `/` | Portada con las secciones |
| `/tiendita/` | Catálogo en vivo, carrito y pedido → WhatsApp |
| `/app/` | Página de instalación de AppFMarroquin (64/32 bits, pasos y ayuda "No se instaló") |
| `/app/descargar.html` | Descarga directa (enlace para WhatsApp) |
| Acuerdos, Historias | Pronto, privadas (inicio de sesión con DNI y contraseña, como la app) |

## Archivos
- `assets/supabase.js`: URL + **anon key** (pública) y `FMU.rpc()`. Nunca va la service_role.
- `assets/tiendita.js`: lógica de la tiendita.
- `assets/descarga-app.js`: tarjetas "Descarga la app" y "NotasApp" (portada) y enlace al pie de la tiendita.
  AppFMarroquin lleva a `app/` (nunca al APK directo) y muestra la versión de `app_version`.
  NotasApp toma versión y APK del último release de `famimaqux/NotasApp-releases`.
  En iPhone cambia los botones por un aviso.

## Releases (APK)
- AppFMarroquin: GitHub Releases de **este repo** (`AppFMarroquin.apk` y `AppFMarroquin-32bits.apk`);
  `app_version.url_apk` apunta a ellos. La antigua `sigamef.github.io/appfmarroquin/` solo redirige a `app/`.
- NotasApp: se publica en `famimaqux/NotasApp-releases` (otra cuenta); aquí solo se enlaza.
- `assets/app.js`, `sw.js`, `manifest.webmanifest`: PWA ("Agregar a pantalla de inicio").
- `assets/img/og.jpg`: vista previa al compartir el enlace.

## Supabase
La web solo llama a dos RPC (security definer, `grant execute` a anon):
- `fn_web_catalogo()`: productos activos con stock.
- `fn_web_crear_pedido(...)`: valida código del grupo, límites y stock, y crea un pedido
  `pendiente` con `canal = 'web'` que se aprueba en la app como cualquier otro.

Además lee `app_version.version_name` (select con anon, igual que la página de descarga)
para mostrar la versión de la app.

El SQL está en la app: `famimuv2/supabase/sql/famimuv2_tienda_web.sql`.
El código del grupo **no** se guarda en este repo (solo su hash en la base).
