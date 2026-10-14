# Mattu · Grabados personalizados

Web pública de servicios de grabado, construida en HTML, CSS y JavaScript. Mantiene las imágenes y el logo del negocio y la paleta marrón, blanco y negro.

## Páginas

- `index.html`: presentación, servicios, ejemplos ampliables y consulta.
- `Service.html`: catálogo con búsqueda, filtros y personalización de solicitudes.
- `Cart.html`: piezas y detalles, cantidades, edición y preparación de presupuesto.
- `FAQ.html`: preguntas frecuentes.
- `Auth.html`: enlace al sistema privado de gestión del equipo, protegido por Cloudflare Access.

## Configuración del negocio

Editar `Js/config.js` desde GitHub:

- `whatsapp`: número real del negocio en formato internacional, solo dígitos, sin `+`, espacios ni guiones. Para una línea móvil de Argentina, verificar el formato internacional correcto del número antes de cargarlo.
- `instagram`: perfil oficial.
- `teamPortal`: URL del sistema interno de pedidos.
- `MATTU_SERVICES`: servicios, descripciones e imágenes. No hay precios ficticios: los trabajos se cotizan después de revisar el diseño.

Mientras `whatsapp` esté vacío, el botón prepara el mensaje y abre WhatsApp para elegir el contacto. No abre automáticamente el chat del negocio. El cliente puede copiar y descargar su consulta. Falta completar este número para el flujo directo.

## Comportamiento

La solicitud se guarda en localStorage del navegador; no se envía al backend. Agregar piezas o preparar el mensaje no confirma una compra. El cliente debe enviar el mensaje desde WhatsApp, y el equipo debe registrar el pedido confirmado en la app interna.

No hay pagos online ni registro público de clientes. `Auth.html` abre el portal real del equipo; no simula autenticación ni guarda contraseñas. La web pública no tiene acceso a D1 ni a las órdenes internas.

El formulario de contacto prepara un mensaje revisable. No muestra una confirmación falsa de envío. Las fotografías de referencia se comparten por el canal de conversación; la web no sube archivos.

## Publicación desde la web

Es un sitio estático y no requiere build ni instalar dependencias. Puede publicarse desde GitHub Pages seleccionando la rama `main` y carpeta raíz en Settings → Pages, o en un alojamiento estático compatible. Los enlaces y archivos usan rutas relativas para admitir publicación en una subcarpeta.

Actualizar el repositorio no activa por sí mismo un hosting no configurado. El sistema de pedidos tiene su propio despliegue y no se modifica por estos cambios.

## Verificación

- `node --check Js/app.js`
- `node --check Js/cart-core.js`
- `node --test tests/cart.test.cjs`

Las pruebas cubren recuperación del carrito, datos corruptos, cantidades, combinación de diseños y mensaje de presupuesto. Se revisaron archivos enlazados, anclas, etiquetas e IDs.

Falta prueba visual en un navegador real y verificación del flujo de WhatsApp con el número definitivo. Antes de publicar, revisar en móvil y escritorio: menú, catálogo, agregar/editar/quitar piezas, recarga del carrito, preguntas, galería y consulta.
