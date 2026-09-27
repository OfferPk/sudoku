"""Generates Quillnine's original launcher icons, adaptive foreground, splash images and store icons.
Art: a calm paper tile with a faint 3x3 sudoku grid and a large italic serif "9" in ink blue. Pure Pillow.
Run: python3 assets/make_icon.py
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

S = 1024
BG_TOP, BG_BOT = (251, 249, 244), (236, 230, 218)
SPLASH = (247, 244, 238)   # #F7F4EE
INK = (61, 111, 182)       # #3D6FB6
LINE = (196, 187, 170)
FONT = '/usr/share/fonts/truetype/sand-box/google/Noto Serif/NotoSerif-Italic-VariableFont_wdth,wght.ttf'


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def background(size):
    im = Image.new('RGB', (size, size))
    d = ImageDraw.Draw(im)
    for y in range(size):
        d.line([(0, y), (size, y)], fill=lerp(BG_TOP, BG_BOT, y / (size - 1)))
    return im


def draw_art(canvas, scale):
    """Grid + numeral centred on an RGBA canvas; scale = grid width / canvas width."""
    W = canvas.size[0]
    g = W * scale
    x0, y0 = (W - g) / 2, (W - g) / 2
    d = ImageDraw.Draw(canvas)
    thin, thick = max(1, int(g * 0.006)), max(2, int(g * 0.016))
    for i in range(10):
        if i in (0, 9):
            continue
        w = thick if i % 3 == 0 else thin
        c = LINE if i % 3 == 0 else lerp(LINE, BG_TOP, 0.45)
        p = x0 + g * i / 9
        d.line([(p, y0), (p, y0 + g)], fill=c, width=w)
        p = y0 + g * i / 9
        d.line([(x0, p), (x0 + g, p)], fill=c, width=w)
    font = ImageFont.truetype(FONT, int(g * 0.95))
    try:
        font.set_variation_by_name('Medium Italic')
    except Exception:
        pass
    # soft shadow + numeral
    txt = Image.new('L', canvas.size, 0)
    ImageDraw.Draw(txt).text((W / 2, W / 2 + g * 0.02), '9', font=font, fill=255, anchor='mm')
    sh = txt.filter(ImageFilter.GaussianBlur(g * 0.02))
    canvas.paste(Image.new('RGBA', canvas.size, (40, 40, 60, 70)), (int(g * 0.012), int(g * 0.02)), sh)
    canvas.paste(Image.new('RGBA', canvas.size, INK + (255,)), (0, 0), txt)


def rounded_mask(size, r):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], r, fill=255)
    return m


def main():
    root = os.path.dirname(os.path.abspath(__file__))
    repo = os.path.dirname(root)
    res = os.path.join(repo, 'android/app/src/main/res')
    big = 2048
    full = background(big).convert('RGBA')
    draw_art(full, 0.78)
    full = full.convert('RGB').resize((S, S), Image.LANCZOS)
    full.save(os.path.join(root, 'icon-full.png'))
    for out in [os.path.join(root, 'play-store-icon-512.png'), os.path.join(repo, 'www/icon.png'), os.path.join(repo, 'store/icon-512.png')]:
        os.makedirs(os.path.dirname(out), exist_ok=True)
        full.resize((512, 512), Image.LANCZOS).save(out)
    fg = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    draw_art(fg, 0.56)
    fg = fg.resize((432, 432), Image.LANCZOS)
    sizes = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
    fsizes = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}
    for dens, px in sizes.items():
        d = os.path.join(res, 'mipmap-' + dens)
        sq = full.resize((px, px), Image.LANCZOS)
        out = Image.new('RGBA', (px, px), (0, 0, 0, 0))
        out.paste(sq, (0, 0), rounded_mask(px, int(px * 0.18)))
        out.save(os.path.join(d, 'ic_launcher.png'))
        rnd = Image.new('RGBA', (px, px), (0, 0, 0, 0))
        cm = Image.new('L', (px, px), 0)
        ImageDraw.Draw(cm).ellipse([0, 0, px - 1, px - 1], fill=255)
        rnd.paste(sq, (0, 0), cm)
        rnd.save(os.path.join(d, 'ic_launcher_round.png'))
        fg.resize((fsizes[dens], fsizes[dens]), Image.LANCZOS).save(os.path.join(d, 'ic_launcher_foreground.png'))
    splash_sizes = {
        'drawable': (480, 320),
        'drawable-land-mdpi': (480, 320), 'drawable-land-hdpi': (800, 480), 'drawable-land-xhdpi': (1280, 720),
        'drawable-land-xxhdpi': (1600, 960), 'drawable-land-xxxhdpi': (1920, 1280),
        'drawable-port-mdpi': (320, 480), 'drawable-port-hdpi': (480, 800), 'drawable-port-xhdpi': (720, 1280),
        'drawable-port-xxhdpi': (960, 1600), 'drawable-port-xxxhdpi': (1280, 1920),
    }
    logo = Image.new('RGBA', (big, big), SPLASH + (255,))
    draw_art(logo, 0.62)
    logo = logo.convert('RGB')
    for folder, (w, h) in splash_sizes.items():
        im = Image.new('RGB', (w, h), SPLASH)
        side = int(min(w, h) * 0.5)
        im.paste(logo.resize((side, side), Image.LANCZOS), ((w - side) // 2, (h - side) // 2))
        im.save(os.path.join(res, folder, 'splash.png'))
    print('icons + splash written')


if __name__ == '__main__':
    main()
