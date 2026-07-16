// scripts/prepare-vercel-schema.js
//
// Runs only during the Vercel build. Prisma schema uses SQLite for local
// development (see prisma/schema.prisma); this switches the datasource to
// PostgreSQL + a directUrl before `prisma generate` runs, the same way
// Dockerfile does it with `sed` for the Docker build.
const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
let schema = fs.readFileSync(schemaPath, 'utf8');

if (!schema.includes('provider = "sqlite"')) {
  console.error('ERROR: expected provider = "sqlite" in prisma/schema.prisma — nothing to switch');
  process.exit(1);
}

schema = schema.replace('provider = "sqlite"', 'provider  = "postgresql"');

if (!schema.includes('directUrl')) {
  schema = schema.replace(
    /url\s*=\s*env\("DATABASE_URL"\)/,
    'url       = env("DATABASE_URL")\n  directUrl = env("DIRECT_URL")'
  );
}

fs.writeFileSync(schemaPath, schema);
console.log('prisma/schema.prisma switched to postgresql for Vercel build');
