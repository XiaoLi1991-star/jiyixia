import http from 'node:http'

const port = Number(process.env.MINIMAX_TEST_PROXY_PORT || 8787)
const targetOrigin = process.env.MINIMAX_TARGET_ORIGIN || 'https://api.minimaxi.com'

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (!req.url?.startsWith('/v1/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Only /v1/* MiniMax requests are proxied.' }))
      return
    }

    const started = Date.now()
    const body = await readBody(req)
    const upstream = await fetch(`${targetOrigin}${req.url}`, {
      method: req.method,
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json',
        Authorization: req.headers.authorization || ''
      },
      body: body.length ? body : undefined
    })
    const responseBody = Buffer.from(await upstream.arrayBuffer())
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json'
    })
    res.end(responseBody)
    console.log(`${req.method} ${req.url} -> ${upstream.status} ${Date.now() - started}ms`)
  } catch (error) {
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Proxy request failed.' }))
    console.log(`${req.method} ${req.url} -> 502`)
  }
})

server.listen(port, '0.0.0.0', () => {
  console.log(`MiniMax test proxy listening on http://0.0.0.0:${port}`)
})
