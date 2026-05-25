import { InstanceBase, Regex, InstanceStatus, runEntrypoint } from '@companion-module/base'
import { getActions } from './actions.js'
import { getPresets } from './presets.js'
import { getVariables } from './variables.js'
import { getFeedbacks } from './feedbacks.js'
import UpgradeScripts from './upgrades.js'

import os from 'os'
import OSC from 'osc'
import { Bonjour } from '@julusian/bonjour-service'
import { MittiDisplayServer } from './display-server.js'

class MittiInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
	}

	async init(config) {
		this.config = config

		this.cues = {}
		this.cueOrder = []
		this.cueCache = {}
		this.states = {}

		this.connection = {
			ip: null,
			connected: null,
			testService: null,
			testTimeout: null,
			lastPong: null,
			bonjour: null,
			bonjourService: null,
		}

		this.parseIpAndPort()
		this.updateStatus(InstanceStatus.Connecting)

		this.initActions()
		this.initPresets()
		this.initVariables()
		this.initFeedbacks()

		if (this.connection.ip) {
			this.initOSC()
		} else {
			this.updateStatus(InstanceStatus.BadConfig, 'Unable to determine IP Address')
		}

		this.initDisplayServer()
	}

	getConfigFields() {
		return [
			{
				type: 'bonjour-device',
				id: 'bonjourHost',
				label: 'Mitti Connection',
				tooltip:
					'This dropdown attempts to discover active Mitti instances on the network. You can also select "Manual" to enter a custom IP address.',
				width: 10,
			},
			{
				type: 'static-text',
				id: 'hostFiller',
				width: 10,
				label: '',
				isVisible: (options) => !!options['bonjourHost'],
				value: '',
			},
			{
				type: 'textinput',
				id: 'host',
				label: 'IP Address',
				tooltip: 'The IP address of the computer running Mitti',
				default: '127.0.0.1',
				width: 10,
				regex: Regex.IP,
				isVisible: (options) => !options['bonjourHost'],
			},
			{
				type: 'textinput',
				id: 'feedbackPort',
				label: 'Feedback Port',
				width: 4,
				tooltip: 'The port designated for Feedback in the OSC/UDP Controls tab in Mitti',
				default: 51001,
				regex: Regex.PORT,
			},
			{
				type: 'textinput',
				id: 'displayPort',
				label: 'Display Server Port',
				width: 4,
				tooltip:
					'HTTP+WS port that serves the browser display component (/mitti-display.js) and pushes playback state to subscribers.',
				default: 4666,
				regex: Regex.PORT,
			},
			{
				type: 'static-text',
				id: 'displayUrls',
				width: 12,
				label: 'Display Server URLs',
				value:
					'Open the browser playback display at one of these addresses:<br>' +
					this._getDisplayServerUrls()
						.map((url) => `<a href="${url}" target="_blank">${url}</a>`)
						.join('<br>') +
					'<br><i>Reopen this dialog after changing the port to refresh these links.</i>',
			},
			{
				type: 'checkbox',
				id: 'feedbackAlert',
				label: 'Feedback Alert',
				tooltip:
					'If enabled, the module status will change to "Error" if not receiving responses from Mitti. Disable if you wish to use the module without feedback.',
				default: true,
			},
		]
	}

	async configUpdated(config) {
		this.config = config

		this.parseIpAndPort()
		this.updateStatus(InstanceStatus.Connecting)

		if (this.connection.ip) {
			this.initPresets()
			this.initVariables()
			this.initFeedbacks()
			this.initOSC()
		} else {
			this.updateStatus(InstanceStatus.BadConfig, 'Unable to determine IP Address')
		}

		this.initDisplayServer()
	}

	async destroy() {
		if (this.listener) {
			this.listener.close()
		}

		this.stopTestService()
		this.stopBonjourService()

		if (this._displayHeartbeat) {
			clearInterval(this._displayHeartbeat)
			this._displayHeartbeat = null
		}

		if (this._cacheRefreshTimer) {
			clearTimeout(this._cacheRefreshTimer)
			this._cacheRefreshTimer = null
		}

		if (this.displayServer) {
			this.displayServer.close()
			this.displayServer = null
		}

		this.cues = {}
	}

	initDisplayServer() {
		if (this.displayServer) {
			this.displayServer.close()
			this.displayServer = null
		}
		const displayPort = isNaN(parseInt(this.config.displayPort)) ? 4666 : parseInt(this.config.displayPort)
		this.displayServer = new MittiDisplayServer(displayPort, (level, msg) => this.log(level, msg))
		this.displayServer.setState(this._buildDisplayState())

		// Heartbeat so the elapsed-freshness check can flip playing→false even when
		// Mitti goes quiet (pause/stop without a togglePlay 0 message).
		if (this._displayHeartbeat) clearInterval(this._displayHeartbeat)
		this._displayHeartbeat = setInterval(() => this._broadcastDisplayState(), 1000)
	}

	// Enumerate the URLs the display server is reachable at: loopback plus every
	// non-internal IPv4 address of this host. The server binds all interfaces, so
	// any of these will work from a browser on the same network.
	_getDisplayServerUrls() {
		const parsed = parseInt(this.config?.displayPort)
		const port = isNaN(parsed) ? 4666 : parsed
		const hosts = ['localhost', '127.0.0.1']
		try {
			for (const addrs of Object.values(os.networkInterfaces())) {
				for (const addr of addrs ?? []) {
					const isIPv4 = addr.family === 'IPv4' || addr.family === 4
					if (isIPv4 && !addr.internal) hosts.push(addr.address)
				}
			}
		} catch {
			// ignore — the loopback entries are still useful on their own
		}
		return hosts.map((host) => `http://${host}:${port}`)
	}

	_buildDisplayState() {
		const cueName = this.states.currentCueName && this.states.currentCueName !== '-' ? this.states.currentCueName : null
		const elapsedFresh = this.states.lastElapsedAt > 0 && Date.now() - this.states.lastElapsedAt < 1500

		// `playing` (documented in README): true only when Mitti is actively
		// playing a clip with a fresh advancing timer. Preserves the clean
		// edge-on-stop contract for external consumers.
		// Note: the `elapsedSec > 0` gate was removed in v3.11.2 — it caused
		// a brief idle flash at loop boundaries when elapsedSec resets to 0
		// momentarily. `elapsedFresh` still catches stale-after-stop cases
		// (the original v3.11.1 motivation for the gate).
		const playing = !!cueName && this.states.playing === 'Playing' && elapsedFresh

		// `hasCue` (new in v3.11.2): true whenever a cue is loaded on Mitti's
		// output, including pause-at-end and mid-clip pause. Drives the
		// display widget's playback-vs-idle gate so the widget keeps showing
		// the cue when paused (the previous `playing` gate hid the widget
		// when Mitti reported Paused, even at pause-at-end).
		const hasCue = !!cueName

		// Pull cached attributes for the cue at the given slot (selected / next).
		// Returns nulls when no entry is cached yet (cold start) — the consumer
		// can render a placeholder.
		const onDeck = (name) => {
			if (!name || name === '-') {
				return { name: null, duration: null, loop: null, pauseAtEnd: null, audio: null }
			}
			const cached = this.cueCache[name]
			return {
				name,
				duration: cached?.trtSec ?? null,
				loop: cached?.loop ?? null,
				pauseAtEnd: cached?.pauseAtEnd ?? null,
				audio: cached?.audio ?? null,
			}
		}
		const sel = onDeck(this.states.selectedCueName)
		const nxt = onDeck(this.states.nextCueName)

		// Current clip's cached state — looked up by cueName regardless of
		// `playing` so the widget renders the right icons during pause-at-end.
		const cur = hasCue ? (this.cueCache[cueName] ?? null) : null

		return {
			playing,
			hasCue,
			clipName: hasCue ? cueName : null,
			elapsed: hasCue ? (this.states.elapsedSec ?? 0) : 0,
			duration: hasCue ? (this.states.durationSec ?? 0) : 0,
			remaining: hasCue ? (this.states.remainingSec ?? 0) : 0,
			currentClipLoop: cur?.loop ?? null,
			currentClipPauseAtEnd: cur?.pauseAtEnd ?? null,
			currentClipAudio: cur?.audio ?? null,
			selectedClipName: sel.name,
			selectedClipDuration: sel.duration,
			selectedClipLoop: sel.loop,
			selectedClipPauseAtEnd: sel.pauseAtEnd,
			selectedClipAudio: sel.audio,
			nextClipName: nxt.name,
			nextClipDuration: nxt.duration,
			nextClipLoop: nxt.loop,
			nextClipPauseAtEnd: nxt.pauseAtEnd,
			nextClipAudio: nxt.audio,
		}
	}

	_broadcastDisplayState() {
		if (this.displayServer) {
			this.displayServer.setState(this._buildDisplayState())
		}
	}

	// Ask Mitti to re-broadcast its full feedback state. Mitti sometimes lags
	// the currentCueName update on small navigation jumps (±1 clip), so when
	// playback transitions to Playing we force a refresh to avoid showing a
	// stale clip name. Debounced so rapid play/stop cycling can't flood Mitti.
	_requestResyncFromMitti() {
		const now = Date.now()
		if (this._lastResyncAt && now - this._lastResyncAt < 250) return
		this._lastResyncAt = now
		this.sendCommand('resendOSCFeedback')
	}

	initVariables() {
		const variables = getVariables.bind(this)()
		this.setVariableDefinitions(variables)
	}

	initFeedbacks() {
		const feedbacks = getFeedbacks.bind(this)()
		this.setFeedbackDefinitions(feedbacks)
	}

	initPresets() {
		const presets = getPresets.bind(this)()
		this.setPresetDefinitions(presets)
	}

	initActions() {
		const actions = getActions.bind(this)()
		this.setActionDefinitions(actions)
	}

	parseIpAndPort() {
		const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/

		if (this.config.bonjourHost) {
			const [ip, rawPort] = this.config.bonjourHost.split(':')
			const port = Number(rawPort)
			if (ip.match(ipRegex) && !isNaN(port)) {
				this.connection.ip = ip
			}
		} else if (this.config.host) {
			if (this.config.host.match(ipRegex)) {
				this.connection.ip = this.config.host
			}
		}
		return null
	}

	sendCommand(command, value, type) {
		if (value || value === 0) {
			this.oscSend(this.connection.ip, 51000, `/mitti/${command}`, [
				{
					type: type ?? 's',
					value: value,
				},
			])
		} else {
			this.oscSend(this.connection.ip, 51000, `/mitti/${command}`, [])
		}
	}

	async conformCueID(context, cueID) {
		let cue = await context.parseVariablesInString(cueID)

		if (cue?.match(/^(current|selected|previous|next|all)$/)) {
			// Resolve "current" / "selected" to the concrete cue ID so feedbacks
			// that read `this.cues[id].<param>` actually find data. Mitti
			// broadcasts most per-cue toggle state under /mitti/<realID>/<param>
			// rather than under /mitti/current/<param>, so the alias cache misses
			// those. Actions still work — Mitti accepts both /mitti/current/<cmd>
			// and /mitti/<id>/<cmd> inbound. Leave "previous"/"next"/"all" as
			// the keyword: "all" is multi-cue by design, and previous/next have
			// no corresponding currentCueID-style state we can read here.
			if (cue === 'current' && this.states.currentCueID && this.states.currentCueID !== '-') {
				cue = this.states.currentCueID
			} else if (cue === 'selected' && this.states.selectedCueID && this.states.selectedCueID !== '-') {
				cue = this.states.selectedCueID
			} else {
				return cue
			}
			// fall through so a numeric position gets _pairedCueID treatment too
		}

		cue = cue.toUpperCase().slice(0, 6)

		// For purely-numeric input, see if the cue at that position has a custom
		// ID alias and substitute it. See _pairedCueID for why this is needed.
		if (/^\d+$/.test(cue)) {
			const alias = this._pairedCueID(cue)
			if (alias) {
				this.log('debug', `conformCueID: position ${cue} -> custom ID ${alias}`)
				cue = alias
			}
		}
		return cue
	}

	/**
	 * Mitti splits broadcasts for cues with a custom ID across two cueOrder
	 * entries: an "alias" entry (toggle states, no cueName) and a "position"
	 * entry (cueName + numeric properties, no toggles), with the alias
	 * broadcast immediately before its position counterpart. Inbound commands
	 * always go through the custom ID once set, so `/mitti/4/select` fails for
	 * a cue with custom ID "FLAG".
	 *
	 * Given either half of a pair, return the other half's identifier — or
	 * null if `id` is a regular (un-custom-ID'd) cue or not part of a pair.
	 */
	_pairedCueID(id) {
		const idx = this.cueOrder.indexOf(id)
		if (idx < 0) return null
		const entry = this.cues[id]
		if (!entry) return null

		const isAlias = entry.cueName === undefined && entry.toggleAudio !== undefined
		const isPosition = entry.cueName !== undefined && entry.toggleAudio === undefined

		if (isAlias && idx + 1 < this.cueOrder.length) {
			const candidate = this.cueOrder[idx + 1]
			const c = this.cues[candidate]
			if (c && c.cueName !== undefined && c.toggleAudio === undefined) return candidate
		} else if (isPosition && idx > 0) {
			const candidate = this.cueOrder[idx - 1]
			const c = this.cues[candidate]
			if (c && c.cueName === undefined && c.toggleAudio !== undefined) return candidate
		}
		return null
	}

	/**
	 * Resolve a cue identifier to its playlist position number, or null if it
	 * isn't a position-keyed entry. Mitti broadcasts `cueName` under the
	 * position-number path even for custom-ID cues, so `this.cues["4"]` (with
	 * cueName set) is position 4 regardless of any custom ID alias. A custom
	 * ID like "FLAG" resolves to its paired position via `_pairedCueID`.
	 */
	_positionForCueID(id) {
		if (!id || id === '-') return null
		if (/^\d+$/.test(id) && this.cues[id]?.cueName !== undefined) {
			return parseInt(id, 10)
		}
		const paired = this._pairedCueID(id)
		if (paired && /^\d+$/.test(paired)) return parseInt(paired, 10)
		return null
	}

	/**
	 * Refresh `prevSelectedCueName` / `nextSelectedCueName` from the current
	 * `selectedCueID`. Powers the Select Previous / Select Next presets, which
	 * need names relative to the selection cursor — distinct from Mitti's
	 * top-level `previousCueName` / `nextCueName` (those follow the playback
	 * cursor and don't shift when the user arrows through the playlist).
	 */
	_refreshSelectedNavCues() {
		const pos = this._positionForCueID(this.states.selectedCueID)
		const prev = pos !== null ? this.cues[String(pos - 1)]?.cueName : null
		const next = pos !== null ? this.cues[String(pos + 1)]?.cueName : null
		this.setVariableValues({
			prevSelectedCueName: prev ?? 'None',
			nextSelectedCueName: next ?? 'None',
		})
	}

	/**
	 * Derive the cueName of the currently-playing cue from `currentCueID`, NOT
	 * from `states.currentCueName`. During cue transitions Mitti broadcasts
	 * /mitti/currentCueID before /mitti/currentCueName, so the latter is stale
	 * (still the previous cue) when we want to cache the new cue's attributes.
	 * The per-cue path `this.cues[id].cueName` reflects the cue identified by
	 * `currentCueID` accurately. For split (custom-ID) cues, the alias entry
	 * has no cueName — fall back to the paired position entry. Returns null
	 * when we can't determine the name yet (skip the write rather than risk
	 * corrupting a sibling cue's cache entry).
	 */
	_currentCueName() {
		const id = this.states.currentCueID
		if (!id || id === '-') return null
		if (this.cues[id]?.cueName !== undefined) return this.cues[id].cueName
		const paired = this._pairedCueID(id)
		if (paired && this.cues[paired]?.cueName !== undefined) return this.cues[paired].cueName
		return null
	}

	/**
	 * Cache attributes against the currently-playing cue's name so we can look
	 * them up later when that name reappears as `selectedCueName` or
	 * `nextCueName`. Mitti only broadcasts TRT / loop / pauseAtEnd for the
	 * playing cue, never for the next/selected one — observing during play is
	 * the only path.
	 *
	 * Writes are debounced because Mitti's transition broadcasts arrive in an
	 * order we can't rely on — /mitti/currentCueTRT and /mitti/current/toggleX
	 * frequently arrive BEFORE /mitti/currentCueID updates, so resolving the
	 * cue name synchronously at write time would land the new cue's data in
	 * the previous cue's entry. Stashing attrs and flushing ~50 ms later gives
	 * the broadcast burst time to settle and `_currentCueName()` to resolve
	 * against the correct (new) `currentCueID`.
	 */
	_cacheCurrentCueAttributes(attrs) {
		if (!this._pendingCacheAttrs) this._pendingCacheAttrs = {}
		Object.assign(this._pendingCacheAttrs, attrs)
		if (this._cacheRefreshTimer) clearTimeout(this._cacheRefreshTimer)
		this._cacheRefreshTimer = setTimeout(() => this._flushPendingCache(), 50)
	}

	_flushPendingCache() {
		this._cacheRefreshTimer = null
		if (!this._pendingCacheAttrs || Object.keys(this._pendingCacheAttrs).length === 0) return
		const name = this._currentCueName()
		if (!name || name === '-') {
			// currentCueID-derived name still not available — retry a few times
			// to handle the case where currentCueID arrives well after the data.
			if (this._cacheRefreshRetries == null) this._cacheRefreshRetries = 0
			if (this._cacheRefreshRetries < 5) {
				this._cacheRefreshRetries++
				this._cacheRefreshTimer = setTimeout(() => this._flushPendingCache(), 50)
				return
			}
			// Give up; drop the pending attrs rather than guess.
			this._cacheRefreshRetries = 0
			this._pendingCacheAttrs = null
			return
		}
		this._cacheRefreshRetries = 0
		if (!this.cueCache[name]) this.cueCache[name] = {}
		Object.assign(this.cueCache[name], this._pendingCacheAttrs)
		this._pendingCacheAttrs = null
		this._refreshOnDeckFromCache()
	}

	/**
	 * Re-derive `currentCueLoop` / `currentCuePauseAtEnd` (and mirror into the
	 * on-deck cache) from the **per-cue** cache `this.cues[currentCueID]`,
	 * which is the trustworthy source for custom-ID cues. Mitti's
	 * `/mitti/current/toggleX` broadcasts are unreliable for split cues —
	 * they may not fire at all on cue change, or may carry the previous cue's
	 * stale state. The per-cue path always reflects reality.
	 */
	_refreshCurrentToggleStates() {
		const id = this.states.currentCueID
		if (!id || id === '-') return
		const lookup = (param) => {
			if (this.cues[id] && typeof this.cues[id][param] !== 'undefined') return this.cues[id][param]
			const paired = this._pairedCueID(id)
			return paired ? this.cues[paired]?.[param] : undefined
		}
		const updates = {}
		const cacheUpdates = {}
		const loop = lookup('toggleLoop')
		if (typeof loop !== 'undefined') {
			const on = loop > 0
			updates.currentCueLoop = on ? 'On' : 'Off'
			cacheUpdates.loop = on
		}
		const pe = lookup('togglePauseAtEnd')
		if (typeof pe !== 'undefined') {
			const on = pe > 0
			updates.currentCuePauseAtEnd = on ? 'On' : 'Off'
			cacheUpdates.pauseAtEnd = on
		}
		const audio = lookup('toggleAudio')
		if (typeof audio !== 'undefined') {
			const on = audio > 0
			updates.currentCueAudio = on ? 'Unmuted' : 'Muted'
			cacheUpdates.audio = on
		}
		if (Object.keys(updates).length > 0) this.setVariableValues(updates)
		if (Object.keys(cacheUpdates).length > 0) this._cacheCurrentCueAttributes(cacheUpdates)
	}

	/**
	 * Re-derive `selectedCue*` and `nextCue*` variables from `cueCache` and
	 * push a fresh display state. Called when the cache changes or when
	 * `selectedCueName` / `nextCueName` change. Variables show `'None'` when
	 * no entry is cached yet (cold-start until the cue has played once).
	 */
	_refreshOnDeckFromCache() {
		const fmtFlag = (v) => (v == null ? 'None' : v ? 'On' : 'Off')
		const fmtAudio = (v) => (v == null ? 'None' : v ? 'Unmuted' : 'Muted')
		const lookup = (name) => (!name || name === '-' ? null : (this.cueCache[name] ?? null))
		const sel = lookup(this.states.selectedCueName)
		const nxt = lookup(this.states.nextCueName)
		this.setVariableValues({
			selectedCueTRT: sel?.trtShort ?? 'None',
			selectedCueTRT_hhmmss: sel?.trtFull ?? 'None',
			selectedCueLoop: fmtFlag(sel?.loop),
			selectedCuePauseAtEnd: fmtFlag(sel?.pauseAtEnd),
			selectedCueAudio: fmtAudio(sel?.audio),
			nextCueTRT: nxt?.trtShort ?? 'None',
			nextCueTRT_hhmmss: nxt?.trtFull ?? 'None',
			nextCueLoop: fmtFlag(nxt?.loop),
			nextCuePauseAtEnd: fmtFlag(nxt?.pauseAtEnd),
			nextCueAudio: fmtAudio(nxt?.audio),
		})
		this._broadcastDisplayState()
	}

	async initOSC() {
		this.cues = {}
		this.cueOrder = []
		this.cueCache = {}
		this.states = {}

		if (this.listener) {
			this.listener.close()
		}
		const feedbackPort = isNaN(parseInt(this.config.feedbackPort)) ? 51001 : this.config.feedbackPort

		this.listener = new OSC.UDPPort({
			localAddress: '0.0.0.0',
			localPort: feedbackPort,
			metadata: true,
		})

		this.listener.open()

		this.listener.on('ready', async () => {
			this.updateStatus(InstanceStatus.Ok)
			this.connection.connected = true

			this.sendCommand('resendOSCFeedback')

			if (this.config.feedbackAlert) {
				this.startTestService()
			} else {
				this.stopTestService()
			}

			await this.startBonjourService()
		})

		this.listener.on('error', (err) => {
			this.connection.connected = false
			if (err.code == 'EADDRINUSE') {
				this.log('error', `Error: Selected feedback port ${err.message.split(':')[1]} is already in use.`)
				this.updateStatus(InstanceStatus.BadConfig, 'Feedback port conflict')
			} else {
				this.log('error', `Error: ${err.message}`)
				this.updateStatus(InstanceStatus.BadConfig, 'Feedback Unavailable')
			}
		})

		this.listener.on('message', (message) => {
			const address = message?.address
			const value = message?.args?.[0]?.value

			if (!address || typeof address !== 'string') {
				return
			}

			if (address.match(/(^\/mitti\/current\/)/i)) {
				const cueInfo = address.match(/(\/mitti\/current\/)(\S*)/i)
				const param = cueInfo?.[2]
				if (param) {
					this.processCueUpdate('current', param, value)
				}
			} else if (address.match(/(^\/mitti\/\S*\/)/i)) {
				const cueInfo = address.match(/(\/mitti\/)(\S*)(\/)(\S*)/i)
				const cue = cueInfo?.[2]
				const param = cueInfo?.[4]

				if (cue && param && cue !== 'current') {
					this.processCueUpdate(cue, param, value)
				}
			} else {
				const sanitizedAddress = address.replace('/mitti/', '')
				this.processListenerUpdate(sanitizedAddress, value)
			}
		})
	}

	testConnection() {
		this.connection.testService = setInterval(() => {
			this.sendCommand('ping')

			this.connection.testTimeout = setTimeout(() => {
				if (Date.now() - 4000 > this.connection.lastPong) {
					if (this.connection.connected === true) {
						this.connection.connected = false
						this.updateStatus(InstanceStatus.ConnectionFailure, 'Feedback Unavailable')
						this.log(
							'error',
							'Feedback unavailable, unable to receive response from Mitti. Check you OSC Feedback settings in both Mitti and Companion.',
						)
					}
				} else {
					if (this.connection.connected === false) {
						this.connection.connected = true
						this.updateStatus(InstanceStatus.Ok)
						this.log('info', 'Connected to Mitti')
					}
				}
			}, 2000)
		}, 4000)
	}

	startTestService() {
		this.stopTestService()
		this.log('debug', 'Starting Connection Test')
		this.testConnection()
	}

	stopTestService() {
		if (this.connection.testService) {
			this.log('debug', 'Stopping Connection Test')
			clearInterval(this.connection.testService)
			this.connection.testService = null
		}
		if (this.connection.testTimeout) {
			clearTimeout(this.connection.testTimeout)
			this.connection.testTimeout = null
		}
	}

	async startBonjourService() {
		await this.stopBonjourService()

		const feedbackPort = isNaN(parseInt(this.config.feedbackPort)) ? 51001 : this.config.feedbackPort
		const name = `Companion-Mitti-Module:${feedbackPort}`

		try {
			this.connection.bonjour = new Bonjour()

			this.connection.bonjourService = this.connection.bonjour.publish({
				name: name,
				type: 'osc',
				port: feedbackPort,
				protocol: 'udp',
				disableIPv6: true,
			})

			this.connection.bonjourService.on('up', () => {
				this.log('debug', `Bonjour advertised as ${name}`)
			})

			this.connection.bonjourService.on('error', (err) => {
				this.log('debug', `Bonjour error: ${err}`)
			})
		} catch (e) {
			this.log('error', `Error advertising Bonjour discovery service: ${e}`)
			// Clean up if we created the Bonjour instance but failed to publish
			if (this.connection.bonjour) {
				try {
					this.connection.bonjour.destroy()
				} catch (destroyErr) {
					this.log('error', `Error destroying Bonjour instance: ${destroyErr}`)
				}
				this.connection.bonjour = null
			}
		}
	}

	async stopBonjourService() {
		// Stop the service explicitly first
		if (this.connection.bonjourService) {
			try {
				this.connection.bonjourService.stop()
			} catch (e) {
				this.log('error', `Error stopping Bonjour service: ${e}`)
			}
			// Remove event listeners from service before cleanup
			this.connection.bonjourService.removeAllListeners()
			this.connection.bonjourService = null
		}

		if (this.connection.bonjour) {
			try {
				await new Promise((resolve) => {
					try {
						this.connection.bonjour.unpublishAll(() => {
							this.log('debug', `Bonjour advertisement destroyed`)
							try {
								this.connection.bonjour.destroy()
								this.log('debug', `Bonjour instance destroyed`)
							} catch (destroyErr) {
								this.log('error', `Error destroying Bonjour instance: ${destroyErr}`)
							} finally {
								this.connection.bonjour = null
								resolve()
							}
						})
					} catch (e) {
						this.log('error', `Error stopping Bonjour instance: ${e}`)
						this.connection.bonjour = null
						resolve()
					}
				})
			} catch (e) {
				this.log('error', `Error stopping Bonjour instance: ${e}`)
				this.connection.bonjour = null
			}
		}
	}

	processListenerUpdate(address, value) {
		switch (address) {
			case 'currentCueName': {
				const prevCueName = this.states.currentCueName
				this.states.currentCueName = value
				this.setVariableValues({ currentCueName: value != '-' ? value : 'None' })
				this.checkFeedbacks('playingCueName', 'playingCueID', 'activeCueName')
				if (prevCueName !== undefined && prevCueName !== value) {
					// Cue changed — the old clip's elapsed/duration belong to a different clip now.
					// Clear them so playing computes false until the new clip's elapsed actually advances.
					this.states.elapsedSec = 0
					this.states.remainingSec = 0
					this.states.durationSec = 0
					this.states.lastElapsedAt = 0
				}
				this._broadcastDisplayState()
				break
			}
			case 'currentCueID':
				this.states.currentCueID = value
				this.setVariableValues({ currentCueID: value != '-' ? value : 'None' })
				this.checkFeedbacks('playingCueName', 'playingCueID', 'activeCueID')
				// Re-derive from the per-cue path — Mitti's /mitti/current/toggleX
				// broadcasts go stale on transitions to/from custom-ID cues.
				this._refreshCurrentToggleStates()
				break
			case 'previousCueName':
				this.setVariableValues({ previousCueName: value != '-' ? value : 'None' })
				break
			case 'nextCueName':
				this.states.nextCueName = value
				this.setVariableValues({ nextCueName: value != '-' ? value : 'None' })
				this._refreshOnDeckFromCache()
				break
			case 'selectedCueName':
				this.states.selectedCueName = value
				this.setVariableValues({ selectedCueName: value != '-' ? value : 'None' })
				this.checkFeedbacks('selectedCueName')
				this._refreshOnDeckFromCache()
				break
			case 'selectedCueID':
				this.states.selectedCueID = value
				this.setVariableValues({ selectedCueID: value != '-' ? value : 'None' })
				this.checkFeedbacks('selectedCueID')
				this._refreshSelectedNavCues()
				break
			case 'cueTimeLeft':
				{
					let cueTimeLeft = value
					let cueTimeLeftSplit = cueTimeLeft.match(/^-(?<hh>\d\d):(?<mm>\d\d):(?<ss>\d\d)(?::(?<ff>\d\d))?/i)
					if (cueTimeLeftSplit) {
						let cueTimeLeftHH = cueTimeLeftSplit?.groups?.hh
						let cueTimeLeftMM = cueTimeLeftSplit?.groups?.mm
						let cueTimeLeftSS = cueTimeLeftSplit?.groups?.ss
						let cueTimeLeftFF = cueTimeLeftSplit?.groups?.ff ?? '00'
						let cueTimeLeftShort = `-${cueTimeLeftHH == '00' ? '' : cueTimeLeftHH + ':'}${cueTimeLeftMM}:${cueTimeLeftSS}`
						let cueTimeLeftFull = `-${cueTimeLeftHH}:${cueTimeLeftMM}:${cueTimeLeftSS}`
						// Drop leading zero segments; minimum is -SS:FF.
						let cueTimeLeftHmsf
						if (cueTimeLeftHH !== '00') {
							cueTimeLeftHmsf = `-${cueTimeLeftHH}:${cueTimeLeftMM}:${cueTimeLeftSS}:${cueTimeLeftFF}`
						} else if (cueTimeLeftMM !== '00') {
							cueTimeLeftHmsf = `-${cueTimeLeftMM}:${cueTimeLeftSS}:${cueTimeLeftFF}`
						} else {
							cueTimeLeftHmsf = `-${cueTimeLeftSS}:${cueTimeLeftFF}`
						}

						this.setVariableValues({
							cueTimeLeft: cueTimeLeftShort,
							cueTimeLeft_hhmmss: cueTimeLeftFull,
							cueTimeLeft_hhmmssff: cueTimeLeftHmsf,
							cueTimeLeft_h: cueTimeLeftHH,
							cueTimeLeft_m: cueTimeLeftMM,
							cueTimeLeft_s: cueTimeLeftSS,
						})
						this.states.timeRemaining =
							parseInt(cueTimeLeftHH) * 120 + parseInt(cueTimeLeftMM) * 60 + parseInt(cueTimeLeftSS)
						this.states.remainingSec =
							parseInt(cueTimeLeftHH) * 3600 + parseInt(cueTimeLeftMM) * 60 + parseInt(cueTimeLeftSS)
						this.checkFeedbacks('timeRemaining')
						this._broadcastDisplayState()

						const atOutPoint =
							cueTimeLeftHH === '00' && cueTimeLeftMM === '00' && cueTimeLeftSS === '00' && cueTimeLeftFF === '00'
						if (this.states.atOutPoint !== atOutPoint) {
							this.states.atOutPoint = atOutPoint
							this.checkFeedbacks('atOutPoint')
						}
					}
				}
				break
			case 'cueTimeElapsed':
				{
					let cueTimeElapsed = value
					let cueTimeElapsedSplit = cueTimeElapsed.match(/^(?<hh>\d\d):(?<mm>\d\d):(?<ss>\d\d)(?::(?<ff>\d\d))?/i)
					if (cueTimeElapsedSplit) {
						let cueTimeElapsedHH = cueTimeElapsedSplit?.groups?.hh
						let cueTimeElapsedMM = cueTimeElapsedSplit?.groups?.mm
						let cueTimeElapsedSS = cueTimeElapsedSplit?.groups?.ss
						let cueTimeElapsedFF = cueTimeElapsedSplit?.groups?.ff ?? '00'
						let cueTimeElapsedShort = `${
							cueTimeElapsedHH == '00' ? '' : cueTimeElapsedMM + ':'
						}${cueTimeElapsedMM}:${cueTimeElapsedSS}`
						let cueTimeElapsedFull = `${cueTimeElapsedHH}:${cueTimeElapsedMM}:${cueTimeElapsedSS}`
						// Drop leading zero segments; minimum is SS:FF.
						let cueTimeElapsedHmsf
						if (cueTimeElapsedHH !== '00') {
							cueTimeElapsedHmsf = `${cueTimeElapsedHH}:${cueTimeElapsedMM}:${cueTimeElapsedSS}:${cueTimeElapsedFF}`
						} else if (cueTimeElapsedMM !== '00') {
							cueTimeElapsedHmsf = `${cueTimeElapsedMM}:${cueTimeElapsedSS}:${cueTimeElapsedFF}`
						} else {
							cueTimeElapsedHmsf = `${cueTimeElapsedSS}:${cueTimeElapsedFF}`
						}

						this.setVariableValues({
							cueTimeElapsed: cueTimeElapsedShort,
							cueTimeElapsed_hhmmss: cueTimeElapsedFull,
							cueTimeElapsed_hhmmssff: cueTimeElapsedHmsf,
							cueTimeElapsed_h: cueTimeElapsedHH,
							cueTimeElapsed_m: cueTimeElapsedMM,
							cueTimeElapsed_s: cueTimeElapsedSS,
						})
						this.states.elapsedSec =
							parseInt(cueTimeElapsedHH) * 3600 + parseInt(cueTimeElapsedMM) * 60 + parseInt(cueTimeElapsedSS)
						this.states.lastElapsedAt = Date.now()
						this._broadcastDisplayState()

						const atInPoint =
							cueTimeElapsedHH === '00' &&
							cueTimeElapsedMM === '00' &&
							cueTimeElapsedSS === '00' &&
							cueTimeElapsedFF === '00'
						if (this.states.atInPoint !== atInPoint) {
							this.states.atInPoint = atInPoint
							this.checkFeedbacks('atInPoint')
						}
					}
				}
				break
			case 'currentCueTRT':
				{
					let currentCueTRT = value
					let cueTimeSplit = currentCueTRT.match(/^(?<hh>\d\d):(?<mm>\d\d):(?<ss>\d\d)/i)
					if (cueTimeSplit) {
						let cueTimeHH = cueTimeSplit?.groups?.hh
						let cueTimeMM = cueTimeSplit?.groups?.mm
						let cueTimeSS = cueTimeSplit?.groups?.ss
						let cueTimeShort = `${cueTimeHH == '00' ? '' : cueTimeHH + ':'}${cueTimeMM}:${cueTimeSS}`
						let cueTimeFull = `${cueTimeHH}:${cueTimeMM}:${cueTimeSS}`

						this.setVariableValues({
							currentCueTRT: cueTimeShort,
							currentCueTRT_hhmmss: cueTimeFull,
							currentCueTRT_h: cueTimeHH,
							currentCueTRT_m: cueTimeMM,
							currentCueTRT_s: cueTimeSS,
						})
						this.states.durationSec = parseInt(cueTimeHH) * 3600 + parseInt(cueTimeMM) * 60 + parseInt(cueTimeSS)
						this._cacheCurrentCueAttributes({
							trtShort: cueTimeShort,
							trtFull: cueTimeFull,
							trtSec: this.states.durationSec,
						})
						this._broadcastDisplayState()
					}
				}
				break
			case 'currentCueVolume':
				this.states.currentCueName = value
				this.setVariableValues({ currentCueName: value != '-' ? value : 'None' })
				this.checkFeedbacks('playingCueName', 'playingCueID', 'activeCueName')
				break
			case 'togglePlay': {
				const wasPlaying = this.states.playing === 'Playing'
				this.states.playing = value === 0 ? 'Paused' : 'Playing'
				this.setVariableValues({ playStatus: this.states.playing })
				this.checkFeedbacks('playStatus', 'playingCueName', 'playingCueID')
				if (this.states.playing === 'Playing' && !wasPlaying) {
					this._requestResyncFromMitti()
				}
				this._broadcastDisplayState()
				break
			}
			case 'playhead':
				this.states.playhead = value
				break
			case 'toggleVideoOutputs':
				this.states.videoOutputs = value == 1 ? true : false
				this.setVariableValues({ video_outputs: this.states.videoOutputs ? 'Active' : 'Off' })
				this.checkFeedbacks('videoOutputs')
				break
			case 'toggleAudio':
				this.states.audioOutputs = value == 1 ? true : false
				this.setVariableValues({ audio_outputs: this.states.audioOutputs ? 'Active' : 'Off' })
				this.checkFeedbacks('audioOutputs')
				break
			case 'inFromPlayheadEnabled':
				this.states.inFromPlayheadEnabled = value == 1 ? true : false
				this.checkFeedbacks('inFromPlayheadEnabled')
				break
			case 'outFromPlayheadEnabled':
				this.states.outFromPlayheadEnabled = value == 1 ? true : false
				this.checkFeedbacks('outFromPlayheadEnabled')
				break
			case 'pong':
				this.connection.lastPong = Date.now()
				break
			default:
				break
		}
	}

	processCueUpdate(cue, param, value) {
		if (cue === 'current') {
			if (!this.cues[cue]) {
				this.cues[cue] = {}
			}
			this.cues[cue][param] = value
			// For split (custom-ID) cues, Mitti's /mitti/current/toggleX broadcast
			// is unreliable — it may not fire on cue change, or may carry the
			// previous cue's stale state. Skip the variable + cache update for
			// these params; the per-cue path (handled in the cue=<id> branch
			// below) is the trustworthy source and fires _refreshCurrentToggleStates.
			if (
				(param === 'toggleLoop' || param === 'togglePauseAtEnd' || param === 'toggleAudio') &&
				this._pairedCueID(this.states.currentCueID) !== null
			) {
				return
			}
			// Mirror loop / pause-at-end / audio state into the name-keyed cache
			// so we can show it for the selected / next cue later. Verified
			// raw=1 means feature ON via debug logs.
			if (param === 'toggleLoop') {
				this._cacheCurrentCueAttributes({ loop: value > 0 })
			} else if (param === 'togglePauseAtEnd') {
				this._cacheCurrentCueAttributes({ pauseAtEnd: value > 0 })
			} else if (param === 'toggleAudio') {
				this._cacheCurrentCueAttributes({ audio: value > 0 })
			}
			if (param.match(/^toggle/)) {
				if (param === 'Audio') {
					value = value > 0 ? 'Unmuted' : 'Muted'
				} else {
					value = value > 0 ? 'On' : 'Off'
				}
				param = param.replace('toggle', '')
				param = `currentCue${param}`
			} else {
				param = param.charAt(0).toUpperCase() + param.slice(1)
				if (param === 'VolumeAsDecibels') {
					this.states.currentCueVolume = value
					param = 'Volume'
					value = Math.round(value * 100) / 100
				}
				if (param === 'PlaybackSpeed') {
					this.states.currentCuePlaybackSpeed = value
				}

				param = `currentCue${param}`
			}

			this.setVariableValues({ [`${param}`]: value })
		} else if (cue === 'previous' || cue === 'next') {
			if (!this.cues[cue]) {
				this.cues[cue] = {}
			}
			this.cues[cue][param] = value
		} else {
			// Track playlist order by first-seen for every real cue identifier.
			// On `resendOSCFeedback` Mitti broadcasts cues in playlist order, so
			// `cueOrder[N-1]` gives the effective ID of the cue at position N.
			// `conformCueID` uses this to translate a numeric input (e.g. "4")
			// to the custom-ID-bearing path Mitti actually listens on.
			if (cue != 0 && !this.cueOrder.includes(cue)) {
				this.cueOrder.push(cue)
			}
			if (!this.cues[cue]?.cueName && cue != 0 && param === 'cueName') {
				if (!this.cues[cue]) {
					this.cues[cue] = {}
				}
				this.cues[cue][param] = value
				this.initVariables()
				this.initPresets()
				this.setVariableValues({ [`cue_${cue}_cueName`]: value })
			} else if (this.cues[cue] && cue != 0 && param === 'deleted') {
				const idx = this.cueOrder.indexOf(cue)
				if (idx !== -1) this.cueOrder.splice(idx, 1)
				delete this.cues[cue]
				this.initVariables()
				this.initPresets()
			} else {
				if (!this.cues[cue]) {
					this.cues[cue] = {}
				}
				this.cues[cue][param] = value

				// Per-cue toggle broadcasts for the currently-playing cue are the
				// trustworthy source for `currentCueLoop` / `currentCuePauseAtEnd`
				// / `currentCueAudio` and the on-deck cache — see
				// _refreshCurrentToggleStates for why. Handles toggle changes made
				// while a cue is playing; cue-transition changes are covered by
				// the case 'currentCueID' refresh.
				if (
					cue === this.states.currentCueID &&
					(param === 'toggleLoop' || param === 'togglePauseAtEnd' || param === 'toggleAudio')
				) {
					const on = value > 0
					if (param === 'toggleLoop') {
						this.setVariableValues({ currentCueLoop: on ? 'On' : 'Off' })
						this._cacheCurrentCueAttributes({ loop: on })
					} else if (param === 'togglePauseAtEnd') {
						this.setVariableValues({ currentCuePauseAtEnd: on ? 'On' : 'Off' })
						this._cacheCurrentCueAttributes({ pauseAtEnd: on })
					} else {
						this.setVariableValues({ currentCueAudio: on ? 'Unmuted' : 'Muted' })
						this._cacheCurrentCueAttributes({ audio: on })
					}
				}

				switch (param) {
					case 'cueName': {
						this.setVariableValues({ [`cue_${cue}_cueName`]: value })
						// Mirror to the custom-ID alias so `cue_FLAG_cueName` and
						// the position's `cue_4_cueName` stay in sync.
						const alias = this._pairedCueID(cue)
						if (alias) this.setVariableValues({ [`cue_${alias}_cueName`]: value })
						// Renaming a cue may affect the displayed prev/next-of-selected names.
						this._refreshSelectedNavCues()
						break
					}
					case 'toggleAudio':
						this.checkFeedbacks('cueAudioStatus')
						break
					case 'togglePauseAtBeginning':
						this.checkFeedbacks('cuePauseAtBeginningStatus')
						break
					case 'togglePauseAtEnd':
						this.checkFeedbacks('cuePauseAtEndStatus')
						break
					case 'toggleFadeIn':
						this.checkFeedbacks('cueFadeInStatus')
						break
					case 'toggleFadeOut':
						this.checkFeedbacks('cueFadeOutStatus')
						break
					case 'toggleLoop':
						this.checkFeedbacks('cueLoopStatus')
						break
					case 'toggleTransition':
						this.checkFeedbacks('cueTransitionStatus')
						break
					case 'toggleGoto':
						this.checkFeedbacks('cueGotoStatus')
						break
					default:
						break
				}
			}
		}
	}
}
runEntrypoint(MittiInstance, UpgradeScripts)
