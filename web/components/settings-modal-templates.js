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
					<button class="settings-tab active" data-tab="simulation">Simulation</button>
					<button class="settings-tab" data-tab="companion">Companion</button>
					<button class="settings-tab" data-tab="media-usb">media/usb</button>
					<button class="settings-tab" data-tab="system-hardware">system</button>
					<button class="settings-tab" data-tab="decklink">decklink</button>
					<button class="settings-tab" data-tab="plugins">Plugins</button>
					<button class="settings-tab" data-tab="variables">Variables</button>
					<button class="settings-tab" data-tab="nuclear">Nuclear</button>
				</div>
				<div class="settings-panes">
					<div class="settings-pane active" id="settings-pane-simulation">
						<h3 class="settings-category">Simulation</h3>
						<div class="settings-group checkbox">
							<label><input type="checkbox" id="set-offline-mode"> Simulation / Offline Mode (Simulate CasparCG playback)</label>
						</div>
						<p class="settings-note">Placeholder panel for simulation workflow. More controls will be added here.</p>
					</div>
					<div class="settings-pane" id="settings-pane-companion">
						<h3 class="settings-category">Bitfocus Companion</h3>
						<div class="settings-group"><label>Companion Host</label><input type="text" id="set-companion-host" placeholder="127.0.0.1"></div>
						<div class="settings-group"><label>Companion Port</label><input type="number" id="set-companion-port" placeholder="8000"></div>
					</div>
					<div class="settings-pane" id="settings-pane-media-usb">
						<h3 class="settings-category">Media disk mount (live / internal)</h3>
						<p class="settings-note">Fixed folder: <code>/home/casparcg/highascg/media</code>. Mounting deletes <strong>all files</strong> currently in that folder (not recoverable here), then mounts the chosen partition. The partition UUID is saved and remounted automatically when HighAsCG starts (<code>sudo</code> helper + <code>sudoers.d</code> required — see <code>docs/HIGHASCG_PASSWORDLESS_SUDO.md</code> / installer). After you change the mount while CasparCG is already running, <strong>restart CasparCG</strong>; stop playback first if umount reports the device is busy.</p>
						<div class="settings-group" style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center">
							<label for="media-mount-part-select" style="flex:1 1 100%">Partition</label>
							<button type="button" class="btn btn--secondary" id="media-mount-refresh-btn" style="flex:0">Refresh drives</button>
							<select id="media-mount-part-select" style="flex:1 1 12rem;min-width:14rem"><option value="">— select —</option></select>
							<button type="button" class="btn btn--primary" id="media-mount-apply-btn" disabled style="flex:0">Mount…</button>
						</div>
						<p class="settings-note" id="media-mount-status-line" style="margin-top:0.25rem"></p>
						<hr style="border:none;border-top:1px solid rgba(255,255,255,0.12);margin:1rem 0" />
						<h3 class="settings-category">USB media import</h3>
						<div class="settings-group"><label>CasparCG Media Path</label><input type="text" id="set-local-media-path" placeholder="/home/casparcg/highascg/media"></div>
						<div class="settings-group checkbox"><label><input type="checkbox" id="set-usb-enabled" checked /> Enable USB import</label></div>
						<div class="settings-group"><label>Default subfolder template</label><input type="text" id="set-usb-subfolder" placeholder="usb/{label}/{date}"></div>
						<div class="settings-group"><label>When file already exists</label><select id="set-usb-policy"><option value="rename">Rename</option><option value="skip">Skip</option><option value="overwrite">Overwrite</option></select></div>
						<div class="settings-group checkbox"><label><input type="checkbox" id="set-usb-verify" /> Verify SHA1 after copy</label></div>
					</div>
					<div class="settings-pane" id="settings-pane-system-hardware">
						<h3 class="settings-category">NVIDIA GPU</h3>
						<p class="settings-note">Driver info from this host and optional apply from offline pool <code>/opt/nvidia-pool</code> (branch must have <code>nvidia-driver-*</code> debs cached). <strong>If nuclear password protection is enabled</strong>, enter it under the <strong>Nuclear</strong> tab before Apply or GPU tools.</p>
						<pre class="settings-note" id="system-hw-nvidia-summary" style="white-space:pre-wrap;max-height:10rem;overflow:auto;font-size:0.8rem;line-height:1.35;background:rgba(0,0,0,0.2);padding:0.5rem;border-radius:0.35rem;margin:0.25rem 0">Loading…</pre>
						<div class="settings-group" style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;margin-top:0.5rem">
							<label for="system-hw-nvidia-branch" style="flex:1 1 100%">Branch (from pool)</label>
							<select id="system-hw-nvidia-branch" style="flex:1 1 8rem;min-width:7rem"><option value="">—</option></select>
							<button type="button" class="btn btn--primary" id="system-hw-nvidia-apply" style="flex:0">Apply driver…</button>
							<button type="button" class="btn btn--secondary" id="system-hw-nvidia-settings" style="flex:0">nvidia-settings :0</button>
							<button type="button" class="btn btn--secondary" id="system-hw-nvidia-refresh" style="flex:0">Refresh</button>
						</div>
						<p class="settings-note" id="system-hw-nvidia-status" style="margin-top:0.35rem"></p>
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
					<div class="settings-pane" id="settings-pane-plugins">
						<h3 class="settings-category">Plugins</h3>
						<p class="settings-note">Enable or disable plugins. Toggle one or several, then apply.</p>
						<div class="settings-group">
							<p class="settings-note" id="set-plugin-status"></p>
						</div>
						<div class="settings-group">
							<div id="set-plugins-list"></div>
						</div>
						<div class="settings-group">
							<button type="button" class="btn btn--primary" id="set-plugin-apply-toggles">Apply plugin toggles</button>
							<button type="button" class="btn btn--secondary" id="set-plugin-refresh">Refresh list</button>
						</div>
						<details class="settings-group">
							<summary>Advanced plugin actions</summary>
							<div class="settings-group">
								<label>Add plugin (ID)</label>
								<input type="text" id="set-plugin-add-id" placeholder="my-plugin">
							</div>
							<div class="settings-group">
								<label>Module name</label>
								<input type="text" id="set-plugin-add-module" placeholder="my-plugin">
							</div>
							<div class="settings-group">
								<label>Source</label>
								<select id="set-plugin-add-source">
									<option value="local">local</option>
									<option value="bundled">bundled</option>
									<option value="github">github (future)</option>
								</select>
							</div>
							<div class="settings-group">
								<button type="button" class="btn btn--secondary" id="set-plugin-add-btn">Add plugin</button>
							</div>
							<button type="button" class="btn btn--primary" id="set-plugin-restart-app">Restart HighAsCG App</button>
						</details>
					</div>
					<div class="settings-pane" id="settings-pane-variables"></div>
					<div class="settings-pane" id="settings-pane-nuclear">
						<h3 class="settings-category">Danger zone</h3>
						<p class="settings-note">These actions can interrupt output immediately.</p>
						<div class="settings-group checkbox">
							<label><input type="checkbox" id="set-nuclear-require-pass" /> Require password for nuclear actions</label>
						</div>
						<div class="settings-group">
							<label>Nuclear password</label>
							<input type="password" id="set-nuclear-password" placeholder="Optional (only used when checkbox is on)" autocomplete="new-password">
						</div>
						<div class="settings-group">
							<label>Action password</label>
							<input type="password" id="set-nuclear-action-password" placeholder="Enter only if required" autocomplete="off">
						</div>
						<div class="settings-group">
							<button type="button" class="btn btn--secondary" id="set-nuclear-restart-wm">Restart window manager (nodm)</button>
							<button type="button" class="btn btn--primary" id="set-nuclear-reboot">Reboot host</button>
						</div>
						<p class="settings-note" id="set-nuclear-status"></p>
					</div>
				</div>
			</div>
			<div class="modal-footer"><button class="btn btn--secondary" id="settings-cancel">Close</button><span id="settings-save-status"></span></div>
		</div>
	`
}

