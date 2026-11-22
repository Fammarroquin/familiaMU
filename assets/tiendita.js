// familiaMU — Tiendita.
// Flujo: buscar → carrito → Comprar → Yape/Plin/Efectivo → (baucher) →
// Enviar al grupo (baucher + descripción del pedido, sin foto del pedido). El pedido se crea SIEMPRE en el servidor
// (fn_web_crear_pedido) antes de abrir WhatsApp: precios, stock y total
// los decide Supabase, no esta página.
(function () {
  var CLAVE_CARRITO = 'fmu.tiendita.carrito';
  var CLAVE_PERFIL = 'fmu.perfil';
  var CLAVE_PAGO = 'fmu.tiendita.ultimoPago';

  var $ = function (id) { return document.getElementById(id); };

  var estado = {
    abierta: false,
    maxUnidades: 10,
    maxLineas: 15,
    productos: [],          // del servidor
    porId: {},
    carrito: FMU.leer(CLAVE_CARRITO) || {},   // { producto_id: cantidad }
    perfil: FMU.leer(CLAVE_PERFIL),           // { nombre, celular, codigo }
    filtro: '',
    busqueda: '',
    medio: null,
    // Medios que el admin tiene activos (Ajustes › Configuración de pagos).
    medios: { yape: true, plin: true, efectivo: true },
    yaPago: false,
    baucher: null,          // File comprimido
    ultimo: null,           // último pedido creado (para reenviar)
    enviando: false,        // creando el pedido en el servidor
    compartiendo: false     // hoja de compartir abierta
  };

  // ---------------------------------------------------------------- util
  function soles(n) { return 'S/ ' + (Number(n) || 0).toFixed(2); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function normal(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  // Mismo criterio que categoria_icono.dart de la app.
  function emoji(categoria) {
    var c = normal(categoria);
    if (c.indexOf('gas') >= 0) return '🔥';
    if (/lonche|comida|snack/.test(c)) return '🥪';
    if (/agua|bebida|gaseosa/.test(c)) return '🥤';
    if (/tienda|abarrote/.test(c)) return '🏪';
    return '📦';
  }
  function abrir(dlg) { if (!dlg.open) dlg.showModal(); }
  function cerrar(dlg) { if (dlg.open) dlg.close(); }

  // ------------------------------------------------------------ catálogo
  function cargar() {
    if (!estado.productos.length) {
      $('estado').hidden = false;
      $('estado').textContent = 'Cargando productos…';
    }
    return FMU.rpc('fn_web_catalogo').then(function (data) {
      estado.abierta = !!data.abierta;
      estado.maxUnidades = data.max_unidades || 10;
      estado.maxLineas = data.max_lineas || 15;
      estado.productos = data.productos || [];
      // Si el SQL es viejo y no manda los campos, se muestran ambos.
      estado.medios.yape = data.yape_activo !== false;
      estado.medios.plin = data.plin_activo !== false;
      if (estado.medio && !estado.medios[estado.medio]) estado.medio = null;
      estado.porId = {};
      estado.productos.forEach(function (p) {
        // "stock" = real (SQL nuevo); si no viene (SQL viejo), "disponible".
        p.stock = typeof p.stock === 'number' ? p.stock : p.disponible;
        // Lo máximo que se puede agregar: el menor entre stock y tope.
        p.maximo = Math.min(p.stock, p.disponible, estado.maxUnidades);
        estado.porId[p.producto_id] = p;
      });
      ajustarCarrito();
      $('avisoCerrada').hidden = estado.abierta;
      pintarFiltros();
      pintarProductos();
      pintarBarra();
    }).catch(function () {
      if (estado.productos.length) return;   // ya hay algo en pantalla
      $('estado').hidden = false;
      $('estado').innerHTML = 'No se pudo cargar la tiendita.<br><button class="enlace" type="button" id="btnReintentar">Reintentar</button>';
      $('btnReintentar').onclick = cargar;
    });
  }

  // Quita del carrito lo que ya no existe y respeta el stock actual.
  function ajustarCarrito() {
    Object.keys(estado.carrito).forEach(function (id) {
      var p = estado.porId[id];
      var c = Math.floor(Number(estado.carrito[id]) || 0);
      if (!p || c < 1) delete estado.carrito[id];
      else estado.carrito[id] = Math.min(c, p.maximo);
    });
    FMU.guardar(CLAVE_CARRITO, estado.carrito);
  }

  function pintarFiltros() {
    var cats = [];
    estado.productos.forEach(function (p) {
      if (p.categoria && cats.indexOf(p.categoria) < 0) cats.push(p.categoria);
    });
    if (estado.filtro && cats.indexOf(estado.filtro) < 0) estado.filtro = '';
    $('filtros').hidden = cats.length < 2;
    $('filtros').innerHTML = [''].concat(cats).map(function (c) {
      return '<button type="button" class="filtro" data-filtro="' + esc(c) + '" aria-pressed="' +
        (c === estado.filtro) + '">' + (c ? emoji(c) + ' ' + esc(c) : 'Todo') + '</button>';
    }).join('');
  }

  function visibles() {
    var q = normal(estado.busqueda).trim();
    return estado.productos.filter(function (p) {
      if (estado.filtro && p.categoria !== estado.filtro) return false;
      if (!q) return true;
      return normal(p.nombre + ' ' + (p.marca || '') + ' ' + (p.categoria || '')).indexOf(q) >= 0;
    });
  }

  function htmlProducto(p) {
    var cant = estado.carrito[p.producto_id] || 0;
    var foto = /^https:\/\//.test(p.imagen_url || '')
      ? '<img src="' + esc(p.imagen_url) + '" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode(\'' + emoji(p.categoria) + '\'))">'
      : emoji(p.categoria);
    var quedan = '<span class="quedan' + (p.stock <= 3 ? ' pocas' : '') + '">Quedan ' + p.stock + '</span>';
    // Llegó al tope por pedido pero hay más stock: se explica por qué no sube.
    var tope = cant >= p.maximo && p.stock > estado.maxUnidades
      ? '<span class="tope">Máximo ' + estado.maxUnidades + ' por pedido</span>' : '';
    var acciones = cant > 0
      ? '<div class="contador">' +
          '<button type="button" data-accion="menos" aria-label="Quitar uno">−</button>' +
          '<output aria-live="polite">' + cant + '</output>' +
          '<button type="button" data-accion="mas" aria-label="Agregar uno"' + (cant >= p.maximo ? ' disabled' : '') + '>+</button>' +
        '</div>'
      : '<button type="button" class="agregar" data-accion="mas">Agregar</button>';
    return '<article class="prod' + (cant > 0 ? ' en-carrito' : '') + '" data-id="' + esc(p.producto_id) + '">' +
      '<div class="foto">' + foto + '</div>' +
      '<div class="info">' +
        '<div class="nombre">' + esc(p.nombre) + '</div>' +
        (p.marca ? '<div class="marca">' + esc(p.marca) + '</div>' : '') +
        '<div class="precio">' + soles(p.precio) + '</div>' + quedan +
        '<div class="acciones">' + acciones + tope + '</div>' +
      '</div></article>';
  }

  function pintarProductos() {
    var lista = visibles();
    $('productos').innerHTML = lista.map(htmlProducto).join('');
    var vacio = !lista.length;
    $('estado').hidden = !vacio;
    if (vacio) {
      $('estado').textContent = estado.productos.length
        ? 'No encontramos “' + estado.busqueda + '”.'
        : 'Por ahora no hay productos con stock.';
    }
  }

  function pintarProducto(id) {
    var viejo = document.querySelector('.prod[data-id="' + CSS.escape(id) + '"]');
    if (!viejo) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = htmlProducto(estado.porId[id]);
    viejo.replaceWith(tmp.firstChild);
  }

  // ------------------------------------------------------------- carrito
  function lineas() {
    return Object.keys(estado.carrito).map(function (id) {
      var p = estado.porId[id];
      return { p: p, cantidad: estado.carrito[id], subtotal: p.precio * estado.carrito[id] };
    }).filter(function (l) { return l.p; });
  }
  function totalCarrito() {
    return lineas().reduce(function (s, l) { return s + l.subtotal; }, 0);
  }

  function cambiar(id, delta) {
    var p = estado.porId[id];
    if (!p) return;
    var actual = estado.carrito[id] || 0;
    if (delta > 0 && !actual && Object.keys(estado.carrito).length >= estado.maxLineas) {
      alert('Máximo ' + estado.maxLineas + ' productos distintos por pedido.');
      return;
    }
    var nueva = Math.max(0, Math.min(p.maximo, actual + delta));
    if (nueva) estado.carrito[id] = nueva; else delete estado.carrito[id];
    FMU.guardar(CLAVE_CARRITO, estado.carrito);
    pintarProducto(id);
    pintarBarra();
  }

  function pintarBarra() {
    var ls = lineas();
    var unidades = ls.reduce(function (s, l) { return s + l.cantidad; }, 0);
    $('barra').hidden = !ls.length;
    $('barraTotal').textContent = soles(totalCarrito());
    $('barraCant').textContent = unidades + (unidades === 1 ? ' producto' : ' productos');
    $('btnComprar').disabled = !estado.abierta;
    $('btnComprar').textContent = estado.abierta ? 'Comprar' : 'Cerrada';
  }

  // -------------------------------------------------------------- perfil
  function pintarPerfil() {
    var p = estado.perfil;
    $('persona').hidden = !p;
    $('personaNombre').textContent = p ? p.nombre : '';
    $('pagoNombre').textContent = p ? p.nombre : '';
  }

  function marcarCampo(id, mensaje) {
    var c = $(id);
    c.classList.toggle('mal', !!mensaje);
    var s = c.querySelector('small');
    if (!s.dataset.ayuda) s.dataset.ayuda = s.textContent;
    s.textContent = mensaje || s.dataset.ayuda;
  }

  function abrirDatos(campoMalo, mensaje) {
    var p = estado.perfil || {};
    $('fNombre').value = p.nombre || '';
    $('fCelular').value = p.celular || '';
    $('fCodigo').value = p.codigo || '';
    ['cNombre', 'cCelular', 'cCodigo'].forEach(function (c) { marcarCampo(c, null); });
    if (campoMalo) {
      var mapa = { nombre: 'cNombre', celular: 'cCelular', codigo: 'cCodigo' };
      marcarCampo(mapa[campoMalo], mensaje);
    }
    cerrar($('dlgPago'));
    abrir($('dlgDatos'));
    var foco = { nombre: 'fNombre', celular: 'fCelular', codigo: 'fCodigo' }[campoMalo] ||
      (p.nombre ? 'fCodigo' : 'fNombre');
    setTimeout(function () { $(foco).focus(); }, 50);
  }

  $('formDatos').addEventListener('submit', function (e) {
    e.preventDefault();
    var nombre = $('fNombre').value.replace(/\s+/g, ' ').trim();
    var celular = $('fCelular').value.replace(/\D/g, '');
    var codigo = $('fCodigo').value.replace(/\s/g, '').toUpperCase();
    if (celular.length === 11 && celular.indexOf('51') === 0) celular = celular.slice(2);
    var ok = true;
    if (nombre.length < 2) { marcarCampo('cNombre', 'Escribe tu nombre.'); ok = false; } else marcarCampo('cNombre', null);
    if (celular && !/^9\d{8}$/.test(celular)) { marcarCampo('cCelular', '9 dígitos, empieza con 9.'); ok = false; } else marcarCampo('cCelular', null);
    if (codigo.length !== 6) { marcarCampo('cCodigo', 'El código tiene 6 caracteres.'); ok = false; } else marcarCampo('cCodigo', null);
    if (!ok) return;
    estado.perfil = { nombre: nombre, celular: celular, codigo: codigo };
    FMU.guardar(CLAVE_PERFIL, estado.perfil);
    pintarPerfil();
    cerrar($('dlgDatos'));
    if (lineas().length) abrirPago();
  });

  function noSoyYo() {
    estado.perfil = null;
    FMU.guardar(CLAVE_PERFIL, null);
    pintarPerfil();
    abrirDatos();
  }

  // ---------------------------------------------------------------- pago
  function abrirPago() {
    var ls = lineas();
    if (!ls.length) return;
    if (!estado.perfil) { abrirDatos(); return; }
    $('pagoLineas').innerHTML = ls.map(function (l) {
      return '<li><span class="c">' + l.cantidad + '×</span><span class="n">' + esc(l.p.nombre) +
        '</span><span class="s">' + soles(l.subtotal) + '</span></li>';
    }).join('');
    $('pagoTotal').textContent = soles(totalCarrito());
    $('pagoError').hidden = true;
    if (!estado.medio) elegirMedio(FMU.leer(CLAVE_PAGO));
    pintarPago();
    abrir($('dlgPago'));
  }

  function elegirMedio(m) {
    estado.medio = ['yape', 'plin', 'efectivo'].indexOf(m) >= 0 && estado.medios[m] ? m : null;
    if (estado.medio === 'efectivo') quitarBaucher();
    pintarPago();
  }

  function pintarPago() {
    document.querySelectorAll('[data-medio]').forEach(function (b) {
      b.hidden = !estado.medios[b.dataset.medio];
      b.setAttribute('aria-pressed', String(b.dataset.medio === estado.medio));
    });
    var digital = estado.medio === 'yape' || estado.medio === 'plin';
    $('bloqueBaucher').hidden = !digital;
    $('bloquePagado').hidden = !estado.medio;
    if (estado.baucher) estado.yaPago = true;
    document.querySelector('[data-pagado="si"]').setAttribute('aria-pressed', String(estado.yaPago));
    document.querySelector('[data-pagado="no"]').setAttribute('aria-pressed', String(!estado.yaPago));
    $('btnEnviar').disabled = !estado.medio || estado.enviando;
    $('btnEnviar').textContent = estado.enviando ? 'Creando pedido…' : 'Enviar al grupo';
  }

  // Reduce la foto (máx. 1600 px, JPG) para compartirla rápido.
  function comprimir(file) {
    if (!window.createImageBitmap) return Promise.resolve(file);
    return createImageBitmap(file).then(function (bmp) {
      var escala = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      var c = document.createElement('canvas');
      c.width = Math.round(bmp.width * escala);
      c.height = Math.round(bmp.height * escala);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return new Promise(function (ok) { c.toBlob(ok, 'image/jpeg', 0.82); });
    }).then(function (blob) {
      return blob ? new File([blob], 'baucher-' + Date.now() + '.jpg', { type: 'image/jpeg' }) : file;
    }).catch(function () { return file; });
  }

  $('fBaucher').addEventListener('change', function () {
    var f = this.files && this.files[0];
    this.value = '';
    if (!f) return;
    comprimir(f).then(function (foto) {
      estado.baucher = foto;
      if ($('imgBaucher').src) URL.revokeObjectURL($('imgBaucher').src);
      $('imgBaucher').src = URL.createObjectURL(foto);
      $('imgBaucher').hidden = false;
      $('btnQuitarBaucher').hidden = false;
      $('txtBaucher').textContent = 'Cambiar foto';
      pintarPago();
    });
  });

  function quitarBaucher() {
    estado.baucher = null;
    if ($('imgBaucher').src) URL.revokeObjectURL($('imgBaucher').src);
    $('imgBaucher').removeAttribute('src');
    $('imgBaucher').hidden = true;
    $('btnQuitarBaucher').hidden = true;
    $('txtBaucher').textContent = 'Tomar o elegir foto';
  }

  // ------------------------------------------------------------- enviar
  function enviar() {
    if (estado.enviando || !estado.medio || !estado.perfil) return;
    estado.enviando = true;
    $('pagoError').hidden = true;
    pintarPago();

    var items = lineas().map(function (l) { return { producto_id: l.p.producto_id, cantidad: l.cantidad }; });
    var tieneFoto = !!estado.baucher;

    FMU.rpc('fn_web_crear_pedido', {
      p_codigo: estado.perfil.codigo,
      p_nombre: estado.perfil.nombre,
      p_celular: estado.perfil.celular || null,
      p_tipo_pago: estado.medio,
      p_ya_pago: estado.yaPago,
      p_tiene_baucher: tieneFoto,
      p_items: items
    }).then(function (r) {
      if (!r || !r.ok) {
        var msg = (r && r.error) || 'No se pudo crear el pedido.';
        if (r && r.campo) { abrirDatos(r.campo, msg); return; }
        mostrarError(msg);
        cargar();   // por si cambió el stock
        return;
      }
      var u = estado.ultimo = {
        correlativo: r.correlativo_venta,
        total: r.monto_total,
        items: r.items || [],
        nombre: estado.perfil.nombre,
        celular: estado.perfil.celular,
        medio: estado.medio,
        yaPago: estado.yaPago || tieneFoto,
        baucher: estado.baucher,
        enviado: false
      };
      FMU.guardar(CLAVE_PAGO, estado.medio);
      estado.carrito = {};
      FMU.guardar(CLAVE_CARRITO, estado.carrito);
      estado.medio = null;
      estado.yaPago = false;
      estado.baucher = null;
      quitarBaucher();
      cerrar($('dlgPago'));
      mostrarListo();
      cargar();
      // Un solo intento automático, y solo si hay baucher para compartir.
      // Si no, la persona usa el botón (nunca se abre WhatsApp dos veces).
      compartir(true);
    }).catch(function () {
      mostrarError('Sin conexión o error del servidor. Revisa tu internet e intenta de nuevo.');
    }).finally(function () {
      estado.enviando = false;
      pintarPago();
    });
  }

  function mostrarError(msg) {
    $('pagoError').textContent = msg;
    $('pagoError').hidden = false;
  }

  function mostrarListo() {
    var u = estado.ultimo;
    $('listoTitulo').textContent = 'Pedido ' + u.correlativo + ' creado';
    $('listoTexto').textContent = 'Total ' + soles(u.total) +
      '. Queda pendiente hasta que lo aprueben en la app.';
    $('listoAviso').hidden = true;
    pintarListo();
    abrir($('dlgListo'));
  }

  function pintarListo() {
    var u = estado.ultimo;
    $('btnReenviar').disabled = estado.compartiendo;
    $('btnReenviar').textContent = u && u.enviado ? 'Enviar otra vez' : 'Enviar al grupo';
  }

  // Mismo formato que la app (mensaje_pedido.dart): primero el nombre,
  // luego productos y total, y al final el nro. de pedido en cursiva
  // (WhatsApp no tiene letra pequeña). Sin emojis: WhatsApp Web los rompe.
  function textoPedido(u) {
    var t = ['*' + u.nombre + '*'];
    u.items.forEach(function (i) {
      t.push(i.cantidad + ' x ' + i.nombre + ' — ' + soles(i.subtotal));
    });
    t.push('*Total: ' + soles(u.total) + '*');
    t.push('_Pedido ' + u.correlativo + '_');
    return t.join('\n');
  }

  function abrirWhatsApp(texto) {
    var url = 'https://api.whatsapp.com/send?text=' + encodeURIComponent(texto);
    var w = window.open(url, '_blank');
    if (w) w.opener = null; else location.href = url;
  }

  function puedeCompartir(archivos) {
    try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files: archivos })); }
    catch (e) { return false; }
  }

  function marcarEnviado() {
    if (estado.ultimo) estado.ultimo.enviado = true;
    pintarListo();
  }

  // Con baucher y soporte: navigator.share con la foto del baucher y la
  // descripción como texto; Android lo manda directo a WhatsApp y la
  // persona elige el grupo. Sin baucher (o sin soporte): api.whatsapp.com
  // solo con el texto.
  // auto = intento automático tras crear el pedido: nunca abre WhatsApp
  // por su cuenta en el respaldo, para no duplicar con el botón.
  function compartir(auto) {
    var u = estado.ultimo;
    if (!u || estado.compartiendo) return;
    var texto = textoPedido(u);

    if (u.baucher && puedeCompartir([u.baucher])) {
      estado.compartiendo = true;
      pintarListo();
      navigator.share({ files: [u.baucher], text: texto }).then(marcarEnviado).catch(function (e) {
        if (e && e.name === 'AbortError') return;   // la persona canceló
        avisoListo('Toca <b>“Enviar al grupo”</b> para compartir tu baucher.');
      }).finally(function () {
        estado.compartiendo = false;
        pintarListo();
      });
      return;
    }

    if (auto) {
      avisoListo('Toca <b>“Enviar al grupo”</b> para abrir WhatsApp.' +
        (u.baucher ? ' Luego adjunta tu baucher en el chat.' : ''));
      return;
    }
    abrirWhatsApp(texto);
    marcarEnviado();
  }

  function avisoListo(html) {
    $('listoAviso').innerHTML = html;
    $('listoAviso').hidden = false;
  }

  // ------------------------------------------------------------- eventos
  $('productos').addEventListener('click', function (e) {
    var b = e.target.closest('[data-accion]');
    if (!b) return;
    var id = b.closest('.prod').dataset.id;
    cambiar(id, b.dataset.accion === 'mas' ? 1 : -1);
  });

  $('filtros').addEventListener('click', function (e) {
    var b = e.target.closest('[data-filtro]');
    if (!b) return;
    estado.filtro = b.dataset.filtro;
    document.querySelectorAll('[data-filtro]').forEach(function (x) {
      x.setAttribute('aria-pressed', String(x === b));
    });
    pintarProductos();
  });

  var temporizador;
  $('buscar').addEventListener('input', function () {
    clearTimeout(temporizador);
    var v = this.value;
    temporizador = setTimeout(function () { estado.busqueda = v; pintarProductos(); }, 120);
  });

  $('btnComprar').addEventListener('click', abrirPago);
  $('btnNoSoyYo').addEventListener('click', noSoyYo);
  $('btnCambiarDatos').addEventListener('click', noSoyYo);
  $('btnQuitarBaucher').addEventListener('click', function () { quitarBaucher(); pintarPago(); });
  $('btnEnviar').addEventListener('click', enviar);
  $('btnReenviar').addEventListener('click', function () { compartir(false); });

  $('medios').addEventListener('click', function (e) {
    var b = e.target.closest('[data-medio]');
    if (b) elegirMedio(b.dataset.medio);
  });
  $('bloquePagado').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pagado]');
    if (!b) return;
    estado.yaPago = b.dataset.pagado === 'si';
    if (!estado.yaPago && estado.baucher) quitarBaucher();   // "no pagué" no lleva baucher
    pintarPago();
  });

  document.querySelectorAll('dialog').forEach(function (d) {
    d.addEventListener('click', function (e) {
      if (e.target === d || e.target.closest('[data-cerrar]')) cerrar(d);
    });
  });

  // Al volver de WhatsApp, refresca stock.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') cargar();
  });

  pintarPerfil();
  cargar();
})();
