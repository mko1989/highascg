"""mqpy.py — drive MagicQ PC on :0 (coordinates = the mq0shot.sh frame: screen − (10, 33)), with pixel checks."""
import subprocess, time, os, io, fcntl
from PIL import Image
ENV = dict(os.environ, DISPLAY=':0', XAUTHORITY=os.path.expanduser('~/.Xauthority'))
OX, OY = 10, 33
_lock = open('/tmp/highascg-gui.lock', 'w')
def _x(*a):
    fcntl.flock(_lock, fcntl.LOCK_EX)
    try: subprocess.run(['xdotool', *map(str, a)], env=ENV, check=True)
    finally: fcntl.flock(_lock, fcntl.LOCK_UN)
def click(x, y, wait=0.4): _x('mousemove', x + OX, y + OY, 'click', 1); time.sleep(wait)
def shift_click(x, y, wait=0.4): _x('keydown', 'shift', 'mousemove', x + OX, y + OY, 'click', 1, 'keyup', 'shift'); time.sleep(wait)
def key(k, wait=0.3): _x('key', k); time.sleep(wait)
def typ(t, wait=0.3): _x('type', '--delay', 40, t); time.sleep(wait)
def grab():
    r = subprocess.run(['ffmpeg', '-loglevel', 'error', '-f', 'x11grab', '-video_size', '1800x920', '-i', f':0+{OX},{OY}', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], env=ENV, capture_output=True)
    return Image.open(io.BytesIO(r.stdout)).convert('RGB')
def shot(name, box=None):
    im = grab(); im = im.crop(box) if box else im
    p = os.path.join(os.path.dirname(__file__), '..', 'shots', f'q_{name}.png'); im.save(p); return p
def blue(im, x, y): r, g, b = im.getpixel((x, y)); return b > 200 and r < 90 and g < 90
def wait_blue(x, y, on=True, timeout=30):
    """Wait until the pixel is (not) the dialog-title blue."""
    t = time.time()
    while time.time() - t < timeout:
        if blue(grab(), x, y) == on: return True
        time.sleep(0.4)
    return False
def confirm_open(): return blue(grab(), 700, 199)       # CONFIRM dialog title bar
def select_open(): return blue(grab(), 700, 99)         # SELECT dialog title bar
def status():  # crop of the two status lines, for the caller to look at
    return shot('status', (80, 595, 1490, 630))

def top(n=30):
    _x('mousemove', 700 + OX, 400 + OY)
    for i in range(n): _x('click', 4); time.sleep(0.05)
    time.sleep(0.6)
def clone(r0, r1=None, wait=12):
    """Clone the head rows r0..r1 of the shown View Heads tab (list scrolled to the top). → True when both dialogs appeared."""
    top(); click(290, 196 + 18 * r0, 0.6)
    if r1 is not None: shift_click(290, 196 + 18 * r1, 0.6)
    click(917, 56, 2)
    if not confirm_open(): return False
    click(665, 293, 2)
    im = grab()
    if im.getpixel((728, 253))[0] < 40: return False  # the DONE button of "Select clone type" is not there
    click(728, 253, wait); return True

def save(name='gutmanny26'):
    click(20, 12, 1); click(55, 99, 2.5)
    if not confirm_open(): return False
    typ(name); key('Return', 3)
    if confirm_open(): click(665, 293, 8)
    return True

def export(name):
    """Patch ▸ View Chans ▸ Export Heads → mq/<name>.csv"""
    import shutil
    click(1707, 210, 2); click(212, 56, 2); click(1443, 56, 3)
    if not confirm_open(): return None
    typ(name); key('Return', 4)
    p = os.path.expanduser(f'~/Documents/MagicQ/show/{name}.csv'); q = os.path.join(os.path.dirname(__file__), '..', 'mq', f'{name}.csv')
    shutil.move(p, q); return q

def import_readdress(col, wait=60):
    """Patch ▸ View Chans ▸ Import Heads ▸ the file in column `col` (0-based) of the file manager's first row ▸ Readdress."""
    click(1707, 210, 2); click(212, 56, 2); click(1002, 56, 2.5)
    if not confirm_open(): return False
    click(665, 294, 3); click(231 + 123 * col, 157, 2.5); click(707, 184, wait); return True
def check(q, want_csv):
    import csv
    want = {int(r['Headno']): r['Dmxno'] for r in csv.DictReader(open(want_csv))}
    got = {int(r['Headno']): r['Dmxno'] for r in csv.DictReader(open(q)) if 'vdim' not in r['Headtype']}
    return [(n, want[n], got.get(n)) for n in want if got.get(n) != want[n]]

def previs_shot(name, wait=3):
    """Hide MagicQ for a moment and photograph the HighAsCG GUI behind it."""
    w = subprocess.run(['xdotool', 'search', '--name', 'MagicQ PC'], env=ENV, capture_output=True, text=True).stdout.split()[0]
    _x('windowminimize', w); time.sleep(wait)
    p = os.path.join(os.path.dirname(__file__), '..', 'shots', f'{name}.png')
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'x11grab', '-video_size', '1920x1080', '-i', ':0', '-frames:v', '1', p], env=ENV)
    _x('windowmap', w); _x('windowactivate', w); time.sleep(1.5); return p

def bottom(n=200):
    _x('mousemove', 700 + OX, 400 + OY)
    for i in range(n): _x('click', 5); time.sleep(0.03)
    time.sleep(0.6)
def block_enter(x, r0, r1):
    click(x, 196 + 18 * r0, 0.6)
    if r1 != r0: shift_click(x, 196 + 18 * r1, 0.8)
    key('Return', 2)

def reaim(col, row, x, z):
    """Focus Hold (already active, heads selected) to stage point x,z (m) → merge into position palette at col,row."""
    click(1638, 324, 2.5)
    click(round(785 + 8.55 * x), round(222 + 8.55 * z), 2)
    click(1563, 779, 2.5); click(1772, 678, 1); click(230 + 121 * col, 139 + 48 * row, 2)
    if not confirm_open(): return 'no confirm'
    click(665, 293, 2); return 'ok'
