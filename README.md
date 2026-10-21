# familiaMU
Productos Tienda Familia AcuerdosAPP

Web de la familia en GitHub Pages: `https://fammarroquin.github.io/familiaMU/`

## Secciones
| Ruta | Estado |
|---|---|
| `/` | Portada con las secciones |
| `/tiendita/` | Catálogo en vivo, carrito y pedido → WhatsApp |
| Acuerdos, Historias | Pronto, privadas (inicio de sesión con DNI y contraseña, como la app) |

## Archivos
- `assets/supabase.js`: URL + **anon key** (pública) y `FMU.rpc()`. Nunca va la service_role.
- `assets/tiendita.js`: lógica de la tiendita.
- `assets/descarga-app.js`: tarjeta "Descarga la app" (portada) y enlace al pie de la tiendita.
  Lleva a `https://sigamef.github.io/appfmarroquin/` (nunca al APK directo), muestra la versión
  de `app_version` y en iPhone cambia el botón por un aviso.
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
