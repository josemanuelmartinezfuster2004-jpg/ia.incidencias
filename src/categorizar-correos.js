// Módulos de Node.js para leer/escribir archivos y construir rutas válidas
// en Windows, macOS y Linux.
// Este archivo sirve tanto para clasificar un correo como para procesar un JSON completo.
const fs = require('node:fs/promises');
const path = require('node:path');

// Categorías que puede devolver el modelo. Se usan también para comprobar
// que la respuesta sea válida y para crear un archivo por categoría.
const categorias = [
  'Pedidos',
  'Facturación',
  'Incidencias',
  'Proveedores',
  'Publicidad',
  'Notificaciones',
  'Modificaciones',
  'Pagos',
  'Logística',
  'Comercial',
];

// Nombre de archivo asociado a cada categoría (sin tildes ni espacios).
const nombresArchivo = {
  Pedidos: 'pedidos',
  'Facturación': 'facturacion',
  Incidencias: 'incidencias',
  Proveedores: 'proveedores',
  Publicidad: 'publicidad',
  Notificaciones: 'notificaciones',
  Modificaciones: 'modificaciones',
  Pagos: 'pagos',
  'Logística': 'logistica',
  Comercial: 'comercial',
};

// Instrucciones enviadas al modelo para que use siempre las mismas categorías
// y responda únicamente con el nombre de una de ellas.
const prompt = `Clasifica el correo según el asunto, el remitente y el contenido.
Elige una sola categoría:
Pedidos: nuevos pedidos y solicitudes de productos, incluidos los pedidos que llegan mediante avisos automáticos de plataformas.
Facturación: facturas, albaranes, abonos y consultas contables.
Incidencias: reclamaciones, errores, productos defectuosos o faltantes.
Proveedores: tarifas, catálogos y ofertas de proveedores.
Publicidad: anuncios, promociones, spam y posibles fraudes.
Notificaciones: avisos automáticos e informativos que no incluyan un pedido, una factura u otra operación comercial.
Modificaciones: cambios o cancelaciones de pedidos existentes.
Pagos: transferencias, cobros, vencimientos y deudas.
Logística: transporte, entregas y planificación de distribución.
Comercial: presupuestos, consultas y otras comunicaciones comerciales.
Devuelve solo el nombre de la categoría.`;

// Envía un correo a OpenRouter y devuelve su categoría. Acepta varios nombres
// de campo para poder trabajar con correos de distintas fuentes o formatos.
async function clasificarCorreo(correo) {
  // ?. permite consultar un campo anidado aunque falte su objeto padre.
  // || prueba alternativas cuando el valor anterior está vacío o no existe.
  const asunto = correo.asunto || correo.subject || correo.tema || '';
  const remitente = correo.remitente || correo.from?.emailAddress?.address || correo.from || correo.sender || correo.de || '';
  const contenido = correo.contenido || correo.body?.content || correo.body || correo.text || correo.texto || correo.mensaje || '';

  let ultimoError = 'respuesta vacía o categoría no válida';

  // Se permiten hasta tres intentos: los errores transitorios y las respuestas
  // mal formadas pueden corregirse al volver a consultar el servicio.
  for (let intento = 1; intento <= 3; intento += 1) {
    try {
      // Solicitud de clasificación al modelo configurado en OpenRouter.
      const respuesta = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'qwen/qwen3.8-27b',
          max_tokens: 30,
          reasoning_effort: 'none',
          temperature: 0,
          messages: [
            { role: 'system', content: prompt },
            {
              role: 'user',
              content: `Asunto: ${asunto}\nRemitente: ${remitente}\nContenido: ${contenido}`,
            },
          ],
        }),
      });

      if (!respuesta.ok) {
        const detalle = await respuesta.text();
        // Un error 402 suele indicar que la cuenta no tiene crédito; repetirlo
        // no ayuda, así que se sale del ciclo de reintentos.
        if (respuesta.status === 402) {
          try {
            const errorApi = JSON.parse(detalle);
            ultimoError = `HTTP 402: ${errorApi.error?.message || 'créditos insuficientes'}`;
          } catch {
            ultimoError = 'HTTP 402: créditos insuficientes';
          }
          break;
        }
        ultimoError = `HTTP ${respuesta.status}: ${detalle}`;
      } else {
        const datos = await respuesta.json();
        const texto = datos.choices?.[0]?.message?.content;
        // La API puede añadir puntuación; se quita antes de validar el nombre.
        const categoria = typeof texto === 'string'
          ? texto.trim().replace(/[.!]+$/, '')
          : '';

        if (categorias.includes(categoria)) {
          return categoria;
        }

        ultimoError = `respuesta no válida (${JSON.stringify(texto ?? datos.error ?? 'sin texto')})`;
      }
    } catch (error) {
      ultimoError = error.message;
    }

    // Espera creciente entre intentos para no saturar el servicio.
    if (intento < 3) {
      const espera = intento * 3000;
      console.log(`Reintentando correo "${asunto}" en ${espera / 1000} segundos...`);
      await new Promise((resolver) => setTimeout(resolver, espera));
    }
  }

  throw new Error(`No se pudo clasificar "${asunto}" después de 3 intentos. Último error: ${ultimoError}`);
}

// Convierte saltos de línea, tabuladores y espacios repetidos en espacios
// simples para que el contenido del correo quede más legible en el resultado.
function limpiarTexto(texto) {
  return texto.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

// Programa principal: lee un JSON de correos, los clasifica por grupos y
// guarda un JSON independiente para cada categoría.
async function main() {
  // Argumentos: ruta del JSON de entrada y carpeta de resultados.
  const archivoEntrada = process.argv[2];
  const carpetaSalida = process.argv[3];

  if (!archivoEntrada || !carpetaSalida) {
    console.log('Uso: node src/categorizar-correos.js entrada.json carpeta-salida');
    return;
  }

  // Lee la clave guardada en .env si no está definida en el terminal.
  // Permite ejecutar el script sin --env-file: carga la clave desde .env
  // solo cuando el proceso aún no tiene OPENROUTER_API_KEY.
  if (!process.env.OPENROUTER_API_KEY) {
    const archivoEnv = path.join(__dirname, '..', '.env');
    const env = await fs.readFile(archivoEnv, 'utf8');
    const linea = env.split('\n').find((texto) => texto.startsWith('OPENROUTER_API_KEY='));
    process.env.OPENROUTER_API_KEY = linea?.split('=').slice(1).join('=').trim();
  }

  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('No se encontró OPENROUTER_API_KEY en el archivo .env');
  }

  // Acepta una lista JSON directamente o una lista dentro de correos, emails
  // o messages para adaptarse a distintas exportaciones.
  const entrada = JSON.parse(await fs.readFile(archivoEntrada, 'utf8'));
  const nombreLista = ['correos', 'emails', 'messages'].find((nombre) =>
    Array.isArray(entrada[nombre])
  );
  const correos = Array.isArray(entrada) ? entrada : entrada[nombreLista];

  if (!Array.isArray(correos)) {
    throw new Error('El JSON debe contener una lista de correos o una clave "correos".');
  }

  // El archivo de progreso permite continuar tras una interrupción sin volver
  // a pagar por correos ya clasificados. Se reutiliza solo si coincide la lista
  // de identificadores y todas las categorías guardadas son válidas.
  const rutaCarpetaSalida = path.resolve(carpetaSalida);
  const archivoProgreso = `${rutaCarpetaSalida}.progreso.json`;
  await fs.mkdir(rutaCarpetaSalida, { recursive: true });
  const ids = correos.map((correo) => correo.id || correo.messageId || correo.subject || '');
  let categoriasGuardadas = [];

  try {
    const progreso = JSON.parse(await fs.readFile(archivoProgreso, 'utf8'));
    const mismoArchivo = JSON.stringify(progreso.ids) === JSON.stringify(ids);
    const categoriasValidas = Array.isArray(progreso.categorias)
      && progreso.categorias.every((categoria) => categorias.includes(categoria));

    if (mismoArchivo && categoriasValidas) {
      categoriasGuardadas = progreso.categorias;
      console.log(`Continuando desde el correo ${categoriasGuardadas.length + 1}...`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  // Procesa cinco correos en paralelo por tanda y guarda el progreso al final
  // de cada tanda. Así limita la concurrencia y reduce el trabajo perdido.
  for (let i = categoriasGuardadas.length; i < correos.length; i += 5) {
    const grupo = correos.slice(i, i + 5);
    // Promise.all espera a que terminen las cinco consultas; si una falla, la tanda falla.
    const categoriasGrupo = await Promise.all(grupo.map(clasificarCorreo));

    for (let j = 0; j < grupo.length; j += 1) {
      categoriasGuardadas.push(categoriasGrupo[j]);
      console.log(`Correo ${i + j + 1}/${correos.length}: ${categoriasGrupo[j]}`);
    }

    await fs.writeFile(
      archivoProgreso,
      JSON.stringify({ ids, categorias: categoriasGuardadas }, null, 2),
      'utf8'
    );
  }

  // Añade la categoría a cada correo y normaliza el campo body si es texto.
  const resultado = correos.map((correo, i) => {
    const correoFinal = { ...correo, categoría: categoriasGuardadas[i] };
    if (typeof correoFinal.body === 'string') {
      correoFinal.body = limpiarTexto(correoFinal.body);
    }
    return correoFinal;
  });

  // Crea un archivo por categoría, incluso si esa categoría no tuvo correos.
  for (const categoria of categorias) {
    const correosCategoria = resultado.filter(
      (correo) => correo.categoría === categoria
    );
    const archivoCategoria = path.join(
      rutaCarpetaSalida,
      `${nombresArchivo[categoria]}.json`
    );

    await fs.writeFile(archivoCategoria, JSON.stringify(correosCategoria, null, 2), 'utf8');
    console.log(`${categoria}: ${correosCategoria.length} correos`);
  }

  await fs.unlink(archivoProgreso).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  console.log(`Archivos separados guardados en: ${rutaCarpetaSalida}`);
}

// Evita ejecutar el proceso principal cuando este archivo se importa desde
// otro módulo; en ese caso solo se exportan las funciones y datos indicados.
if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

// Interfaz pública para que otros scripts puedan reutilizar la clasificación.
module.exports = { clasificarCorreo, categorias };
