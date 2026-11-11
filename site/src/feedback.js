// 소리·진동. 소리는 Web Audio로 직접 만들어서 음원 파일이 없습니다.
//
//  - 바람 소리·레일 울림: 속도에 따라 커집니다.
//  - 덜컹 소리: 일정 거리를 달릴 때마다 한 번 (오르막에서는 느리게, 내리막에서는 빠르게).
//  - 출발·만세·기절·도착 효과음, 기절·도착·큰 G 진동.
//  - 켜기/끄기는 사용자가 정하고, 화면을 벗어나면 바로 멈췄다가 돌아오면 다시 납니다.

const CLACK_EVERY = 170; // 이 거리(px)를 달릴 때마다 덜컹
const CLACK_MIN_GAP = 0.045; // 덜컹 사이 최소 간격(초) — 4배속에서도 소리가 뭉치지 않게

const clamp01 = (x) => Math.max(0, Math.min(1, x));

export function createFeedback({ enabled = true } = {}) {
  const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  let on = enabled;
  let ctx = null;
  let master = null;
  let noise = null;
  let wind = null;
  let rumble = null;
  let lastS = null;
  let sinceClack = 0;
  let lastClackAt = 0;
  let lastBuzzAt = 0;
  let background = false;

  function ensure() {
    if (ctx || !AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = on ? 1 : 0;
    master.connect(ctx.destination);

    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const ch = noise.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;

    const loop = ctx.createBufferSource();
    loop.buffer = noise;
    loop.loop = true;
    wind = { filter: ctx.createBiquadFilter(), gain: ctx.createGain() };
    wind.filter.type = 'bandpass';
    wind.filter.Q.value = 0.7;
    wind.gain.gain.value = 0;
    rumble = { filter: ctx.createBiquadFilter(), gain: ctx.createGain() };
    rumble.filter.type = 'lowpass';
    rumble.filter.frequency.value = 140;
    rumble.gain.gain.value = 0;
    loop.connect(wind.filter).connect(wind.gain).connect(master);
    loop.connect(rumble.filter).connect(rumble.gain).connect(master);
    loop.start();
  }

  function sync() {
    if (!ctx) return;
    if (on && !background) ctx.resume?.().catch(() => {});
    else ctx.suspend?.().catch(() => {});
  }

  const audible = () => ctx && on && !background && ctx.state === 'running';

  function tone(freq, dur, { type = 'sine', gain = 0.16, delay = 0, to = null } = {}) {
    if (!audible()) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function clack(strength) {
    if (!audible()) return;
    const t = ctx.currentTime;
    if (t - lastClackAt < CLACK_MIN_GAP) return;
    lastClackAt = t;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900 + 700 * strength;
    f.Q.value = 2.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.1 + 0.12 * strength, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.05);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 1.5, 0.06);
  }

  function vibrate(pattern) {
    if (!on || background) return;
    try {
      globalThis.navigator?.vibrate?.(pattern);
    } catch {
      /* 진동을 못 쓰는 기기 */
    }
  }

  function quiet() {
    lastS = null;
    if (!ctx) return;
    const t = ctx.currentTime;
    wind.gain.gain.setTargetAtTime(0, t, 0.06);
    rumble.gain.gain.setTargetAtTime(0, t, 0.06);
  }

  return {
    get enabled() {
      return on;
    },

    /** 사용자가 버튼을 누른 순간에 불러야 소리를 낼 수 있습니다 (브라우저 정책). */
    unlock() {
      if (!on) return;
      ensure();
      sync();
    },

    setEnabled(value) {
      on = !!value;
      if (on) ensure();
      if (master) master.gain.value = on ? 1 : 0;
      if (!on) globalThis.navigator?.vibrate?.(0);
      sync();
    },

    /** 화면을 벗어나면 true, 돌아오면 false */
    setBackground(value) {
      background = !!value;
      if (background) {
        quiet();
        try {
          globalThis.navigator?.vibrate?.(0);
        } catch {
          /* 무시 */
        }
      }
      sync();
    },

    /**
     * 매 프레임 호출. 달리는 중이 아니면 null을 넘기면 바람·울림이 잦아듭니다.
     * @param {{s:number, v:number, vMax:number, g:number, zone:string}|null} ride
     */
    frame(ride) {
      if (!ride || ride.zone === 'station') return quiet();
      const speed = clamp01(ride.v / ride.vMax);
      if (audible()) {
        const t = ctx.currentTime;
        const braking = ride.zone === 'brake' ? 0.4 : 1;
        wind.filter.frequency.setTargetAtTime(350 + 2600 * speed, t, 0.1);
        wind.gain.gain.setTargetAtTime(0.42 * speed * speed * braking, t, 0.1);
        rumble.gain.gain.setTargetAtTime((0.1 + 0.35 * speed) * braking, t, 0.1);
      }
      const moved = lastS == null ? 0 : ride.s - lastS;
      lastS = ride.s;
      if (moved > 0 && moved < 600) {
        sinceClack += moved;
        if (sinceClack >= CLACK_EVERY) {
          sinceClack %= CLACK_EVERY;
          clack(speed);
        }
      }
      // 크게 눌리거나 뜨는 순간 짧게 진동
      const now = globalThis.performance?.now() ?? 0;
      if (Math.abs(ride.g - 1) > 1.6 && now - lastBuzzAt > 260) {
        lastBuzzAt = now;
        vibrate(14);
      }
    },

    /** @param {'start'|'hands'|'faint'|'finish'} name */
    event(name) {
      if (name === 'start') {
        tone(660, 0.16, { type: 'triangle' });
        tone(880, 0.3, { type: 'triangle', delay: 0.14 });
        vibrate(10);
      } else if (name === 'hands') {
        tone(520, 0.09, { gain: 0.07, to: 820 });
        vibrate(8);
      } else if (name === 'faint') {
        tone(420, 0.75, { type: 'sawtooth', gain: 0.13, to: 90 });
        vibrate([70, 50, 180]);
      } else if (name === 'finish') {
        [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.32, { type: 'triangle', delay: i * 0.11 }));
        vibrate([25, 40, 25]);
      }
    },

    quiet,
  };
}
