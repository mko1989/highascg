#!/usr/bin/env python3
"""WO-586 — convert ShaderAmp (github.com/ArthurTent/ShaderAmp) .frag/.meta pairs into HighAsCG
shader-store configs. Output: out/<id>.json per shader + out/_report.json (converted + skipped).

  git clone --depth 1 https://github.com/ArthurTent/ShaderAmp.git /tmp/sa
  python3 tools/shaders/convert-shaderamp.py /tmp/sa/dist/shaders /tmp/sa-out <existing,ids>
  node tools/shaders/validate-shader-configs.js /tmp/sa-out /tmp/sa-results.json
  then POST each passing config to /api/shaders (the store writes JSON + Caspar template).
Existing ids (comma list) are never reused. Imported ids are prefixed sh-sa- so the batch can be
found or removed as a unit.

ShaderAmp runs Shadertoy code inside a three.js full-screen quad: `void main()` either calls
`mainImage(gl_FragColor, vUv*iResolution.xy)` or holds the code itself using vUv. Audio is a
separate `iAudioData` sampler (ONE row of FFT bytes), unset iChannels get a fallback sky image.
Conversion wraps the whole file instead of extracting mainImage, so both styles port the same way:
  main -> sa_main, mainImage -> sa_mainImage, gl_FragColor -> sa_FragColor, varying vUv -> global,
  new mainImage sets vUv, runs sa_main, returns sa_FragColor.
iAudioData -> a free iChannelN bound 'audio'; its y coordinate is pinned to the FFT row (0.25),
because our texture is Shadertoy's 512x2 (row 1 = waveform) and ShaderAmp's single row gave FFT
at any y.
"""
import json, glob, os, re, sys

SRC = sys.argv[1]
OUT = sys.argv[2]
EXISTING = set(sys.argv[3].split(',')) if len(sys.argv) > 3 else set()
os.makedirs(OUT, exist_ok=True)

BUILTIN_UNIFORMS = {'iResolution', 'iTime', 'iTimeDelta', 'iFrameRate', 'iFrame', 'iChannelTime',
                    'iChannelResolution', 'iMouse', 'iChannel0', 'iChannel1', 'iChannel2',
                    'iChannel3', 'iDate', 'iSampleRate', 'iAmplifiedTime', 'iAudioData'}
UNSUPPORTED_SAMPLERS = ['iVideo', 'iKeyboard', 'iMidi', 'iJoystick']
BUF_LETTER = {'buffer0': 'A', 'buffer1': 'B', 'buffer2': 'C', 'buffer3': 'D'}
PASS_KEY = {0: 'bufferA', 1: 'bufferB', 2: 'bufferC', 3: 'bufferD'}


class Skip(Exception):
    pass


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


def strip_comments(code):
    code = re.sub(r'/\*.*?\*/', ' ', code, flags=re.S)
    return re.sub(r'//[^\n]*', '', code)


def rewrite_calls(code, fn, wrap):
    """Rewrite fn(iAudioData, ARG...) so the coordinate ARG is wrapped: fn(<ch>, wrap(ARG)...)."""
    out, i = [], 0
    pat = re.compile(r'\b' + fn + r'\s*\(\s*iAudioData\s*,')
    while True:
        m = pat.search(code, i)
        if not m:
            out.append(code[i:])
            return ''.join(out)
        out.append(code[i:m.start()])
        j, depth, start = m.end(), 0, m.end()
        # argument ends at the next top-level ',' or the closing ')'
        while j < len(code):
            c = code[j]
            if c in '([':
                depth += 1
            elif c in ')]':
                if depth == 0:
                    break
                depth -= 1
            elif c == ',' and depth == 0:
                break
            j += 1
        arg = code[start:j].strip()
        out.append(f'{fn}(iAudioData, {wrap}({arg})')
        i = j


