import http from 'http'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { WebSocketServer, WebSocket } from 'ws'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PUBLIC_DIR = path.join(__dirname, 'public')

// Static assets served over HTTP. `file` is relative to public/; `binary` files
// (the font) are cached as Buffers, everything else as utf8 strings. The HUD
// layout lives at `/`; the raw test page moved to `/debug.html`.
const STATIC_ROUTES = {
	'/': { file: 'index.html', contentType: 'text/html; charset=utf-8' },
	'/index.html': { file: 'index.html', contentType: 'text/html; charset=utf-8' },
	'/debug.html': { file: 'debug.html', contentType: 'text/html; charset=utf-8' },
	'/mitti-display.js': { file: 'mitti-display.js', contentType: 'application/javascript; charset=utf-8' },
	'/tod-clock.js': { file: 'tod-clock.js', contentType: 'application/javascript; charset=utf-8' },
	'/fonts/Lekton-Bold.ttf': { file: 'fonts/Lekton-Bold.ttf', contentType: 'font/ttf', binary: true },
	'/icons/looping.svg': { file: 'icons/looping.svg', contentType: 'image/svg+xml' },
	'/icons/pause-end.svg': { file: 'icons/pause-end.svg', contentType: 'image/svg+xml' },
	'/icons/audio.svg': { file: 'icons/audio.svg', contentType: 'image/svg+xml' },
	'/favicon.ico': { file: 'favicon.ico', contentType: 'image/x-icon', binary: true },
}

export class MittiDisplayServer {
	constructor(port, logger) {
		this.port = port
		this.log = logger || (() => {})
		this.clients = new Set()
		this._lastState = {
			playing: false,
			clipName: null,
			elapsed: 0,
			duration: 0,
			remaining: 0,
		}
		this._lastJson = JSON.stringify(this._lastState)

		// Read every static asset once at startup and cache it in memory.
		this._assets = {}
		for (const [route, def] of Object.entries(STATIC_ROUTES)) {
			try {
				const body = readFileSync(path.join(PUBLIC_DIR, def.file), def.binary ? null : 'utf8')
				this._assets[route] = { body, contentType: def.contentType }
			} catch (e) {
				this.log('error', `Display server: failed to load ${def.file}: ${e.message}`)
			}
		}

		this.server = http.createServer((req, res) => this._handleHttp(req, res))

		this.server.on('error', (err) => {
			if (err.code === 'EADDRINUSE') {
				this.log('error', `Display server: port ${this.port} is already in use`)
			} else {
				this.log('error', `Display server error: ${err.message}`)
			}
		})

		this.wss = new WebSocketServer({ server: this.server })
		// ws re-emits the underlying http server's errors (e.g. EADDRINUSE) onto the
		// WebSocketServer. Without this listener, Node throws an unhandled 'error'
		// event and the whole module process crashes. The http server's own handler
		// above already logs EADDRINUSE, so only log anything unexpected here.
		this.wss.on('error', (err) => {
			if (err.code !== 'EADDRINUSE') {
				this.log('error', `Display server WebSocket error: ${err.message}`)
			}
		})
		this.wss.on('connection', (ws) => this._handleConnection(ws))

		try {
			this.server.listen(this.port, () => {
				this.log('debug', `Display server listening on port ${this.port}`)
			})
		} catch (e) {
			this.log('error', `Display server: failed to start on port ${this.port}: ${e.message}`)
		}
	}

	_handleHttp(req, res) {
		if (req.method !== 'GET') {
			res.writeHead(405, { 'Content-Type': 'text/plain' })
			res.end('Method Not Allowed')
			return
		}
		const url = req.url.split('?')[0]
		const asset = this._assets[url]
		if (asset) {
			res.writeHead(200, {
				'Content-Type': asset.contentType,
				'Cache-Control': 'no-cache',
				'Access-Control-Allow-Origin': '*',
			})
			res.end(asset.body)
			return
		}
		res.writeHead(404, { 'Content-Type': 'text/plain' })
		res.end('Not Found')
	}

	_handleConnection(ws) {
		this.clients.add(ws)
		this._sendState(ws)

		ws.on('message', (data) => {
			try {
				const message = JSON.parse(data.toString())
				if (message && message.type === 'get_state') {
					this._sendState(ws)
				}
			} catch {
				// ignore malformed messages
			}
		})

		ws.on('close', () => {
			this.clients.delete(ws)
		})

		ws.on('error', () => {
			this.clients.delete(ws)
		})
	}

	_sendState(ws) {
		if (ws.readyState !== WebSocket.OPEN) return
		ws.send(JSON.stringify({ type: 'state', data: this._lastState }))
	}

	setState(next) {
		const json = JSON.stringify(next)
		if (json === this._lastJson) return
		this._lastState = next
		this._lastJson = json
		const payload = JSON.stringify({ type: 'state', data: next })
		for (const ws of this.clients) {
			if (ws.readyState === WebSocket.OPEN) {
				try {
					ws.send(payload)
				} catch {
					// drop on send failure
				}
			}
		}
	}

	close() {
		for (const ws of this.clients) {
			try {
				ws.terminate()
			} catch {
				// ignore
			}
		}
		this.clients.clear()
		try {
			this.wss?.close()
		} catch {
			// ignore
		}
		try {
			this.server?.close()
		} catch {
			// ignore
		}
	}
}
