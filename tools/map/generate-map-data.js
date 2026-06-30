const fs = require('fs');
const path = require('path');
const { scanServerModules, scanClientModules, crossReferenceWorkOrders } = require('./ast-scanner');

// CLI Arguments
const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || args.includes('-v');
let outputPath = path.join(__dirname, '../../client/assets/map-data.json');

const outputArgIdx = args.findIndex(a => a === '--output' || a === '-o');
if (outputArgIdx >= 0 && outputArgIdx + 1 < args.length) {
    outputPath = args[outputArgIdx + 1];
}

const rootNode = {
    id: "ubuntu",
    label: "Ubuntu 24.04 LTS",
    kind: "os",
    description: "Playout host operating system — headless X11 kiosk via nodm/Openbox",
    children: [
        {
            id: "grub",
            label: "GRUB 2",
            kind: "bootloader",
            description: "GNU bootloader — chainloads kernel, optional recovery mode",
            meta: { configPath: "/boot/grub/grub.cfg", timeout: 0 },
            children: [
                {
                    id: "plymouth",
                    label: "Plymouth",
                    kind: "subsystem",
                    description: "Boot splash — HighAsCG corner throbber animation",
                    meta: { theme: "highascg", relatedService: "highascg-fb-corner-throbber.service" }
                }
            ]
        },
        {
            id: "kernel",
            label: "Linux Kernel",
            kind: "kernel",
            description: "Linux kernel — hardware abstraction, device drivers, process scheduling",
            children: [
                {
                    id: "drv:nvidia",
                    label: "NVIDIA GPU Driver",
                    kind: "driver",
                    description: "Proprietary NVIDIA driver — screen consumers, xrandr multi-head, VBlank sync control",
                    meta: {
                        kernelModule: "nvidia",
                        relatedWOs: ["WO-35", "WO-40", "WO-80"],
                        managedBy: ["xrandr", "nvidia-settings", "nvidia-smi"],
                        relatedScripts: ["scripts/nvidia/", "highascg-nvidia-x-apply.sh"]
                    },
                    children: [
                        { id: "nvidia:screen-consumers", label: "Screen Consumers", kind: "subsystem", description: "CasparCG screen consumer windows — one per xrandr output" },
                        { id: "nvidia:xrandr", label: "xrandr Layout", kind: "subsystem", description: "X11 RandR — multi-head display layout, custom modes, position/rotation" },
                        { id: "nvidia:vblank", label: "VBlank / VSync Control", kind: "subsystem", description: "Sync to VBlank OFF for screen consumers — prevents frame drops", meta: { refDoc: "docs/reference/screen-consumer-vsync-nvidia.md" } }
                    ]
                },
                {
                    id: "drv:decklink",
                    label: "Blackmagic DeckLink Driver",
                    kind: "driver",
                    description: "DeckLink kernel module — SDI/HDMI I/O via Blackmagic cards",
                    meta: {
                        kernelModule: "blackmagic-io",
                        userTool: "desktopvideo_setup",
                        relatedWOs: ["WO-28", "WO-36", "WO-55", "WO-56"]
                    },
                    children: [
                        { id: "decklink:input", label: "DeckLink Inputs", kind: "subsystem", description: "SDI/HDMI capture — live camera inputs for CasparCG" },
                        { id: "decklink:output", label: "DeckLink Outputs", kind: "subsystem", description: "SDI/HDMI output — PGM feed to downstream equipment" }
                    ]
                },
                {
                    id: "drv:alsa",
                    label: "ALSA",
                    kind: "subsystem",
                    description: "Advanced Linux Sound Architecture — HDMI, USB, Dante/AES67 audio",
                    meta: { relatedWOs: ["WO-06", "WO-16", "WO-44", "WO-53"] },
                    children: [
                        { id: "alsa:hdmi", label: "HDMI Audio", kind: "subsystem", description: "Audio embedded in HDMI/DP output — GPU-routed" },
                        { id: "alsa:usb", label: "USB Audio", kind: "subsystem", description: "USB audio interfaces — mixers, headphone monitors" },
                        { id: "alsa:dante", label: "Dante / AES67", kind: "subsystem", description: "Network audio via Dante Virtual Soundcard or AES67 driver" },
                        { id: "alsa:decklink-audio", label: "DeckLink Audio", kind: "subsystem", description: "Embedded SDI audio via DeckLink cards" }
                    ]
                },
                {
                    id: "drv:usb",
                    label: "USB Subsystem",
                    kind: "subsystem",
                    description: "USB host controller — exFAT sticks, media ingest, NVMe bridge enclosures",
                    meta: {
                        relatedWOs: ["WO-29", "WO-38", "WO-47", "WO-52"],
                        udevRules: "config/udev/"
                    },
                    children: [
                        { id: "usb:exfat-stick", label: "exFAT USB Stick", kind: "subsystem", description: "HIGHASCGEXF labeled stick — config sync, drop-update, media transport" },
                        { id: "usb:media-ingest", label: "Media Ingest USB", kind: "subsystem", description: "Unlabeled USB drives — auto-mount and copy media files" },
                        { id: "usb:bridge-nvme", label: "NVMe Bridge Enclosure", kind: "subsystem", description: "HIGHASCGDAT labeled NVMe — persistent media bridge volume" }
                    ]
                },
                {
                    id: "drv:network",
                    label: "Network Stack",
                    kind: "subsystem",
                    description: "Ethernet — LAN access, Syncthing, rsync, AMCP, OSC, HTTP, WebSocket",
                    children: [
                        { id: "net:ethernet", label: "Ethernet (LAN)", kind: "subsystem", description: "Primary network — operator browser, Companion, peer replication" },
                        { id: "net:amcp", label: "AMCP TCP :5250", kind: "subsystem", description: "CasparCG command protocol — TCP connection to CasparCG server" },
                        { id: "net:osc", label: "OSC UDP :6250", kind: "subsystem", description: "CasparCG telemetry — audio meters, playback status, profiler" },
                        { id: "net:http", label: "HTTP :4200", kind: "subsystem", description: "HighAsCG web server — operator UI, REST API, WebSocket" }
                    ]
                }
            ]
        },
        {
            id: "systemd",
            label: "systemd",
            kind: "init",
            description: "System and Service Manager",
            children: [
                {
                    id: "svc:casparcg-server", label: "casparcg-server.service", kind: "service",
                    description: "CasparCG Server (HighAsCG playout)",
                    meta: { unit: "casparcg-server.service", exec: "run.sh → bin/casparcg", ports: [5250], relatedWOs: ["WO-07", "WO-73"] },
                    children: [
                        {
                            id: "run-sh:casparcg", label: "run.sh", kind: "script", description: "CasparCG Supervisor",
                            children: [{ id: "app:casparcg_link", label: "CasparCG Server", kind: "application", description: "Points to app:casparcg" }]
                        }
                    ]
                },
                { id: "svc:casparcg-scanner", label: "casparcg-scanner.service", kind: "service", description: "CasparCG media scanner", meta: { unit: "casparcg-scanner.service", exec: "/usr/bin/casparcg-scanner", ports: [8000], relatedWOs: ["WO-08"] } },
                { id: "svc:highascg", label: "highascg.service", kind: "service", description: "HighAsCG Playout Control Server", meta: { unit: "highascg.service", exec: "node index.js", ports: [4200], relatedWOs: ["WO-11", "WO-12"] }, children: [{ id: "app:highascg-server_link", label: "HighAsCG Server", kind: "application", description: "Points to app:highascg-server" }] },
                { id: "svc:companion", label: "companion.service", kind: "service", description: "Bitfocus Companion (headless)", meta: { unit: "companion.service", exec: "companion", ports: [8000], relatedWOs: ["WO-24", "WO-70"] } },
                { id: "svc:nodm", label: "nodm.service", kind: "service", description: "Auto-login display manager", meta: { unit: "nodm.service", exec: "nodm", relatedWOs: ["WO-11"] }, children: [{ id: "x11-session_link", label: "X11 Session", kind: "session", description: "Points to x11-session" }] },
                { id: "svc:nginx", label: "nginx.service", kind: "service", description: "Reverse proxy", meta: { unit: "nginx.service", exec: "nginx", ports: [80, 443] } },
                { id: "svc:syncthing", label: "syncthing@casparcg.service", kind: "service", description: "Syncthing file sync", meta: { unit: "syncthing@casparcg.service", exec: "syncthing", ports: [8384, 22000], relatedWOs: ["WO-61"] } },
                { id: "svc:bridge-boot", label: "highascg-bridge-boot.service", kind: "service", description: "Mount HIGHASCGDAT bridge + bind media", meta: { unit: "highascg-bridge-boot.service", exec: "shell script", relatedWOs: ["WO-52"] } },
                { id: "svc:bridge-arrive", label: "highascg-bridge-arrive.service", kind: "service", description: "Mount bridge on late hotplug", meta: { unit: "highascg-bridge-arrive.service", exec: "udev-triggered", relatedWOs: ["WO-52"] } },
                { id: "svc:bridge-media-prep", label: "highascg-bridge-media-prep.service", kind: "service", description: "Ensure bridge exposes media/", meta: { unit: "highascg-bridge-media-prep.service", exec: "shell script", relatedWOs: ["WO-52"] } },
                { id: "svc:exfat-boot", label: "highascg-exfat-boot.service", kind: "service", description: "Wait for HIGHASCGEXF USB, mount, queue sync", meta: { unit: "highascg-exfat-boot.service", exec: "shell script", relatedWOs: ["WO-47"] } },
                { id: "svc:exfat-arrive", label: "highascg-exfat-arrive.service", kind: "service", description: "Mount HIGHASCGEXF on late USB hotplug", meta: { unit: "highascg-exfat-arrive.service", exec: "udev-triggered", relatedWOs: ["WO-47"] } },
                { id: "svc:exfat-media-prep", label: "highascg-exfat-media-prep.service", kind: "service", description: "Ensure exFAT exposes media/", meta: { unit: "highascg-exfat-media-prep.service", exec: "shell script", relatedWOs: ["WO-47"] } },
                { id: "svc:exfat-sync", label: "highascg-exfat-sync.service", kind: "service", description: "Bridge/USB mtime sync", meta: { unit: "highascg-exfat-sync.service", exec: "node tools/runtime/exfat-sync-cli.js", relatedWOs: ["WO-47", "WO-52"] } },
                { id: "svc:exfat-server-update", label: "highascg-exfat-server-update.service", kind: "service", description: "Apply server drop from exFAT", meta: { unit: "highascg-exfat-server-update.service", exec: "shell script", relatedWOs: ["WO-47", "WO-66"] } },
                { id: "svc:power-button", label: "highascg-power-button.service", kind: "service", description: "Power button handler (short=network reset, 3s=shutdown)", meta: { unit: "highascg-power-button.service", exec: "shell script" } },
                { id: "svc:fb-throbber", label: "highascg-fb-corner-throbber.service", kind: "service", description: "Corner throbber on framebuffer", meta: { unit: "highascg-fb-corner-throbber.service", exec: "shell script" } },
                { id: "svc:fix-config-perms", label: "highascg-fix-config-permissions.service", kind: "service", description: "Fix config ownership for exfat-sync", meta: { unit: "highascg-fix-config-permissions.service", exec: "shell script", relatedWOs: ["WO-47"] } },
                { id: "svc:syncthing-resume", label: "syncthing-resume.service", kind: "service", description: "Restart Syncthing after suspend", meta: { unit: "syncthing-resume.service", exec: "shell script" } }
            ]
        },
        {
            id: "x11-session",
            label: "X11 / Openbox",
            kind: "session",
            description: "Minimal X11 desktop — auto-login via nodm, window manager Openbox",
            children: [
                { id: "x11:nodm", label: "nodm", kind: "subsystem", description: "Auto-login display manager — starts X and logs in as 'casparcg' user", meta: { configPath: "/etc/default/nodm", user: "casparcg" } },
                { id: "x11:openbox", label: "Openbox", kind: "subsystem", description: "Lightweight window manager — runs autostart script on login" },
                {
                    id: "x11:autostart", label: "Openbox Autostart", kind: "script", description: "~/.config/openbox/autostart — X session setup, display config",
                    meta: { path: "~/.config/openbox/autostart", refDoc: "docs/openbox_autostart.md" },
                    children: [
                        { id: "x11:xset", label: "xset", kind: "subsystem", description: "Disable screensaver, blanking, and DPMS power management" },
                        { id: "x11:unclutter", label: "unclutter", kind: "subsystem", description: "Hide mouse cursor after 1 second of inactivity" },
                        { id: "x11:nvidia-apply", label: "NVIDIA VBlank Apply", kind: "script", description: "highascg-nvidia-x-apply.sh — disable Sync to VBlank for screen consumers", meta: { path: "/usr/local/bin/highascg-nvidia-x-apply.sh" } },
                        { id: "x11:flock-caspar", label: "flock Caspar Start", kind: "script", description: "File-locked single-instance Caspar launch (legacy path, now systemd)", meta: { lockFile: "/tmp/caspar-openbox-autostart.lock" } }
                    ]
                },
                { id: "x11:xrandr", label: "xrandr", kind: "subsystem", description: "X11 RandR extension — multi-head display layout, custom modes, position/rotation", meta: { relatedWOs: ["WO-40", "WO-80"], relatedCode: ["src/utils/xrandr-custom-mode.js", "src/utils/gpu-topology-xrandr.js"] } }
            ]
        },
        {
            id: "filesystem",
            label: "Filesystem Layout",
            kind: "filesystem",
            description: "Key filesystem paths and mount points",
            children: [
                {
                    id: "fs:opt-casparcg", label: "/opt/casparcg/", kind: "filesystem", description: "CasparCG server — binaries (bin/), libraries (lib/), config, cef-cache, templates", meta: { path: "/opt/casparcg/", fsType: "ext4", mount: "persistent" },
                    children: [
                        { id: "fs:caspar-bin", label: "bin/casparcg", kind: "filesystem", description: "CasparCG server binary" },
                        { id: "fs:caspar-lib", label: "lib/", kind: "filesystem", description: "Shared libraries — libcef.so, libEGL, libGLESv2, libvulkan, libndi" },
                        { id: "fs:caspar-config", label: "config/casparcg.config", kind: "config", description: "CasparCG XML config — channels, consumers, paths" },
                        { id: "fs:caspar-cef", label: "cef-cache/", kind: "filesystem", description: "CEF/Chromium cache — cleared on each restart" },
                        { id: "fs:caspar-templates", label: "template/", kind: "filesystem", description: "HTML templates for CG producer" }
                    ]
                },
                {
                    id: "fs:home-highascg", label: "/home/casparcg/highascg/", kind: "filesystem", description: "HighAsCG repo — Node server, client SPA, config, projects, media", meta: { path: "/home/casparcg/highascg/", fsType: "ext4", mount: "persistent" },
                    children: [
                        { id: "fs:highascg-index", label: "index.js", kind: "file", description: "Server entry point — boots HighAsCG" },
                        { id: "fs:highascg-src", label: "src/", kind: "filesystem", description: "Server source modules — drills into Layer 2" },
                        { id: "fs:highascg-client", label: "client/", kind: "filesystem", description: "Client SPA sources — drills into Layer 3" },
                        { id: "fs:highascg-dist-web", label: "dist-web/", kind: "filesystem", description: "Vite production build — served at :4200" },
                        { id: "fs:highascg-config", label: "config/", kind: "filesystem", description: "Runtime config JSON files — settings, routing, streaming, replication" },
                        { id: "fs:highascg-projects", label: "projects/", kind: "filesystem", description: "Saved project files (scenes, timelines)" },
                        { id: "fs:highascg-media", label: "media/", kind: "filesystem", description: "Local media library (bind-mounted from bridge or local disk)" },
                        { id: "fs:highascg-scripts", label: "scripts/", kind: "filesystem", description: "Setup, deploy, boot, NVIDIA, systemd, eggs scripts" },
                        { id: "fs:highascg-tools", label: "tools/", kind: "filesystem", description: "Smoke tests, wiki builder, release scripts, runtime utilities" },
                        { id: "fs:highascg-work", label: "work/", kind: "filesystem", description: "Work orders, wiki, references, build logs (dev only)" }
                    ]
                },
                { id: "fs:exfat", label: "/home/casparcg/exfat/", kind: "filesystem", description: "USB exFAT stick mount — HIGHASCGEXF label, config/media transport", meta: { path: "/home/casparcg/exfat/", fsType: "exfat", mount: "usb-hotplug", label: "HIGHASCGEXF" } },
                { id: "fs:bridge", label: "/home/casparcg/bridge/", kind: "filesystem", description: "NVMe bridge volume — HIGHASCGDAT label, persistent media storage", meta: { path: "/home/casparcg/bridge/", fsType: "ext4", mount: "nvme-boot", label: "HIGHASCGDAT" } },
                { id: "fs:etc-highascg", label: "/etc/highascg/", kind: "filesystem", description: "System-level HighAsCG config — display-mode, udev rules", meta: { path: "/etc/highascg/" } }
            ]
        },
        {
            id: "app:casparcg", label: "CasparCG Server 2.5", kind: "application", description: "Open-source video playout server — AMCP protocol, screen/DeckLink/NDI/FFmpeg consumers, HTML/CEF producer",
            meta: { binary: "/opt/casparcg/bin/casparcg", config: "/opt/casparcg/config/casparcg.config", supervisor: "run.sh", ports: { amcp: 5250, osc: 6250 } },
            children: [
                {
                    id: "caspar:amcp", label: "AMCP Protocol (TCP :5250)", kind: "subsystem", description: "Advanced Media Control Protocol — text-based TCP commands for playout control",
                    children: [
                        { id: "caspar:amcp:play", label: "PLAY / LOAD / STOP", kind: "subsystem", description: "Media playout commands" },
                        { id: "caspar:amcp:mixer", label: "MIXER", kind: "subsystem", description: "Video mixer commands — opacity, fill, crop, blend, chroma" },
                        { id: "caspar:amcp:cg", label: "CG ADD / UPDATE / REMOVE", kind: "subsystem", description: "HTML template overlay commands" },
                        { id: "caspar:amcp:query", label: "INFO / CLS / TLS", kind: "subsystem", description: "Server query commands — channel info, media list, template list" },
                        { id: "caspar:amcp:data", label: "DATA STORE / RETRIEVE", kind: "subsystem", description: "Server-side data store for templates" },
                        { id: "caspar:amcp:restart", label: "RESTART / KILL", kind: "subsystem", description: "Server lifecycle commands" }
                    ]
                },
                {
                    id: "caspar:osc", label: "OSC Output (UDP :6250)", kind: "subsystem", description: "Real-time telemetry — audio levels, playback position, profiler data",
                    children: [
                        { id: "caspar:osc:audio", label: "Audio Meters", kind: "subsystem", description: "/channel/N/layer/N/audio/dBFS — per-layer audio levels" },
                        { id: "caspar:osc:playback", label: "Playback Position", kind: "subsystem", description: "/channel/N/layer/N/file/frame — current frame, total frames" },
                        { id: "caspar:osc:profiler", label: "Profiler", kind: "subsystem", description: "/channel/N/profiler — frame timing, consumer stats" }
                    ]
                },
                {
                    id: "caspar:consumers", label: "Consumers (output)", kind: "subsystem", description: "Output consumers — where CasparCG sends rendered frames",
                    children: [
                        { id: "caspar:consumer:screen", label: "Screen Consumer", kind: "subsystem", description: "X11 window output — one per xrandr display, borderless" },
                        { id: "caspar:consumer:decklink", label: "DeckLink Consumer", kind: "subsystem", description: "SDI/HDMI output via Blackmagic DeckLink" },
                        { id: "caspar:consumer:ndi", label: "NDI Consumer", kind: "subsystem", description: "NDI network video output" },
                        { id: "caspar:consumer:ffmpeg", label: "FFmpeg Consumer", kind: "subsystem", description: "Streaming, recording, RTMP push via FFmpeg" },
                        { id: "caspar:consumer:image", label: "Image Consumer", kind: "subsystem", description: "JPEG snapshot output for compose-preview thumbnails" }
                    ]
                },
                {
                    id: "caspar:producers", label: "Producers (input/source)", kind: "subsystem", description: "Content producers — sources loaded into layers",
                    children: [
                        { id: "caspar:producer:ffmpeg", label: "FFmpeg Producer", kind: "subsystem", description: "Media file playback — video, image, audio" },
                        { id: "caspar:producer:html", label: "HTML Producer (CEF)", kind: "subsystem", description: "Chromium Embedded Framework — HTML template overlays" },
                        { id: "caspar:producer:decklink", label: "DeckLink Producer", kind: "subsystem", description: "Live SDI/HDMI input capture" },
                        { id: "caspar:producer:route", label: "Route Producer", kind: "subsystem", description: "Channel/layer routing — route one channel's output as a source" },
                        { id: "caspar:producer:color", label: "Color Producer", kind: "subsystem", description: "Solid color fill — #RRGGBBAA" }
                    ]
                },
                { id: "caspar:channels", label: "Channels & Layers", kind: "subsystem", description: "Video channels (1–N) with 9999 layers each — composited top-down" }
            ]
        },
        { id: "app:highascg-server", label: "HighAsCG Server", kind: "application", description: "Node.js playout control server — REST API + WebSocket + AMCP client on :4200", meta: { entry: "index.js", runtime: "Node.js ≥20", port: 4200, configFile: "highascg.config.json" }, children: [] },
        { id: "app:highascg-client", label: "HighAsCG Client (SPA)", kind: "application", description: "Browser-based operator UI — dashboard, scenes, device view, timeline, audio mixer", meta: { entry: "client/app.js", servedAt: "http://<host>:4200/", buildTool: "Vite", buildOutput: "dist-web/" }, children: [] },
        { id: "app:companion", label: "Bitfocus Companion", kind: "application", description: "Button box controller — actions trigger AMCP commands via HighAsCG API", meta: { port: 8000, relatedWOs: ["WO-24", "WO-70", "WO-75"] } },
        { id: "app:syncthing", label: "Syncthing", kind: "application", description: "Peer-to-peer file sync — media library replication between hosts", meta: { ports: [8384, 22000], relatedWOs: ["WO-61"] } },
        { id: "app:nginx", label: "nginx", kind: "application", description: "Reverse proxy — serves HTTPS, static assets caching, WebSocket upgrade", meta: { ports: [80, 443], configPath: "config/nginx/" } },
        { id: "app:casparcg-scanner", label: "CasparCG Scanner", kind: "application", description: "Media file scanner — detects new/changed media, generates thumbnails", meta: { port: 8000 } },
        {
            id: "app:run-sh", label: "run.sh (Caspar Supervisor)", kind: "script", description: "Shell supervisor — single-instance Caspar launch, crash relaunch, hang detection",
            meta: {
                path: "run.sh",
                envVars: ["CASPAR_ROOT", "CASPAR_BIN", "CASPAR_CONFIG", "DISPLAY", "XAUTHORITY", "CASPAR_RESPAWN", "CASPAR_HANG_SEC", "CASPAR_BOOT_HANG_SEC"],
                features: ["flock single instance", "AMCP liveness check", "exit code relaunch", "rapid failure backoff"]
            },
            children: [
                { id: "runsh:flock", label: "flock single instance", kind: "function", description: "File lock (/tmp/caspar-runsh.lock) — prevents multiple run.sh instances" },
                { id: "runsh:inhibit", label: "Inhibit check", kind: "function", description: "Exit if /run/highascg/inhibit-caspar-autostart exists" },
                { id: "runsh:run-caspar", label: "run_caspar()", kind: "function", description: "Launch CasparCG binary, monitor AMCP port, detect hangs (90s/180s)" },
                { id: "runsh:relaunch", label: "Relaunch loop", kind: "function", description: "should_relaunch() — restart on exit codes 5/139/1/134, backoff after 6 rapid failures" }
            ]
        }
    ]
};

