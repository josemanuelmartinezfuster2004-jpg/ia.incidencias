// Comprueba la estructura del borrador, no si está listo para un albarán.
// Los datos desconocidos pueden ser null y las dudas quedan para revisión humana.
// No rellena campos, no inventa valores y no modifica la respuesta del modelo.
function validarBorrador(pedido) {
  if (!pedido || typeof pedido !== 'object' || Array.isArray(pedido)) {
    throw new Error('Borrador inválido: se esperaba un objeto.');
  }

  if (!Array.isArray(pedido.productos)) {
    throw new Error('Borrador inválido: productos debe ser una lista.');
  }

  if (!Array.isArray(pedido.dudas)
    || !pedido.dudas.every((duda) => typeof duda === 'string')) {
    throw new Error('Borrador inválido: dudas debe ser una lista de textos.');
  }

  // Una lista vacía es válida: por ejemplo, si falta el adjunto del pedido.
  for (const [indice, producto] of pedido.productos.entries()) {
    const ubicacion = `Borrador inválido: producto ${indice + 1}`;
    if (!producto || typeof producto !== 'object' || Array.isArray(producto)) {
      throw new Error(`${ubicacion} debe ser un objeto.`);
    }

    // Cada campo debe existir, aunque su valor sea null por falta de información.
    for (const campo of ['nombre', 'referencia', 'codigo_articulo', 'unidad']) {
      if (producto[campo] !== null && typeof producto[campo] !== 'string') {
        throw new Error(`${ubicacion}, ${campo} debe ser texto o null.`);
      }
    }

    if (producto.cantidad !== null
      && (typeof producto.cantidad !== 'number' || !Number.isFinite(producto.cantidad))) {
      throw new Error(`${ubicacion}, cantidad debe ser un número válido o null.`);
    }
  }
}

// Envía el cuerpo del correo (y opcionalmente los PDF adjuntos) a OpenRouter
// para obtener una lista estructurada de productos y preguntas pendientes.
async function main(correo, modelo = 'openai/gpt-oss-120b', archivosPdf = []) {
  // El formato multimodal de OpenRouter recibe el texto y cada PDF como partes
  // del contenido del mensaje del usuario.
  const inicio = Date.now();
  const contenidoUsuario = [{ type: 'text', text: correo }];
  for (const archivo of archivosPdf) {
    contenidoUsuario.push({
      type: 'file',
      file: {
        filename: archivo.nombre,
        file_data: `data:application/pdf;base64,${archivo.contenido.toString('base64')}`,
      },
    });
  }

  // Construye la solicitud: modelo, instrucciones de extracción y formato JSON.
  // El plugin de análisis de PDF solo se activa cuando hay archivos adjuntos.
  // fetch envía la petición por Internet. La clave se lee de la configuración,
  // y el cuerpo del mensaje y los PDF se comparten con el servicio de IA.
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelo, max_tokens: 8000,
      messages: [
        {
          role: 'system',
          content: 'Extrae del correo todos los productos solicitados. No inventes datos ni deduzcas cantidades, unidades ni códigos. Para cada producto devuelve nombre, referencia, codigo_articulo, cantidad y unidad. El nombre debe contener solo el nombre y la descripción del producto, sin los códigos ni la cantidad del pedido. Si aparecen columnas "Referencia" y "Artículo", copia sus códigos en "referencia" y "codigo_articulo", respectivamente. Devuelve los códigos como texto para conservar ceros iniciales; si un código no aparece, usa null. La cantidad debe ser un número o null si no se indica. La unidad debe ser texto o null si no se indica claramente (por ejemplo: cajas, kg, bolsas o unidades). Si falta la cantidad, añade una pregunta concreta en "dudas" para pedirla. Si falta la unidad o no queda claro qué significa la cantidad, también añade una pregunta concreta en "dudas"; no supongas que "3 merluzas" significa 3 piezas ni que una cantidad sin unidad corresponde a kg, cajas u otra medida. Si el correo corrige o cancela una cantidad, conserva solo la instrucción final vigente. Si hay productos repetidos, suma las cantidades solo cuando sus unidades coincidan claramente; si no, mantenlos separados y explica la duda. Si el correo indica que el pedido está en un adjunto, pero el contenido del adjunto no está incluido, no inventes productos y explica en "dudas" que falta el adjunto. Devuelve únicamente un JSON válido con esta estructura: {"productos":[{"nombre":"merluza fresca","referencia":"09040500","codigo_articulo":"000344","cantidad":3,"unidad":"cajas"}],"dudas":[]}.',
        },
        {
          role: 'user',
          content: contenidoUsuario,
        },
      ],
      response_format: { type: 'json_object' },
      ...(archivosPdf.length > 0 ? {
        plugins: [{ id: 'file-parser', pdf: { engine: 'cloudflare-ai' } }],
      } : {}),
    }),
  });

  // Si el servidor devuelve un error HTTP, incluye el detalle para facilitar
  // el diagnóstico (por ejemplo, credenciales, modelo o límites de uso).
  if (!response.ok) {
    const detalle = await response.text();
    throw new Error(
      `OpenRouter respondió con el estado ${response.status}: ${detalle}`
    );
  }

  // Convierte la respuesta JSON del modelo en un objeto JavaScript.
  const data = await response.json();
  // JSON.parse convierte el texto de la respuesta en un objeto que JavaScript puede usar.
  const pedido = JSON.parse(data.choices[0].message.content);
  // Un borrador incompleto sigue siendo válido. Solo se rechaza una estructura
  // que impediría mostrarlo o editarlo; esta comprobación no aprueba el albarán.
  validarBorrador(pedido);

  // Informa duración, uso de tokens y modelo efectivo para poder revisar
  // el coste y el comportamiento de la petición.
  const tiempoMs = Date.now() - inicio;
  const uso = data.usage ?? {};
  console.log(`Tiempo total de respuesta: ${(tiempoMs / 1000).toFixed(2)} segundos`);
  console.log(`Tokens de entrada: ${uso.prompt_tokens ?? 'no disponible'}`);
  console.log(`Tokens de salida: ${uso.completion_tokens ?? 'no disponible'}`);
  console.log(`Tokens totales: ${uso.total_tokens ?? 'no disponible'}`);
  console.log(`Modelo usado: ${data.model ?? 'no disponible'}`);

  // Devuelve el borrador al script que lo pidió; el guardado se hace allí.
  return pedido;
}

// Permite que otros scripts usen el extractor sin ejecutar nada al importarlo.
module.exports = { main };