def convert_pass(code, meta_channels, custom_uniforms):
    """Returns (source, channels[4]). meta_channels: {'iChannel0': 'buffer0', ...} for this pass."""
    code = code.replace('\r\n', '\n')
    code = re.sub(r'^\s*#version[^\n]*\n', '', code, flags=re.M)
    code = re.sub(r'^\s*precision\s+\w+\s+\w+\s*;[^\n]*\n', '', code, flags=re.M)
    code = re.sub(r'^\s*#extension[^\n]*\n', '', code, flags=re.M)

    live = strip_comments(code)
    for s in UNSUPPORTED_SAMPLERS:
        if re.search(r'\b' + s + r'\b', re.sub(r'uniform[^;]*;', '', live)):
            raise Skip(f'uses {s}')

    # uniforms: builtins removed (ShaderToyLite declares them), custom floats become consts
    def uni(m):
        typ, name = m.group(1), m.group(2)
        if name in BUILTIN_UNIFORMS or name in UNSUPPORTED_SAMPLERS:
            return ''
        if name in custom_uniforms and typ == 'float':
            return f'const float {name} = {float(custom_uniforms[name]):.4f};'
        raise Skip(f'unsupported uniform {typ} {name}')
    code = re.sub(r'^\s*uniform\s+(\w+)\s+(\w+)\s*(?:\[\s*\d+\s*\])?\s*;', uni, code, flags=re.M)
    code = re.sub(r'^\s*(?:varying|in)\s+vec2\s+vUv\s*;', 'vec2 vUv;', code, flags=re.M)
    if re.search(r'^\s*(varying|attribute)\b', code, flags=re.M):
        raise Skip('extra varying/attribute')
    if not re.search(r'\bvoid\s+main\s*\(', code):
        raise Skip('no main()')
    if 'vec2 vUv;' not in code:
        code = 'vec2 vUv;\n' + code

    live = strip_comments(code)
    uses_audio = bool(re.search(r'\biAudioData\b', live))
    channels = [None, None, None, None]
    for n in range(4):
        v = meta_channels.get(f'iChannel{n}')
        if v is None:
            continue
        if v in BUF_LETTER:
            channels[n] = BUF_LETTER[v]
        elif v == 'audio':
            channels[n] = 'audio'
        else:
            # only matters if the pass samples it
            if re.search(rf'\biChannel{n}\b', live):
                raise Skip(f'iChannel{n} needs asset {v}')
    for n in range(4):
        if channels[n] is None and re.search(rf'\biChannel{n}\b', live):
            raise Skip(f'iChannel{n} sampled without a binding (ShaderAmp fallback image)')

    if uses_audio:
        free = [n for n in range(4) if channels[n] is None and not re.search(rf'\biChannel{n}\b', live)]
        if not free:
            raise Skip('no free channel for audio')
        k = free[0]
        channels[k] = 'audio'
        for fn in ('texture2D', 'texture', 'textureLod', 'texture2DLod'):
            code = rewrite_calls(code, fn, 'sa_fft')
        code = rewrite_calls(code, 'texelFetch', 'sa_fftI')
        code = re.sub(r'\biAudioData\b', f'iChannel{k}', code)

    code = re.sub(r'\biAmplifiedTime\b', 'iTime', code)
    code = re.sub(r'\bgl_FragColor\b', 'sa_FragColor', code)
    code = re.sub(r'\bmainImage\b', 'sa_mainImage', code)
    code = re.sub(r'\bvoid\s+main\s*\(\s*(void)?\s*\)', 'void sa_main()', code)
    code = re.sub(r'\btextureCube\b', 'texture', code)
    code = re.sub(r'\btexture2DLod\b', 'textureLod', code)

    prelude = ['vec4 sa_FragColor;']
    # three.js (ShaderAmp's host) supplies saturate(); GLSL ES does not
    if re.search(r'\bsaturate\s*\(', live) and not re.search(r'\b(float|vec[234])\s+saturate\s*\(|#define\s+saturate\b', live):
        prelude.append('#define saturate(a) clamp(a, 0.0, 1.0)')
    if uses_audio:
        prelude.append('vec2 sa_fft(vec2 p) { return vec2(p.x, 0.25); } // ShaderAmp FFT is one row')
        prelude.append('ivec2 sa_fftI(ivec2 p) { return ivec2(p.x, 0); }')
    wrapper = ('\n\nvoid mainImage(out vec4 fragColor, in vec2 fragCoord) {\n'
               '\tvUv = fragCoord / iResolution.xy;\n'
               '\tsa_FragColor = vec4(0.0);\n'
               '\tsa_main();\n'
               '\tfragColor = sa_FragColor;\n'
               '}\n')
    return '\n'.join(prelude) + '\n' + code.rstrip() + wrapper, channels, uses_audio


