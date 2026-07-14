module.exports = {
	extraFiles: ['public/*'],
	webpack: {
		node: {
			__dirname: true,
		},
	},
} 