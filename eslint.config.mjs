import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.mastra/**',
      '**/.open-next/**',
      '**/.wrangler/**',
      'out/**',
      'cloudflare-env.d.ts',
      'next-env.d.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs', 'docs/**/*.mjs'],
    // These Node harnesses evaluate CommonJS modules, outside the Next runtime.
    rules: { '@next/next/no-assign-module-variable': 'off' },
  },
];

export default eslintConfig;
