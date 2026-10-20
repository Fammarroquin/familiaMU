// familiaMU — PWA: service worker y botón "Instalar".
// Cada página lo carga con data-base apuntando a la raíz del sitio
// ("./" en la portada, "../" en las secciones).
(function () {
  var base = (document.currentScript && document.currentScript.dataset.base) || './';

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register(base + 'sw.js', { scope: base }).catch(function () {});
    });
  }

  // Android/Chrome: el navegador ofrece la instalación y la mostramos en
  // cualquier botón con data-instalar.
  var aviso = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    aviso = e;
    document.querySelectorAll('[data-instalar]').forEach(function (b) { b.hidden = false; });
  });
  window.addEventListener('appinstalled', function () {
    document.querySelectorAll('[data-instalar]').forEach(function (b) { b.hidden = true; });
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-instalar]');
    if (!b || !aviso) return;
    aviso.prompt();
    aviso.userChoice.finally(function () { aviso = null; b.hidden = true; });
  });

  // iPhone: no hay aviso automático; se muestra la ayuda manual.
  var esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var instalada = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (esIOS && !instalada) {
    document.querySelectorAll('[data-ayuda-ios]').forEach(function (n) { n.hidden = false; });
  }
})();
