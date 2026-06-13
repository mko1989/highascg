'use strict';

let animId = null;

/**
 * LED Test Pattern Generators
 */
export const Patterns = {
	'smpte-bars': (container) => {
		const colors = [
			'#c0c0c0', // Gray
			'#c0c000', // Yellow
			'#00c0c0', // Cyan
			'#00c000', // Green
			'#c000c0', // Magenta
			'#c00000', // Red
			'#0000c0'  // Blue
		];
		const barsWrap = document.createElement('div');
		barsWrap.className = 'pattern--color-bars';
		colors.forEach(c => {
			const bar = document.createElement('div');
			bar.className = 'bar';
			bar.style.backgroundColor = c;
			barsWrap.appendChild(bar);
		});
		container.appendChild(barsWrap);
	},

	'gradient-h': (container) => {
		container.classList.add('pattern--gradient-h');
	},

	'gradient-v': (container) => {
		container.classList.add('pattern--gradient-v');
	},

	'checkerboard': (container) => {
		container.classList.add('pattern--checkerboard');
	},

	'solid-red': (container) => { container.style.backgroundColor = '#f00'; },
	'solid-green': (container) => { container.style.backgroundColor = '#0f0'; },
	'solid-blue': (container) => { container.style.backgroundColor = '#00f'; },
	'solid-white': (container) => { container.style.backgroundColor = '#fff'; },
	'solid-black': (container) => { container.style.backgroundColor = '#000'; },

	'grid-white': (container) => {
		container.style.backgroundImage = 'linear-gradient(to right, #444 1px, transparent 1px), linear-gradient(to bottom, #444 1px, transparent 1px)';
		container.style.backgroundSize = '40px 40px';
	},

	'bouncing-element': (container, options) => {
		if (animId) {
			cancelAnimationFrame(animId);
			animId = null;
		}
		const n = Math.max(1, Math.min(48, parseInt(options?.charCount, 10) || 1));
		const canvas = document.createElement('canvas');
		canvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; display:block;';
		container.innerHTML = '';
		container.appendChild(canvas);

		const width = window.innerWidth || 1920;
		const height = window.innerHeight || 1080;
		canvas.width = width;
		canvas.height = height;

		const ctx = canvas.getContext('2d', { alpha: false });

		const bounceAssets = [
			'../ch_both_open_green.svg',
			'../ch_left_closed_green.svg',
			'../ch_right_closed_green.svg',
			'../both_open.svg',
			'../left_closed.svg',
			'../right_closed.svg'
		];

		const images = [];
		let loadedCount = 0;

		function checkStart() {
			loadedCount++;
			if (loadedCount === bounceAssets.length) {
				startLoop();
			}
		}

		for (let idx = 0; idx < bounceAssets.length; idx++) {
			const img = new Image();
			img.onload = checkStart;
			img.onerror = checkStart;
			img.src = bounceAssets[idx];
			images.push(img);
		}

		const bounceSize = 250;
		const baseSpeed = 250;

		const characters = [];
		for (let i = 0; i < n; i++) {
			const travelX = Math.max(10, width - bounceSize);
			const travelY = Math.max(10, height - bounceSize);

			const speedX = baseSpeed * (0.8 + Math.random() * 0.4);
			const speedY = baseSpeed * (0.8 + Math.random() * 0.4);

			const vx = speedX * (Math.random() > 0.5 ? 1 : -1);
			const vy = speedY * (Math.random() > 0.5 ? 1 : -1);

			const x = Math.random() * travelX;
			const y = Math.random() * travelY;

			const imgIndex = Math.floor(Math.random() * images.length);

			characters.push({
				x: x,
				y: y,
				vx: vx,
				vy: vy,
				imgIndex: imgIndex
			});
		}

		let lastTime = performance.now();

		function startLoop() {
			function tick(now) {
				let dt = (now - lastTime) / 1000;
				lastTime = now;

				if (dt > 0.1) dt = 0.1;

				ctx.fillStyle = '#000000';
				ctx.fillRect(0, 0, width, height);

				const maxW = width - bounceSize;
				const maxH = height - bounceSize;

				for (let j = 0; j < characters.length; j++) {
					const ch = characters[j];
					ch.x += ch.vx * dt;
					ch.y += ch.vy * dt;

					let bounced = false;

					if (ch.x < 0) {
						ch.x = 0;
						ch.vx = -ch.vx;
						bounced = true;
					} else if (ch.x > maxW) {
						ch.x = maxW;
						ch.vx = -ch.vx;
						bounced = true;
					}

					if (ch.y < 0) {
						ch.y = 0;
						ch.vy = -ch.vy;
						bounced = true;
					} else if (ch.y > maxH) {
						ch.y = maxH;
						ch.vy = -ch.vy;
						bounced = true;
					}

					if (bounced) {
						ch.imgIndex = Math.floor(Math.random() * images.length);
					}

					const imgEl = images[ch.imgIndex];
					if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
						let drawW = bounceSize;
						let drawH = bounceSize;
						const ratio = imgEl.naturalWidth / imgEl.naturalHeight;
						if (ratio > 1) {
							drawH = bounceSize / ratio;
						} else {
							drawW = bounceSize * ratio;
						}
						const offsetX = (bounceSize - drawW) / 2;
						const offsetY = (bounceSize - drawH) / 2;
						ctx.drawImage(imgEl, ch.x + offsetX, ch.y + offsetY, drawW, drawH);
					} else {
						ctx.fillStyle = '#00ff00';
						ctx.fillRect(ch.x, ch.y, bounceSize, bounceSize);
					}
				}

				animId = requestAnimationFrame(tick);
			}

			animId = requestAnimationFrame(tick);
		}
	}
};

export function renderPattern(name, container, options) {
	if (animId) {
		cancelAnimationFrame(animId);
		animId = null;
	}
	container.innerHTML = '';
	container.className = 'pattern-layer';
	container.style.backgroundColor = '';
	container.style.backgroundImage = '';
	
	const gen = Patterns[name] || Patterns['grid-white'];
	gen(container, options || {});
}
