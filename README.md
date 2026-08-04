# 🔐 Auth Microservice

<p align="center">
  <img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" />
</p>

<p align="center">
  Microservicio de autenticación, construido con <a href="http://nestjs.com/" target="blank">NestJS</a>, <a href="https://www.prisma.io/" target="blank">Prisma ORM</a> sobre MongoDB y JWT.
</p>

---

**No expone HTTP.** Solo escucha NATS. Es el único lugar del sistema donde se firman y verifican los JWT: el gateway no conoce `JWT_SECRET` ni tiene `@nestjs/jwt`.

## 📬 Message Patterns

Usa **strings con puntos**, igual que `payments-ms`.

| Patrón | Hace |
|---|---|
| `auth.register.user` | Crea el usuario, hashea con bcrypt y devuelve `{ user, token }` |
| `auth.login.user` | Valida credenciales y devuelve `{ user, token }` |
| `auth.verify.user` | Verifica el token y devuelve `{ user, token }` con un token **nuevo** |

En los tres casos la contraseña se saca del objeto antes de responder: el gateway reenvía los payloads tal cual.

## 🔄 Revalidación y renovación

`auth.verify.user` no devuelve el token que recibió: devuelve uno **recién firmado**. Así una sesión activa se va renovando sola en lugar de vencer a mitad de uso. El `AuthGuard` del gateway deja ese token nuevo en `request.token` para que el cliente lo levante.

Dos detalles de la implementación que no son obvios:

- **Hay que sacar `iat` y `exp` del payload verificado antes de volver a firmar.** `jsonwebtoken` tira error si el payload ya los trae y además está seteado `signOptions.expiresIn`.
- **Los errores se tiran como `RpcException({ status: 401, message })`.** La clave tiene que ser `status`, no `statusCode`, o el filtro global del gateway lo degrada a un 400 (que es el bug que todavía tiene `products-ms`).

> ⚠️ El `AuthGuard` del gateway desestructura `{ user, token }` de la respuesta. Desestructurar algo que no es un objeto devuelve `undefined` **sin lanzar**, así que si la forma de retorno de `verifyUser` cambia, el guard **falla abierto**, no cerrado. Ya pasó una vez, mientras `verifyUser` todavía devolvía el token crudo: autenticaba cualquier token.

## 📋 Requisitos Previos

- **Node.js 22**
- **npm** (este servicio usa npm, no pnpm)
- **MongoDB** — Atlas o un contenedor local
- **Docker** (para NATS, o para levantar todo el stack)

## 🛠️ Instalación

```bash
cd auth-ms
npm install
npx prisma generate
```

## ⚙️ Variables de Entorno

```bash
cp .env.template .env
```

```env
PORT=3004
NATS_SERVERS="nats://localhost:4222"
JWT_SECRET=cambiame_por_un_secreto_largo
DATABASE_URL=mongodb+srv://usuario:password@cluster.mongodb.net/AuthDB
```

> `PORT` se valida pero **no se usa**: el servicio no escucha en ningún puerto. El `3004:3004` del compose es cosmético.

> `DATABASE_URL` **no está** en el schema de Joi, pero Prisma la necesita igual. Si falta, el servicio arranca y falla en la primera query.

`JWT_SECRET` tiene que ser el mismo que usa el resto del stack: bajo Docker llega desde el `.env` de la raíz.

## 🗄️ Base de datos (Prisma 6 + MongoDB)

```bash
npx prisma generate
npx prisma db push
```

### ⚠️ Este servicio está fijado en Prisma 6 a propósito

**Prisma 7 no soporta MongoDB.** La v7 hace obligatorios los driver adapters y no existe `@prisma/adapter-mongodb` — el paquete no está publicado en npm. Un cliente v7 contra un datasource `mongodb` *se genera* bien y después explota al construirse: *"PrismaClient was instantiated without any options. A driver adapter is required."*

La recomendación oficial de Prisma es quedarse en v6 para MongoDB. Por eso acá `prisma` y `@prisma/client` están en `^6.19`, mientras `products-ms` y `orders-ms` van en 7.

> **No "unifiques las versiones".** Un `npm update` acá rompe el servicio.

Diferencias con los otros dos servicios que tienen Prisma:

- **No hay migraciones.** `prisma migrate dev` no está soportado en MongoDB: el flujo es `prisma db push`.
- El generador es `prisma-client-js` sin `output`, así que el import es `@prisma/client` (como `orders-ms`, no como `products-ms`).
- **`schema.prisma` sí declara `url = env("DATABASE_URL")`** y **no hay `prisma.config.ts`** — ese archivo es de la forma v7 y se eliminó. Es justo al revés que en los servicios v7.
- Los ids son ObjectIds: `id String @id @default(auto()) @map("_id") @db.ObjectId`.
- Usa el **motor nativo** (`libquery_engine-...so.node`), no el compilador WASM de la v7. Por eso su imagen necesita `openssl`.

## ▶️ Ejecución

Lo normal es levantar todo el stack desde la raíz del proyecto:

```bash
docker compose up -d --build
```

Solo, con NATS corriendo:

```bash
npm run start:dev
```

## 🧪 Testing

```bash
npm test
npm run test:e2e
npm run test:cov
```

Smoke test rápido, con el stack levantado:

```bash
curl -s "localhost:8222/subsz?subs=1" | grep -c '"subject": "auth\.'   # esperás 3

curl -s -X POST localhost:3001/api/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"Test","email":"test@test.com","password":"Abc123456!"}'
```

## ⚠️ Cosas a tener en cuenta

**El `try/catch` de `AuthService` tiene que relanzar las `RpcException`.** Un `catch (error) { throw new RpcException({ status: 400, message: 'User login failed' }) }` pelado se come el `Invalid credentials` específico que se tiró adentro del `try` y lo reemplaza por el genérico. La forma correcta es `if (error instanceof RpcException) throw error;` primero, y recién después el genérico con `status: 500`.

**`openssl` tiene que estar instalado en la etapa donde corre `prisma generate`**, no solo en la de runtime. Prisma lo usa para *detectar* qué motor emitir: sin él asume `openssl-1.1.x` y la imagen final (openssl 3.x) muere al arrancar con *"could not locate the Query Engine"*.

**Los DTOs están duplicados** con los del gateway (`client-gateway/src/auth/dto`). Los dos lados corren `forbidNonWhitelisted`, así que un campo declarado de un solo lado se rechaza. Usan `@IsStrongPassword()`, o sea que una contraseña débil se rechaza en el gateway antes de llegar a NATS.

**El índice único de `email` todavía no está aplicado.** Está declarado como `@unique` en el schema, pero hace falta correr `prisma db push` contra la base para que exista. Hasta entonces, los emails duplicados entran sin problema.
