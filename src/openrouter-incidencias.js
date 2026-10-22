
const fs = require('node:fs/promises');
const path = require('node:path');

const rutaProductosTxt = path.join(
  __dirname,
  '..',
  'datos',
  'productos-oficiales.txt'
);

const rutaProductosJson = path.join(
  __dirname,
  '..',
  'pruebas',
  'productos.json'
);

const rutaEquivalencias = path.join(
  __dirname,
  '..',
  'datos',
  'equivalencias-productos.json'
);

async function cargarProductosOficiales() {
  try {
    const contenido = await fs.readFile(rutaProductosTxt, 'utf8');
    const productos = contenido
      .split(/\r?\n/)
      .map((producto) => producto.trim())
      .filter(Boolean);

    if (productos.length > 0) {
      return [...new Set(productos)];
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  try {
    const contenidoJson = await fs.readFile(rutaProductosJson, 'utf8');
    const productos = JSON.parse(contenidoJson);

    if (Array.isArray(productos)) {
      const nombres = productos
        .map((producto) =>
          typeof producto === 'string' ? producto : producto.nombreOficial
        )
        .filter(Boolean)
        .map((nombre) => nombre.trim());

      if (nombres.length > 0) {
        return [...new Set(nombres)];
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  throw new Error(`No se encontró el catálogo oficial: ${rutaProductosTxt}`);
}

function validarTexto(valor) {
  if (typeof valor !== 'string') {
    return null;
  }

  const texto = valor.trim();
  return texto || null;
}

function normalizarNombre(valor) {
  return validarTexto(valor)
    ?.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim() || null;
}

function esCoincidenciaExacta(nombre1, nombre2) {
  if (!nombre1 || !nombre2) return false;
  return normalizarNombre(nombre1) === normalizarNombre(nombre2);
}

async function cargarEquivalenciasProductos(productosOficiales) {
  const contenido = await fs.readFile(rutaEquivalencias, 'utf8');
  const equivalencias = JSON.parse(contenido);

  if (!Array.isArray(equivalencias)) {
    throw new Error(
      'El archivo de equivalencias debe contener una lista.'
    );
  }

  const resultado = new Map();

  for (const equivalencia of equivalencias) {
    const nombreCorreo = validarTexto(equivalencia?.nombre_correo);
    const productoOficial = validarTexto(equivalencia?.producto_oficial);

    if (!nombreCorreo || !productoOficial) {
      throw new Error('Hay una equivalencia de producto incompleta.');
    }

    if (!productosOficiales.includes(productoOficial)) {
      throw new Error(
        `El producto oficial de la equivalencia no existe en el catálogo: ${productoOficial}`
      );
    }

    const clave = normalizarNombre(nombreCorreo);

    if (resultado.has(clave)) {
      throw new Error(
        `Hay una equivalencia duplicada para: ${nombreCorreo}`
      );
    }

    resultado.set(clave, productoOficial);
  }

  return resultado;
}

function validarCantidad(valor) {
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    return valor;
  }

  if (typeof valor === 'string' && valor.trim()) {
    const numero = Number(valor.replace(',', '.'));

    if (Number.isFinite(numero)) {
      return numero;
    }
  }

  return null;
}

function validarCantidadDetalle(detalle) {
  if (!detalle || typeof detalle !== 'object' || Array.isArray(detalle)) {
    return null;
  }

  return {
    tipo: validarTexto(detalle.tipo),
    cantidad: validarCantidad(detalle.cantidad),
    unidad: validarTexto(detalle.unidad),
    producto: validarTexto(detalle.producto),
    dudas: Array.isArray(detalle.dudas)
      ? detalle.dudas.map(validarTexto).filter(Boolean)
      : []
  };
}

function validarDetalleIncidencia(
  incidencia,
  productosOficiales,
  equivalencias,
  albaranGeneral,
  pedidoGeneral
) {
  const datos = incidencia && typeof incidencia === 'object'
    ? incidencia
    : {};

  const productoMencionado = validarTexto(
    datos.producto_mencionado ?? datos.producto_cliente
  );

  const productoEquivalente = productoMencionado
    ? equivalencias.get(normalizarNombre(productoMencionado)) || null
    : null;

  const productoSolicitado = validarTexto(datos.producto_solicitado);
  const productoRecibido = validarTexto(datos.producto_recibido);

  let solicitaDevolucion = null;

  if (typeof datos.solicita_devolucion === 'boolean') {
    solicitaDevolucion = datos.solicita_devolucion;
  } else if (
    datos.solicita_devolucion !== null &&
    datos.solicita_devolucion !== undefined
  ) {
    throw new Error('solicita_devolucion debe ser true, false o null.');
  }

  let solicitaAbono = null;

  if (typeof datos.solicita_abono === 'boolean') {
    solicitaAbono = datos.solicita_abono;
  } else if (
    datos.solicita_abono !== null &&
    datos.solicita_abono !== undefined
  ) {
    throw new Error('solicita_abono debe ser true, false o null.');
  }

   const dudasOriginales = Array.isArray(datos.dudas)
    ? datos.dudas.map(validarTexto).filter(Boolean)
    : [];

  const dudas = productoEquivalente !== null
    ? dudasOriginales.filter(
        (duda) => !/confirmar referencia oficial|confirmar.*producto|producto.*no coincide exactamente/i.test(duda)
      )
    : dudasOriginales;

  const candidatosEntrada = Array.isArray(datos.candidatos)
    ? datos.candidatos
    : Array.isArray(datos.candidatos_oficiales)
      ? datos.candidatos_oficiales
      : [];

  let candidatos = candidatosEntrada
    .filter((candidato) => typeof candidato === 'string' && candidato.trim())
    .map((candidato) => candidato.trim())
    .filter((candidato) => productosOficiales.includes(candidato))
    .filter((candidato, index, self) => self.indexOf(candidato) === index);

  let productoOficial = validarTexto(datos.producto_oficial);

  if (productoMencionado !== null) {
    if (productosOficiales.length === 0) {
      productoOficial = null;
      candidatos = [];
      dudas.push(
        'No se ha encontrado el listado de productos oficiales o está vacío. No se puede verificar el nombre oficial.'
      );
    } else {
      if (productoOficial !== null && !productosOficiales.includes(productoOficial)) {
        productoOficial = null;
        dudas.push(
          'El modelo devolvió un nombre oficial que no aparece exactamente en el listado de productos.'
        );
      }

      if (productoEquivalente !== null) {
        productoOficial = productoEquivalente;
        candidatos = [];
      }

      if (
        productoOficial !== null &&
        !esCoincidenciaExacta(productoMencionado, productoOficial) &&
        productoEquivalente !== productoOficial
      ) {
        if (!candidatos.includes(productoOficial)) {
          candidatos.push(productoOficial);
        }

        const noCoincidente = productoOficial;
        productoOficial = null;

        const textoDuda = `El producto mencionado ("${productoMencionado}") no coincide exactamente con el producto oficial ("${noCoincidente}"). Queda pendiente de revisión.`;

        if (
          !dudas.some(
            (duda) =>
              duda.includes(noCoincidente) ||
              duda.includes('no coincide exactamente')
          )
        ) {
          dudas.push(textoDuda);
        }
      }

      if (productoOficial === null && candidatos.length === 1) {
        if (esCoincidenciaExacta(productoMencionado, candidatos[0])) {
          productoOficial = candidatos[0];
        } else {
          const textoDuda = `El candidato ("${candidatos[0]}") no coincide exactamente con el producto mencionado ("${productoMencionado}"). Queda pendiente de revisión.`;

          if (
            !dudas.some(
              (duda) =>
                duda.includes(candidatos[0]) ||
                duda.includes('no coincide exactamente')
            )
          ) {
            dudas.push(textoDuda);
          }
        }
      }

      if (candidatos.length > 1) {
        productoOficial = null;
        dudas.push(
          'Hay varios productos oficiales posibles. Es necesario confirmar cuál corresponde al producto reclamado.'
        );
      }

      if (productoOficial === null && candidatos.length === 0) {
        const dudaExiste = dudas.some((duda) =>
          /cat[aá]logo|oficial|listado/i.test(duda)
        );

        if (!dudaExiste) {
          dudas.push(
            `El producto '${productoMencionado}' no aparece en el catálogo oficial de la empresa.`
          );
        }
      }
    }
  } else {
    productoOficial = null;
    candidatos = [];
  }

  const cantidadesDetalle = Array.isArray(datos.cantidades_detalle)
    ? datos.cantidades_detalle
        .map(validarCantidadDetalle)
        .filter(Boolean)
    : [];

   let cantidad = validarCantidad(datos.cantidad);
  let unidad = validarTexto(datos.unidad);

  if (cantidadesDetalle.length > 0) {
    const faltantes = cantidadesDetalle.filter(
      (item) =>
        item &&
        normalizarNombre(item.tipo) === 'faltante' &&
        item.cantidad !== null
    );

    if (faltantes.length === 1) {
      cantidad = faltantes[0].cantidad;
      unidad = faltantes[0].unidad || unidad;
    } else if (faltantes.length > 1) {
      const faltanteCajas = faltantes.find(
        (item) => normalizarNombre(item.unidad) === 'cajas'
      );

      if (faltanteCajas) {
        cantidad = faltanteCajas.cantidad;
        unidad = faltanteCajas.unidad;
      }
    }
  }

  const pedidoIncidencia = validarTexto(datos.pedido) || pedidoGeneral || null;
  const albaranIncidencia = validarTexto(datos.albaran) || albaranGeneral || null;

  const referenciaProducto = validarTexto(
    datos.referencia_producto ??
    datos.referencia ??
    datos.codigo_producto ??
    datos.codigo_articulo
  );

  return {
    pedido: pedidoIncidencia,
    numero_pedido: pedidoIncidencia,
    albaran: albaranIncidencia,
    referencia_producto: referenciaProducto,
    referencia: referenciaProducto,
    tipo_incidencia: validarTexto(datos.tipo_incidencia),
    solicita_devolucion: solicitaDevolucion,
    solicita_abono: solicitaAbono,
    producto_mencionado: productoMencionado,
    producto_cliente: productoMencionado,
    producto_solicitado: productoSolicitado,
    producto_recibido: productoRecibido,
    producto_oficial: productoOficial,
    candidatos,
    candidatos_oficiales: candidatos,
    cantidad,
    unidad,
    cantidades_detalle: cantidadesDetalle,
    referencia_temporal: validarTexto(datos.referencia_temporal),
    motivo: validarTexto(datos.motivo),
    dudas
  };
}

function validarIncidencias(
  resultado,
  productosOficiales = [],
  equivalencias = new Map()
) {
  if (
    !resultado ||
    typeof resultado !== 'object' ||
    Array.isArray(resultado)
  ) {
    throw new Error('La respuesta de incidencias no es un objeto válido.');
  }

  if (!Array.isArray(resultado.incidencias)) {
    throw new Error(
      'La respuesta debe contener una propiedad "incidencias" que sea una lista.'
    );
  }

  const pedidoGeneral = validarTexto(resultado.pedido);
  const albaranGeneral = validarTexto(resultado.albaran);

  resultado.pedido = pedidoGeneral;
  resultado.numero_pedido = pedidoGeneral;
  resultado.albaran = albaranGeneral;

  resultado.incidencias = resultado.incidencias.map((incidencia) =>
    validarDetalleIncidencia(
      incidencia,
      productosOficiales,
      equivalencias,
      albaranGeneral,
      pedidoGeneral
    )
  );

  resultado.dudas = Array.isArray(resultado.dudas)
    ? resultado.dudas.map(validarTexto).filter(Boolean)
    : [];

  return resultado;
}

function validarIncidencia(
  resultado,
  productosOficiales = [],
  equivalencias = new Map()
) {
  if (
    !resultado ||
    typeof resultado !== 'object' ||
    Array.isArray(resultado)
  ) {
    throw new Error('La respuesta de incidencias no es un objeto válido.');
  }

  if (Array.isArray(resultado.incidencias)) {
    return validarIncidencias(
      resultado,
      productosOficiales,
      equivalencias
    );
  }

  const adaptado = {
    pedido: resultado.pedido || null,
    albaran: resultado.albaran || null,
    incidencias: [resultado],
    dudas: Array.isArray(resultado.dudas) ? [...resultado.dudas] : []
  };

  return validarIncidencias(adaptado, productosOficiales, equivalencias);
}

async function main(
  correo,
  modelo = 'openai/gpt-oss-120b',
  archivosPdf = []
) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('Falta la variable OPENROUTER_API_KEY en el archivo .env.');
  }

  let textoCorreo = '';

  if (typeof correo === 'string') {
    textoCorreo = correo;
  } else if (correo && typeof correo === 'object') {
    textoCorreo = [
      `Asunto: ${validarTexto(correo.asunto ?? correo.subject) || 'Sin asunto'}`,
      `Remitente: ${validarTexto(correo.remitente ?? correo.from) || 'Desconocido'}`,
      '',
      validarTexto(correo.cuerpo ?? correo.body ?? correo.cuerpo_original) || ''
    ].join('\n').trim();
  } else {
    throw new Error('Debes proporcionar un correo válido.');
  }

  const productosOficiales = await cargarProductosOficiales();

  if (productosOficiales.length === 0) {
    throw new Error('El catálogo oficial de productos está vacío.');
  }

  const equivalencias = await cargarEquivalenciasProductos(productosOficiales);

  const instrucciones = `
Eres un sistema especializado en extraer incidencias de correos comerciales de una empresa de alimentación.

Debes responder exclusivamente con un objeto JSON válido, sin Markdown ni explicaciones fuera del JSON.
La respuesta final debe contener únicamente el objeto JSON solicitado.
No incluyas campos como "analysis", "reasoning", "thoughts" ni explicaciones sobre cómo has llegado a la respuesta.
No escribas el análisis en inglés ni en ningún otro idioma.
La propiedad "incidencias" debe existir siempre y su valor debe ser una lista, aunque esté vacía.
No omitas campos de la estructura indicada: utiliza null cuando no haya información y [] cuando una lista no tenga elementos.
Antes de responder, comprueba que el JSON contiene la propiedad "incidencias" como una lista y que cada incidencia incluye todos los campos requeridos.

La estructura principal debe ser:
{
  "pedido": null,
  "albaran": null,
  "incidencias": [
    {
      "pedido": null,
      "albaran": null,
      "referencia_producto": null,
      "tipo_incidencia": null,
      "solicita_devolucion": false,
      "solicita_abono": false,
      "producto_mencionado": null,
      "producto_solicitado": null,
      "producto_recibido": null,
      "producto_oficial": null,
      "candidatos": [],
      "cantidad": null,
      "unidad": null,
      "cantidades_detalle": [],
      "referencia_temporal": null,
      "motivo": null,
      "dudas": []
    }
  ],
  "dudas": []
}

Cada incidencia debe contener todos los campos indicados.

REGLAS:

1. Extrae únicamente información que aparezca en el correo. No inventes datos.
2. Si no se conoce un valor, utiliza null. Para listas sin elementos, utiliza [].
3. Separa las incidencias reales cuando el correo describe problemas diferentes o varios artículos independientes.
4. Clasifica correctamente el tipo de incidencia:
   - "mercancía faltante": género facturado o pedido que no se entregó.
   - "cantidades incorrectas": discrepancia entre cantidades facturadas y recibidas.
   - "producto equivocado": se entregó un producto diferente al solicitado.
   - "producto dañado" o "producto golpeado": mercancía deteriorada o rota.
   - "reclamación sobre el transportista" / "reclamación sobre el repartidor": quejas sobre el servicio de entrega o transportista.
   - "otro": otra incidencia no contemplada.
5. "solicita_devolucion" solo será true si el cliente solicita EXPRESAMENTE una devolución o retirada física de la mercancía.
6. "solicita_abono" solo será true si el cliente solicita EXPRESAMENTE un abono, factura rectificativa o nota de crédito.
7. Extrae en "referencia_producto" el código numérico o referencia del producto. No lo confundas con números de pedido ni albaranes.
8. Conserva los números de pedido y albarán cuando estén presentes.
9. "producto_mencionado" debe conservar el nombre tal como aparece en el correo.
10. Diferencia "producto_solicitado" y "producto_recibido" cuando se haya pedido un producto y se haya recibido otro.
11. El catálogo oficial es la fuente válida para "producto_oficial" y "candidatos". No inventes equivalencias. Si el nombre no coincide exactamente con un producto del catálogo, deja "producto_oficial": null y añade candidatos solo si son opciones razonables que requieren revisión manual.
12. "cantidad" y "unidad" deben recoger la cantidad afectada por la incidencia.
13. "cantidades_detalle" registra por separado las cantidades mencionadas, con "tipo", "cantidad", "unidad", "producto" y "dudas".
14. No sumes ni mezcles unidades distintas.
15. "referencia_temporal" recoge fechas o referencias temporales mencionadas.
16. "motivo" resume brevemente el problema.
17. "dudas" recoge las ambigüedades que requieren revisión humana.
18. Si el correo no contiene ninguna incidencia, devuelve "incidencias": [].

Las equivalencias expresamente aprobadas se aplicarán después de la extracción. No inventes otras equivalencias.

CATÁLOGO OFICIAL DE PRODUCTOS:
${productosOficiales.map((producto) => `- ${producto}`).join('\n')}
`;

  const contenidoUsuario = [{ type: 'text', text: textoCorreo }];

  if (Array.isArray(archivosPdf)) {
    for (const archivo of archivosPdf) {
      if (archivo && archivo.contenido) {
        contenidoUsuario.push({
          type: 'file',
          file: {
            filename: archivo.nombre || 'adjunto.pdf',
            file_data: `data:application/pdf;base64,${archivo.contenido.toString('base64')}`
          }
        });
      }
    }
  }

  const cuerpo = {
    model: modelo,
    messages: [
      {
        role: 'system',
        content: instrucciones
      },
      {
        role: 'user',
        content: contenidoUsuario
      }
    ],
    response_format: {
      type: 'json_object'
    },
    temperature: 0,
    max_tokens: 5000
  };

  if (Array.isArray(archivosPdf) && archivosPdf.length > 0) {
    cuerpo.plugins = [
      {
        id: 'file-parser',
        pdf: {
          engine: 'cloudflare-ai'
        }
      }
    ];
  }

  let resultado;
  let ultimoError;

  for (let intento = 1; intento <= 2; intento++) {
    const cuerpoIntento = {
      ...cuerpo,
      messages: [...cuerpo.messages]
    };

    if (intento === 2) {
      cuerpoIntento.messages = [
        ...cuerpo.messages,
        {
          role: 'assistant',
          content: 'La respuesta anterior no tenía la estructura JSON requerida.'
        },
        {
          role: 'user',
          content: 'Vuelve a analizar el correo original y responde únicamente con un objeto JSON válido que respete exactamente la estructura indicada en las instrucciones. La propiedad debe llamarse "incidencias", sin dos puntos dentro del nombre, y su valor debe ser una lista. Cada incidencia debe incluir todos los campos requeridos. No inventes información.'
        }
      ];
      console.log('\nLa respuesta anterior no era válida. Reintentando una vez...');
    }

    try {
      const respuesta = await fetch(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(cuerpoIntento)
        }
      );

      if (!respuesta.ok) {
        throw new Error(
          `OpenRouter respondió con HTTP ${respuesta.status}: ${await respuesta.text()}`
        );
      }

      const datosRespuesta = await respuesta.json();
      const texto = datosRespuesta.choices?.[0]?.message?.content;

      if (typeof texto !== 'string' || !texto.trim()) {
        throw new Error('OpenRouter devolvió una respuesta vacía.');
      }

      resultado = JSON.parse(texto);

      if (
        !resultado ||
        typeof resultado !== 'object' ||
        Array.isArray(resultado)
      ) {
        throw new Error('OpenRouter devolvió un JSON que no es un objeto.');
      }

      if (!Array.isArray(resultado.incidencias)) {
        console.error('\nRespuesta recibida de OpenRouter:');
        console.error(JSON.stringify(resultado, null, 2));
        throw new Error(
          'La respuesta de OpenRouter no contiene "incidencias" como una lista.'
        );
      }

      ultimoError = null;
      break;
    } catch (error) {
      ultimoError = error;
    }
  }

  if (ultimoError) {
    throw new Error(
      `No se pudo obtener una respuesta válida de OpenRouter después de 2 intentos. ${ultimoError.message}`
    );
  }

  return validarIncidencias(
    resultado,
    productosOficiales,
    equivalencias
  );
}

module.exports = {
  main,
  cargarProductosOficiales,
  cargarEquivalenciasProductos,
  validarIncidencias,
  validarIncidencia
};

