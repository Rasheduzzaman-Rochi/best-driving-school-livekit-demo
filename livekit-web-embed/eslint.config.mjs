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
      '.next/**',
      'app/test/popup/**',
      'components/embed-popup/**',
      'components/popup-page.tsx',
      'components/popup-page-dynamic.tsx',
      'components/welcome.tsx',
      'components/welcome-dynamic.tsx',
      'hooks/use-agent-control-bar.ts',
      'hooks/use-connection-details.ts',
      'hooks/useDebug.ts',
      'public/embed-popup.*',
      'webpack.config.js',
      'next-env.d.ts',
    ],
  },
  ...compat.extends(
    'next/core-web-vitals',
    'next/typescript',
    'plugin:import/recommended',
    'prettier',
    'plugin:prettier/recommended'
  ),
];

export default eslintConfig;
