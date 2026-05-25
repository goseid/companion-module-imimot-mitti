/**
 * Time Of Day Clock Component
 * A responsive digital clock that can be embedded in any webpage.
 * Copied from multiview-hud with the font URL adjusted to absolute (/fonts/...).
 */

class TODClock {
	constructor(container, options = {}) {
		this.container = typeof container === 'string' ? document.querySelector(container) : container

		if (!this.container) {
			throw new Error('Container element not found')
		}

		this.options = {
			color: options.color || '#fff',
			backgroundColor: options.backgroundColor || '#222',
			fontFamily: options.fontFamily || 'Lekton-Bold, Lekton, monospace',
			...options,
		}

		this.intervalId = null
		this.init()
	}

	init() {
		this.injectFont()
		this.injectStyles()
		this.createHTML()
		this.updateClock()
		this.intervalId = setInterval(() => this.updateClock(), 1000)
	}

	injectFont() {
		const fontId = 'big-digital-clock-font'
		if (document.getElementById(fontId)) return

		const style = document.createElement('style')
		style.id = fontId
		style.textContent = `
            @font-face {
                font-family: 'Lekton-Bold';
                src: url('/fonts/Lekton-Bold.ttf') format('truetype');
                font-weight: 700;
                font-style: normal;
                font-display: swap;
            }
        `
		document.head.appendChild(style)
	}

	injectStyles() {
		const styleId = 'big-digital-clock-styles'
		if (document.getElementById(styleId)) return

		const style = document.createElement('style')
		style.id = styleId
		style.textContent = `
            .bdc-container {
                width: 100%;
                aspect-ratio: 1220 / 480;
                color: var(--bdc-color, #0f0);
                background-color: var(--bdc-bg-color, #222);
                font-family: var(--bdc-font-family, Lekton-Bold, Lekton, monospace);
                font-weight: 700;
                container-type: inline-size;
            }

            .bdc-time-container {
                display: flex;
                justify-content: center;
                padding-top: 3.28cqi;
            }

            .bdc-time {
                font-size: 34.75cqi;
                display: flex;
                line-height: 27.46cqi;
            }

            .bdc-colon {
                margin: -3.28cqi;
            }

            .bdc-ssampm {
                display: flex;
                flex-direction: column;
                font-size: 0;
                margin-left: 1.23cqi;
            }

            .bdc-ss {
                font-size: 15.25cqi;
                line-height: 12.7cqi;
            }

            .bdc-ampm {
                font-size: 14.75cqi;
                line-height: 12.7cqi;
            }

            .bdc-date {
                font-size: 6.07cqi;
                line-height: 1;
                text-align: center;
            }
        `
		document.head.appendChild(style)
	}

	createHTML() {
		this.container.style.setProperty('--bdc-color', this.options.color)
		this.container.style.setProperty('--bdc-bg-color', this.options.backgroundColor)
		this.container.style.setProperty('--bdc-font-family', this.options.fontFamily)

		this.container.innerHTML = `
            <div class="bdc-container">
                <div class="bdc-time-container">
                    <div class="bdc-time">
                        <div class="bdc-hh">12</div>
                        <div class="bdc-colon">:</div>
                        <div class="bdc-mm">00</div>
                        <div class="bdc-ssampm">
                            <div class="bdc-ss">00</div>
                            <div class="bdc-ampm">AM</div>
                        </div>
                    </div>
                </div>
                <div class="bdc-date">Loading...</div>
            </div>
        `

		this.elements = {
			hh: this.container.querySelector('.bdc-hh'),
			mm: this.container.querySelector('.bdc-mm'),
			ss: this.container.querySelector('.bdc-ss'),
			ampm: this.container.querySelector('.bdc-ampm'),
			date: this.container.querySelector('.bdc-date'),
		}
	}

	updateClock() {
		const now = new Date()

		let hours = now.getHours()
		const minutes = now.getMinutes()
		const seconds = now.getSeconds()

		const ampm = hours >= 12 ? 'PM' : 'AM'

		hours = hours % 12
		hours = hours ? hours : 12

		const hh = String(hours)
		const mm = String(minutes).padStart(2, '0')
		const ss = String(seconds).padStart(2, '0')

		this.elements.hh.textContent = hh
		this.elements.mm.textContent = mm
		this.elements.ss.textContent = ss
		this.elements.ampm.textContent = ampm

		const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
		const months = [
			'January',
			'February',
			'March',
			'April',
			'May',
			'June',
			'July',
			'August',
			'September',
			'October',
			'November',
			'December',
		]

		const dayName = days[now.getDay()]
		const monthName = months[now.getMonth()]
		const day = now.getDate()
		const year = now.getFullYear()

		const dateStr = `${dayName}, ${monthName} ${day}, ${year}`
		this.elements.date.textContent = dateStr
	}

	destroy() {
		if (this.intervalId) {
			clearInterval(this.intervalId)
			this.intervalId = null
		}
		this.container.innerHTML = ''
	}
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = TODClock
}
if (typeof window !== 'undefined') {
	window.TODClock = TODClock
}
