#!/usr/bin/env python3
"""Concatenate src/game/part*.js into js/game.js (keeps runtime file:// friendly)."""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
parts = sorted((root/"src/game").glob("part*.js"))
if not parts:
    raise SystemExit("No parts found in src/game/")
# strip the AUTO-SPLIT header line from each part when building
out_lines=[]
for p in parts:
    lines=p.read_text("utf-8").splitlines(True)
    if lines and lines[0].startswith("// AUTO-SPLIT PART"):
        lines=lines[1:]
    out_lines.extend(lines)
out=(root/"js/game.js")
out.write_text("".join(out_lines), "utf-8")
print(f"Built {out} from {len(parts)} parts")
