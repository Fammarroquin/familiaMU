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

  // NotasApp: versión y APK del último release público en GitHub. Si GitHub
  // no responde, el botón queda en la página del release (también descarga).
  var botonNotas = document.querySelector('[data-descargar-notas]');
  if (botonNotas && window.fetch) {
    fetch('https://api.github.com/repos/famimaqux/NotasApp-releases/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' }
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (rel) {
      if (!rel) return;
      var apk = (rel.assets || []).filter(function (a) { return /\.apk$/i.test(a.name); })[0];
      if (apk) botonNotas.href = apk.browser_download_url;
      var v = (rel.tag_name || '').replace(/^v/i, '');
      var n = document.querySelector('[data-version-notas]');
      if (v && n) { n.textContent = 'Versión ' + v; n.hidden = false; }
    }).catch(function () {});
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
