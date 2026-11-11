// 레일의 진행 방향과 실제 지수 변동폭에 따른 날씨. 주행 물리와 점수에는 영향을 주지 않습니다.
const clamp = (n) => Math.max(0, Math.min(1, n));
export function weatherTarget({ ang, changePct, rangePct, zone }) {
  if (zone !== 'main') return { storm: 0, sun: 0 };
  const slope = Math.sin(ang);
  if (Math.abs(slope) < 0.015) return { storm: 0, sun: 0 };
  // 화면에 맞춰 늘린 레일 높이 대신 실제 변동률도 반영합니다.
  const magnitude = clamp(Math.abs(changePct) / 4 + rangePct / 100);
  const strength = clamp(0.28 + 0.42 * magnitude + 0.3 * clamp(Math.abs(slope) / 0.5));
  return { storm: slope < 0 ? strength : 0, sun: slope > 0 ? strength : 0 };
}
export function easeWeather(state, target, dt) {
  const blend = 1 - Math.exp(-Math.max(0, dt) * 2);
  state.storm += (target.storm - state.storm) * blend;
  state.sun += (target.sun - state.sun) * blend;
}
const seed = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export function drawWeatherSky(ctx, w, h, state, night, reduced) {
  const { storm, sun, time } = state;
  const daylight = 1 - night;
  ctx.save();
  if (sun > 0.02 && daylight > 0.02) {
    const x = w * 0.78, y = Math.max(100, h * 0.25), r = Math.min(w, h) * 0.075;
    const glow = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 5);
    glow.addColorStop(0, `rgba(255,247,171,${sun * daylight * 0.8})`);
    glow.addColorStop(1, 'rgba(255,235,140,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    ctx.translate(x, y);
    ctx.rotate(reduced ? 0 : time * 0.025);
    ctx.fillStyle = `rgba(255,244,185,${sun * daylight * 0.13})`;
    for (let i = 0; i < 10; i++) {
      ctx.rotate(Math.PI / 5); ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.lineTo(r * 9, -r * 0.7); ctx.lineTo(r * 9, r * 0.7); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = `rgba(255,251,212,${sun * daylight})`;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  ctx.save();
  // 넓게 겹치는 먹구름. 반짝임 없이 천천히 이동합니다.
  if (storm > 0.02) {
    for (let i = 0; i < 9; i++) {
      const width = w * (0.22 + seed(i) * 0.16);
      const x = ((seed(i + 20) * (w + width * 2) - (reduced ? 0 : time * (6 + i))) % (w + width * 2) + w + width * 2) % (w + width * 2) - width;
      const y = h * (0.13 + seed(i + 40) * 0.19);
      const cloud = ctx.createRadialGradient(x, y, 0, x, y, width);
      cloud.addColorStop(0, `rgba(24,34,53,${storm * 0.6})`);
      cloud.addColorStop(1, 'rgba(24,34,53,0)');
      ctx.fillStyle = cloud;
      ctx.beginPath(); ctx.ellipse(x, y, width, width * 0.35, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

export function drawWeatherFront(ctx, w, h, state, reduced) {
  const { storm, sun, time } = state;
  ctx.save();
  if (storm > 0.03) {
    const fog = ctx.createLinearGradient(0, h * 0.45, 0, h);
    fog.addColorStop(0, 'rgba(120,145,165,0)');
    fog.addColorStop(1, `rgba(120,145,165,${storm * 0.18})`);
    ctx.fillStyle = fog; ctx.fillRect(0, 0, w, h);
    const count = Math.round((reduced ? 18 : Math.min(160, w * h / 4500)) * storm);
    ctx.strokeStyle = `rgba(196,218,243,${0.2 + storm * 0.35})`;
    ctx.lineWidth = 1.2; ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const y = (seed(i + 100) * (h + 50) + (reduced ? 0 : time * (420 + seed(i) * 400))) % (h + 50) - 25;
      const x = (seed(i + 200) * (w + 100) - y * 0.2 + w + 100) % (w + 100) - 20;
      const length = 12 + storm * 16 + seed(i) * 10;
      ctx.moveTo(x, y); ctx.lineTo(x - length * 0.3, y + length);
    }
    ctx.stroke();
    const vignette = ctx.createRadialGradient(w / 2, h / 2, w * 0.1, w / 2, h / 2, Math.max(w, h) * 0.75);
    vignette.addColorStop(0, 'rgba(9,18,32,0)');
    vignette.addColorStop(1, `rgba(9,18,32,${storm * 0.42})`);
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, w, h);
  }
  if (sun > 0.03) {
    const colors = ['#ffe679', '#fff8cd', '#ffb85a', '#b7fff0'];
    const count = Math.round((reduced ? 8 : 44) * sun);
    for (let i = 0; i < count; i++) {
      const x = seed(i + 300) * w;
      const y = (seed(i + 400) * h - (reduced ? 0 : time * (25 + seed(i) * 45)) % h + h) % h;
      const r = 1.5 + seed(i) * 2.5;
      ctx.globalAlpha = sun * (0.3 + seed(i + 500) * 0.5);
      ctx.fillStyle = colors[i % colors.length];
      ctx.beginPath();ctx.moveTo(x, y - r * 2);ctx.lineTo(x + r, y);ctx.lineTo(x, y + r * 2);ctx.lineTo(x - r, y);ctx.closePath();ctx.fill();
    }
  }
  ctx.restore();
}
