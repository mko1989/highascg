# How to Serve a Web Page from a Companion Module

This guide explains how to correctly configure a Companion module to serve a static web page that includes client-side JavaScript libraries like Socket.IO. This is useful for creating custom viewer pages, dashboards, or configuration interfaces for your module.

The key challenge is ensuring that all necessary files (HTML, CSS, vendor JavaScript) are correctly packaged with your module and can be found and served when the module is running within Companion, especially on a different machine from where it was built (e.g., deploying to a Raspberry Pi).

## 1. Project Structure

It's best practice to keep your web assets separate from your module's source code. Create a `public` directory in the root of your module to hold your `index.html` and other custom assets.

```
your-companion-module/
├── companion/
├── node_modules/
├── public/
│   ├── index.html
│   ├── style.css
│   └── script.js
├── src/
│   ├── index.js
│   └── server.js
├── build-config.cjs
└── package.json
```

## 2. Configure the Build Process

The standard Companion build process does not automatically include extra directories or files. You must explicitly tell the build script what to include by creating a `build-config.cjs` file in the root of your module directory.

This is the most critical step. The configuration below tells the build script to do two things:
1.  Copy all files from your `public` directory into the root of the final package.
2.  Find the `socket.io.min.js` client library in your `node_modules` and also copy it into the root of the final package.

```javascript
// build-config.cjs
module.exports = {
	// This tells the build script what extra files to copy into the package root.
	extraFiles: [
		'public/*', // Copies all files from /public into the root
		'node_modules/socket.io/client-dist/socket.io.min.js', // Copies the socket.io client
	],
}
```

## 3. Configure the Web Server

When your module is running inside Companion, the path to its files can be different than in your development environment. The most reliable way to find your module's files is to use `process.cwd()`, which gives the current working directory of the running module. Since the build process now copies all web files to the root of your package, the server should serve static files from there.

Here is a complete example of a `server.js` file that correctly serves the files.

```javascript
// src/server.js
import express from 'express'
import http from 'http'
import { Server } from 'socket.io'
import path from 'path'

export function setupWebServer(instance) {
	const app = express()
	const server = http.createServer(app)
	const io = new Server(server, {
		cors: {
			origin: '*',
		},
	})

	// Serve static files from the root of the package directory.
	app.use(express.static(process.cwd()))

	io.on('connection', (socket) => {
		instance.log('debug', 'Client connected to web server')

		// Your socket.io logic here...
		socket.emit('state', instance.getFullState())

		socket.on('disconnect', () => {
			instance.log('debug', 'Client disconnected from web server')
		})

		instance.broadcastState()
	})

	const port = instance.config.port || 8080
	server.listen(port, () => {
		instance.log('info', `Web server started on port ${port}`)
	})

	return {
		server,
		io,
	}
}
```

## 4. Reference the Scripts in Your HTML

Your `index.html` can now load the necessary JavaScript files using simple, relative paths, as they will be available in the same directory as the `index.html` file itself.

```html
<!-- public/index.html -->
<body>
	<!-- Your HTML content -->

	<script src="socket.io.min.js"></script>
	<script src="script.js"></script>
</body>
```

## 5. Build Your Module

With the `build-config.cjs` and your server code in place, your `package.json` only needs a simple build script:

```json
// package.json
{
  "scripts": {
    "build": "yarn companion-module-build"
  }
}
```

Run the build command from your terminal:

```bash
yarn build
```

This will create a `.tgz` file that is fully self-contained, offline-capable, and ready for distribution. It can be correctly imported into Companion, and the web server will find and serve all your files without any 404 errors. 