const serverAppNode = rootNode.children.find(c => c.id === 'app:highascg-server');
if (serverAppNode) {
    const repoRoot = path.resolve(__dirname, '../../');
    const { modules } = scanServerModules(repoRoot);
    serverAppNode.children = serverAppNode.children || [];
    serverAppNode.children.push(...modules);
}

const clientAppNode = rootNode.children.find(c => c.id === 'app:highascg-client');
if (clientAppNode) {
    const repoRoot = path.resolve(__dirname, '../../');
    const { clientChildren } = scanClientModules(repoRoot);
    clientAppNode.children = clientAppNode.children || [];
    clientAppNode.children.push(...clientChildren);
}

// Flatten tree to get ALL nodes for cross-referencing
let allNodesGlobal = [];
function flatten(node) {
    allNodesGlobal.push(node);
    if (node.children) {
        node.children.forEach(flatten);
    }
}
flatten(rootNode);

// Perform Work Order Cross Reference
const woDir = path.resolve(__dirname, '../../work/work-orders');
crossReferenceWorkOrders(allNodesGlobal, woDir);

let totalNodes = 0;
let maxDepth = 0;
const layerCounts = { "0": 0, "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };

function walk(node, currentDepth) {
    totalNodes++;
    if (currentDepth > maxDepth) maxDepth = currentDepth;
    
    // Assign depth string up to max tracked layers
    const layerString = String(Math.min(currentDepth, 5));
    layerCounts[layerString] = (layerCounts[layerString] || 0) + 1;

    if (node.children) {
        for (const child of node.children) {
            walk(child, currentDepth + 1);
        }
    }
}

walk(rootNode, 0);

const mapData = {
    version: 1,
    generated: new Date().toISOString(),
    generatorVersion: "1.0.0",
    repo: "highascg",
    stats: {
        totalNodes,
        maxDepth,
        layerCounts
    },
    root: rootNode
};

const outputDir = path.dirname(outputPath);
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(outputPath, JSON.stringify(mapData, null, 2), 'utf-8');

if (verbose) {
    console.log(`Generated Map Data JSON`);
    console.log(`Total Nodes: ${totalNodes}`);
    console.log(`Max Depth: ${maxDepth}`);
    console.log(`Layer Counts: ${JSON.stringify(layerCounts)}`);
    console.log(`Output saved to: ${outputPath}`);
}
