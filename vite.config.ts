import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import packageJson from './package.json' with { type: 'json' };

const dependencyNames = Object.keys(packageJson.dependencies ?? {});
const rootDir = import.meta.dirname;

function isExternal(id: string): boolean {
  if (id.startsWith('node:')) {
    return true;
  }

  if (builtinModules.includes(id)) {
    return true;
  }

  return dependencyNames.some(
    (dependencyName) =>
      id === dependencyName || id.startsWith(`${dependencyName}/`),
  );
}

export default defineConfig(() => {
  const cli = process.env.DOKLADO_ENTRY === 'cli';

  return {
    plugins: cli
      ? []
      : [
          dts({
            include: ['src/**/*.ts'],
            exclude: ['src/cli/**/*.ts'],
            tsconfigPath: './tsconfig.json',
            bundleTypes: true,
          }),
        ],
    build: {
      emptyOutDir: !cli,
      lib: {
        entry: cli
          ? { cli: resolve(rootDir, 'src/cli/main.ts') }
          : { index: resolve(rootDir, 'src/index.ts') },
        formats: ['es'],
        fileName: (_format, entryName) => `${entryName}.js`,
      },
      rollupOptions: {
        external: isExternal,
      },
      sourcemap: true,
      target: 'node24',
    },
  };
});
