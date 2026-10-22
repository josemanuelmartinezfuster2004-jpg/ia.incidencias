
const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
  const rutaCorreos = path.join(__dirname, '..', 'pruebas', 'incidencias-pruebas.json');
  const rutaProductos = path.join(__dirname, '..', 'pruebas', 'productos.json');
  const rutaResultados = path.join(__dirname, '..', 'pruebas', 'incidencias-resultados.json');

  const contenidoCorreos = await fs.readFile(rutaCorreos, 'utf8');
  const contenidoProductos = await fs.readFile(rutaProductos, 'utf8');

  const correos = JSON.parse(contenidoCorreos);
  const productos = JSON.parse(contenidoProductos);
  const resultados = [];

  for (const correo of correos) {
    const texto = `${correo.asunto} ${correo.cuerpo}`;
    const textoMinusculas = texto.toLowerCase();

    let tipoCorreo = 'Otro';
    let motivo = 'No identificado';

    if (/\b(consulta|consultar|confirmar|confirméis)\b/i.test(textoMinusculas)) {
      tipoCorreo = 'Consulta';
    } else if (/\b(incidencia|dañad[oa]s?|rot[oa]s?|deteriorad[oa]s?|golpead[oa]s?|abollad[oa]s?|equivocad[oa]s?|incorrect[oa]s?|erróne[oa]s?|faltan|falta mercancía|pedido incompleto)\b/i.test(textoMinusculas)) {
      tipoCorreo = 'Incidencia';
    }

    if (/\b(dañad[oa]s?|rot[oa]s?|deteriorad[oa]s?)\b/i.test(textoMinusculas)) {
      motivo = 'Producto dañado';
    } else if (/\b(golpead[oa]s?|abollad[oa]s?)\b/i.test(textoMinusculas)) {
      motivo = 'Producto golpeado';
    } else if (/\b(equivocad[oa]s?|producto incorrecto|producto erróneo|incorrect[oa]s?)\b/i.test(textoMinusculas)) {
      motivo = 'Producto incorrecto';
    } else if (/\b(faltan|falta mercancía|pedido incompleto)\b/i.test(textoMinusculas)) {
      motivo = 'Falta mercancía';
    }

    const niegaDevolucion =
      /\b(?:no|nunca|tampoco)\s+(?:solicitamos|solicito|queremos|quiero|pedimos|pido|deseamos|deseo)\b.{0,60}\b(?:devoluci[oó]n|devoluciones|devolver\w*)\b/i.test(textoMinusculas);

    const solicitaDevolucion =
      !niegaDevolucion &&
      /\b(?:queremos|quiero|solicitamos|solicito|pedimos|pido|deseamos|deseo)\b.{0,40}\b(?:devoluci[oó]n|devoluciones|devolver\w*)\b/i.test(textoMinusculas);

    const cantidad = texto.match(/\b(\d+(?:[,.]\d+)?)\s*(cajas|caja|unidades|unidad|kg|kilos|kilogramos|toneladas|tonelada|palés|palet|palets|sacos|saco|paquetes|paquete)\b/i);

    const productosEncontrados = productos.filter((producto) => {
      const nombres = [
        producto.nombreOficial,
        ...(producto.nombresAlternativos || [])
      ];

      return nombres.some((nombre) => {
        const nombreNormalizado = nombre.toLowerCase().trim();
        const expresion = new RegExp(
          `(^|[^\\p{L}\\p{N}])${nombreNormalizado.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`,
          'iu'
        );

        return expresion.test(textoMinusculas);
      });
    });

    const productosUnicos = [
      ...new Map(
        productosEncontrados.map((producto) => [
          producto.referencia,
          producto
        ])
      ).values()
    ];

    const productoMencionado = productosUnicos.length > 0
      ? productosUnicos.map((producto) => producto.nombreOficial).join(', ')
      : 'No identificado';

    const nombreOficial = productosUnicos.length === 1
      ? productosUnicos[0].nombreOficial
      : null;

    const referenciaProducto = productosUnicos.length === 1
      ? productosUnicos[0].referencia
      : null;

    const revisionNecesaria =
      productosUnicos.length !== 1 ||
      (tipoCorreo === 'Consulta' && productosUnicos.length > 1);

    const resultado = {
      id: correo.id,
      asunto: correo.asunto,
      remitente: correo.remitente,
      tipoCorreo,
      motivo,
      solicitaDevolucion,
      productoMencionado,
      cantidad: cantidad ? cantidad[1] : null,
      unidad: cantidad ? cantidad[2] : null,
      nombreOficial,
      referenciaProducto,
      revisionNecesaria
    };

    resultados.push(resultado);

    console.log('\nCorreo:', correo.id);
    console.log('Asunto:', correo.asunto);
    console.log('Tipo de correo:', tipoCorreo);
    console.log('Motivo de la incidencia:', motivo);
    console.log('Solicita devolución:', solicitaDevolucion ? 'Sí' : 'No detectada');
    console.log('Producto mencionado:', productoMencionado);
    console.log('Cantidad:', cantidad ? cantidad[1] : 'No indicada');
    console.log('Unidad:', cantidad ? cantidad[2] : 'No indicada');
    console.log('Nombre oficial:', nombreOficial || 'Pendiente de identificar');
    console.log('Referencia:', referenciaProducto || 'Sin asignar');

    if (revisionNecesaria) {
      console.log('Revisión necesaria: confirmar el producto exacto');
    }
  }

  await fs.writeFile(
    rutaResultados,
    JSON.stringify(resultados, null, 2),
    'utf8'
  );

  console.log('\nResultados guardados en:', rutaResultados);
}

main().catch((error) => {
  console.error('Error al procesar las incidencias:', error.message);
});
