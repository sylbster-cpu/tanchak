#!/usr/bin/env python3
"""Build the self-contained GitHub Pages index.html from editable assets in src/.

Usage: python scripts/build.py [--check]
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = (ROOT / 'src' / 'index.template.html').read_text(encoding='utf-8')
STYLES = (ROOT / 'src' / 'styles.css').read_text(encoding='utf-8')
GAME = (ROOT / 'src' / 'game.js').read_text(encoding='utf-8')
assert TEMPLATE.count('<!-- TANCHAK:CSS -->') == 1
assert TEMPLATE.count('<!-- TANCHAK:JS -->') == 1
built = TEMPLATE.replace('<!-- TANCHAK:CSS -->', '<style>' + STYLES + '</style>')
built = built.replace('<!-- TANCHAK:JS -->', '<script>' + GAME + '</script>')
output = ROOT / 'index.html'
if '--check' in sys.argv:
    if not output.exists() or output.read_text(encoding='utf-8') != built:
        raise SystemExit('index.html differs from src/; run python scripts/build.py')
    print('Build verified: index.html matches src/.')
else:
    output.write_text(built, encoding='utf-8')
    print('Built index.html (', len(built.encode('utf-8')), 'bytes )')
