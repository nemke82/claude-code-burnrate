#!/usr/bin/env python3
"""Renders an asciicast written by make-demo.ts to a GIF.

    python3 demo/render-gif.py band.cast assets/demo-band.gif

Each event of the cast is one whole screen (it starts with a clear), so a
frame is that event's text, drawn cell by cell with its colours.
"""
import json
import re
import sys

from PIL import Image, ImageDraw, ImageFont

FONT = '/usr/share/fonts/dejavu-sans-mono-fonts/DejaVuSansMono.ttf'
BOLD = '/usr/share/fonts/dejavu-sans-mono-fonts/DejaVuSansMono-Bold.ttf'
SIZE = 15
PAD = 14
BG = (22, 24, 29)
FG = (214, 218, 224)
COLORS = {31: (240, 98, 98), 32: (112, 200, 120), 33: (229, 192, 100), 36: (92, 200, 214)}
SGR = re.compile(r'\x1b\[([0-9;?]*)([a-zA-Z])')


def cells(text):
    """The screen as rows of (char, colour, bold)."""
    rows, row = [], []
    color, bold, dim = FG, False, False
    pos = 0
    for m in SGR.finditer(text):
        for ch in text[pos:m.start()]:
            if ch == '\n':
                rows.append(row)
                row = []
            elif ch != '\r':
                shade = tuple((c + b) // 2 for c, b in zip(color, BG)) if dim else color
                row.append((ch, shade, bold))
        pos = m.end()
        if m.group(2) != 'm':
            continue
        for code in [int(c) for c in m.group(1).split(';') if c.isdigit()] or [0]:
            if code == 0:
                color, bold, dim = FG, False, False
            elif code == 1:
                bold = True
            elif code == 2:
                dim = True
            elif code in COLORS:
                color = COLORS[code]
    for ch in text[pos:]:
        if ch not in '\r\n':
            row.append((ch, color, bold))
    rows.append(row)
    return rows


def main(cast, out):
    lines = open(cast).read().splitlines()
    header = json.loads(lines[0])
    events = [json.loads(line) for line in lines[1:]]
    regular, bold = ImageFont.truetype(FONT, SIZE), ImageFont.truetype(BOLD, SIZE)
    cw = regular.getlength('M')
    ch = int(SIZE * 1.45)
    size = (int(header['width'] * cw) + 2 * PAD, header['height'] * ch + 2 * PAD)

    frames, durations = [], []
    for i, (at, _, data) in enumerate(events):
        if not data:
            continue
        img = Image.new('RGB', size, BG)
        draw = ImageDraw.Draw(img)
        for y, row in enumerate(cells(data)):
            for x, (char, color, is_bold) in enumerate(row):
                left, top = PAD + x * cw, PAD + y * ch
                # rules and bars are drawn as shapes: glyphs leave seams between cells
                if char == '─':
                    draw.line((left, top + ch // 2, left + cw, top + ch // 2), fill=color)
                elif char == '│':
                    draw.line((left + cw // 2, top, left + cw // 2, top + ch), fill=color)
                elif char == '█':
                    draw.rectangle((left, top + 3, left + cw, top + ch - 4), fill=color)
                elif char != ' ':
                    draw.text((left, top), char, fill=color, font=bold if is_bold else regular)
        frames.append(img)
        durations.append(int((events[i + 1][0] - at) * 1000) if i + 1 < len(events) else 2000)

    # one palette for every frame, taken from all of them: a colour only one frame has must be in it
    sheet = Image.new('RGB', (size[0], size[1] * len(frames)))
    for i, frame in enumerate(frames):
        sheet.paste(frame, (0, i * size[1]))
    palette = sheet.quantize(colors=96, method=Image.Quantize.MEDIANCUT)
    frames = [f.quantize(palette=palette, dither=Image.Dither.NONE) for f in frames]
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True)
    print(f'{out}: {len(frames)} frames, {size[0]}x{size[1]}, {sum(durations) / 1000:.1f}s')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
