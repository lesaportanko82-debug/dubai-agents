import type { NextConfig } from 'next';
import path from 'node:path';

const config: NextConfig = {
  // the agent cores live one level up (../src); let Next compile them
  turbopack: { root: path.join(__dirname, '..') },
  outputFileTracingRoot: path.join(__dirname, '..'),
};
export default config;
