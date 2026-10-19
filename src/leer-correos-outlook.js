// Entrada principal para conectar Outlook con la clasificación y la extracción.
// La conexión real requiere configurar Microsoft y completar el inicio de sesión.


// Lee correos nuevos de Outlook, los clasifica y extrae los pedidos.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { PublicClientApplication } = require('@azure/msal-node');
const { clasificarCorreo } = require('./categorizar-correos');
const { main: extraerPedido } = require('./openrouter');

// Rutas locales: borradores, mensajes ya procesados y sesión de Microsoft.
const carpetaResultados = path.join(__dirname, '..', 'resultados', 'correos-outlook');
const archivoProcesados = path.join(__dirname, '..', 'resultados', 'correos-procesados.json');
const archivoCache = path.join(__dirname, '..', 'resultados', 'outlook-token-cache.json');
const graphUrl = 'https://graph.microsoft.com/v1.0';
const modeloExtraccion = process.env.MODELO_EXTRACCION || 'openai/gpt-oss-120b';

// Guarda los tokens de inicio de sesión para no pedir autorización cada vez.
const cachePlugin = {
  // Recupera la sesión guardada antes de que MSAL consulte los tokens.
  beforeCacheAccess: async (context) => {
    try {
      context.tokenCache.deserialize(await fs.readFile(archivoCache, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  },
  // Actualiza el archivo solo si Microsoft ha cambiado la sesión.
  afterCacheAccess: async (context) => {
    if (context.cacheHasChanged) {
      await fs.mkdir(path.dirname(archivoCache), { recursive: true });
      await fs.writeFile(archivoCache, context.tokenCache.serialize(), 'utf8');
    }
  },
};

// Obtiene el permiso de acceso al buzón. Intenta reutilizar la sesión primero.
async function obtenerToken(correoBuzon) {
  if (!process.env.OUTLOOK_CLIENT_ID) {
    throw new Error('Falta OUTLOOK_CLIENT_ID en el archivo .env. Consulta las instrucciones de configuración.');
  }

  // MSAL es la biblioteca que gestiona la autenticación con Microsoft.
  const aplicacion = new PublicClientApplication({
    auth: {
      clientId: process.env.OUTLOOK_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${process.env.OUTLOOK_TENANT_ID || 'organizations'}`,
    },
    cache: { cachePlugin },
  });
  const cuentas = await aplicacion.getTokenCache().getAllAccounts();
  const cuenta = cuentas.find((item) => item.username.toLowerCase() === correoBuzon.toLowerCase());

  if (cuenta) {
    try {
      const token = await aplicacion.acquireTokenSilent({
        account: cuenta,
        scopes: ['User.Read', 'Mail.Read'],
      });
      return token.accessToken;
    } catch {
      // Si ha caducado, solicitamos de nuevo el inicio de sesión.
    }
  }

  // Si no se pudo reutilizar la sesión, muestra instrucciones para entrar con un código.
  console.log('Inicia sesión con la cuenta de Outlook que quieres leer:');
  const token = await aplicacion.acquireTokenByDeviceCode({
    scopes: ['User.Read', 'Mail.Read'],
    deviceCodeCallback: (respuesta) => console.log(respuesta.message),
  });
  if (token.account?.username && token.account.username.toLowerCase() !== correoBuzon.toLowerCase()) {
    throw new Error(`Has iniciado sesión con ${token.account.username}, pero pediste ${correoBuzon}.`);
  }
  return token.accessToken;
}

// Consulta Microsoft Graph, la API que permite leer Outlook.
// El token acredita la sesión; Prefer solicita el cuerpo del correo como texto.
async function graphGet(url, token) {
  const respuesta = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Prefer: 'outlook.body-content-type="text"',
    },
  });
  if (!respuesta.ok) {
    throw new Error(`Microsoft Graph respondió HTTP ${respuesta.status}: ${await respuesta.text()}`);
  }
  return respuesta.json();
}

// Recuerda desde cuándo debe trabajar el programa para este buzón.
// Se crea una sola vez: reiniciar no cambia la fecha ni incluye correos antiguos.
async function obtenerFechaInicio(correoBuzon) {
  // Crea un identificador a partir del correo para que cada buzón tenga su archivo.
  // Pasarlo a minúsculas evita crear otro archivo por escribir la dirección con mayúsculas.
  const identificador = crypto.createHash('sha1')
    .update(correoBuzon.trim().toLowerCase()).digest('hex');
  const archivoInicio = path.join(__dirname, '..', 'resultados', `inicio-outlook-${identificador}.json`);

  try {
    // Si el programa ya se ejecutó, recupera su fecha de inicio guardada.
    const estado = JSON.parse(await fs.readFile(archivoInicio, 'utf8'));
    // Comprueba que la fecha se pueda interpretar antes de consultar Outlook.
    if (typeof estado.desde !== 'string' || !Number.isFinite(Date.parse(estado.desde))) {
      throw new Error(`La fecha de inicio no es válida en ${archivoInicio}.`);
    }
    return estado.desde; // Reutiliza la misma fecha aunque hayas reiniciado el programa.
  } catch (error) {
    // Solo creamos el archivo si no existe. Otros errores deben revisarse,
    // porque sustituir una fecha dañada podría dejar correos sin procesar.
    if (error.code !== 'ENOENT') throw error;
  }

  // Primera ejecución: toma la hora actual en UTC, un formato que entiende Graph.
  const desde = new Date().toISOString();
  // Crea la carpeta de resultados si todavía no existe.
  await fs.mkdir(path.dirname(archivoInicio), { recursive: true });
  try {
    // wx impide sobrescribir una fecha creada por otra ejecución simultánea.
    await fs.writeFile(archivoInicio, JSON.stringify({ desde }, null, 2), { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    // Si otra ejecución acaba de crear el archivo, lee la fecha que ya guardó.
    if (error.code === 'EEXIST') return obtenerFechaInicio(correoBuzon);
    throw error;
  }
  console.log(`Se recogerán correos recibidos desde ${desde}. La fecha queda guardada.`);
  return desde;
}

// Recupera los mensajes recibidos desde el primer arranque, estén leídos o no.
// Los que ya se procesaron se descartan después usando sus identificadores.
async function leerCorreosNuevos(token, desde) {
  const url = new URL(`${graphUrl}/me/mailFolders/inbox/messages`);
  // ge significa "mayor o igual": pide mensajes recibidos desde la fecha guardada.
  // Ya no se filtra por leído/no leído, por lo que abrir un correo no lo excluye.
  url.searchParams.set('$filter', `receivedDateTime ge ${desde}`);
  // Solicita solo los campos que usa el programa para reducir los datos descargados.
  url.searchParams.set('$select', 'id,subject,from,body,hasAttachments,receivedDateTime');
  // Cada página puede contener hasta 50 mensajes; el bucle también lee las demás.
  url.searchParams.set('$top', '50');

  const correos = [];
  let siguiente = url.toString();
  // Graph entrega páginas: nextLink indica dónde obtener la página siguiente.
  while (siguiente) {
    const pagina = await graphGet(siguiente, token);
    correos.push(...(pagina.value || []));
    siguiente = pagina['@odata.nextLink'];
  }
  return correos;
}

// Separa los PDF y el texto de los adjuntos; los formatos no admitidos generan dudas.
async function obtenerAdjuntos(correo, token) {
  if (!correo.hasAttachments) return { pdfs: [], texto: '', nombres: [], dudas: [] };
  const url = `${graphUrl}/me/messages/${encodeURIComponent(correo.id)}/attachments`;
  const datos = await graphGet(url, token);
  const resultado = { pdfs: [], texto: '', nombres: [], dudas: [] };

  for (const adjunto of datos.value || []) {
    // Omite archivos incrustados, como firmas, y adjuntos sin contenido descargable.
    if (adjunto.isInline || !adjunto.contentBytes) continue;
    resultado.nombres.push(adjunto.name || 'archivo sin nombre');
    // Graph entrega los bytes codificados en base64; Buffer recupera el archivo.
    const contenido = Buffer.from(adjunto.contentBytes, 'base64');
    const extension = path.extname(adjunto.name || '').toLowerCase();

    if (extension === '.pdf' || adjunto.contentType === 'application/pdf') {
      if (contenido.length > 15 * 1024 * 1024) {
        resultado.dudas.push(`El PDF ${adjunto.name} supera 15 MB y no se ha enviado al modelo.`);
      } else {
        resultado.pdfs.push({ nombre: adjunto.name || 'pedido.pdf', contenido });
      }
    } else if (['.txt', '.csv'].includes(extension)) {
      resultado.texto += `\n\nContenido del archivo ${adjunto.name}:\n${contenido.toString('utf8')}`;
    } else {
      resultado.dudas.push(`No se ha podido leer automáticamente el adjunto ${adjunto.name || '(sin nombre)'} (${adjunto.contentType || 'formato desconocido'}).`);
    }
  }
  return resultado;
}

// Lee los identificadores guardados para no repetir correos en revisiones posteriores.
// ENOENT significa que todavía no existe el archivo: se empieza con una lista vacía.
async function leerProcesados() {
  try {
    return JSON.parse(await fs.readFile(archivoProcesados, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

// Guarda un JSON por correo con su origen, categoría y extracción, si la hay.
async function guardarResultado(correo, categoria, adjuntos, extraccion) {
  await fs.mkdir(carpetaResultados, { recursive: true });
  const resultado = {
    id: correo.id,
    asunto: correo.subject || '',
    remitente: correo.from?.emailAddress?.address || '',
    // Conserva el cuerpo del correo para compararlo con el borrador al revisarlo.
    cuerpo_original: correo.body?.content || '',
    recibido: correo.receivedDateTime || null,
    categoría: categoria,
    adjuntos: adjuntos.nombres,
    // Añade la extracción únicamente cuando el correo se ha tratado como pedido.
    ...(extraccion ? { extraccion } : {}),
  };
  // Convierte el ID en un nombre de archivo estable; esto no cifra el contenido.
  const nombre = `${crypto.createHash('sha1').update(correo.id).digest('hex')}.json`;
  await fs.writeFile(path.join(carpetaResultados, nombre), JSON.stringify(resultado, null, 2), 'utf8');
}

// Coordina una revisión: entrar, leer, clasificar, extraer y guardar.
async function revisarBuzon(correoBuzon) {
  // Fija el inicio antes del login para incluir mensajes llegados durante la autenticación.
  const desde = await obtenerFechaInicio(correoBuzon);
  const token = await obtenerToken(correoBuzon);
  const procesados = await leerProcesados();
  const nuevos = await leerCorreosNuevos(token, desde);
  let cantidad = 0;

  for (const correo of nuevos) {
    if (procesados.includes(correo.id)) continue;
    const asunto = correo.subject || '(sin asunto)';
    console.log(`Procesando: ${asunto}`);

    try {
      const categoria = await clasificarCorreo({
        subject: correo.subject || '',
        from: correo.from?.emailAddress?.address || '',
        body: correo.body?.content || '',
      });
      let adjuntos = { pdfs: [], texto: '', nombres: [], dudas: [] };
      let extraccion;

      // Solo los pedidos pasan al extractor; el texto de TXT/CSV se une al correo.
      if (categoria === 'Pedidos') {
        adjuntos = await obtenerAdjuntos(correo, token);
        const texto = `Asunto: ${correo.subject || ''}\nRemitente: ${correo.from?.emailAddress?.address || ''}\n\n${correo.body?.content || ''}${adjuntos.texto}`;
        extraccion = await extraerPedido(texto, modeloExtraccion, adjuntos.pdfs);
        if (adjuntos.dudas.length) extraccion.dudas.push(...adjuntos.dudas);
        if (adjuntos.nombres.length && adjuntos.pdfs.length === 0 && !adjuntos.texto) {
          extraccion.dudas.push('El pedido puede estar en un adjunto que este programa no puede leer todavía.');
        }
      }

      // Guarda primero el resultado y después registra el mensaje como procesado.
      await guardarResultado(correo, categoria, adjuntos, extraccion);
      procesados.push(correo.id);
      await fs.mkdir(path.dirname(archivoProcesados), { recursive: true });
      await fs.writeFile(archivoProcesados, JSON.stringify(procesados, null, 2), 'utf8');
      cantidad += 1;
      console.log(`Guardado (${categoria}).`);
    } catch (error) {
      // Si falla, no guardamos el ID como procesado: se intentará en la siguiente revisión.
      console.error(`Error con "${asunto}": ${error.message}`);
    }
  }
  console.log(`Revisión terminada. Correos procesados: ${cantidad}.`);
}

// Lee las opciones de ejecución y decide si revisar una vez o repetir cada minuto.
async function main() {
  // Usa el correo indicado como argumento o, si falta, OUTLOOK_EMAIL.
  const correoBuzon = process.argv.slice(2).find((argumento) => !argumento.startsWith('--'))
    || process.env.OUTLOOK_EMAIL;
  if (!correoBuzon) {
    throw new Error('Indica el correo: node --env-file=.env src/leer-correos-outlook.js usuario@empresa.com');
  }
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('Falta OPENROUTER_API_KEY en .env.');
  }

  const soloUnaVez = process.argv.includes('--once');
  do {
    await revisarBuzon(correoBuzon);
    if (!soloUnaVez) {
      console.log('Esperando un minuto para revisar otra vez...');
      await new Promise((resolver) => setTimeout(resolver, 60_000));
    }
  } while (!soloUnaVez);
}

// Ejecuta main solo al lanzar este archivo, no cuando otro archivo lo importa.
if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

// Permite que otros módulos llamen a una revisión del buzón.
module.exports = { revisarBuzon };
