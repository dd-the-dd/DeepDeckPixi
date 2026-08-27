import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
    plugins: [vue()],
    build: {
        lib: {
            entry: resolve(import.meta.dirname, 'src/index.mjs'),
            formats: ['es'],
            fileName: 'deepdeck-pixi',
        },
        rollupOptions: {
            external: ['pixi.js', 'vue'],
        },
        sourcemap: true,
    },
    test: {
        environment: 'happy-dom',
        setupFiles: ['./vitest.setup.mjs'],
    },
});
