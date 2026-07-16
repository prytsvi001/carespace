// api/index.ts — Vercel serverless entry point.
// Vercel's Node.js runtime invokes the default export as a plain
// (req, res) handler, which is exactly what an Express app is —
// no adapter needed, and no app.listen() here.
import app from '../server/src/app';

export default app;
