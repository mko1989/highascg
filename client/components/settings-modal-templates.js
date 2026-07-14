/**
 * HTML templates for the Settings Modal.
 */
export function getMainModalHtml() {
	return `
		<div class="modal-content settings-modal">
			<div class="modal-header">
				<h2>Application Settings</h2>
				<button class="modal-close" id="settings-close">&times;</button>
			</div>
			<div class="modal-body settings-body">
				<div class="settings-tabs">
					<button class="settings-tab active" data-tab="defaults">Defaults</button>
					<button class="settings-tab" data-tab="companion">Companion</button>
					<button class="settings-tab" data-tab="media-usb">media/usb</button>
					<button class="settings-tab" data-tab="system-updates">updates</button>
					<button class="settings-tab" data-tab="system-hardware">system</button>
					<button class="settings-tab" data-tab="decklink">decklink</button>
					<button class="settings-tab" data-tab="diagnostics">Diagnostics</button>
					<button class="settings-tab" data-tab="tailscale">Tailscale</button>
					<button class="settings-tab" data-tab="live-audio">Live audio</button>
					<button class="settings-tab" data-tab="usb-video">USB video</button>
					<button class="settings-tab" data-tab="variables">Variables</button>
					<button class="settings-tab" data-tab="nuclear">Nuclear</button>
				</div>
				<div class="settings-panes">
					<div class="settings-pane active" id="settings-pane-defaults">
						<h3 class="settings-category">Layer position</h3>
						<div class="settings-group">
							<label for="ed-coordinate-origin">Coordinate origin (0,0)</label>
							<select id="ed-coordinate-origin">
								<option value="topLeft">Top-left — canvas and layer box</option>
								<option value="center">Center — screen and layer box</option>
							</select>
						</div>
						<p class="settings-note">Center mode: X/Y in the look editor, timeline inspector, and position keyframes are offsets from the screen center. Playout and saved projects still use top-left fill.</p>
						<h3 class="settings-category">Scene — dropping media onto a look</h3>
						<div class="settings-group checkbox">
							<label><input type="checkbox" id="ed-scene-loop" /> Loop media on new layers</label>
						</div>
						<div class="settings-group">
							<label for="ed-scene-start">Start playback</label>
							<select id="ed-scene-start">
								<option value="beginning">Start from beginning (trim in)</option>
								<option value="relativeToPrevious">Continue from previous play on this layer</option>
							</select>
						</div>
						<p class="settings-note">“Continue from previous” seeks to live <code>current_duration</code> on that PGM layer (variables, then OSC/INFO). Timeline clip on the same layer index still applies when no live playhead is found.</p>
						<div class="settings-group">
							<label for="ed-scene-content-fit">Content sizing</label>
							<select id="ed-scene-content-fit"></select>
						</div>
						<h3 class="settings-category">Timeline — new clips</h3>
						<div class="settings-group checkbox">
							<label><input type="checkbox" id="ed-timeline-loop-always" /> Loop always</label>
						</div>
						<div class="settings-group">
							<label for="ed-timeline-content-fit">Content sizing</label>
							<select id="ed-timeline-content-fit"></select>
						</div>
						<h3 class="settings-category">Default transition (new looks)</h3>
						<div class="settings-group" style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center">
							<label for="ed-transition-type" style="flex:1 1 100%">Type</label>
							<select id="ed-transition-type" style="flex:1 1 10rem">
								<option value="CUT">CUT</option>
								<option value="MIX">MIX</option>
								<option value="PUSH">PUSH</option>
								<option value="WIPE">WIPE</option>
								<option value="SLIDE">SLIDE</option>
								<option value="MIX + ANIMATE">MIX + Animate</option>
								<option value="WIPE + ANIMATE">WIPE + Animate</option>
								<option value="SLIDE + ANIMATE">SLIDE + Animate</option>
								<option value="PUSH + ANIMATE">PUSH + Animate</option>
							</select>
							<label for="ed-transition-duration">Duration (frames)</label>
							<input type="text" id="ed-transition-duration" class="inspector-math-input" inputmode="decimal" style="width:4.5rem" />
							<label for="ed-transition-tween">Tween</label>
							<select id="ed-transition-tween">
								<option value="linear">linear</option>
								<option value="easein">easein</option>
								<option value="easeout">easeout</option>
								<option value="easeboth">easeboth</option>
							</select>
						</div>
						<p class="settings-note">Also used for the timeline Take bar default. Existing looks and clips are not changed.</p>
						<h3 class="settings-category">Compose preview</h3>
						<div class="settings-group">
							<label for="set-compose-preview-mode">Preview source</label>
							<select id="set-compose-preview-mode">
								<option value="canvas">Canvas thumbnails</option>
								<option value="ffmpeg_jpeg">Caspar JPEG — ffmpeg writes file</option>
							</select>
						</div>
						<div id="set-compose-preview-ffmpeg-fields">
							<p class="settings-note">JPEG mode embeds a low-cost ffmpeg consumer in Caspar config. Apply Caspar config after changing FPS or resolution.</p>
							<div class="settings-group">
								<label for="set-compose-preview-fps">Update rate: <strong id="set-compose-preview-fps-val">25</strong> fps</label>
								<input type="range" id="set-compose-preview-fps" min="1" max="30" step="1" value="25" style="width:100%;max-width:24rem" />
							</div>
							<div class="settings-group">
								<label for="set-compose-preview-scale">Resolution (relative to channel)</label>
								<select id="set-compose-preview-scale">
									<option value="half">Half width × height (default)</option>
									<option value="75">75%</option>
									<option value="full">Full channel size</option>
								</select>
							</div>
							<div class="settings-group">
								<label for="set-compose-preview-jpeg-q">JPEG quality: <strong id="set-compose-preview-jpeg-q-val">10</strong></label>
								<input type="range" id="set-compose-preview-jpeg-q" min="2" max="20" step="1" value="10" style="width:100%;max-width:24rem" />
								<p class="settings-note">Lower number = higher quality, larger files.</p>
							</div>
							<div class="settings-group checkbox">
								<label><input type="checkbox" id="set-compose-preview-companion-thumb" /> Companion preview variables (Stream Deck button images)</label>
								<p class="settings-note">Pushes <code>compose_preview_ch{N}_image</code> data-URI variables at compose preview rate (same fps). In Companion, set a button image to <code>$(highascg_compose_preview_ch1_image)</code>.</p>
							</div>
						</div>
					</div>
					<div class="settings-pane" id="settings-pane-companion">
						<h3 class="settings-category">Bitfocus Companion</h3>
						<div class="companion-connection-status" id="companion-connection-status" aria-live="polite">
							<div class="companion-connection-status__row">
								<span class="status-dot" id="companion-connection-dot" aria-hidden="true"></span>
								<span class="companion-connection-status__label" id="companion-connection-label">Not checked</span>
								<button type="button" class="btn btn--secondary btn--sm" id="companion-connection-refresh">Check</button>
							</div>
							<p class="settings-note companion-connection-status__detail" id="companion-connection-detail"></p>
						</div>
						<div class="settings-group"><label>Companion Host</label><input type="text" id="set-companion-host" placeholder="127.0.0.1"></div>
						<div class="settings-group"><label>Companion Port (HTTP press)</label><input type="number" id="set-companion-port" placeholder="8000"></div>
						<div class="settings-group checkbox">
							<label><input type="checkbox" id="set-companion-satellite-enabled" checked /> Satellite preview (button images)</label>
						</div>
						<div class="settings-group"><label>Satellite Host</label><input type="text" id="set-companion-satellite-host" placeholder="same as Companion host"></div>
						<div class="settings-group"><label>Satellite Port</label><input type="number" id="set-companion-satellite-port" placeholder="16622"></div>
						<div class="settings-group"><label>Preview bitmap size (px)</label><input type="number" id="set-companion-preview-size" placeholder="72" min="32" max="512"></div>
						<div class="settings-group"><label>Page picker grid size</label><input type="number" id="set-companion-picker-grid" placeholder="8" min="1" max="16"></div>
						<p class="settings-note">Timeline <code>companion_press</code> flags use HTTP for triggers. Button previews use Companion Satellite <code>ADD-SUB</code> — in Companion you must enable both the <strong>Satellite server</strong> (port 16622) and <strong>Button Subscriptions API</strong>. See <code>docs/reference/companion-satellite-api.md</code>.</p>
					</div>
					<div class="settings-pane" id="settings-pane-media-usb">
						<h3 class="settings-category">exFAT ↔ project sync</h3>
						<p class="settings-note">Expect the data partition at <code>/home/casparcg/exfat</code> (see <code>tools/eggs/live-usb/systemd/home-casparcg-exfat.mount.example</code>). Map: <code>HIGHASCG_EXFAT_SYNC_MAP</code>, then <code>/etc/highascg/exfat-sync.json</code>, then repo <code>config/exfat-sync.json</code>. Per file, newer <code>mtime</code> wins; deletes are not synced.</p>
						<div class="settings-group" style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center">
							<button type="button" class="btn btn--secondary" id="exfat-sync-refresh-btn">Refresh sync map</button>
							<button type="button" class="btn btn--secondary" id="exfat-sync-dryrun-btn">Dry-run sync</button>
						</div>
						<p class="settings-note" id="exfat-sync-status-line" style="margin-top:0.25rem"></p>
						<div class="settings-group" style="overflow:auto;max-height:14rem;border:1px solid rgba(255,255,255,0.12);border-radius:0.35rem;padding:0.35rem">
							<table id="exfat-sync-pairs-table" style="width:100%;font-size:0.82rem;border-collapse:collapse">
								<thead>
									<tr style="text-align:left;border-bottom:1px solid rgba(255,255,255,0.15)">
										<th style="padding:0.2rem 0.35rem">ID</th>
										<th style="padding:0.2rem 0.35rem">exFAT rel</th>
										<th style="padding:0.2rem 0.35rem">Project</th>
										<th style="padding:0.2rem 0.35rem">Exclude</th>
										<th style="padding:0.2rem 0.35rem">Way</th>
										<th style="padding:0.2rem 0.35rem">Status</th>
									</tr>
								</thead>
								<tbody></tbody>
							</table>
						</div>
						<hr style="border:none;border-top:1px solid rgba(255,255,255,0.12);margin:1rem 0" />
						<h3 class="settings-category">Project media folder</h3>
						<div class="settings-group">
							<label for="set-project-media-location">Store <code>media/projects/&lt;slug&gt;/</code> on</label>
							<select id="set-project-media-location">
								<option value="internal">System media root (<code>~/highascg/media/projects/</code>)</option>
								<option value="exfat">exFAT stick (<code>~/highascg/media/exfat/projects/</code>)</option>
								<option value="bridge">Bridge partition (<code>~/highascg/media/bridge/projects/</code>)</option>
							</select>
						</div>
						<p class="settings-note" id="set-project-media-location-hint">Default upload and ingest target for the active project. The full media library remains browsable.</p>
						<h3 class="settings-category">USB media import</h3>
						<div class="settings-group"><label>CasparCG Media Path</label><input type="text" id="set-local-media-path" placeholder="/home/casparcg/highascg/media"></div>
						<div class="settings-group checkbox"><label><input type="checkbox" id="set-project-scoped-media" checked /> Default uploads to active project folder (<code>media/projects/&lt;slug&gt;/</code>)</label></div>
						<div class="settings-group checkbox"><label><input type="checkbox" id="set-usb-enabled" checked /> Enable USB import</label></div>
						<div class="settings-group"><label>Default subfolder template</label><input type="text" id="set-usb-subfolder" placeholder="usb/{label}/{date}"></div>
						<div class="settings-group"><label>When file already exists</label><select id="set-usb-policy"><option value="rename">Rename</option><option value="skip">Skip</option><option value="overwrite">Overwrite</option></select></div>
						<div class="settings-group checkbox"><label><input type="checkbox" id="set-usb-verify" /> Verify SHA1 after copy</label></div>
					</div>
					<div class="settings-pane" id="settings-pane-system-updates">
						<h3 class="settings-category">Server version</h3>
						<p class="settings-note">Build stamp (UTC). On live USB sticks the canonical copy lives in <code>drop-update/</code> on exFAT — it is re-applied every boot.</p>
						<pre class="settings-note" id="system-updates-stamp" style="white-space:pre-wrap;font-size:1rem;line-height:1.4;background:rgba(0,0,0,0.25);padding:0.6rem;border-radius:0.35rem;margin:0.35rem 0">Loading…</pre>
						<p class="settings-note" id="system-updates-volumes" style="margin-top:0.25rem"></p>
						<h3 class="settings-category">GitHub releases</h3>
						<div class="settings-group" style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center">
							<button type="button" class="btn btn--secondary" id="system-updates-refresh">Refresh</button>
							<button type="button" class="btn btn--secondary" id="system-updates-check">Check now</button>
							<button type="button" class="btn btn--primary" id="system-updates-apply" disabled>Install latest release</button>
						</div>
						<p class="settings-note" id="system-updates-check-line" style="margin-top:0.35rem">Loading…</p>
						<pre class="settings-note" id="system-updates-log" style="white-space:pre-wrap;max-height:12rem;overflow:auto;font-size:0.78rem;line-height:1.35;background:rgba(0,0,0,0.2);padding:0.5rem;border-radius:0.35rem;margin:0.5rem 0 0"></pre>
					</div>
					<div class="settings-pane" id="settings-pane-system-hardware">
						<p class="settings-note" id="system-hw-operator-display" style="margin-top:0.35rem">Loading operator display…</p>
						<div class="settings-group" style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;margin-top:0.35rem">
							<button type="button" class="btn btn--secondary" id="system-hw-open-firefox">Open browser</button>
							<button type="button" class="btn btn--secondary" id="system-hw-open-file-manager">Open file manager</button>
							<button type="button" class="btn btn--secondary" id="system-hw-refresh-btn">Refresh hardware</button>
						</div>
						<p class="settings-note" id="system-hw-operator-status" style="margin-top:0.35rem"></p>
						<div id="system-hw-summary-container" style="margin-top:1rem"></div>
						<!-- WO-193: System time section -->
						<div class="settings-group" style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid rgba(255,255,255,0.1)">
							<h4 style="margin:0 0 0.5rem 0">System time</h4>
							<div style="margin-bottom:0.5rem">
								<label style="display:block;margin-bottom:0.25rem;font-size:0.9rem">Current time: <code id="system-time-clock">Loading…</code></label>
							</div>
							<div class="settings-group checkbox" style="margin-bottom:0.5rem">
								<label><input type="checkbox" id="system-time-ntp-toggle" /> NTP enabled</label>
							</div>
							<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.5rem;align-items:flex-end">
								<div style="flex:0 1 auto">
									<label for="system-time-date-input" style="display:block;font-size:0.85rem;margin-bottom:0.2rem">Date (YYYY-MM-DD)</label>
									<input type="date" id="system-time-date-input" style="width:12rem" />
								</div>
								<div style="flex:0 1 auto">
									<label for="system-time-time-input" style="display:block;font-size:0.85rem;margin-bottom:0.2rem">Time (HH:MM:SS)</label>
									<input type="time" id="system-time-time-input" style="width:8rem" />
								</div>
								<button type="button" class="btn btn--secondary" id="system-time-set-btn">Set time</button>
							</div>
							<p class="settings-note" id="system-time-result" style="margin:0.25rem 0 0 0;min-height:1.2rem"></p>
						</div>
					</div>
					<div class="settings-pane" id="settings-pane-decklink">
						<h3 class="settings-category">Blackmagic DeckLink</h3>
						<p class="settings-note">Discovery uses ffmpeg DeckLink list and recent Caspar log when present. Buttons open GUIs on <code>:0</code> (needs X session). If nuclear password protection is on, set it under <strong>Nuclear</strong> first.</p>
						<pre class="settings-note" id="decklink-summary" style="white-space:pre-wrap;max-height:12rem;overflow:auto;font-size:0.8rem;line-height:1.35;background:rgba(0,0,0,0.2);padding:0.5rem;border-radius:0.35rem;margin:0.25rem 0">Loading…</pre>
						<div class="settings-group" style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.5rem">
							<button type="button" class="btn btn--secondary" id="decklink-refresh-btn">Refresh</button>
							<button type="button" class="btn btn--secondary" id="decklink-dv-setup">Desktop Video Setup</button>
							<button type="button" class="btn btn--secondary" id="decklink-dv-updater">Desktop Video Updater</button>
						</div>
						<p class="settings-note" id="decklink-status-line" style="margin-top:0.35rem"></p>
					</div>
					<div class="settings-pane" id="settings-pane-diagnostics">
						<h3 class="settings-category">Diagnostics &amp; support</h3>
						<p class="settings-note">Download a ZIP with redacted config, Caspar XML, project summary, system inventory, GPU/xrandr layout, and recent HighAsCG + Caspar log tails. Filename: <code>highascg-support_&lt;hostname&gt;_&lt;timestamp&gt;.zip</code>.</p>
						<div class="settings-group" style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center">
							<button type="button" class="btn btn--primary" id="settings-diagnostics-bundle">Download support bundle</button>
							<button type="button" class="btn btn--secondary" id="settings-diagnostics-logs">Open server logs</button>
						</div>
						<p class="settings-note" id="settings-diagnostics-status" style="margin-top:0.35rem"></p>
						<p class="settings-note">Same bundle as the <strong>Support bundle</strong> button in the connection-eye logs modal. Use after a failure or before contacting support.</p>
					</div>
					<div class="settings-pane" id="settings-pane-tailscale">
						<h3 class="settings-category">Tailscale</h3>
						<p class="settings-note">Reach this playout box over your tailnet. If nuclear password protection is on, set the password under <strong>Nuclear</strong> first.</p>
						<p class="settings-note" id="tailscale-status-line">Loading…</p>
						<dl class="settings-kv" style="margin:0.5rem 0 1rem;font-size:0.9rem">
							<dt>Tailnet IPv4</dt><dd id="tailscale-ipv4">—</dd>
							<dt>Machine</dt><dd id="tailscale-hostname">—</dd>
							<dt>Daemon</dt><dd id="tailscale-daemon">—</dd>
							<dt>Login URL</dt><dd><span id="tailscale-auth-url">—</span> <a id="tailscale-auth-link" href="#" target="_blank" rel="noopener" style="display:none">open</a></dd>
						</dl>
						<div class="settings-group checkbox">
							<label><input type="checkbox" id="tailscale-enabled" /> Enable Tailscale service</label>
						</div>
						<div class="settings-group" style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center">
							<button type="button" class="btn btn--primary" id="tailscale-login">Log in</button>
							<button type="button" class="btn btn--secondary" id="tailscale-login-operator">Open on operator monitor</button>
							<button type="button" class="btn btn--secondary" id="tailscale-copy-url">Copy login URL</button>
							<button type="button" class="btn btn--secondary" id="tailscale-logout">Log out</button>
							<a class="btn btn--secondary" id="tailscale-admin-link" href="https://login.tailscale.com/admin/machines" target="_blank" rel="noopener">Admin console</a>
						</div>
						<details class="settings-group" style="margin-top:1rem">
							<summary>Advanced</summary>
							<div class="settings-group checkbox" style="margin-top:0.5rem">
								<label><input type="checkbox" id="tailscale-auto-login" /> Auto-login on boot when needed</label>
							</div>
							<div class="settings-group checkbox">
								<label><input type="checkbox" id="tailscale-operator-assist" checked /> Open login page on operator monitor when available</label>
							</div>
							<div class="settings-group checkbox">
								<label><input type="checkbox" id="tailscale-accept-routes" /> Accept subnet routes</label>
							</div>
							<div class="settings-group">
								<label>Hostname (optional)</label>
								<input type="text" id="tailscale-hostname-input" placeholder="leave empty for default" autocomplete="off">
							</div>
							<button type="button" class="btn btn--secondary" id="tailscale-save-prefs">Save preferences</button>
						</details>
					</div>
					<div class="settings-pane" id="settings-pane-live-audio"></div>
					<div class="settings-pane" id="settings-pane-usb-video"></div>
					<div class="settings-pane" id="settings-pane-variables"></div>
					<div class="settings-pane" id="settings-pane-nuclear">
						<h3 class="settings-category">Danger zone</h3>
						<p class="settings-note">These actions can interrupt output immediately.</p>
						<div class="settings-group checkbox">
							<label><input type="checkbox" id="set-nuclear-require-pass" /> Require password for nuclear actions</label>
						</div>
						<div class="settings-group" id="set-nuclear-password-fields">
							<label>Nuclear password</label>
							<input type="password" id="set-nuclear-password" placeholder="Required for nuclear actions when enabled" autocomplete="new-password">
						</div>
						<div class="settings-group">
							<button type="button" class="btn btn--secondary" id="set-nuclear-restart-wm">Restart window manager (nodm)</button>
							<button type="button" class="btn btn--primary" id="set-nuclear-reboot">Reboot host</button>
						</div>
						<h4 class="settings-subhead">Install to disk</h4>
						<p class="settings-note">Launch the Calamares graphical installer on <code>:0</code> (needs a connected screen). Use after booting the live USB to copy HighAsCG onto internal storage.</p>
						<div class="settings-group">
							<button type="button" class="btn btn--secondary" id="set-nuclear-install-disk">Install to disk (Calamares)</button>
						</div>
						<h4 class="settings-subhead">CasparCG playout</h4>
						<p class="settings-note" id="set-nuclear-caspar-status">Caspar status: unknown</p>
						<div class="settings-group" style="display:flex;flex-wrap:wrap;gap:0.5rem">
							<button type="button" class="btn btn--secondary" id="set-nuclear-caspar-stop">Stop CasparCG</button>
							<button type="button" class="btn btn--secondary" id="set-nuclear-caspar-start">Start CasparCG</button>
							<button type="button" class="btn btn--secondary" id="set-nuclear-caspar-restart">Restart CasparCG</button>
						</div>
						<p class="settings-note">Stop shuts down playout without autorestart until you start again (systemd units).</p>
						<p class="settings-note" id="set-nuclear-status"></p>
					</div>
				</div>
			</div>
			<div class="modal-footer"><button class="btn btn--secondary" id="settings-cancel">Close</button><span id="settings-save-status"></span></div>
		</div>
	`
}

