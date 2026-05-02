'use strict';

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

	'bouncing-element': (container) => {
		const node = document.createElement('div');
		node.className = 'bouncing-character';
		
		const img = document.createElement('img');
		img.className = 'bouncing-character__img';
		
		const bounceAssets = [
			'../ch_both_open_green.svg',
			'../ch_left_closed_green.svg',
			'../ch_right_closed_green.svg',
			'../ch_both_open_red.svg',
			'../ch_left_closed_red.svg',
			'../ch_right_closed_red.svg'
		];
		
		let curIdx = 0;
		img.src = bounceAssets[curIdx];
		node.appendChild(img);
		container.appendChild(node);
		
		let x = 100, y = 100, dx = 4, dy = 3;
		const size = 250;
		
		const animate = () => {
			const rect = container.getBoundingClientRect();
			let hit = false;
			
			if (x + size > rect.width || x < 0) {
				dx = -dx;
				hit = true;
			}
			if (y + size > rect.height || y < 0) {
				dy = -dy;
				hit = true;
			}
			
			if (hit) {
				let nextIdx = curIdx;
				while (nextIdx === curIdx) nextIdx = Math.floor(Math.random() * bounceAssets.length);
				curIdx = nextIdx;
				img.src = bounceAssets[curIdx];
			}
			
			x += dx;
			y += dy;
			node.style.transform = `translate(${x}px, ${y}px)`;
			requestAnimationFrame(animate);
		};
		animate();
	}
};

export function renderPattern(name, container) {
	container.innerHTML = '';
	container.className = 'pattern-layer';
	container.style.backgroundColor = '';
	container.style.backgroundImage = '';
	
	const gen = Patterns[name] || Patterns['grid-white'];
	gen(container);
}
