# ─── Build stage ──────────────────────────────────────────────────────────────
# Installs all dependencies, patches the schema, compiles TypeScript, bundles React.
FROM node:20-alpine AS build

WORKDIR /app

COPY . .

# Prisma schema uses SQLite for development; switch to PostgreSQL for production build
RUN sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma && \
    grep -q 'provider = "postgresql"' prisma/schema.prisma || \
    (echo "ERROR: failed to switch prisma datasource provider to postgresql" && exit 1)

# Install all deps (devDeps needed for build tools: tsx, tsc, vite, prisma CLI)
RUN npm ci

# Generate Prisma client targeting PostgreSQL
RUN npx prisma generate --schema=./prisma/schema.prisma

# Build frontend → client/dist/
RUN npm run build --workspace=client

# Build backend TypeScript → server/dist/
RUN npm run build --workspace=server


# ─── App stage (Express API server) ───────────────────────────────────────────
FROM node:20-alpine AS app

WORKDIR /app

COPY --from=build /app/node_modules       ./node_modules
COPY --from=build /app/server/dist        ./server/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/package.json       ./package.json
COPY --from=build /app/prisma             ./prisma

EXPOSE 3001

# dotenv.config() in loadEnv.ts looks for '../.env'; that file won't exist in
# production — all env vars are injected by Docker. dotenv silently skips missing
# files, so this is safe.
CMD ["node", "server/dist/index.js"]


# ─── Web stage (Nginx serving React frontend + proxying /api) ─────────────────
FROM nginx:1.27-alpine AS web

COPY --from=build /app/client/dist        /usr/share/nginx/html
COPY nginx/nginx.conf                     /etc/nginx/conf.d/default.conf

EXPOSE 80
