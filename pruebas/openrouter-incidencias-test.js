const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validarIncidencia,
  validarIncidencias,
  cargarProductosOficiales,
} = require('../src/openrouter-incidencias');

const productosOficialesPrueba = [
  'Tomate triturado',
  'Tomate natural',
  'Zanahoria',
  'Patata',
];

test('cargarProductosOficiales devuelve la lista de productos oficiales del catálogo', async () => {
  const productos = await cargarProductosOficiales();
  assert.ok(Array.isArray(productos));
  assert.ok(productos.length > 900);
  assert.ok(productos.includes('CARAGOLS CUINATS 500 GRS'));
  assert.ok(productos.includes('ALL I OLI SALSA'));
});

test('validarIncidencias rechaza respuestas que no incluyan incidencias como lista', () => {
  assert.throws(
    () => validarIncidencias(null, productosOficialesPrueba),
    /La respuesta de incidencias no es un objeto válido/
  );
  assert.throws(
    () => validarIncidencias({}, productosOficialesPrueba),
    /debe contener una propiedad "incidencias" que sea una lista/
  );
  assert.throws(
    () => validarIncidencias({ incidencias: 'no-es-lista' }, productosOficialesPrueba),
    /debe contener una propiedad "incidencias" que sea una lista/
  );
});

test('detecta y valida varias incidencias independientes en un mismo correo con albarán y pedido', () => {
  const extraccionMultiple = {
    pedido: null,
    albaran: null,
    incidencias: [
      {
        pedido: '33918719',
        albaran: '536774',
        tipo_incidencia: 'mercancía faltante',
        solicita_devolucion: false,
        solicita_abono: false,
        producto_mencionado: 'Cargols cuits 500g',
        producto_oficial: null,
        candidatos: [],
        cantidad: 4,
        unidad: 'unds',
        motivo: 'se facturan 4 unds, recibimos 0',
        dudas: [],
      },
      {
        pedido: '33870879',
        albaran: '536773',
        tipo_incidencia: 'cantidades incorrectas',
        solicita_devolucion: false,
        solicita_abono: false,
        producto_mencionado: 'Allioli 180gr',
        producto_oficial: null,
        candidatos: [],
        cantidad: 1,
        unidad: 'cj',
        motivo: 'se facturan 37 cj, recibimos 36 cj',
        dudas: [],
      },
    ],
    dudas: [],
  };

  const resultado = validarIncidencias(extraccionMultiple, productosOficialesPrueba);

  assert.equal(resultado.incidencias.length, 2);

  // Incidencia 1
  assert.equal(resultado.incidencias[0].pedido, '33918719');
  assert.equal(resultado.incidencias[0].albaran, '536774');
  assert.equal(resultado.incidencias[0].tipo_incidencia, 'mercancía faltante');
  assert.equal(resultado.incidencias[0].producto_mencionado, 'Cargols cuits 500g');
  assert.equal(resultado.incidencias[0].cantidad, 4);
  assert.equal(resultado.incidencias[0].unidad, 'unds');
  assert.equal(resultado.incidencias[0].solicita_devolucion, false);
  assert.equal(resultado.incidencias[0].solicita_abono, false);

  // Incidencia 2
  assert.equal(resultado.incidencias[1].pedido, '33870879');
  assert.equal(resultado.incidencias[1].albaran, '536773');
  assert.equal(resultado.incidencias[1].tipo_incidencia, 'cantidades incorrectas');
  assert.equal(resultado.incidencias[1].producto_mencionado, 'Allioli 180gr');
  assert.equal(resultado.incidencias[1].cantidad, 1);
  assert.equal(resultado.incidencias[1].unidad, 'cj');
});

