// serve.mjs — minimal Node HTTP adapter for the TanStack Start server build.
//
// `npm run build` produces dist/server/server.js exporting a fetch handler.
// This wraps it in a real listening server so the app can run anywhere Node
// runs. PORT and HOST come from the environment.

import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { createReadStream, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.PORT || 3000)
const HOST = process.env.HOST || '0.0.0.0'

const here = fileURLToPath(new URL('.', import.meta.url))
const CLIENT_DIR = resolve(here, 'dist/client')

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

/** Serve a build asset from dist/client. Returns true when handled. */
function tryStatic(pathname, res) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
  const file = join(CLIENT_DIR, rel)
  if (!file.startsWith(CLIENT_DIR)) return false
  let stat
  try {
    stat = statSync(file)
  } catch {
    return false
  }
  if (!stat.isFile()) return false

  const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
  const immutable = rel.startsWith('/assets/')
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
  })
  createReadStream(file).pipe(res)
  return true
}

const { default: server } = await import('./dist/server/server.js')
const fetchHandler = server?.fetch ?? server?.default?.fetch ?? server

if (typeof fetchHandler !== 'function') {
  console.error('serve.mjs: no fetch handler found on dist/server/server.js')
  process.exit(1)
}

const server_ = createServer(async (req, res) => {
  try {
    const pathname = (req.url ?? '/').split('?')[0]

    // Static build assets first (JS, CSS, images, fonts).
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (tryStatic(pathname, res)) return
    }

    const url = `http://${req.headers.host ?? `localhost:${PORT}`}${req.url}`

    const headers = new Headers()
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) v.forEach((x) => headers.append(k, x))
      else if (v != null) headers.set(k, v)
    }

    const method = req.method ?? 'GET'
    const hasBody = method !== 'GET' && method !== 'HEAD'

    const request = new Request(url, {
      method,
      headers,
      body: hasBody ? Readable.toWeb(req) : undefined,
      // @ts-expect-error duplex is required when streaming a body
      duplex: hasBody ? 'half' : undefined,
    })

    const response = await fetchHandler(request)

    res.statusCode = response.status
    response.headers.forEach((value, key) => {
      // node sets its own framing
      if (key.toLowerCase() === 'content-encoding') return
      res.setHeader(key, value)
    })

    if (!response.body) {
      res.end()
      return
    }

    Readable.fromWeb(response.body).pipe(res)
  } catch (err) {
    console.error('request failed:', err)
    res.statusCode = 500
    res.end('Internal Server Error')
  }
})

server_.listen(PORT, HOST, () => {
  console.log(`web listening on http://${HOST}:${PORT}`)
})
