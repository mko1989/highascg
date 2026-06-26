#!/usr/bin/env python3
"""
Stick Studio — GUI wrapper around live‑USB tooling + portable HighAsCG simulation.

Requires: Python 3, tkinter (Debian/Ubuntu: sudo apt install python3-tk)
Flashing runs via pkexec → client/tools/stick-tools/stick-studio-priv.sh .
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


def repo_root() -> Path:
	return Path(__file__).resolve().parents[3]


def privileged_helper() -> Path:
	p = repo_root() / "client/tools/stick-tools/stick-studio-priv.sh"
	if not p.is_file():
		raise RuntimeError(f"Missing {p}")
	mode = p.stat().st_mode
	if not mode & 0o111:
		os.chmod(p, mode | 0o111)
	return p


def run_priv(action: str, *args: str) -> subprocess.CompletedProcess:
	env = dict(os.environ)
	env.setdefault("LANG", "C.UTF-8")
	cmd = ["pkexec", str(privileged_helper()), action, *args]
	return subprocess.run(cmd, env=env)


def list_usb_disks() -> list[str]:
	"""Delegate to flash-stick-common.sh for the same heuristic as CLI flash tools."""
	rr = repo_root()
	common_sh = rr / "tools/eggs/live-usb/flash-stick-common.sh"
	if not common_sh.is_file():
		return []
	proc = subprocess.run(
		["bash", "-lc", f"source {common_sh.as_posix()} && list_flash_candidates"],
		capture_output=True,
		text=True,
	)
	out = proc.stdout.strip()
	if proc.returncode != 0:
		sys.stderr.write(proc.stderr or "")
	return [ln.strip() for ln in out.splitlines() if ln.strip().startswith("/dev/")]


def disk_desc(path: Path) -> str:
	try:
		sz = subprocess.run(
			["lsblk", "-dnro", "SIZE", str(path)],
			capture_output=True,
			text=True,
			timeout=5,
		).stdout.strip()
	except (FileNotFoundError, subprocess.TimeoutExpired):
		sz = "?"
	mod = subprocess.run(
		["lsblk", "-dnro", "MODEL", str(path)],
		capture_output=True,
		text=True,
		timeout=5,
	).stdout.strip()
	return f"{path} — {sz} — {mod}"


DEFAULT_EXFAT_DIRS = ("sim/highascg", "drop-config", "media", "templates", "configs", "snapshots/rear-panels")


def ensure_operator_tree(vol: Path) -> None:
	for rel in DEFAULT_EXFAT_DIRS:
		(vol / rel).mkdir(parents=True, exist_ok=True)


def sync_tree(src: Path, dst_under_sim: Path) -> None:
	if not src.is_dir():
		raise FileNotFoundError(str(src))
	dst_under_sim.mkdir(parents=True, exist_ok=True)
	for item in src.iterdir():
		target = dst_under_sim / item.name
		if item.is_dir():
			if target.exists():
				shutil.rmtree(target)
			shutil.copytree(item, target, symlinks=False, ignore_dangling_symlinks=True)
		else:
			shutil.copy2(item, target)


class StickStudioUi:
	def __init__(self, root) -> None:
		import tkinter as tk
		from tkinter import filedialog, messagebox, ttk

		self.filedialog = filedialog
		self.tk = tk
		self.messagebox = messagebox
		self.root = root
		root.title("Stick Studio — HighAsCG / live USB")

		ff = tk.Frame(root, padx=8, pady=8)
		ff.pack(fill=tk.X)
		default_repo = repo_root().resolve()

		tk.Label(ff, text="HighAsCG repo:").grid(row=0, column=0, sticky="w")
		self.var_repo = tk.StringVar(value=str(default_repo))
		tk.Entry(ff, textvariable=self.var_repo, width=64).grid(row=0, column=1, sticky="ew")
		ff.columnconfigure(1, weight=1)

		iso_lb = tk.LabelFrame(root, text="1 · Flash hybrid ISO → whole disk (destructive dd)", padx=8, pady=8)
		iso_lb.pack(fill=tk.X, padx=8, pady=6)
		self.var_iso = tk.StringVar(value="")
		tk.Entry(iso_lb, textvariable=self.var_iso, width=70).grid(row=0, column=0, padx=(0, 8))
		self.filedialog = filedialog
		tk.Button(iso_lb, text="Browse…", command=self._pick_iso).grid(row=0, column=1)

		usb_lb = tk.LabelFrame(root, text="USB whole-disk target (must be disk, not partition)", padx=8, pady=8)
		usb_lb.pack(fill=tk.X, padx=8, pady=6)

		raw = list_usb_disks()
		self.cmb_labels = []
		values: list[str] = []
		for disk in raw:
			p = Path(disk)
			values.append(f"{disk}  |  {disk_desc(p)}")
			self.cmb_labels.append(disk)
		self.cmb_usb = ttk.Combobox(usb_lb, width=80, values=values, state="readonly")
		if values:
			self.cmb_usb.current(0)
		self.cmb_usb.pack(side=tk.LEFT, fill=tk.X, expand=True)
		tk.Button(usb_lb, text="Refresh", command=self._refresh_usb).pack(side=tk.RIGHT, padx=(8, 0))

		self.var_do_dd = tk.BooleanVar(value=False)
		self.var_do_exfat = tk.BooleanVar(value=True)
		self.var_exfat_fill = tk.BooleanVar(value=False)

		tk.Checkbutton(root, text="✓ Erase stick with ISO image (runs pkexec dd)", variable=self.var_do_dd).pack(anchor="w", padx=16)
		tk.Checkbutton(root, text="✓ Append exFAT data partition LABEL HIGHASCGEXF (WO‑47)", variable=self.var_do_exfat).pack(anchor="w", padx=16)
		tk.Checkbutton(root, text="   EXFAT_FILL_DISK — only for sticks without hybrid layout", variable=self.var_exfat_fill).pack(anchor="w", padx=32)

		mount_lb = tk.LabelFrame(root, text="2 · Operator tree on mounted HIGHASCGEXF (no root needed)", padx=8, pady=8)
		mount_lb.pack(fill=tk.X, padx=8, pady=8)
		self.var_mount = tk.StringVar(value=str(Path.home() / "mnt"))
		tk.Entry(mount_lb, textvariable=self.var_mount, width=60).grid(row=0, column=0, padx=(0, 8))
		tk.Button(mount_lb, text="Browse…", command=self._pick_mount).grid(row=0, column=1)

		self.var_do_mkdirs = tk.BooleanVar(value=True)
		tk.Checkbutton(
			root,
			text="Ensure sim/highascg (+ operator dirs) at mount path below",
			variable=self.var_do_mkdirs,
		).pack(anchor="w", padx=16)

		cp_row = tk.Frame(root)
		cp_row.pack(fill=tk.X, padx=16, pady=4)
		self.var_copy_src = tk.StringVar(value="")
		self.var_do_copy = tk.BooleanVar(value=False)
		tk.Checkbutton(cp_row, text="Copy:", variable=self.var_do_copy).pack(side=tk.LEFT)
		tk.Entry(cp_row, textvariable=self.var_copy_src, width=48).pack(side=tk.LEFT, padx=(4, 4))
		tk.Button(cp_row, text="Browse…", command=self._pick_copy_src).pack(side=tk.LEFT)

		btn_row = tk.Frame(root)
		btn_row.pack(fill=tk.X, padx=8, pady=12)
		tk.Button(btn_row, text="Run pkexec pipeline", command=self._pipeline, width=20).pack(side=tk.LEFT, padx=4)
		tk.Button(btn_row, text="Start simulation (npm portable:sim)", command=self._run_sim, width=26).pack(
			side=tk.LEFT,
			padx=4,
		)

		log_lb = tk.LabelFrame(root, text="Log", padx=4, pady=4)
		log_lb.pack(fill=tk.BOTH, expand=True, padx=8, pady=(0, 8))
		self._log = tk.Text(log_lb, height=12, wrap="word")
		self._log.pack(fill=tk.BOTH, expand=True)

	def log(self, s: str) -> None:
		self._log.insert(self.tk.END, s + "\n")
		self._log.see(self.tk.END)

	def _pick_iso(self) -> None:
		p = self.filedialog.askopenfilename(
			title="Live / hybrid ISO",
			filetypes=[("ISO images", "*.iso"), ("Any", "*")],
		)
		if p:
			self.var_iso.set(p)

	def _pick_mount(self) -> None:
		p = self.filedialog.askdirectory(title="Mounted HIGHASCGEXF")
		if p:
			self.var_mount.set(p)

	def _pick_copy_src(self) -> None:
		p = self.filedialog.askdirectory(title="Sources → …/sim/highascg/")
		if p:
			self.var_copy_src.set(p)

	def _refresh_usb(self) -> None:
		raw = list_usb_disks()
		self.cmb_labels = []
		values: list[str] = []
		for disk in raw:
			self.cmb_labels.append(disk)
			values.append(f"{disk}  |  {disk_desc(Path(disk))}")
		self.cmb_usb["values"] = values
		if values:
			self.cmb_usb.current(0)
		self.log("[USB refreshed]")

	def _selected_disk(self) -> str | None:
		idx = self.cmb_usb.current()
		if idx < 0 or idx >= len(self.cmb_labels):
			self.messagebox.showerror("Stick Studio", "Select a USB disk (Refresh if empty).")
			return None
		return self.cmb_labels[idx]

	def _pipeline(self) -> None:
		m = self.messagebox
		iso_str = Path(self.var_iso.get().strip()).expanduser()
		repo_try = Path(self.var_repo.get().strip()).expanduser().resolve()
		if not (repo_try / "package.json").is_file():
			m.showerror("Stick Studio", f"Repo must contain package.json:\n{repo_try}")
			return

		device = ""

		if self.var_do_dd.get():
			device = self._selected_disk()
			if not device:
				return
			if not iso_str.is_file():
				m.showerror("Stick Studio", "Choose a valid ISO first.")
				return
			ok = m.askyesno(
				"Confirm erase",
				f"Destructive flash — entire disk will be erased:\n\n{device}\n\nISO:\n{iso_str}\n",
				icon="warning",
			)
			if not ok:
				return

		if device == "" and (self.var_do_exfat.get() or self.var_do_dd.get()):
			device = self._selected_disk() or ""

		if self.var_do_dd.get():
			self.log(f"[flash] {iso_str} → {device}")
			if run_priv("flash", str(iso_str.resolve()), device).returncode != 0:
				m.showerror("Stick Studio", "Flash helper failed.")
				return
			self.log("[flash] done.")
			run_priv("partprobe", device)

		if self.var_do_exfat.get():
			if device == "":
				device = self._selected_disk() or ""
				if not device:
					return
			args_k: list[str] = []
			if iso_str.is_file():
				args_k.extend(["--iso-path", str(iso_str.resolve())])
			if self.var_exfat_fill.get():
				args_k.append("--fill-disk")
			args_k.append(device)
			self.log(f"[exfat] partitioning {device}")
			if run_priv("exfat", *args_k).returncode != 0:
				m.showerror("Stick Studio", "exFAT step failed.")
				return
			self.log("[exfat] done.")

		mount_pt = Path(self.var_mount.get().strip()).expanduser()
		if self.var_do_mkdirs.get():
			if not mount_pt.is_dir():
				self.log(f"[dirs] SKIP — mount not found: {mount_pt}")
			else:
				try:
					ensure_operator_tree(mount_pt)
					readme = mount_pt / "README-HIGHASCG-EXFAT.txt"
					if not readme.is_file():
						readme.write_text(
							"sim/highascg — HighAsCG payload (ZIP or git sync).\n"
							"See tools/live-usb/MANUAL_STICK_WINDOWS_MACOS.md · WO‑47.\n",
							encoding="utf-8",
						)
				except OSError as e:
					m.showerror("Stick Studio", f"Could not mkdir:\n{e}")
					return
				self.log(f"[dirs] WO‑47 tree ensured under {mount_pt}")

		if self.var_do_copy.get() and self.var_copy_src.get().strip():
			src_p = Path(self.var_copy_src.get().strip()).expanduser().resolve()
			if not mount_pt.is_dir():
				m.showerror("Stick Studio", f"Bad mount:\n{mount_pt}")
				return
			dest = mount_pt / "sim/highascg"
			try:
				sync_tree(src_p, dest)
			except OSError as e:
				m.showerror("Stick Studio", f"Copy failed:\n{e}")
				return
			self.log(f"[copy]\n {src_p}\n→\n {dest}")

		m.showinfo("Stick Studio", "Pipeline finished.")

	def _run_sim(self) -> None:
		repo_try = Path(self.var_repo.get().strip()).expanduser().resolve()
		if not (repo_try / "package.json").is_file():
			self.messagebox.showerror("Stick Studio", f"No package.json in\n{repo_try}")
			return
		self.log(f"[sim] npm run portable:sim in {repo_try}")
		try:
			if sys.platform.startswith("win"):
				subprocess.Popen(["npm.cmd", "run", "portable:sim"], cwd=repo_try)
			else:
				subprocess.Popen(["npm", "run", "portable:sim"], cwd=repo_try)
		except OSError as e:
			self.messagebox.showerror("Stick Studio", f"npm spawn failed:\n{e}")


def main() -> None:
	try:
		import tkinter as tk
	except ImportError:
		print("Install python3-tk (e.g. sudo apt install python3-tk)", file=sys.stderr)
		sys.exit(1)
	root = tk.Tk()
	StickStudioUi(root)
	root.mainloop()


if __name__ == "__main__":
	main()
