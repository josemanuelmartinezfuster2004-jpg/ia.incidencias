// Módulos para leer el archivo de pedidos y preparar rutas de salida.
const fs = require('node:fs/promises');
const path = require('node:path');
// Función que manda el correo al modelo y devuelve los productos y dudas.
const { main: extraerPedido } = require('./openrouter');

// Extrae los productos de un correo concreto del archivo pedidos.json.
async function main() {
  // Este archivo lo genera categorizar-correos.js dentro de resultados.
  const rutaCorreos = path.join(
    __dirname,
    '..',
    'resultados',
    'correos-categorizados',
    'pedidos.json'
  );

  // Uso: node src/extraccion-pedidos.js [número-de-correo] [modelo].
  // El número empieza en 1; si no se indica, se procesa el primer correo.
  const numeroCorreo = Number(process.argv[2] || 1);
  const modelo = process.argv[3] || 'openai/gpt-oss-120b';
  const textoCorreos = await fs.readFile(rutaCorreos, 'utf8');
  const correos = JSON.parse(textoCorreos);

  // Comprueba que el JSON contenga una lista y que el número solicitado exista.
  if (!Array.isArray(correos)) {
    throw new Error('pedidos.json debe contener una lista de correos.');
  }

  if (numeroCorreo < 1 || numeroCorreo > correos.length) {
    throw new Error(`Elige un número de correo entre 1 y ${correos.length}.`);
  }

  // Convierte los campos del mensaje en texto para enviarlos al extractor.
  const correo = correos[numeroCorreo - 1];
  const asunto = correo.subject || correo.asunto || '';
  const remitente = correo.from || correo.remitente || '';
  const cuerpo = correo.body || correo.contenido || correo.text || '';
  const textoCorreo = `Asunto: ${asunto}\nRemitente: ${remitente}\n\n${cuerpo}`;

  console.log(`Correo ${numeroCorreo}/${correos.length}: ${asunto}`);
  const pedido = await extraerPedido(textoCorreo, modelo);

  // Advierte si el mensaje menciona un adjunto pero la extracción no encontró
  // productos ni dudas: el archivo adjunto podría no estar en pedidos.json.
  if (
    pedido.productos?.length === 0
    && pedido.dudas?.length === 0
    && /adjunt/i.test(cuerpo)
  ) {
    pedido.dudas.push(
      'El correo indica que el pedido está en un documento adjunto, pero ese archivo no está incluido en pedidos.json.'
    );
  }

  // Guarda la extracción junto con los datos necesarios para identificar
  // el correo y el modelo que se utilizó.
  const resultado = {
    correo: numeroCorreo, // Posición del mensaje dentro del archivo de entrada.
    asunto, // Título del mensaje.
    remitente, // Persona o dirección que envió el correo.
    // Conserva el cuerpo del correo para compararlo con el borrador al revisarlo.
    cuerpo_original: cuerpo,
    modelo, // Modelo solicitado para realizar la extracción.
    extraccion: pedido, // Borrador con productos y dudas pendientes.
  };
  const carpetaSalida = path.join(__dirname, '..', 'resultados', 'extracciones');
  await fs.mkdir(carpetaSalida, { recursive: true });

  // Sanitiza el nombre del modelo para que pueda formar parte del nombre
  // del archivo en todos los sistemas operativos.
  const nombreModelo = modelo.replace(/[^a-zA-Z0-9-]/g, '-');
  const rutaSalida = path.join(
    carpetaSalida,
    `correo-${numeroCorreo}-${nombreModelo}.json`
  );
  // JSON.stringify convierte el objeto en texto; el 2 añade sangría para leerlo mejor.
  await fs.writeFile(rutaSalida, JSON.stringify(resultado, null, 2), 'utf8');
  console.log(`Resultado guardado en: ${rutaSalida}`);
}

// Inicia el programa y muestra el error si falla la lectura o la extracción.
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
