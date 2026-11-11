"""만세 그림 만들기: site/characters/<id>.png → site/characters/<id>-cheer.png

원래 그림 뒤에 위로 쭉 뻗은 두 팔(소매 + 손/앞발)을 그려 넣습니다.
원래 그림의 가슴 앞 주먹은 지우고(그 줄 아래를 투명하게), 몸통은 그대로 둡니다.
게임에서는 아래쪽이 열차 칸에 가려지므로 잘린 부분이 보이지 않습니다.

캔버스는 원래보다 넓고 높습니다(PAD_X, PAD_TOP). 게임은 같은 비율로 그려서 몸 크기를 맞춥니다.
실행: python3 scripts/make-cheer.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent / 'site' / 'characters'
SIZE = 256          # 원래 그림 크기
PAD_X = 40          # 좌우로 넓힌 폭
PAD_TOP = 56        # 위로 늘린 높이
CUT = 0.80          # 이 높이 아래(주먹이 있는 줄)는 지웁니다
SS = 4              # 매끈하게 그리려고 4배로 그린 뒤 줄입니다
OUTLINE = (58, 40, 32, 255)

# 캐릭터별 소매색, 손색, 손 모양 (glove: 장갑처럼 둥근 손 / paw: 동물 앞발)
STYLE = {
    'boy':       dict(sleeve=(246, 190, 22), cuff=(226, 160, 10), hand=(255, 218, 192), kind='hand'),
    'girl':      dict(sleeve=(28, 168, 150), cuff=(240, 248, 246), hand=(255, 218, 192), kind='hand'),
    'shiba':     dict(sleeve=(232, 178, 110), cuff=None, hand=(250, 236, 214), kind='paw'),
    'bear':      dict(sleeve=(140, 92, 60), cuff=None, hand=(140, 92, 60), kind='paw'),
    'robot':     dict(sleeve=(196, 206, 218), cuff=(120, 132, 150), hand=(236, 241, 246), kind='glove'),
    'astronaut': dict(sleeve=(240, 244, 250), cuff=(40, 92, 200), hand=(250, 252, 255), kind='glove'),
}


def arm(draw, pts, width, color, outline_w):
    """팔: 테두리 → 속 색 순서로 굵은 선과 관절의 원을 그립니다."""
    for w, c in ((width + 2 * outline_w, OUTLINE), (width, color)):
        draw.line(pts, fill=c, width=int(w), joint="curve")
        for x, y in pts:
            r = w / 2
            draw.ellipse((x - r, y - r, x + r, y + r), fill=c)


def make(cid):
    s = STYLE[cid]
    src = Image.open(ROOT / f'{cid}.png').convert('RGBA')
    W, H = SIZE + 2 * PAD_X, SIZE + PAD_TOP
    k = SS
    layer = Image.new('RGBA', (W * k, H * k), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    o = int(3.2 * k)  # 테두리 두께

    for side in (-1, 1):
        cx = W / 2
        # 어깨(몸 뒤) → 팔꿈치(머리 옆) → 손(머리 위 바깥쪽)
        shoulder = (cx + side * 72, PAD_TOP + 196)
        elbow = (cx + side * 118, PAD_TOP + 108)
        wrist = (cx + side * 112, PAD_TOP + 28)
        pts = [(x * k, y * k) for x, y in (shoulder, elbow, wrist)]
        arm(d, pts, 30 * k, s['sleeve'], o)
        if s['cuff']:
            # 소매 끝 띠
            wx, wy = wrist
            arm(d, [((wx - side * 1) * k, (wy + 8) * k), (wx * k, (wy + 1) * k)], 31 * k, s['cuff'], o)
        # 손
        hx, hy = wrist[0] + side * 2, wrist[1] - 18
        r = 19 if s['kind'] != 'paw' else 20
        d.ellipse(((hx - r) * k - o, (hy - r) * k - o, (hx + r) * k + o, (hy + r) * k + o), fill=OUTLINE)
        d.ellipse(((hx - r) * k, (hy - r) * k, (hx + r) * k, (hy + r) * k), fill=s['hand'])
        if s['kind'] == 'hand':
            # 쫙 편 손가락 느낌의 짧은 선 셋 + 엄지
            for i, dx in enumerate((-9, 0, 9)):
                d.line(((hx + dx) * k, (hy - r + 2) * k, (hx + dx) * k, (hy - 4) * k), fill=OUTLINE, width=int(2.4 * k))
            d.ellipse(((hx - side * 22 - 7) * k, (hy + 2 - 7) * k, (hx - side * 22 + 7) * k, (hy + 2 + 7) * k), fill=s['hand'], outline=OUTLINE, width=int(2.6 * k))
        elif s['kind'] == 'paw':
            # 앞발 발가락 선 둘 + 분홍 발바닥
            for dx in (-7, 7):
                d.line(((hx + dx) * k, (hy - r + 3) * k, (hx + dx) * k, (hy - r + 13) * k), fill=OUTLINE, width=int(2.4 * k))
            pad = (255, 182, 182, 255) if cid == 'shiba' else (214, 160, 120, 255)
            d.ellipse(((hx - 8) * k, (hy + 1) * k, (hx + 8) * k, (hy + 12) * k), fill=pad)
        else:
            # 장갑: 손가락 마디 선 + 하이라이트
            d.arc(((hx - 12) * k, (hy - 14) * k, (hx + 12) * k, (hy + 10) * k), 200, 340, fill=OUTLINE, width=int(2.4 * k))
            d.ellipse(((hx - side * 8 - 5) * k, (hy - 12) * k, (hx - side * 8 + 5) * k, (hy - 4) * k), fill=(255, 255, 255, 200))

    layer = layer.resize((W, H), Image.LANCZOS)
    body = src.copy()
    # 가슴 앞 주먹이 있는 아래쪽은 지웁니다 (게임에서는 열차 칸에 가려지는 부분)
    cut = int(SIZE * CUT)
    body.paste((0, 0, 0, 0), (0, cut, SIZE, SIZE))
    layer.alpha_composite(body, (PAD_X, PAD_TOP))
    out = layer.quantize(colors=160, method=Image.FASTOCTREE, dither=Image.NONE)
    out.save(ROOT / f'{cid}-cheer.png', optimize=True)
    return layer


if __name__ == '__main__':
    import sys
    sheet = Image.new('RGBA', ((SIZE + 2 * PAD_X) * 6, SIZE + PAD_TOP), (40, 60, 110, 255))
    for i, cid in enumerate(STYLE):
        sheet.alpha_composite(make(cid), (i * (SIZE + 2 * PAD_X), 0))
    if len(sys.argv) > 1:
        sheet.save(sys.argv[1])
    print('ok')
