# Mattu · Web y cuentas de clientes

HTML, CSS y JavaScript con API en Cloudflare Workers y D1. La web pública conserva su catálogo y solicitudes por WhatsApp. Las cuentas permiten enviar solicitudes y consultar únicamente los pedidos asociados al usuario autenticado.

## Funciones
- Registro, inicio/cierre de sesión y recuperación de contraseña mediante enlace por email.
- Mis pedidos: estado, piezas, presupuesto y fecha de entrega; actualización cada 15 segundos mientras la pantalla está abierta.
- Solicitudes autenticadas registradas en la tabla orders que ya usa el equipo.
- El equipo recibe solicitudes con estado Recibido, nota PENDIENTE DE REVISIÓN y precios en cero para cotizar. Los clientes no pueden establecer precio, seña ni estado.
- Cada solicitud nueva queda vinculada al ID del cliente en customer_order_links. No se vinculan automáticamente órdenes antiguas solo porque coincida el correo.
- Registro público no verifica el correo inicialmente. Recuperación requiere acceso a ese correo. No hay carga de fotos ni pagos online.

## Activación desde el navegador

### 1. Tablas
En la consola de la base D1 mattu-pedidos-db, ejecutar el contenido de [migrations/0001_customer_accounts.sql](migrations/0001_customer_accounts.sql). La tabla orders existente se conserva. No ejecutar otra creación de orders.

### 2. Worker público independiente
Workers & Pages → Create application → Import GitHub → Electreer2005/Mattu.

- Nombre: **mattu-clientes** (distinto del Worker interno mattu-pedidos).
- Rama: main. Directorio raíz: /.
- Build command: `npm run build`.
- Deploy command: `npx wrangler deploy`.
- Node 22 o posterior (las pruebas de SQLite utilizan Node 22.13 o posterior).

La configuración wrangler.jsonc ya contiene el ID de D1 y el binding DB. El build copia solo HTML, CSS, JS e imágenes a dist; ni el backend ni las migraciones se sirven como archivos públicos.

La web y su API deben estar en el mismo origen. GitHub Pages o un hosting estático por sí solo no ejecutan este backend. Si la web usa un dominio propio, apuntarlo a este Worker público.

No poner Cloudflare Access delante de este Worker público: el cliente se registra con la propia autenticación. Mantener Access en mattu-pedidos para los empleados. El portal interno existente no cambia.

### 3. Correos de recuperación
La recuperación requiere un proveedor de email. El código utiliza Resend, con un remitente verificado. Agregar en el Worker público → Settings → Variables and Secrets:

- `RESEND_API_KEY`: **Secret**, clave de la cuenta Resend.
- `MAIL_FROM`: remitente verificado, por ejemplo `Mattu <cuentas@DOMINIO_VERIFICADO>`; reemplazar por el remitente real.
- `PUBLIC_ORIGIN`: origen exacto de la web pública (https, sin barra final), para los enlaces de recuperación.

Sin estos valores, registro e inicio de sesión pueden funcionar, pero recuperación responde que aún no está habilitada. No simula envío. Nunca guardar la clave de email en GitHub ni en Js/config.js.

### 4. Datos del negocio
`Js/config.js` configura el WhatsApp real, Instagram, portal del equipo y catálogo.

## Sesiones y permisos
Contraseñas con PBKDF2-SHA256 y sal aleatoria. Sesiones aleatorias, almacenadas solo como hash en D1. Cookie __Host-mattu_session, Secure, HttpOnly, SameSite=Lax, duración 7 días. Mutaciones requieren Origin propio. Límites de intentos de acceso, recuperación y solicitudes.

Los tokens de recuperación duran 30 minutos, se consumen una vez y revocan las sesiones. Los clientes no reciben notas internas ni correos de los empleados. La consulta de pedidos une orders con customer_order_links filtrando por usuario, nunca por un ID de usuario enviado por el navegador.

El carrito es local; las solicitudes se envían al servidor cuando el cliente pulsa Enviar solicitud desde mi cuenta. Se conserva un ID de reintento para evitar duplicados si se pierde la respuesta. La presentación por WhatsApp sigue disponible sin registro.

## Pruebas
`npm test` ejecuta 17 pruebas de carrito, registro, contraseñas, logout, rechazo de otro origen, aislamiento de usuarios, creación idempotente, cambios del equipo y recuperación. Se utiliza SQLite real en memoria y un proveedor de email simulado únicamente dentro de las pruebas.

`npm run build` prepara los assets. `npx wrangler deploy --dry-run` valida el Worker sin publicarlo.

## Verificación final en la cuenta del negocio
Después de activar tablas y desplegar: registrar dos clientes, enviar una solicitud con uno, comprobar su aparición en la app del equipo y que el segundo cliente no la vea. Cambiar el estado desde el equipo y comprobarlo en Mis pedidos. Probar cierre de sesión y recuperación con el remitente de email real.

Las pruebas locales no verifican entrega real de correos, despliegue remoto ni presentación visual en dispositivos.
