#!/usr/bin/env python3
"""Build the self-hosted JetBrainsMono Nerd Font Mono web fonts.

Downloads the official Nerd Fonts release archive (or uses --zip), extracts the
Regular and Medium cuts of "JetBrainsMono Nerd Font Mono", subsets them to the
Unicode ranges the site needs, and writes WOFF2 files plus the OFL licence to
public/fonts/.

    pip install fonttools brotli
    python3 -I scripts/build-fonts.py                # downloads the archive
    python3 -I scripts/build-fonts.py --zip path.zip # uses a local archive

The glyphs are not substituted or redrawn: they are the Nerd Fonts patched
outlines, only filtered down. Pass --full to keep every glyph (much larger).
"""

import argparse
import io
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

VERSION = "v3.4.0"
URL = f"https://github.com/ryanoasis/nerd-fonts/releases/download/{VERSION}/JetBrainsMono.zip"
CUTS = ["Regular", "Medium"]
FAMILY = "JetBrainsMono Nerd Font Mono"

# Latin + the symbols the interface and typical repo/track metadata use.
UNICODES = (
    "U+0020-007E,U+00A0-024F,U+0259,U+02C6,U+02DA,U+02DC,"
    "U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2200-22FF,"
    "U+2300-23FF,U+2500-25FF,U+2600-26FF,U+2B00-2BFF,"
    "U+E0A0-E0D7"  # Powerline symbols
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--zip", type=Path, help="Local JetBrainsMono.zip from Nerd Fonts")
    parser.add_argument("--out", type=Path, default=Path("public/fonts"))
    parser.add_argument("--full", action="store_true", help="Do not subset")
    args = parser.parse_args()

    if args.zip:
        data = args.zip.read_bytes()
    else:
        print(f"downloading {URL}")
        with urllib.request.urlopen(URL, timeout=300) as response:
            data = response.read()

    args.out.mkdir(parents=True, exist_ok=True)
    archive = zipfile.ZipFile(io.BytesIO(data))

    with tempfile.TemporaryDirectory() as tmp:
        for cut in CUTS:
            member = f"JetBrainsMonoNerdFontMono-{cut}.ttf"
            ttf = Path(tmp) / member
            ttf.write_bytes(archive.read(member))

            font = TTFont(ttf)
            # Nerd Fonts 3.x stores the short "NFM" name in nameID 1 and the
            # full "Nerd Font Mono" family in the typographic family (nameID 16).
            families = {n.toUnicode() for n in font["name"].names if n.nameID == 16}
            if FAMILY not in families:
                print(f"unexpected families in {member}: {sorted(families)!r}", file=sys.stderr)
                return 1
            font.close()

            options = subset.Options()
            options.flavor = "woff2"
            options.layout_features = ["*"]
            options.name_IDs = ["*"]
            options.notdef_outline = True
            options.glyph_names = False
            options.hinting = False
            options.desubroutinize = True
            source = TTFont(ttf)
            if args.full:
                unicodes = sorted(source.getBestCmap().keys())
            else:
                unicodes = subset.parse_unicodes(UNICODES)
            subsetter = subset.Subsetter(options)
            subsetter.populate(unicodes=unicodes)
            subsetter.subset(source)
            target = args.out / f"JetBrainsMonoNerdFontMono-{cut}.woff2"
            source.flavor = "woff2"
            source.save(target)
            print(f"wrote {target} ({target.stat().st_size // 1024} KiB)")

        (args.out / "OFL.txt").write_bytes(archive.read("OFL.txt"))
        print(f"wrote {args.out / 'OFL.txt'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