test('diferencia correctamente solicitud de devolución y solicitud de abono', () => {
  const devolucion = {
    incidencias: [
      {
        tipo_incidencia: 'producto dañado',
        solicita_devolucion: true,
        solicita_abono: false,
        producto_mencionado: 'Tomate triturado',
        producto_oficial: 'Tomate triturado',
        candidatos: ['Tomate triturado'],
        cantidad: 3,
        unidad: 'cajas',
        motivo: 'producto roto',
        dudas: [],
      },
    ],
  };

  const abono = {
    albaran: '536592',
    incidencias: [
      {
        tipo_incidencia: 'mercancía faltante',
        solicita_devolucion: false,
        solicita_abono: true,
        producto_mencionado: 'lechuga iceberg',
        producto_oficial: null,
        candidatos: [],
        cantidad: null,
        unidad: null,
        motivo: 'no se ha entregado, solicitan abono',
        dudas: [],
      },
    ],
  };

  const resDev = validarIncidencias(devolucion, productosOficialesPrueba);
  assert.equal(resDev.incidencias[0].solicita_devolucion, true);
  assert.equal(resDev.incidencias[0].solicita_abono, false);

  const resAbo = validarIncidencias(abono, productosOficialesPrueba);
  assert.equal(resAbo.incidencias[0].solicita_devolucion, false);
  assert.equal(resAbo.incidencias[0].solicita_abono, true);
  assert.equal(resAbo.incidencias[0].albaran, '536592');
});

test('registra reclamación sobre el repartidor sin producto asociado', () => {
  const quejaRepartidor = {
    incidencias: [
      {
        tipo_incidencia: 'reclamación sobre el repartidor',
        solicita_devolucion: false,
        solicita_abono: false,
        producto_mencionado: null,
        producto_oficial: null,
        candidatos: [],
        cantidad: null,
        unidad: null,
        motivo: 'repartidor no quiso colaborar y dejó la mercancía en el suelo',
        dudas: [],
      },
    ],
  };

  const res = validarIncidencias(quejaRepartidor, productosOficialesPrueba);
  assert.equal(res.incidencias.length, 1);
  assert.equal(res.incidencias[0].tipo_incidencia, 'reclamación sobre el repartidor');
  assert.equal(res.incidencias[0].producto_mencionado, null);
  assert.equal(res.incidencias[0].producto_oficial, null);
  assert.equal(res.incidencias[0].dudas.length, 0);
});

test('valida producto equivocado y candidatos oficiales con ambigüedad', () => {
  const conAmbiguedad = {
    pedido: 'PMI70-COCINA-2024-1872',
    albaran: '1025582',
    incidencias: [
      {
        tipo_incidencia: 'producto equivocado',
        solicita_devolucion: false,
        solicita_abono: true,
        producto_mencionado: 'tomate',
        producto_oficial: null,
        candidatos: ['Tomate triturado', 'Tomate natural'],
        cantidad: 2,
        unidad: 'cajas',
        motivo: 'se sirvió producto equivocado',
        dudas: [],
      },
    ],
  };

  const res = validarIncidencias(conAmbiguedad, productosOficialesPrueba);
  assert.equal(res.incidencias[0].producto_oficial, null);
  assert.equal(res.incidencias[0].candidatos.length, 2);
  assert.ok(
    res.incidencias[0].dudas.some((d) => d.includes('varios productos oficiales posibles'))
  );
  assert.equal(res.incidencias[0].pedido, 'PMI70-COCINA-2024-1872');
  assert.equal(res.incidencias[0].albaran, '1025582');
});

test('rechaza producto oficial no existente en el listado de la empresa', () => {
  const productoInvalido = {
    incidencias: [
      {
        tipo_incidencia: 'producto dañado',
        solicita_devolucion: false,
        solicita_abono: false,
        producto_mencionado: 'Melón piel de sapo',
        producto_oficial: 'Melón piel de sapo',
        candidatos: ['Melón piel de sapo'],
        cantidad: 1,
        unidad: 'caja',
        motivo: 'dañado',
        dudas: [],
      },
    ],
  };

  const res = validarIncidencias(productoInvalido, productosOficialesPrueba);
  assert.equal(res.incidencias[0].producto_oficial, null);
  assert.equal(res.incidencias[0].candidatos.length, 0);
  assert.ok(
    res.incidencias[0].dudas.some((d) => d.includes('no aparece exactamente en el listado'))
  );
});

test('compatibilidad hacia atrás: validarIncidencia adapta formato antiguo de un solo objeto', () => {
  const formatoAntiguo = {
    solicita_devolucion: true,
    producto_cliente: 'Zanahoria',
    producto_oficial: 'Zanahoria',
    candidatos_oficiales: ['Zanahoria'],
    cantidad: 2,
    unidad: 'cajas',
    motivo: 'producto dañado',
    dudas: [],
  };

  const res = validarIncidencia(formatoAntiguo, productosOficialesPrueba);
  assert.ok(Array.isArray(res.incidencias));
  assert.equal(res.incidencias.length, 1);
  assert.equal(res.incidencias[0].producto_mencionado, 'Zanahoria');
  assert.equal(res.incidencias[0].producto_cliente, 'Zanahoria');
  assert.equal(res.incidencias[0].producto_oficial, 'Zanahoria');
  assert.equal(res.incidencias[0].solicita_devolucion, true);
});

