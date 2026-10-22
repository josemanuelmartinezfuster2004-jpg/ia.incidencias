
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rutaProyecto = path.join(__dirname, '..');
const rutaProcesador = path.join(rutaProyecto, 'src', 'probar-incidencias.js');
const rutaResultados = path.join(__dirname, 'incidencias-resultados.json');

let resultados;

test.before(async () => {
  const ejecucion = spawnSync(
    process.execPath,
    [rutaProcesador],
    {
      cwd: rutaProyecto,
      encoding: 'utf8'
    }
  );

  assert.equal(
    ejecucion.status,
    0,
    `El procesador ha fallado.\n${ejecucion.stderr}`
  );

  const contenido = await fs.readFile(rutaResultados, 'utf8');
  resultados = JSON.parse(contenido);
});

test('se procesan los ocho correos de prueba', () => {
  assert.equal(resultados.length, 8);
});

test('la incidencia 1 detecta el producto dañado y la devolución', () => {
  const resultado = resultados.find((correo) => correo.id === 1);

  assert.ok(resultado, 'No se ha encontrado el correo 1');
  assert.equal(resultado.tipoCorreo, 'Incidencia');
  assert.equal(resultado.motivo, 'Producto dañado');
  assert.equal(resultado.solicitaDevolucion, true);
  assert.equal(resultado.productoMencionado, 'Tomate triturado');
  assert.equal(resultado.cantidad, '3');
  assert.equal(resultado.unidad, 'cajas');
  assert.equal(resultado.nombreOficial, 'Tomate triturado');
  assert.equal(resultado.referenciaProducto, 'PROD001');
  assert.equal(resultado.revisionNecesaria, false);
});

test('la incidencia 2 detecta las zanahorias golpeadas sin devolución', () => {
  const resultado = resultados.find((correo) => correo.id === 2);

  assert.ok(resultado, 'No se ha encontrado el correo 2');
  assert.equal(resultado.tipoCorreo, 'Incidencia');
  assert.equal(resultado.motivo, 'Producto golpeado');
  assert.equal(resultado.solicitaDevolucion, false);
  assert.equal(resultado.productoMencionado, 'Zanahoria');
  assert.equal(resultado.cantidad, null);
  assert.equal(resultado.unidad, null);
  assert.equal(resultado.nombreOficial, 'Zanahoria');
  assert.equal(resultado.referenciaProducto, 'PROD003');
  assert.equal(resultado.revisionNecesaria, false);
});

test('la consulta 3 detecta la ambigüedad entre los dos tomates', () => {
  const resultado = resultados.find((correo) => correo.id === 3);

  assert.ok(resultado, 'No se ha encontrado el correo 3');
  assert.equal(resultado.tipoCorreo, 'Consulta');
  assert.equal(resultado.motivo, 'No identificado');
  assert.equal(resultado.solicitaDevolucion, false);
  assert.equal(
    resultado.productoMencionado,
    'Tomate triturado, Tomate natural'
  );
  assert.equal(resultado.cantidad, null);
  assert.equal(resultado.unidad, null);
  assert.equal(resultado.nombreOficial, null);
  assert.equal(resultado.referenciaProducto, null);
  assert.equal(resultado.revisionNecesaria, true);
});

test('todos los resultados tienen los campos obligatorios', () => {
  const camposObligatorios = [
    'id',
    'asunto',
    'remitente',
    'tipoCorreo',
    'motivo',
    'solicitaDevolucion',
    'productoMencionado',
    'cantidad',
    'unidad',
    'nombreOficial',
    'referenciaProducto',
    'revisionNecesaria'
  ];

  for (const resultado of resultados) {
    for (const campo of camposObligatorios) {
      assert.ok(
        Object.hasOwn(resultado, campo),
        `Falta el campo "${campo}" en el correo ${resultado.id}`
      );
    }
  }
});
