// scripts/prepare-vercel-schema.js
//
// Runs only during the Vercel build. Prisma schema uses SQLite for local
// development (see prisma/schema.prisma); this switches the datasource to
// PostgreSQL + a directUrl before `prisma generate` runs, the same way
// Dockerfile does it with `sed` for the Docker build.
//
// Idempotent — Vercel's build cache can carry an already-switched schema
// into a later build, so this must be a no-op (not an error) if the
// datasource is already postgresql.
const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
let schema = fs.readFileSync(schemaPath, 'utf8');

if (schema.includes('provider = "sqlite"')) {
  schema = schema.replace('provider = "sqlite"', 'provider  = "postgresql"');
} else if (!schema.includes('provider  = "postgresql"')) {
  console.error('ERROR: prisma/schema.prisma has neither sqlite nor postgresql provider — check the datasource block');
  process.exit(1);
}

if (!schema.includes('directUrl')) {
  schema = schema.replace(
    /url\s*=\s*env\("DATABASE_URL"\)/,
    'url       = env("DATABASE_URL")\n  directUrl = env("DIRECT_URL")'
  );
}

fs.writeFileSync(schemaPath, schema);
console.log('prisma/schema.prisma is set to postgresql for the Vercel build');
