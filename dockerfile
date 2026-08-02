# Mismo base que orders-ms/payments-ms. En minúscula, como el resto: en macOS da igual,
# en Linux/CI el lookup por defecto de `Dockerfile` no lo encontraría.
FROM node:22-slim

# Prisma lo pide explícitamente en su postinstall; sin esto avisa que no puede
# detectar la versión de libssl y cae a un default (openssl-1.1.x).
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# package*.json ya matchea package-lock.json
COPY package*.json ./

RUN npm install

COPY . .

# Prisma 6 sí genera en el postinstall, pero ahí todavía no existe prisma/ (sólo se
# copió package*.json), así que el cliente hay que pedirlo explícitamente acá.
RUN npx prisma generate

EXPOSE 3004

CMD ["npm", "run", "start:dev"]
