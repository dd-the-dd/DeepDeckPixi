import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
    plugins: [vue()],
    build: {
        lib: {
            entry: {
                index: resolve(import.meta.dirname, 'src/index.mjs'),
                'replay-element': resolve(import.meta.dirname, 'src/shared/PixiReplayV2Element.mjs'),
            },
            formats: ['es'],
            fileName: (_format, entryName) => `${entryName}.js`,
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
