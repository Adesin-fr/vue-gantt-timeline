import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import dts from 'vite-plugin-dts'

export default defineConfig(({ mode }) => {
    const isLib = mode === 'lib'

    return {
        plugins: [vue(), ...(isLib ? [dts({ include: ['src'], rollupTypes: true })] : [])],
        resolve: {
            alias: {
                '@': fileURLToPath(new URL('./src', import.meta.url)),
            },
        },
        build: isLib
            ? {
                  lib: {
                      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
                      name: 'VueGanttTimeline',
                      fileName: 'vue-gantt-timeline',
                  },
                  cssFileName: 'vue-gantt-timeline',
                  rollupOptions: {
                      external: ['vue'],
                      output: { globals: { vue: 'Vue' } },
                  },
              }
            : { outDir: 'dist-demo' },
    }
})
