// familiaMU — conexión a Supabase.
//
// Página PÚBLICA: aquí va SOLO la anon key (la misma de la app y de la
// página de descarga). NUNCA la service_role. Lo que anon puede hacer lo
// deciden los GRANT de la base: hoy solo fn_web_catalogo y
// fn_web_crear_pedido.
//
// Preparado para las secciones privadas (Acuerdos, Historias): cuando
// exista el inicio de sesión, FMU.sesion guardará el access_token y rpc()
// lo usará en lugar de la anon key, así las RLS de la app aplican igual.
(function () {
  var SUPABASE_URL = 'https://pmfutajljncuhtdlhmdg.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtZnV0YWpsam5jdWh0ZGxobWRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3OTM1OTMsImV4cCI6MjEwNDM2OTU5M30.7MhBNoRc-fduN-8ZGvhnUT2PUm2B2QWSRFZFRc4x6Tw';

  function rpc(nombre, params) {
    var token = (window.FMU.sesion && window.FMU.sesion.access_token) || SUPABASE_ANON_KEY;
    return fetch(SUPABASE_URL + '/rest/v1/rpc/' + nombre, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(params || {})
    }).then(function (r) {
      return r.text().then(function (t) {
        var data = null;
        try { data = t ? JSON.parse(t) : null; } catch (e) { /* respuesta no JSON */ }
        if (!r.ok) {
          var err = new Error((data && data.message) || ('Error ' + r.status));
          err.status = r.status;
          throw err;
        }
        return data;
      });
    });
  }

  // Lectura/escritura segura de localStorage (puede fallar en modo privado).
  function leer(clave) {
    try { var v = localStorage.getItem(clave); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function guardar(clave, valor) {
    try {
      if (valor == null) localStorage.removeItem(clave);
      else localStorage.setItem(clave, JSON.stringify(valor));
    } catch (e) { /* sin almacenamiento: sigue funcionando sin recordar */ }
  }

  window.FMU = { rpc: rpc, leer: leer, guardar: guardar, sesion: null };
})();
