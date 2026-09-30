import { createServer } from 'node:http'
import { handler } from './handler.js'
import type { HttpEvent } from './http.js'

const port = Number(process.env.API_PORT ?? 8787)
if (!Number.isSafeInteger(port) || port < 1 || port > 65535 || process.env.API_LOCAL !== '1') {
  throw new Error('API_LOCAL=1 and a valid API_PORT are required')
}

createServer(async (request, response) => {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk))
    if (chunks.reduce((total, item) => total + item.length, 0) > 128_000) {
      response.writeHead(413).end()
      return
    }
  }
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers[key] = value
  }
  const event: HttpEvent = {
    rawPath: new URL(request.url ?? '/', 'http://localhost').pathname,
    requestContext: { http: { method: request.method ?? 'GET', ...(request.socket.remoteAddress ? { sourceIp: request.socket.remoteAddress } : {}) } },
    headers, body: Buffer.concat(chunks).toString('utf8'),
  }
  const result = await handler(event)
  response.writeHead(result.statusCode, { ...result.headers, ...(result.cookies ? { 'set-cookie': [...result.cookies] } : {}) })
  response.end(result.body)
}).listen(port, '127.0.0.1')
