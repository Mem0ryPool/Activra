import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    // Each preload is a standalone bundle so it can run in a sandboxed renderer.
    build: {
      isolatedEntries: true,
      externalizeDeps: false,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          notification: resolve(__dirname, 'src/preload/notification.ts'),
          widget: resolve(__dirname, 'src/preload/widget.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          notification: resolve(__dirname, 'src/renderer/notification.html'),
          widget: resolve(__dirname, 'src/renderer/widget.html')
        }
      }
    }
  }
})