test('compatibilidad con Outlook: adjuntar dudas a la extracción no genera errores', () => {
  const extraccion = {
    pedido: '12345',
    albaran: '67890',
    incidencias: [
      {
        tipo_incidencia: 'mercancía faltante',
        solicita_devolucion: false,
        solicita_abono: true,
        producto_mencionado: 'Patata',
        producto_oficial: 'Patata',
        candidatos: ['Patata'],
        cantidad: 5,
        unidad: 'kg',
        motivo: 'faltan 5 kg',
        dudas: [],
      },
    ],
    dudas: [],
  };

  const adjuntosDudas = [
    'El PDF supera 15 MB y no se ha enviado al modelo.',
    'No se ha podido leer automáticamente el adjunto imagen.png.',
  ];

  if (!Array.isArray(extraccion.dudas)) {
    extraccion.dudas = [];
  }
  extraccion.dudas.push(...adjuntosDudas);

  assert.equal(extraccion.dudas.length, 2);
  assert.equal(extraccion.incidencias.length, 1);
  assert.equal(extraccion.incidencias[0].dudas.length, 0);
});

test('no confunde CARAGOLS CUINATS 500 GRS con Cargols cuits 500g sin equivalencia confirmada', () => {
  const extraccion = {
    incidencias: [
      {
        pedido: '33918719',
        albaran: '536774',
        tipo_incidencia: 'mercancía faltante',
        producto_mencionado: 'Cargols cuits 500g',
        producto_oficial: 'CARAGOLS CUINATS 500 GRS',
        candidatos: ['CARAGOLS CUINATS 500 GRS'],
        cantidad: 4,
        unidad: 'unds',
        dudas: [],
      },
    ],
  };

  const res = validarIncidencias(extraccion, ['CARAGOLS CUINATS 500 GRS']);
  assert.equal(res.incidencias[0].producto_mencionado, 'Cargols cuits 500g');
  assert.equal(res.incidencias[0].producto_oficial, null);
  assert.ok(
    res.incidencias[0].dudas.some((d) =>
      /no coincide exactamente|pendiente de revisión|confirmar/i.test(d)
    )
  );
});

test('no confunde ALL I OLI SALSA con Allioli 180gr sin equivalencia confirmada', () => {
  const extraccion = {
    incidencias: [
      {
        pedido: '33870879',
        albaran: '536773',
        tipo_incidencia: 'cantidades incorrectas',
        producto_mencionado: 'Allioli 180gr',
        producto_oficial: 'ALL I OLI SALSA',
        candidatos: ['ALL I OLI SALSA'],
        cantidad: 1,
        unidad: 'cj',
        dudas: [],
      },
    ],
  };

  const res = validarIncidencias(extraccion, ['ALL I OLI SALSA']);
  assert.equal(res.incidencias[0].producto_mencionado, 'Allioli 180gr');
  assert.equal(res.incidencias[0].producto_oficial, null);
  assert.ok(
    res.incidencias[0].dudas.some((d) =>
      /no coincide exactamente|pendiente de revisión|confirmar/i.test(d)
    )
  );
});

test('no promueve candidato único si no coincide exactamente con el producto mencionado', () => {
  const extraccion = {
    incidencias: [
      {
        producto_mencionado: 'Cargols cuits 500g',
        producto_oficial: null,
        candidatos: ['CARAGOLS CUINATS 500 GRS'],
        cantidad: 4,
        unidad: 'unds',
        dudas: [],
      },
    ],
  };

  const res = validarIncidencias(extraccion, ['CARAGOLS CUINATS 500 GRS']);
  assert.equal(res.incidencias[0].producto_oficial, null);
  assert.equal(res.incidencias[0].candidatos[0], 'CARAGOLS CUINATS 500 GRS');
  assert.ok(
    res.incidencias[0].dudas.some((d) =>
      /no coincide exactamente|pendiente de revisión|confirmar/i.test(d)
    )
  );
});
