// server/src/index.ts — local development entry point.
// On Vercel, api/index.ts imports app.ts directly and never calls listen().
import app from './app';

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 TeamSpace API running on http://localhost:${PORT}`);
});
