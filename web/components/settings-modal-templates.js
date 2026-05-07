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
					<button class="settings-tab" data-tab="media-usb">Media (USB)</button>
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

