// server/src/loadEnv.ts
// This module MUST be imported first in index.ts.
// It loads .env before any other module reads process.env.
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });
