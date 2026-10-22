// Procesador de correos reales clasificados como incidencias.
// Lee los correos almacenados en resultados/correos-categorizados/incidencias.json
// y ejecuta la extracción con OpenRouter sin requerir inicio de sesión en Outlook.

const fs = require('node:fs/promises');
const path = require('node:path');
const { main: extraerIncidencia } = require('./openrouter-incidencias');

async function procesarCorreo(correo, numero, total, modelo) {
  const asunto = correo.subject || correo.asunto || '(sin asunto)';
  const remitente = correo.from || correo.remitente || correo.fromName || '(desconocido)';
  const cuerpo = correo.body || correo.cuerpo || '';

  console.log(`\n=============================================================`);
  console.log(`Procesando correo ${numero}/${total}: "${asunto}"`);
  console.log(`Remitente: ${remitente}`);
  console.log(`=============================================================`);

  const textoCorreo = [
    `Asunto: ${asunto}`,
    `Remitente: ${remitente}`,
    '',
    cuerpo,
  ].join('\n');

  const extraccion = await extraerIncidencia(textoCorreo, modelo);

  console.log('\n--- Resultado de la extracción ---');
  if (extraccion.pedido) console.log(`Pedido general: ${extraccion.pedido}`);
  if (extraccion.albaran) console.log(`Albarán general: ${extraccion.albaran}`);

  const listaIncidencias = extraccion.incidencias || [];
  console.log(`Incidencias detectadas: ${listaIncidencias.length}`);

  for (const [idx, inc] of listaIncidencias.entries()) {
    console.log(`\n  [Incidencia ${idx + 1}]`);
    console.log(`  - Tipo: ${inc.tipo_incidencia || 'No especificado'}`);
    if (inc.pedido) console.log(`  - Pedido: ${inc.pedido}`);
    if (inc.albaran) console.log(`  - Albarán: ${inc.albaran}`);
    console.log(`  - Motivo: ${inc.motivo || 'No indicado'}`);
    console.log(`  - Solicita devolución: ${inc.solicita_devolucion ? 'Sí' : 'No'}`);
    console.log(`  - Solicita abono: ${inc.solicita_abono ? 'Sí' : 'No'}`);
    console.log(`  - Producto mencionado: ${inc.producto_mencionado || 'Ninguno'}`);
    console.log(`  - Producto oficial: ${inc.producto_oficial || 'Pendiente de identificar'}`);
    if (inc.candidatos && inc.candidatos.length > 0) {
      console.log(`  - Candidatos posibles: ${inc.candidatos.join(', ')}`);
    }
    console.log(`  - Cantidad: ${inc.cantidad !== null ? inc.cantidad : 'No indicada'}`);
    console.log(`  - Unidad: ${inc.unidad || 'No indicada'}`);
    if (inc.dudas && inc.dudas.length > 0) {
      console.log(`  - Dudas:`);
      for (const d of inc.dudas) {
        console.log(`      * ${d}`);
      }
    }
  }

  if (extraccion.dudas && extraccion.dudas.length > 0) {
    console.log('\n  Dudas generales del correo:');
    for (const d of extraccion.dudas) {
      console.log(`    * ${d}`);
    }
  }

  const resultado = {
    correo: numero,
    id: correo.id || `correo-${numero}`,
    asunto,
    remitente,
    recibido: correo.receivedAt || correo.recibido || null,
    cuerpo_original: cuerpo,
    modelo,
    extraccion,
  };

  const carpetaSalida = path.join(
    __dirname,
    '..',
    'resultados',
    'extracciones-incidencias'
  );
  await fs.mkdir(carpetaSalida, { recursive: true });

  const nombreModelo = modelo.replace(/[^a-zA-Z0-9-]/g, '-');
  const rutaSalida = path.join(
    carpetaSalida,
    `correo-${numero}-${nombreModelo}.json`
  );

  await fs.writeFile(rutaSalida, JSON.stringify(resultado, null, 2), 'utf8');
  console.log(`\nGuardado en: ${rutaSalida}`);

  return resultado;
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error(
      'Falta OPENROUTER_API_KEY en las variables de entorno.\nEjecuta el script con: node --env-file=.env src/procesar-incidencias-reales.js'
    );
  }

  const rutaCorreos = path.join(
    __dirname,
    '..',
    'resultados',
    'correos-categorizados',
    'incidencias.json'
  );

  let correos;
  try {
    const contenido = await fs.readFile(rutaCorreos, 'utf8');
    correos = JSON.parse(contenido);
  } catch (error) {
    throw new Error(`No se ha podido leer ${rutaCorreos}: ${error.message}`);
  }

  if (!Array.isArray(correos) || correos.length === 0) {
    throw new Error(`El archivo ${rutaCorreos} no contiene una lista de correos válida.`);
  }

  const primerArg = process.argv[2];
  const segundoArg = process.argv[3];
  const procesarTodos = primerArg === '--todos' || primerArg === '--all' || primerArg === 'todos';

  let numeroCorreo = 1;
  let modelo = process.env.MODELO_EXTRACCION || 'openai/gpt-oss-120b';

  if (!procesarTodos) {
    if (primerArg && !isNaN(Number(primerArg))) {
      numeroCorreo = Number(primerArg);
      if (segundoArg) {
        modelo = segundoArg;
      }
    } else if (primerArg) {
      modelo = primerArg;
    }

    if (numeroCorreo < 1 || numeroCorreo > correos.length) {
      throw new Error(`Elige un número de correo entre 1 y ${correos.length}, o usa --todos.`);
    }

    await procesarCorreo(correos[numeroCorreo - 1], numeroCorreo, correos.length, modelo);
  } else {
    if (segundoArg) {
      modelo = segundoArg;
    }
    console.log(`Procesando los ${correos.length} correos de incidencias reales con el modelo ${modelo}...`);
    const resultados = [];
    for (let i = 0; i < correos.length; i++) {
      const res = await procesarCorreo(correos[i], i + 1, correos.length, modelo);
      resultados.push(res);
    }
    console.log(`\nFinalizado el procesamiento de ${resultados.length} correos de incidencias.`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nError: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  procesarCorreo,
  main,
};
