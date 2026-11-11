// 결과 공유: 결과 카드 이미지를 그려서 공유합니다.
//  1) 이미지 공유가 되는 기기(대부분의 휴대폰) → 이미지 + 글
//  2) 글 공유만 되는 기기 → 글
//  3) 둘 다 안 되면 → 이미지를 저장하고 글을 복사

const W = 1080;
const H = 1080;
const UP = '#ff4d57';
const DOWN = '#3d8bff';
const ACCENT = '#ffd23f';
const DISPLAY = '"Black Han Sans", system-ui, sans-serif';
const BODY = 'system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/**
 * 결과 카드를 그립니다.
 * @param {HTMLCanvasElement} canvas
 * @param {object} r { label, span, title, score, change, changeUp, stars, speed, g, note,
 *                     chart: [{x: 0~1, y: 0~1}], base: 출발 높이 0~1 }
 */
export function drawShareCard(canvas, r) {
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d');
  const bg = c.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1a2a52');
  bg.addColorStop(1, '#0b1122');
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);

  // 제목
  c.textBaseline = 'alphabetic';
  c.textAlign = 'left';
  c.font = `76px ${DISPLAY}`;
  c.fillStyle = '#f4f6fb';
  c.fillText('KOSPI', 72, 142);
  const titleW = c.measureText('KOSPI ').width;
  c.fillStyle = ACCENT;
  c.fillText('코스터', 72 + titleW, 142);
  c.font = `700 34px ${BODY}`;
  c.fillStyle = '#f4f6fb';
  c.fillText(r.label, 72, 208);
  c.font = `500 28px ${BODY}`;
  c.fillStyle = '#a3adc2';
  c.fillText(r.span, 72, 252);

  // 레일 그래프
  const box = { x: 72, y: 296, w: W - 144, h: 300 };
  roundRect(c, box.x, box.y, box.w, box.h, 28);
  c.fillStyle = 'rgba(0,0,0,0.3)';
  c.fill();
  const px = (x) => box.x + 28 + x * (box.w - 56);
  const py = (y) => box.y + box.h - 30 - y * (box.h - 60);
  const baseY = py(r.base);
  c.setLineDash([8, 10]);
  c.strokeStyle = 'rgba(255,255,255,0.3)';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(box.x + 14, baseY);
  c.lineTo(box.x + box.w - 14, baseY);
  c.stroke();
  c.setLineDash([]);
  c.lineWidth = 6;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  for (let i = 1; i < r.chart.length; i++) {
    const a = r.chart[i - 1];
    const b = r.chart[i];
    c.strokeStyle = b.y >= a.y ? UP : DOWN;
    c.beginPath();
    c.moveTo(px(a.x), py(a.y));
    c.lineTo(px(b.x), py(b.y));
    c.stroke();
  }

  // 점수
  c.textAlign = 'center';
  c.font = `60px ${DISPLAY}`;
  c.fillStyle = '#f4f6fb';
  c.fillText(r.title, W / 2, 698);
  c.font = `150px ${DISPLAY}`;
  c.fillStyle = ACCENT;
  c.fillText(`${r.score}점`, W / 2, 846);

  // 기록 네 칸
  const cells = [
    ['구간 등락', r.change, r.changeUp ? UP : DOWN],
    ['스릴', r.stars, ACCENT],
    ['최고 속도', r.speed, '#f4f6fb'],
    ['최대 G', r.g, '#f4f6fb'],
  ];
  const cw = (W - 144 - 3 * 16) / 4;
  cells.forEach(([name, value, color], i) => {
    const x = 72 + i * (cw + 16);
    roundRect(c, x, 888, cw, 112, 20);
    c.fillStyle = 'rgba(255,255,255,0.07)';
    c.fill();
    c.font = `500 24px ${BODY}`;
    c.fillStyle = '#a3adc2';
    c.fillText(name, x + cw / 2, 930);
    c.font = `800 ${name === '스릴' ? 30 : 34}px ${BODY}`;
    c.fillStyle = color;
    c.fillText(value, x + cw / 2, 976);
  });

  c.font = `500 22px ${BODY}`;
  c.fillStyle = 'rgba(163,173,194,0.85)';
  c.fillText(r.note, W / 2, 1046);
  return canvas;
}

const toBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

/**
 * @param {{card: object, text: string, url: string, allowSave: boolean}} what
 *        allowSave: 공유 창이 없을 때 이미지를 파일로 저장해도 되는지 (다른 앱 안에서는 끕니다)
 * @returns {Promise<'shared'|'copied'|'saved'|'cancelled'|'failed'>}
 */
export async function shareResult({ card, text, url, allowSave }) {
  let blob = null;
  try {
    await document.fonts?.ready;
    blob = await toBlob(drawShareCard(document.createElement('canvas'), card));
  } catch {
    /* 이미지를 못 만들면 글만 공유 */
  }
  const body = url ? `${text}\n${url}` : text;
  try {
    const file = blob && new File([blob], 'kospi-coaster.png', { type: 'image/png' });
    if (file && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text: body });
      return 'shared';
    }
    if (navigator.share) {
      await navigator.share(url ? { text, url } : { text });
      return 'shared';
    }
  } catch (err) {
    if (err?.name === 'AbortError') return 'cancelled';
    /* 공유 창을 못 열면 아래 방법으로 */
  }
  let result = 'failed';
  try {
    await navigator.clipboard.writeText(body);
    result = 'copied';
  } catch {
    /* 복사 권한이 없는 환경 */
  }
  if (blob && allowSave) {
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'kospi-coaster.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      if (result === 'failed') result = 'saved';
    } catch {
      /* 저장을 막아 둔 환경 */
    }
  }
  return result;
}
