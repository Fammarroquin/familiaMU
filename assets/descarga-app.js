// familiaMU — "Descarga la app" (AppFMarroquin).
// El botón lleva a la página de descarga, que ya elige 64/32 bits y tiene la
// ayuda de "No se instaló"; aquí nunca se enlaza el APK directo.
(function () {
  // iPhone/iPad (el iPad moderno se presenta como Mac con pantalla táctil).
  var esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
              (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  if (esIOS) {
    document.querySelectorAll('[data-solo-android]').forEach(function (n) { n.hidden = true; });
    document.querySelectorAll('[data-solo-ios]').forEach(function (n) { n.hidden = false; });
  }

  // Versión actual desde app_version; si falla, el texto sigue oculto.
  var nodos = document.querySelectorAll('[data-version-app]');
  if (!nodos.length || !window.FMU) return;
  FMU.select('app_version?select=version_name&limit=1').then(function (filas) {
    var v = filas && filas[0] && filas[0].version_name;
    if (!v) return;
    nodos.forEach(function (n) { n.textContent = 'Versión ' + v; n.hidden = false; });
  }).catch(function () {});
})();
