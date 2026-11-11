"""만세 그림 준비: 만세 캐릭터 시트(3×3)에서 9명을 잘라 site/characters/<id>-cheer.png 로 저장합니다.

  python3 scripts/prepare-cheer.py <만세 시트.png>

앉은 그림(<id>.png)과 몸 크기가 같도록, 원래 시트에서 앉은 그림을 자를 때와 같은 비율로 줄이고
아래쪽(몸통 끝)과 가운데를 맞춥니다. 만세 그림은 팔이 머리 위로 올라가 있어 앉은 그림보다 넓고 높으므로
좌우로 PAD_X, 위로 PAD_TOP만큼 넓힌 캔버스에 그립니다 (site/src/characters.js의 CHEER_PAD와 같은 값).
"""
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent / 'site' / 'characters'
SIZE = 256
PAD_X = 40
PAD_TOP = 64

# 시트의 칸 번호(왼쪽 위부터 1~9) → 캐릭터, 그리고 앉은 그림을 만들 때 원래 시트에서 잘라낸 크기(가로, 세로)
PICKS = {
    1: ('boy', (310, 419)),
    2: ('girl', (313, 400)),
    3: ('cat', (288, 419)),
    4: ('shiba', (303, 388)),
    5: ('rabbit', (269, 415)),
    6: ('bear', (326, 383)),
    7: ('robot', (310, 406)),
    8: ('dinosaur', (285, 406)),
    9: ('astronaut', (325, 400)),
}


def cells(sheet):
    """투명하지 않은 영역을 행과 열로 나눠 3×3 칸의 상자를 찾습니다."""
    alpha = sheet.getchannel('A').point(lambda a: 255 if a > 20 else 0)
    w, h = sheet.size

    def runs(counts):
        out, start = [], None
        for i, c in enumerate(counts):
            if c > 3 and start is None:
                start = i
            if c <= 3 and start is not None:
                out.append((start, i))
                start = None
        if start is not None:
            out.append((start, len(counts)))
        return out

    px = alpha.load()
    rows = runs([sum(1 for x in range(w) if px[x, y]) for y in range(h)])
    if len(rows) != 3:
        raise SystemExit(f'행을 3개 찾지 못했습니다: {rows}')
    boxes = []
    for y0, y1 in rows:
        cols = runs([sum(1 for y in range(y0, y1) if px[x, y]) for x in range(w)])
        if len(cols) != 3:
            raise SystemExit(f'열을 3개 찾지 못했습니다: {cols}')
        boxes += [(x0, y0, x1, y1) for x0, x1 in cols]
    return boxes


def main(path):
    sheet = Image.open(path).convert('RGBA')
    boxes = cells(sheet)
    W, H = SIZE + 2 * PAD_X, SIZE + PAD_TOP
    for n, (cid, (ow, oh)) in PICKS.items():
        x0, y0, x1, y1 = boxes[n - 1]
        crop = sheet.crop((x0 - 4, y0 - 4, x1 + 4, y1 + 4))
        crop = crop.crop(crop.getbbox())
        f = SIZE / max(ow, oh)  # 앉은 그림과 같은 비율
        art = crop.resize((round(crop.width * f), round(crop.height * f)), Image.LANCZOS)
        if art.width > W or art.height > H:
            raise SystemExit(f'{cid}: 캔버스보다 큽니다 {art.size} > {(W, H)} — PAD_X/PAD_TOP을 늘리세요')
        canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        canvas.alpha_composite(art, ((W - art.width) // 2, H - art.height))  # 가운데·아래 맞춤
        out = canvas.quantize(colors=160, method=Image.FASTOCTREE, dither=Image.NONE)
        out.save(ROOT / f'{cid}-cheer.png', optimize=True)
        print(cid, art.size, (ROOT / f'{cid}-cheer.png').stat().st_size, 'bytes')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('사용법: python3 scripts/prepare-cheer.py <만세 시트.png>')
    main(sys.argv[1])
