// Borrador de flujo para leer el buzón, clasificar cada mensaje y, para los
// pedidos, extraer productos y guardar el resultado. Este archivo todavía
// depende de funciones que no están definidas aquí; el flujo completo de
// Outlook se encuentra en leer-correos-outlook.js.
// Es un esquema de referencia: no es la entrada que debe ejecutarse para leer Outlook.
async function revisarBuzon() {
  // Obtiene autorización de Outlook y recupera los mensajes nuevos.
  const token = await obtenerTokenDeOutlook();
  const correosNuevos = await leerCorreoNuevos(token);

  // Recorre los correos y decide qué hacer con cada uno según su categoría.
  for (const correo of correosNuevos) {
    const categoria = await clasificarCorreos(correo);

    // Para pedidos: suma el texto de los adjuntos al mensaje, extrae el pedido
    // y guarda el resultado. Las otras categorías solo se marcan procesadas.
    if (categoria === "Pedido") {
      const adjuntos = await obtenerAdjuntos(correo.id, token);
      const textoCompleto = `${correo.subject}\n${correo.body}\n${adjuntos}`;
      const pedido = await extraerPedido(textoCompleto)
      await guardarCorreo(correo, pedido);
    }

    // Registra el ID para no volver a tratar el mismo correo en otra revisión.
    await guardarComoProcesado(correo.id);
  }
}
