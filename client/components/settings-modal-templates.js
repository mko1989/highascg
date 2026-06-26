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
					<button class="settings-tab" data-tab="simulation">Simulation</button>
					<button class="settings-tab" data-tab="companion">Companion</button>
					<button class="settings-tab" data-tab="media-usb">media/usb</button>
					<button class="settings-tab" data-tab="system-hardware">system</button>
					<button class="settings-tab" data-tab="decklink">decklink</button>
					<button class="settings-tab" data-tab="live-audio">Live audio</button>
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
							<label for="ed-timeline-start">Start behaviour</label>
							<select id="ed-timeline-start">
								<option value="beginning">Start from beginning (trim in)</option>
								<option value="relativeToPrevious">Continue from previous / timeline playhead</option>
							</select>
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
					</div>
					<div class="settings-pane" id="settings-pane-simulation">
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
						<p class="settings-note">Fixed folder: <code>/home/casparcg/highascg/media/drive</code>. Mounting deletes <strong>all files</strong> currently in that folder (not recoverable here), then mounts the chosen partition there. Other paths under <code>media/</code> are unchanged. The partition UUID is saved and remounted automatically when HighAsCG starts (<code>sudo</code> helper + <code>sudoers.d</code> required — see <code>docs/HIGHASCG_PASSWORDLESS_SUDO.md</code> / installer). After you change the mount while CasparCG is already running, <strong>restart CasparCG</strong>; stop playback first if umount reports the device is busy.</p>
						<div class="settings-group" style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center">
							<label for="media-mount-part-select" style="flex:1 1 100%">Partition</label>
							<button type="button" class="btn btn--secondary" id="media-mount-refresh-btn" style="flex:0">Refresh drives</button>
							<select id="media-mount-part-select" style="flex:1 1 12rem;min-width:14rem"><option value="">— select —</option></select>
							<button type="button" class="btn btn--primary" id="media-mount-apply-btn" disabled style="flex:0">Mount…</button>
						</div>
						<p class="settings-note" id="media-mount-status-line" style="margin-top:0.25rem"></p>
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
						<h3 class="settings-category">USB media import</h3>
						<div class="settings-group"><label>CasparCG Media Path</label><input type="text" id="set-local-media-path" placeholder="/home/casparcg/highascg/media"></div>
						<div class="settings-group checkbox"><label><input type="checkbox" id="set-usb-enabled" checked /> Enable USB import</label></div>
						<div class="settings-group"><label>Default subfolder template</label><input type="text" id="set-usb-subfolder" placeholder="usb/{label}/{date}"></div>
						<div class="settings-group"><label>When file already exists</label><select id="set-usb-policy"><option value="rename">Rename</option><option value="skip">Skip</option><option value="overwrite">Overwrite</option></select></div>
						<div class="settings-group checkbox"><label><input type="checkbox" id="set-usb-verify" /> Verify SHA1 after copy</label></div>
					</div>
					<div class="settings-pane" id="settings-pane-system-hardware">
						<h3 class="settings-category">NVIDIA GPU</h3>
						<pre class="settings-note" id="system-hw-nvidia-summary" style="white-space:pre-wrap;max-height:10rem;overflow:auto;font-size:0.8rem;line-height:1.35;background:rgba(0,0,0,0.2);padding:0.5rem;border-radius:0.35rem;margin:0.25rem 0">Loading…</pre>
						<div class="settings-group" style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;margin-top:0.5rem">
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
					<div class="settings-pane" id="settings-pane-live-audio"></div>
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

