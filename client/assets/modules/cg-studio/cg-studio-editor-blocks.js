/** @param {import('grapesjs').Editor['BlockManager']} bm */
export function registerCgStudioBlocks(bm) {
	bm.add('text', {
		label: 'Text',
		media: '<span style="font-size:18px">T</span>',
		content: {
			tagName: 'div',
			attributes: { 'data-lt-role': 'body' },
			style: {
				position: 'relative',
				padding: '10px',
				'font-family': 'sans-serif',
				'font-size': '24px',
				color: '#ffffff',
			},
			components: 'Text',
		},
	})
	bm.add('lt-title', {
		label: 'Title (h1)',
		media: '<span style="font-size:14px;font-weight:700">H1</span>',
		content: {
			tagName: 'h1',
			attributes: { 'data-lt-role': 'title' },
			type: 'text',
			content: 'Name',
			style: {
				'font-size': '46px',
				'font-weight': '700',
				color: 'var(--text, #fff)',
			},
		},
	})
	bm.add('lt-subtitle', {
		label: 'Subtitle',
		media: '<span style="font-size:12px">Sub</span>',
		content: {
			tagName: 'div',
			attributes: { class: 'subtitle' },
			components: [
				{
					tagName: 'p',
					attributes: { 'data-lt-role': 'subtitle' },
					type: 'text',
					content: 'Title',
					style: {
						'font-size': '27px',
						color: 'var(--primary, lightblue)',
					},
				},
			],
		},
	})
	bm.add('box', {
		label: 'Box',
		media: '<span style="font-size:18px">▢</span>',
		content: {
			tagName: 'div',
			style: {
				position: 'absolute',
				left: '120px',
				top: '120px',
				width: '200px',
				height: '100px',
				'background-color': '#007bff',
			},
		},
	})
}
