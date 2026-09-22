import { rmSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
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

function omitCliDeclarations(): Plugin {
  return {
    name: 'omit-cli-declarations',
    apply: 'build',
    closeBundle() {
      rmSync(resolve(rootDir, 'dist/cli.d.ts'), { force: true });
    },
  };
}

export default defineConfig({
  plugins: [
    dts({
      include: ['src/**/*.ts'],
      exclude: ['src/cli/**/*.ts'],
      tsconfigPath: './tsconfig.json',
      bundleTypes: true,
    }),
    omitCliDeclarations(),
  ],
  build: {
    emptyOutDir: true,
    lib: {
      entry: {
        index: resolve(rootDir, 'src/index.ts'),
        cli: resolve(rootDir, 'src/cli/main.ts'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: isExternal,
      output: {
        chunkFileNames: 'shared.js',
      },
    },
    sourcemap: true,
    target: 'node24',
  },
});
