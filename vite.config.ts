import { defineConfig, type Plugin } from 'vite'
import path from 'path'

// Dev-only sink: the renderer POSTs console errors here so they show up in
// the Vite terminal (the embedded webview has no visible devtools console).
function clientLogSink(): Plugin {
  return {
    name: 'client-log-sink',
    configureServer(server) {
      server.middlewares.use('/__client-log', (req, res) => {
        let body = ''
        req.on('data', (chunk) => (body += chunk))
        req.on('end', () => {
          console.log(`[webview] ${body}`)
          res.end('ok')
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [clientLogSink()],
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist-renderer'),
    emptyOutDir: true,
    target: 'chrome120',
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      allow: [path.resolve(__dirname)],
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
})
