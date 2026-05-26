/**
 * MittiDisplay — Self-contained browser component for Mitti playback countdown.
 * Embeddable in multiview-hud.
 *
 * Usage:
 *   var display = new MittiDisplay(container, { wsUrl: 'ws://host:4666' });
 *   display.destroy();
 */
;(function () {
	'use strict'

	function MittiDisplay(container, options) {
		this.container = typeof container === 'string' ? document.querySelector(container) : container
		this.options = options || {}
		this.ws = null
		this.reconnectTimer = null
		this.state = null
		this.elements = {}
		this.init()
	}

	MittiDisplay.prototype.init = function () {
		this._injectStyles()
		this._createDOM()
		this._connect()
	}

	MittiDisplay.prototype._injectStyles = function () {
		if (document.getElementById('mvhud-mitti-display-styles')) return

		var style = document.createElement('style')
		style.id = 'mvhud-mitti-display-styles'
		style.textContent = [
			'.mvhud-mitti-display {',
			'  container-type: inline-size;',
			'  width: 100%;',
			'  height: 100%;',
			'  background: #111;',
			'  color: #fff;',
			"  font-family: 'Lekton-Bold', monospace;",
			'  display: flex;',
			'  flex-direction: column;',
			'  align-items: center;',
			'  justify-content: center;',
			'  overflow: hidden;',
			'  position: relative;',
			'  box-sizing: border-box;',
			'  border-radius: 2cqi;',
			'  gap: 1cqi;',
			'}',
			'.mvhud-mitti-display * { box-sizing: border-box; }',
			'.mvhud-mitti-display__playback {',
			'  width: 90%;',
			'  max-width: 100%;',
			'  display: flex;',
			'  flex-direction: column;',
			'  gap: 0.5cqi;',
			'}',
			// Top row: clip name on the left, TRT label + time on the right.
			// Same font size + color for everything on the row.
			'.mvhud-mitti-display__header {',
			'  display: flex;',
			'  align-items: baseline;',
			'  gap: 1cqi;',
			'  font-size: 4cqi;',
			'  font-weight: 600;',
			'  color: #ddd;',
			'  line-height: 1;',
			'}',
			'.mvhud-mitti-display__clip-name {',
			'  flex: 1 1 auto;',
			'  min-width: 0;',
			'  white-space: nowrap;',
			'  overflow: hidden;',
			'  text-overflow: ellipsis;',
			'}',
			'.mvhud-mitti-display__header-trt {',
			'  flex: 0 0 auto;',
			'  display: flex;',
			'  gap: 0.5cqi;',
			'  white-space: nowrap;',
			'}',
			// `countdown-area` wraps the live countdown plus its overlay siblings:
			// current-cue icons in the upper-right and the current-cue TRT in the
			// lower-right. Both overlays are absolutely positioned so they don't
			// shift the centered countdown text.
			'.mvhud-mitti-display__countdown-area {',
			'  position: relative;',
			'  width: 100%;',
			'}',
			'.mvhud-mitti-display__countdown {',
			"  font-family: 'Lekton-Bold', monospace;",
			'  font-size: 18cqi;',
			'  line-height: 1;',
			'  text-align: center;',
			'  color: #f33;',
			'}',
			'.mvhud-mitti-display__current-icons {',
			'  position: absolute;',
			'  top: 20px;',
			'  right: 0;',
			'  display: flex;',
			'  flex-direction: column;',
			'  align-items: flex-end;',
			'  gap: 1cqi;',
			'}',
			'.mvhud-mitti-display__current-icon {',
			'  width: 6cqi;',
			'  height: 6cqi;',
			'  background-color: #f33;',
			'  mask-size: contain;',
			'  mask-repeat: no-repeat;',
			'  mask-position: center;',
			'  -webkit-mask-size: contain;',
			'  -webkit-mask-repeat: no-repeat;',
			'  -webkit-mask-position: center;',
			'}',
			// Shared mask-image declarations so both on-deck and current icon
			// classes pick them up via their --modifier suffixes. Color comes
			// from each context's background-color (green on-deck, red current).
			'.mvhud-mitti-display__on-deck__icon--audio,',
			'.mvhud-mitti-display__current-icon--audio {',
			"  mask-image: url('/icons/audio.svg');",
			"  -webkit-mask-image: url('/icons/audio.svg');",
			'}',
			'.mvhud-mitti-display__on-deck__icon--loop,',
			'.mvhud-mitti-display__current-icon--loop {',
			"  mask-image: url('/icons/looping.svg');",
			"  -webkit-mask-image: url('/icons/looping.svg');",
			'}',
			'.mvhud-mitti-display__on-deck__icon--pause-end,',
			'.mvhud-mitti-display__current-icon--pause-end {',
			"  mask-image: url('/icons/pause-end.svg');",
			"  -webkit-mask-image: url('/icons/pause-end.svg');",
			'}',
			'.mvhud-mitti-display__progress-track {',
			'  width: 100%;',
			'  height: 3cqi;',
			'  background: #333;',
			'  border-radius: 1.5cqi;',
			'  overflow: hidden;',
			'}',
			'.mvhud-mitti-display__progress-bar {',
			'  height: 100%;',
			'  background: #0af;',
			'  border-radius: 1.5cqi;',
			'  transition: width 0.15s linear;',
			'  width: 0%;',
			'}',
			'.mvhud-mitti-display__idle {',
			'  font-size: 6cqi;',
			'  color: #555;',
			'  text-align: center;',
			'}',
			// On-deck row sits below the playback area regardless of play state, so
			// the operator can see what would play next while live OR while idle.
			// Green color follows the broadcast convention of preview/preset.
			'.mvhud-mitti-display__on-deck {',
			'  width: 90%;',
			'  max-width: 100%;',
			'  display: flex;',
			'  align-items: center;',
			'  gap: 1cqi;',
			'  font-size: 3cqi;',
			'  color: #0c0;',
			'  white-space: nowrap;',
			'  min-width: 0;',
			'}',
			'.mvhud-mitti-display__on-deck__label { flex: 0 0 auto; color: #777; }',
			'.mvhud-mitti-display__on-deck__name {',
			'  flex: 1 1 auto;',
			'  min-width: 0;',
			'  overflow: hidden;',
			'  text-overflow: ellipsis;',
			'}',
			'.mvhud-mitti-display__on-deck__trt { flex: 0 0 auto; }',
			// Icon via CSS mask so we can recolor the SVG to match the green of the
			// surrounding text. The SVGs are served by the display server at /icons/.
			'.mvhud-mitti-display__on-deck__icon {',
			'  flex: 0 0 auto;',
			'  width: 3cqi;',
			'  height: 3cqi;',
			'  background-color: #0c0;',
			'  mask-size: contain;',
			'  mask-repeat: no-repeat;',
			'  mask-position: center;',
			'  -webkit-mask-size: contain;',
			'  -webkit-mask-repeat: no-repeat;',
			'  -webkit-mask-position: center;',
			'}',
			'.mvhud-mitti-display__status {',
			'  position: absolute;',
			'  bottom: 2cqi;',
			'  right: 2cqi;',
			'  width: 2cqi;',
			'  height: 2cqi;',
			'  min-width: 6px;',
			'  min-height: 6px;',
			'  border-radius: 50%;',
			'  background: #555;',
			'}',
			'.mvhud-mitti-display__status--connected { background: #0c0; }',
		].join('\n')

		document.head.appendChild(style)
	}

	MittiDisplay.prototype._createDOM = function () {
		this.container.innerHTML = ''

		var root = document.createElement('div')
		root.className = 'mvhud-mitti-display'

		var playback = document.createElement('div')
		playback.className = 'mvhud-mitti-display__playback'

		var header = document.createElement('div')
		header.className = 'mvhud-mitti-display__header'

		var clipName = document.createElement('div')
		clipName.className = 'mvhud-mitti-display__clip-name'
		header.appendChild(clipName)
		this.elements.clipName = clipName

		var headerTRT = document.createElement('div')
		headerTRT.className = 'mvhud-mitti-display__header-trt'

		var headerTRTLabel = document.createElement('span')
		headerTRTLabel.textContent = 'TRT:'
		headerTRT.appendChild(headerTRTLabel)

		var currentTRTTime = document.createElement('span')
		headerTRT.appendChild(currentTRTTime)
		this.elements.currentTRTTime = currentTRTTime
		this.elements.currentTRT = headerTRT

		header.appendChild(headerTRT)
		playback.appendChild(header)

		var countdownArea = document.createElement('div')
		countdownArea.className = 'mvhud-mitti-display__countdown-area'

		var currentIcons = document.createElement('div')
		currentIcons.className = 'mvhud-mitti-display__current-icons'

		var currentAudio = document.createElement('span')
		currentAudio.className = 'mvhud-mitti-display__current-icon'
		currentIcons.appendChild(currentAudio)
		this.elements.currentAudio = currentAudio

		var currentIcon = document.createElement('span')
		currentIcon.className = 'mvhud-mitti-display__current-icon'
		currentIcons.appendChild(currentIcon)
		this.elements.currentIcon = currentIcon

		countdownArea.appendChild(currentIcons)

		var countdown = document.createElement('div')
		countdown.className = 'mvhud-mitti-display__countdown'
		countdown.textContent = '-0:00'
		countdownArea.appendChild(countdown)
		this.elements.countdown = countdown

		playback.appendChild(countdownArea)

		var progressTrack = document.createElement('div')
		progressTrack.className = 'mvhud-mitti-display__progress-track'
		var progressBar = document.createElement('div')
		progressBar.className = 'mvhud-mitti-display__progress-bar'
		progressTrack.appendChild(progressBar)
		playback.appendChild(progressTrack)
		this.elements.progressTrack = progressTrack
		this.elements.progressBar = progressBar

		root.appendChild(playback)
		this.elements.playback = playback

		var idle = document.createElement('div')
		idle.className = 'mvhud-mitti-display__idle'
		idle.textContent = 'Mitti — idle'
		idle.style.display = 'none'
		root.appendChild(idle)
		this.elements.idle = idle

		var onDeck = document.createElement('div')
		onDeck.className = 'mvhud-mitti-display__on-deck'
		onDeck.style.display = 'none'

		var onDeckLabel = document.createElement('span')
		onDeckLabel.className = 'mvhud-mitti-display__on-deck__label'
		onDeckLabel.textContent = 'on deck:'
		onDeck.appendChild(onDeckLabel)

		var onDeckName = document.createElement('span')
		onDeckName.className = 'mvhud-mitti-display__on-deck__name'
		onDeck.appendChild(onDeckName)
		this.elements.onDeckName = onDeckName

		var onDeckTRT = document.createElement('span')
		onDeckTRT.className = 'mvhud-mitti-display__on-deck__trt'
		onDeck.appendChild(onDeckTRT)
		this.elements.onDeckTRT = onDeckTRT

		var onDeckAudio = document.createElement('span')
		onDeckAudio.className = 'mvhud-mitti-display__on-deck__icon'
		onDeck.appendChild(onDeckAudio)
		this.elements.onDeckAudio = onDeckAudio

		var onDeckIcon = document.createElement('span')
		onDeckIcon.className = 'mvhud-mitti-display__on-deck__icon'
		onDeck.appendChild(onDeckIcon)
		this.elements.onDeckIcon = onDeckIcon

		root.appendChild(onDeck)
		this.elements.onDeck = onDeck

		var status = document.createElement('div')
		status.className = 'mvhud-mitti-display__status'
		root.appendChild(status)
		this.elements.status = status

		this.container.appendChild(root)
	}

	MittiDisplay.prototype._connect = function () {
		var self = this
		var wsUrl = this.options.wsUrl || 'ws://' + window.location.host

		try {
			this.ws = new WebSocket(wsUrl)
		} catch {
			this._scheduleReconnect()
			return
		}

		this.ws.onopen = function () {
			self._setConnected(true)
			try {
				self.ws.send(JSON.stringify({ type: 'get_state' }))
			} catch {
				// ignore
			}
		}

		this.ws.onmessage = function (event) {
			try {
				var message = JSON.parse(event.data)
				if (message && message.type === 'state') {
					self._updateDisplay(message.data)
				}
			} catch {
				// ignore malformed messages
			}
		}

		this.ws.onclose = function () {
			self._setConnected(false)
			self._scheduleReconnect()
		}

		this.ws.onerror = function () {
			if (self.ws) self.ws.close()
		}
	}

	MittiDisplay.prototype._scheduleReconnect = function () {
		var self = this
		if (this.reconnectTimer) return
		this.reconnectTimer = setTimeout(function () {
			self.reconnectTimer = null
			self._connect()
		}, 2000)
	}

	MittiDisplay.prototype._setConnected = function (connected) {
		if (!this.elements.status) return
		this.elements.status.className =
			'mvhud-mitti-display__status' + (connected ? ' mvhud-mitti-display__status--connected' : '')
	}

	MittiDisplay.prototype._updateDisplay = function (data) {
		this.state = data

		// `hasCue` (v3.11.2+) is the gate for "show the cue vs show idle" —
		// stays true when paused-at-end and across loop boundaries. Older
		// states without the field fall back to `playing` for compatibility.
		var hasCue = data && (data.hasCue != null ? data.hasCue : data.playing)
		if (!hasCue) {
			this.elements.playback.style.display = 'none'
			this.elements.idle.style.display = ''
		} else {
			this.elements.playback.style.display = ''
			this.elements.idle.style.display = 'none'

			this.elements.clipName.textContent = data.clipName || ''
			// Prefix with "-" so the countdown reads as time remaining (e.g. "-1:23").
			this.elements.countdown.textContent = '-' + this._formatTime(data.remaining)

			var duration = data.duration || 0
			var elapsed = data.elapsed || 0
			// Compute progress against (duration - 1) so the bar reaches full
			// at the 1-second-remaining mark and stays full through 0:00.
			// `elapsed`/`duration` are integer-second values, so the last
			// second of playback can carry sub-second / frame-level time the
			// widget can't see. Without this, the bar would either fall short
			// at 0:00 (truncated frames look like missing progress) or lunge
			// the last second's worth all at once when remaining ticks to 0.
			var progress = 0
			if (duration > 1) {
				progress = Math.max(0, Math.min(1, elapsed / (duration - 1)))
			} else if (duration > 0) {
				progress = Math.max(0, Math.min(1, elapsed / duration))
			}
			this.elements.progressBar.style.width = progress * 100 + '%'

			this._updateCurrentExtras(data)
		}

		this._updateOnDeck(data)
	}

	MittiDisplay.prototype._updateCurrentExtras = function (data) {
		// TRT in the lower-right of the countdown area. Hidden if duration is
		// unknown (Mitti hasn't broadcast currentCueTRT yet).
		if (data.duration != null && data.duration > 0) {
			this.elements.currentTRT.style.display = ''
			this.elements.currentTRTTime.textContent = this._formatTime(data.duration)
		} else {
			this.elements.currentTRT.style.display = 'none'
		}

		// Audio icon in the upper-right: shown when the current cue is unmuted.
		var audioOn = data.currentClipAudio === true
		this.elements.currentAudio.className =
			'mvhud-mitti-display__current-icon' + (audioOn ? ' mvhud-mitti-display__current-icon--audio' : '')
		this.elements.currentAudio.style.display = audioOn ? '' : 'none'

		// Loop / pause-at-end icon (mutually exclusive in Mitti; loop wins on race).
		var loop = !!data.currentClipLoop
		var pauseEnd = !!data.currentClipPauseAtEnd
		var iconMod = loop
			? ' mvhud-mitti-display__current-icon--loop'
			: pauseEnd
				? ' mvhud-mitti-display__current-icon--pause-end'
				: ''
		this.elements.currentIcon.className = 'mvhud-mitti-display__current-icon' + iconMod
		this.elements.currentIcon.style.display = loop || pauseEnd ? '' : 'none'
	}

	MittiDisplay.prototype._updateOnDeck = function (data) {
		var name = data && data.selectedClipName
		if (!name) {
			this.elements.onDeck.style.display = 'none'
			return
		}
		this.elements.onDeck.style.display = ''
		this.elements.onDeckName.textContent = name
		this.elements.onDeckTRT.textContent =
			data.selectedClipDuration != null ? this._formatTime(data.selectedClipDuration) : ''

		// Audio icon: shown when the cue is unmuted (icon = "this cue will
		// produce sound"). Hidden if muted or audio state unknown.
		var audio = data.selectedClipAudio
		var audioOn = audio === true
		this.elements.onDeckAudio.className =
			'mvhud-mitti-display__on-deck__icon' + (audioOn ? ' mvhud-mitti-display__on-deck__icon--audio' : '')
		this.elements.onDeckAudio.style.display = audioOn ? '' : 'none'

		// Loop / pause-at-end: Mitti makes them mutually exclusive; if both
		// happen to be true (broadcast race), loop wins by convention.
		var loop = !!data.selectedClipLoop
		var pauseEnd = !!data.selectedClipPauseAtEnd
		var iconModifier = loop
			? ' mvhud-mitti-display__on-deck__icon--loop'
			: pauseEnd
				? ' mvhud-mitti-display__on-deck__icon--pause-end'
				: ''
		this.elements.onDeckIcon.className = 'mvhud-mitti-display__on-deck__icon' + iconModifier
		this.elements.onDeckIcon.style.display = loop || pauseEnd ? '' : 'none'
	}

	MittiDisplay.prototype._formatTime = function (seconds) {
		if (seconds == null || isNaN(seconds)) return '0:00'
		var s = Math.max(0, Math.floor(seconds))
		var hours = Math.floor(s / 3600)
		var minutes = Math.floor((s % 3600) / 60)
		var secs = s % 60
		var pad = function (n) {
			return n < 10 ? '0' + n : '' + n
		}
		if (hours > 0) {
			return hours + ':' + pad(minutes) + ':' + pad(secs)
		}
		return minutes + ':' + pad(secs)
	}

	MittiDisplay.prototype.destroy = function () {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}
		if (this.ws) {
			this.ws.onclose = null
			this.ws.onerror = null
			this.ws.onmessage = null
			this.ws.onopen = null
			try {
				this.ws.close()
			} catch {
				// ignore
			}
			this.ws = null
		}
		if (this.container) {
			this.container.innerHTML = ''
		}
		this.elements = {}
	}

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = { MittiDisplay: MittiDisplay }
	}
	if (typeof window !== 'undefined') {
		window.MittiDisplay = MittiDisplay
	}
})()
