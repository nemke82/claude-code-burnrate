#!/usr/bin/env python3
"""Draws the social card (docs/og.png, 1200x630): the name, the pitch and one frame of the row.

    python3 demo/make-og.py assets/demo-band.gif docs/og.png
"""
import sys

from PIL import Image, ImageDraw, ImageFont

MONO_BOLD = '/usr/share/fonts/dejavu-sans-mono-fonts/DejaVuSansMono-Bold.ttf'
MONO = '/usr/share/fonts/dejavu-sans-mono-fonts/DejaVuSansMono.ttf'
BG, TEXT, DIM, CYAN, GREEN = (22, 24, 29), (214, 218, 224), (139, 146, 158), (92, 200, 214), (112, 200, 120)
# the frame with the pace and the "full in" warning
FRAME = 4


def main(gif, out):
    card = Image.new('RGB', (1200, 630), BG)
    draw = ImageDraw.Draw(card)
    title = ImageFont.truetype(MONO_BOLD, 92)
    draw.text((70, 70), '●', fill=GREEN, font=title)
    draw.text((70 + title.getlength('● '), 70), 'burnrate', fill=CYAN, font=title)
    lede = ImageFont.truetype(MONO, 31)
    draw.text((72, 205), 'Watch your Claude Code quota burn, live.', fill=TEXT, font=lede)
    draw.text((72, 252), 'Plan windows, their pace, and cache misses.', fill=DIM, font=lede)

    frames = Image.open(gif)
    frames.seek(FRAME)
    frame = frames.convert('RGB')
    # the row and its rules, without the caption above them
    row = frame.crop((0, 48, frame.width, 140))
    scale = 1060 / row.width
    row = row.resize((1060, int(row.height * scale)), Image.Resampling.LANCZOS)
    top = 380
    draw.rounded_rectangle((60, top - 24, 1140, top + row.height + 24), radius=14, outline=(44, 49, 58), width=2)
    card.paste(row, (70, top))
    draw.text((72, 560), 'github.com/nemke82/claude-code-burnrate', fill=DIM, font=ImageFont.truetype(MONO, 24))
    card.save(out, optimize=True)
    print(out, card.size)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
