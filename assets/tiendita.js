// familiaMU — Tiendita.
// Flujo: buscar → carrito → Comprar → Yape/Plin/Efectivo → (baucher) →
// Enviar al grupo. El pedido se crea SIEMPRE en el servidor
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
    estado.medio = ['yape', 'plin', 'efectivo'].indexOf(m) >= 0 ? m : null;
    if (estado.medio === 'efectivo') quitarBaucher();
    pintarPago();
  }

  function pintarPago() {
    document.querySelectorAll('[data-medio]').forEach(function (b) {
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
        fecha: new Date(),
        tarjeta: null,
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
      // Un solo intento automático, y solo si se puede compartir la foto.
      // Si no, la persona usa el botón (nunca se abre WhatsApp dos veces).
      return dibujarTarjeta(u).then(function (archivo) {
        if (estado.ultimo !== u) return;
        u.tarjeta = archivo;
        pintarListo();
        if ($('dlgListo').open) compartir(true);
      });
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
    if ($('btnDescargar').href) URL.revokeObjectURL($('btnDescargar').href);
    $('btnDescargar').removeAttribute('href');
    $('imgTarjeta').removeAttribute('src');
    pintarListo();
    abrir($('dlgListo'));
  }

  function pintarListo() {
    var u = estado.ultimo;
    var listo = !!(u && u.tarjeta);
    $('imgTarjeta').hidden = !listo;
    $('btnDescargar').hidden = !listo;
    if (listo && !$('btnDescargar').href) {
      var url = URL.createObjectURL(u.tarjeta);
      $('btnDescargar').href = url;
      $('btnDescargar').download = u.tarjeta.name;
      $('imgTarjeta').src = url;
    }
    // Mientras se dibuja la foto no se puede enviar (evita un envío sin ella).
    var dibujando = u && u.tarjeta === null;
    $('btnReenviar').disabled = dibujando || estado.compartiendo;
    $('btnReenviar').textContent = dibujando ? 'Preparando foto…'
      : (u && u.enviado ? 'Enviar otra vez' : 'Enviar al grupo');
  }

  function nombreMedio(m) { return { yape: 'Yape', plin: 'Plin', efectivo: 'Efectivo' }[m] || m; }
  function textoPago(u) {
    return u.yaPago ? 'Ya pagó' : (u.medio === 'efectivo' ? 'Paga al recoger' : 'Por pagar');
  }

  // Va junto a la foto.
  function leyenda(u) {
    return 'Pedido ' + u.correlativo + ' · ' + soles(u.total) + ' · ' + nombreMedio(u.medio);
  }

  // Respaldo sin foto: corto, SIN emojis (WhatsApp Web los rompe) y con
  // el formato de WhatsApp (*negrita*).
  function textoCorto(u) {
    var t = ['*Pedido ' + u.correlativo + '* · Tiendita', u.nombre];
    u.items.forEach(function (i) {
      t.push(i.cantidad + ' x ' + i.nombre + ' — ' + soles(i.subtotal));
    });
    t.push('*Total: ' + soles(u.total) + '*');
    t.push(nombreMedio(u.medio) + ' · ' + textoPago(u));
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

  // Con soporte: navigator.share con la tarjeta (+ baucher) y la leyenda;
  // Android lo manda directo a WhatsApp y la persona elige el grupo.
  // Sin soporte: api.whatsapp.com con texto corto + botón "Descargar".
  // auto = intento automático tras crear el pedido: nunca abre WhatsApp
  // por su cuenta en el respaldo, para no duplicar con el botón.
  function compartir(auto) {
    var u = estado.ultimo;
    if (!u || u.tarjeta === null || estado.compartiendo) return;

    var archivos = null;
    if (u.tarjeta) {
      var todos = u.baucher ? [u.tarjeta, u.baucher] : [u.tarjeta];
      if (puedeCompartir(todos)) archivos = todos;
      else if (u.baucher && puedeCompartir([u.tarjeta])) {
        archivos = [u.tarjeta];
        avisoListo('No se pudo adjuntar el baucher junto a la foto: envíalo aparte en el chat.');
      }
    }

    if (archivos) {
      estado.compartiendo = true;
      pintarListo();
      navigator.share({ files: archivos, text: leyenda(u) }).then(marcarEnviado).catch(function (e) {
        if (e && e.name === 'AbortError') return;   // la persona canceló
        avisoListo('Toca <b>“Enviar al grupo”</b> para compartir la foto del pedido.');
      }).finally(function () {
        estado.compartiendo = false;
        pintarListo();
      });
      return;
    }

    if (auto) {
      avisoListo('Toca <b>“Enviar al grupo”</b> para abrir WhatsApp. ' +
        (u.tarjeta ? 'Si quieres la foto del pedido, descárgala y adjúntala en el chat.' : ''));
      return;
    }
    abrirWhatsApp(textoCorto(u));
    marcarEnviado();
  }

  function avisoListo(html) {
    $('listoAviso').innerHTML = html;
    $('listoAviso').hidden = false;
  }

  // ------------------------------------------------- tarjeta del pedido
  // Boleta en PNG de 1080 px de ancho, dibujada en canvas. Nunca falla:
  // si algo sale mal, resuelve null y se usa solo el texto.
  var ANCHO = 1080, M = 64;
  var C_ROJO = '#D32F2F', C_ROJO2 = '#B71C1C', C_TEXTO = '#1D1B20', C_GRIS = '#5F6368',
      C_BORDE = '#E4E4E7', C_SUAVE = '#FFEBEE', C_VERDE = '#2E7D32', C_VERDE_SUAVE = '#E8F5E9',
      C_AMBAR = '#8D5A00', C_AMBAR_SUAVE = '#FFF3D6';

  function cargarImagen(src) {
    return new Promise(function (ok) {
      var img = new Image();
      img.onload = function () { ok(img); };
      img.onerror = function () { ok(null); };
      img.src = src;
    });
  }

  function fuentesListas() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var cargas = Promise.all(['400 40px Roboto', '500 40px Roboto', '700 40px Roboto']
      .map(function (f) { return document.fonts.load(f); }));
    return Promise.race([cargas, new Promise(function (ok) { setTimeout(ok, 1500); })]).catch(function () {});
  }

  function rectRedondo(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function partirLineas(ctx, texto, ancho) {
    var palabras = String(texto).split(/\s+/), lineas = [], actual = '';
    palabras.forEach(function (p) {
      var prueba = actual ? actual + ' ' + p : p;
      if (ctx.measureText(prueba).width <= ancho || !actual) actual = prueba;
      else { lineas.push(actual); actual = p; }
    });
    if (actual) lineas.push(actual);
    return lineas;
  }

  function lineaPunteada(ctx, y) {
    ctx.save();
    ctx.strokeStyle = C_BORDE;
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 12]);
    ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(ANCHO - M, y); ctx.stroke();
    ctx.restore();
  }

  function pastilla(ctx, x, y, texto, fondo, color) {
    ctx.font = '700 38px Roboto, system-ui, sans-serif';
    var w = ctx.measureText(texto).width + 56;
    ctx.fillStyle = fondo; rectRedondo(ctx, x, y, w, 76, 38); ctx.fill();
    ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(texto, x + 28, y + 39);
    ctx.textBaseline = 'alphabetic';
    return w;
  }

  function pintarTarjeta(canvas, u, logo) {
    var ctx = canvas.getContext('2d');
    var F = ' Roboto, system-ui, sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Cabecera roja con el logo.
    var g = ctx.createLinearGradient(0, 0, ANCHO, 240);
    g.addColorStop(0, '#E53935'); g.addColorStop(1, C_ROJO2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, ANCHO, 240);
    var xt = M;
    if (logo) {
      ctx.save(); rectRedondo(ctx, M, 44, 152, 152, 36); ctx.clip();
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(M, 44, 152, 152);
      ctx.drawImage(logo, M, 44, 152, 152); ctx.restore();
      xt = M + 152 + 36;
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 64px' + F; ctx.fillText('Tiendita Petita', xt, 122);
    ctx.globalAlpha = 0.9; ctx.font = '400 36px' + F; ctx.fillText('familiaMU', xt, 174);
    ctx.globalAlpha = 1;

    // Pedido, nombre y fecha.
    var y = 340;
    ctx.fillStyle = C_TEXTO; ctx.font = '700 76px' + F;
    ctx.fillText('Pedido ' + u.correlativo, M, y);
    y += 66; ctx.font = '500 42px' + F;
    ctx.fillText(u.nombre + (u.celular ? '  ·  ' + u.celular : ''), M, y);
    y += 54; ctx.fillStyle = C_GRIS; ctx.font = '400 36px' + F;
    var f = u.fecha;
    var fecha = f.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' }) +
      ' · ' + f.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    ctx.fillText(fecha.charAt(0).toUpperCase() + fecha.slice(1), M, y);

    y += 50; lineaPunteada(ctx, y); y += 74;

    // Productos: "2 × Nombre ........ S/ 2.40"
    var anchoNombre = ANCHO - 2 * M - 250;
    u.items.forEach(function (i) {
      ctx.font = '400 42px' + F;
      var ls = partirLineas(ctx, i.cantidad + ' × ' + i.nombre, anchoNombre);
      ctx.fillStyle = C_TEXTO;
      ls.forEach(function (l, k) { ctx.fillText(l, M, y + k * 54); });
      ctx.font = '700 42px' + F; ctx.textAlign = 'right';
      ctx.fillText(soles(i.subtotal), ANCHO - M, y);
      ctx.textAlign = 'left';
      y += ls.length * 54 + 22;
    });

    y += 4; lineaPunteada(ctx, y); y += 112;

    // TOTAL grande.
    ctx.fillStyle = C_GRIS; ctx.font = '700 40px' + F;
    ctx.fillText('TOTAL', M, y - 12);
    ctx.fillStyle = C_ROJO; ctx.font = '700 104px' + F; ctx.textAlign = 'right';
    ctx.fillText(soles(u.total), ANCHO - M, y);
    ctx.textAlign = 'left';

    // Medio de pago y estado.
    y += 52;
    var w = pastilla(ctx, M, y, nombreMedio(u.medio), C_SUAVE, C_ROJO);
    if (u.yaPago) pastilla(ctx, M + w + 18, y, 'Ya pagó ✓', C_VERDE_SUAVE, C_VERDE);
    else pastilla(ctx, M + w + 18, y, textoPago(u), C_AMBAR_SUAVE, C_AMBAR);
    y += 76 + 64;

    ctx.fillStyle = C_GRIS; ctx.font = '400 30px' + F; ctx.textAlign = 'center';
    ctx.fillText('Pendiente de aprobación en la app', ANCHO / 2, y);
    ctx.textAlign = 'left';
    return y + 56;   // alto usado
  }

  function dibujarTarjeta(u) {
    var logoUrl = new URL('../assets/img/icon-512.png', location.href).href;
    return Promise.all([fuentesListas(), cargarImagen(logoUrl)]).then(function (r) {
      var logo = r[1];
      // Primero se mide el alto con un lienzo grande, luego se dibuja al alto exacto.
      var prueba = document.createElement('canvas');
      prueba.width = ANCHO; prueba.height = 4000;
      var alto = pintarTarjeta(prueba, u, logo);
      var canvas = document.createElement('canvas');
      canvas.width = ANCHO; canvas.height = alto;
      pintarTarjeta(canvas, u, logo);
      return aArchivo(canvas, u).catch(function () {
        // Si el logo "ensucia" el lienzo (p. ej. abierto como archivo local),
        // se repite en un lienzo nuevo y sin logo.
        var limpio = document.createElement('canvas');
        limpio.width = ANCHO; limpio.height = alto;
        pintarTarjeta(limpio, u, null);
        return aArchivo(limpio, u);
      });
    }).catch(function () { return false; });
  }

  function aArchivo(canvas, u) {
    return new Promise(function (ok, mal) {
      try {
        canvas.toBlob(function (b) {
          if (b) ok(new File([b], 'pedido-' + u.correlativo + '.png', { type: 'image/png' }));
          else mal(new Error('sin imagen'));
        }, 'image/png');
      } catch (e) { mal(e); }
    });
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
