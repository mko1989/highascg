# WO-84 — Router Refactor: Declarative Route Registry

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** Not started
**Prerequisites:** Backup of `src/api/router.js` exists.

## 1. Objective

Refactor the massive ~540 line `if/else` block in `src/api/router.js` into a clean, declarative route registry. This will significantly improve maintainability, reduce cyclomatic complexity, and make it easier to add, discover, and audit API endpoints.

Currently, `router.js` routes requests using a long sequence of hardcoded string matching (e.g., `if (method === 'GET' && p === '/api/settings')`). This needs to be replaced with a proper routing map.

---

## 2. Architecture: Route Registry

We need a custom, lightweight routing system to avoid bringing in heavy dependencies like Express, while maintaining the existing `async ({status, headers, body})` contract.

### 2.1 The `RouteRegistry` Class

Create a new file `src/api/route-registry.js`:

```javascript
'use strict'

class RouteRegistry {
	constructor() {
		this.routes = []
	}

	add(method, path, handler, options = {}) {
		// Convert Express-style paths like `/api/project/file/:id` to Regex
		const keys = []
		const regexPath = path.replace(/:([a-zA-Z0-9_]+)/g, (_, key) => {
			keys.push(key)
			return '([^/]+)'
		})
		const regex = new RegExp(`^${regexPath}$`)

		this.routes.push({ method, path, regex, keys, handler, options })
	}

	get(path, handler, options) { this.add('GET', path, handler, options) }
	post(path, handler, options) { this.add('POST', path, handler, options) }
	delete(path, handler, options) { this.add('DELETE', path, handler, options) }

	async dispatch(method, path, body, ctx, req, query) {
		for (const route of this.routes) {
			if (route.method !== method) continue
			
			const match = path.match(route.regex)
			if (match) {
				// Enforce Caspar requirement middleware
				if (route.options.requireCaspar && !ctx.amcp) {
					const { JSON_HEADERS, jsonBody } = require('./response')
					return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
				}

				// Extract params
				const params = {}
				route.keys.forEach((key, index) => {
					params[key] = decodeURIComponent(match[index + 1])
				})

				// Execute handler
				return await route.handler({ method, path, body, ctx, req, query, params })
			}
		}
		return null // Not handled by registry
	}
}

module.exports = { RouteRegistry }
```

*Note: The exact signature inside the handler might need to bridge the existing `(p, body, ctx)` signatures, or we map them explicitly in `router.js`.*

---

## 3. Migration Plan (`src/api/router.js`)

In `router.js`, initialize the registry and map all existing endpoints.

### 3.1 Setup and Middleware logic
- Preserve the prefix `instance/` logic at the top.
- Preserve the `moduleRegistry.handleApi` hook (optional modules run before main routes).
- Preserve the `/api/selection` custom hook.

### 3.2 Offline-Safe Routes
These are routes that currently sit *before* the `!ctx.amcp` gate. They should be registered with `{ requireCaspar: false }`.
Examples:
- `/api/settings`
- `/api/system/setup/*`
- `/api/ingest/*`
- `/api/hardware/*`

### 3.3 Caspar-Dependent Routes
These are routes currently sitting *after* the `!ctx.amcp` gate. They should be registered with `{ requireCaspar: true }`.
Examples:
- `/api/mixer/*`
- `/api/cg/*`
- `/api/multiview/*`
- `/api/amcp/*`
- `/api/scene/*`

### 3.4 Parameterized Routes
Convert `startsWith` checks into proper parameterized routes:
- `p.startsWith('/api/project/file/')` → `routes.get('/api/project/file/:id', ...)`
- `p.startsWith('/api/local-media/')` → `routes.delete('/api/local-media/:path', ...)`
- `p.startsWith('/api/lower-thirds/')` → `routes.get('/api/lower-thirds/:id', ...)`

Ensure the underlying handler files (like `routesData.handleProjectFile`) are adjusted to use `params` if necessary, or the registry caller bridges it manually by passing the original `p`.

---

## 4. Tasks

### Phase A: Core Registry
- [ ] **T1** Create `src/api/route-registry.js` with `RouteRegistry` class logic.
- [ ] **T2** Ensure path parameter regex matching works for exact strings and `:param` syntax.

### Phase B: Router.js Overhaul (Offline-Safe)
- [ ] **T3** Clear out the giant `if/else` stack in `router.js`. Keep imports.
- [ ] **T4** Instantiate `new RouteRegistry()` in `router.js`.
- [ ] **T5** Register all offline-safe routes (`requireCaspar: false`).
- [ ] **T6** Ensure `query`, `body`, and `ctx` parameters are passed identically to how existing handlers expect them.

### Phase C: Router.js Overhaul (Caspar-Dependent)
- [ ] **T7** Register all remaining routes with `{ requireCaspar: true }`.
- [ ] **T8** Convert `p.startsWith` routes into precise parameterized routes (e.g., `/:id`). Bridge the handlers to ensure they don't break.
- [ ] **T9** Wire the `.dispatch(...)` call to be the primary return logic of `routeRequest`.
- [ ] **T10** Maintain 404 fallback logic if the registry returns `null`.

### Phase D: Testing & Validation
- [ ] **T11** Verify static file serving and basic UI loading isn't broken.
- [ ] **T12** Test an offline route (e.g., system settings).
- [ ] **T13** Test a Caspar-required route (e.g., fetching mixer levels or issuing an AMCP command).
- [ ] **T14** Verify the `src/api/router.js` file is significantly cleaner and smaller.

---

## Work Log

### 2026-06-29 — Initial Creation
**Work Done:**
- Created work order after audit revealed `router.js` had 540 lines of cyclomatic `if/else` checks.
- Defined `RouteRegistry` utility architecture and migration phases.
- Created `router.js.bak` backup file.

**Instructions for Next Agent:**
- Start on Phase A by implementing the `RouteRegistry` class in `src/api/route-registry.js`.
- Proceed methodically in Phase B to map each route. Be careful with function signatures since each `routesX.js` handles arguments slightly differently.

---
*Work Order created: 2026-06-29 | Parent: None (Independent Architecture Task)*
