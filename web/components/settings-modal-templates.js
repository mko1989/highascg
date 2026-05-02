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
					<button class="settings-tab active" data-tab="streaming">Preview streaming</button>
					<button class="settings-tab" data-tab="companion">Companion</button>
					<button class="settings-tab" data-tab="media-usb">Media (USB)</button>
					<button class="settings-tab" data-tab="variables">Variables</button>
					<button class="settings-tab" data-tab="nuclear">Nuclear</button>
				</div>
				<div class="settings-panes">
					<div class="settings-pane active" id="settings-pane-streaming">
						<h3 class="settings-category">General / Simulation</h3>
						<div class="settings-group checkbox">
							<label><input type="checkbox" id="set-offline-mode"> Simulation / Offline Mode (Simulate CasparCG playback)</label>
						</div>
						<h3 class="settings-category">In-browser preview (WebRTC / go2rtc)</h3>
						<div class="settings-group checkbox"><label><input type="checkbox" id="set-stream-enabled"> Enable Live Preview (WebRTC)</label></div>
						<div class="settings-group">
							<p class="settings-note">Preview uses <strong>STREAM</strong> into <strong>go2rtc</strong>. Channel numbers follow <strong>Screens</strong> and <strong>Multiview</strong>.</p>
							<label>Quality Preset</label>
							<select id="set-stream-quality">
								<option value="preview">Preview (½ res, 1 fps)</option>
								<option value="low">Low (½ res, 15 fps)</option>
								<option value="medium">Medium (½ res — default)</option>
								<option value="high">High (½ res, higher bitrate)</option>
								<option value="native">Native (full resolution)</option>
								<option value="ultrafast">Ultrafast (½ res, minimal bitrate)</option>
							</select>
						</div>
						<div class="settings-group checkbox"><label><input type="checkbox" id="set-stream-hw"> Use Hardware Acceleration (FFmpeg)</label></div>
						<div class="settings-group">
							<label>Base Port (go2rtc)</label><input type="number" id="set-stream-port" placeholder="8554">
							<p class="settings-note">UDP base+1 (PGM), base+2 (PRV), base+5 (MV).</p>
						</div>
						<div class="settings-group checkbox">
							<label><input type="checkbox" id="set-stream-auto-relocate" checked /> Auto-relocate base port if UDP ports are busy</label>
						</div>
						<div class="settings-group">
							<label>go2rtc log level</label>
							<select id="set-stream-go2rtc-log">
								<option value="">Default</option><option value="trace">trace</option><option value="debug">debug</option><option value="info">info</option><option value="warn">warn</option><option value="error">error</option>
							</select>
						</div>
					</div>
					<div class="settings-pane" id="settings-pane-companion">
						<h3 class="settings-category">Bitfocus Companion</h3>
						<div class="settings-group"><label>Companion Host</label><input type="text" id="set-companion-host" placeholder="127.0.0.1"></div>
						<div class="settings-group"><label>Companion Port</label><input type="number" id="set-companion-port" placeholder="8000"></div>
					</div>
					<div class="settings-pane" id="settings-pane-media-usb">
						<h3 class="settings-category">USB media import</h3>
						<div class="settings-group checkbox"><label><input type="checkbox" id="set-usb-enabled" checked /> Enable USB import</label></div>
						<div class="settings-group"><label>Default subfolder template</label><input type="text" id="set-usb-subfolder" placeholder="usb/{label}/{date}"></div>
						<div class="settings-group"><label>When file already exists</label><select id="set-usb-policy"><option value="rename">Rename</option><option value="skip">Skip</option><option value="overwrite">Overwrite</option></select></div>
						<div class="settings-group checkbox"><label><input type="checkbox" id="set-usb-verify" /> Verify SHA1 after copy</label></div>
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