def attribution(meta):
    lines = [f"// {meta.get('shaderName', '?')} — by {meta.get('author', '?')}"]
    if meta.get('url'):
        lines.append(f"// {meta['url']}")
    by = meta.get('modifiedBy')
    lines.append('// Ported to ShaderAmp (github.com/ArthurTent/ShaderAmp)' + (f' by {by}' if by else ''))
    lic = meta.get('license', 'unknown')
    lines.append(f"// License: {lic}" + (f" — {meta['licenseURL']}" if meta.get('licenseURL') else ''))
    lines.append('// Converted for HighAsCG, WO-586 (iAudioData -> audio channel, main -> mainImage wrapper)')
    return '\n'.join(lines) + '\n\n'


EXCLUDE = {
    'Informer.frag': 'renderer hang in validation (headless render never completes) — unverifiable',
    'AGiftForYou.frag': "ShaderAmp's own promo / credits screen, not content",
    'Fork_Complicating_things_even_further.frag': 'samples FFT at x=1..12, clamped to the silent top bin — dark by construction (also in ShaderAmp)',
}
converted, skipped = [], []
used_ids = set(EXISTING)
for mpath in sorted(glob.glob(os.path.join(SRC, '*.frag.meta'))):
    fname = os.path.basename(mpath)[:-5]
    try:
        meta = json.load(open(mpath))
    except Exception as e:
        skipped.append({'file': fname, 'reason': f'bad meta: {e}'})
        continue
    if meta.get('hidden'):
        continue
    if fname in EXCLUDE:
        skipped.append({'file': fname, 'reason': EXCLUDE[fname]})
        continue  # buffer passes / disabled entries, reached through their parent
    try:
        if meta.get('experimental'):
            raise Skip('ShaderAmp feature demo (experimental)')
        if meta.get('video'):
            raise Skip('needs video/webcam')
        custom = {}
        for cu in meta.get('customUniforms') or []:
            if cu.get('type') != 'float':
                raise Skip(f"custom uniform type {cu.get('type')}")
            custom[cu['name']] = cu.get('default', 0)
        img_src = open(os.path.join(SRC, fname), errors='replace').read()
        image, ch, audio_any = convert_pass(img_src, meta, custom)
        passes = {'image': {'source': attribution(meta) + image, 'channels': ch}}
        for b in meta.get('buffers') or []:
            out_n = b.get('output')
            if out_n not in PASS_KEY:
                raise Skip(f'buffer output {out_n}')
            bsrc = open(os.path.join(SRC, b['shaderName']), errors='replace').read()
            bcode, bch, baud = convert_pass(bsrc, b, custom)
            audio_any = audio_any or baud
            passes[PASS_KEY[out_n]] = {'source': bcode, 'channels': bch}
        if not audio_any:
            raise Skip('not audio reactive (never samples iAudioData)')
        name = meta.get('shaderName') or fname[:-5]
        base = 'sh-sa-' + slug(name)[:52]
        sid, n = base, 2
        while sid in used_ids:
            sid, n = f'{base}-{n}', n + 1
        used_ids.add(sid)
        cfg = {'id': sid, 'name': name, 'common': '', 'passes': passes,
               'audio': {'enabled': True}, 'opts': {'alpha': False}}
        json.dump(cfg, open(os.path.join(OUT, sid + '.json'), 'w'), indent='\t')
        converted.append({'id': sid, 'name': name, 'file': fname, 'author': meta.get('author'),
                          'url': meta.get('url'), 'license': meta.get('license'),
                          'buffers': len(meta.get('buffers') or [])})
    except (Skip, FileNotFoundError) as e:
        skipped.append({'file': fname, 'reason': str(e)})

json.dump({'converted': converted, 'skipped': skipped}, open(os.path.join(OUT, '_report.json'), 'w'), indent=1)
print(f'converted {len(converted)}  skipped {len(skipped)}')
from collections import Counter
for r, c in Counter(re.sub(r'\{.*|asset .*|iChannel\d', lambda m: m.group(0)[:6], s['reason']) for s in skipped).most_common():
    print(f'  {c:3d}  {r}')
