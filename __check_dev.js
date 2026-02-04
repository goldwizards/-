
window.__CBD_BOOT_OK = true;


(() => {
  try {
  // ---------- Canvas ----------
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;

  // ---------- Battlefield Background (canvas-only) ----------
  const BG_GROUND = new Image();
  let BG_GROUND_READY = false;
  BG_GROUND.onload = () => { BG_GROUND_READY = true; };
  BG_GROUND.src = 'bg_ground_sanctuary_topdown.png';

  // ---------- Battlefield BG cache (perf) ----------
  // 배경(이미지/베일/비네트) + 그리드 + 설치반경은 프레임마다 새로 그리면 모바일에서 부담이 큽니다.
  // bgMode/캔버스 크기/이미지 로드 상태가 바뀔 때만 한 번 렌더링하고, draw에서는 drawImage만 합니다.
  const BG_CACHE = { canvas: null, ctx: null, mode: -1, w: 0, h: 0, groundReady: false };

  function ensureBattleBgCache(bgMode){
    bgMode = (typeof bgMode === 'number') ? bgMode : 1;
    const need = (
      !BG_CACHE.canvas ||
      BG_CACHE.mode !== bgMode ||
      BG_CACHE.w !== W ||
      BG_CACHE.h !== H ||
      BG_CACHE.groundReady !== BG_GROUND_READY
    );
    if (!need) return;

    BG_CACHE.mode = bgMode;
    BG_CACHE.w = W;
    BG_CACHE.h = H;
    BG_CACHE.groundReady = BG_GROUND_READY;

    if (!BG_CACHE.canvas) {
      BG_CACHE.canvas = document.createElement('canvas');
      BG_CACHE.ctx = BG_CACHE.canvas.getContext('2d');
    }
    const bcv = BG_CACHE.canvas;
    const bctx = BG_CACHE.ctx;
    bcv.width = W;
    bcv.height = H;

    // ---- base ----
    bctx.setTransform(1,0,0,1,0,0);
    bctx.clearRect(0,0,W,H);
    bctx.fillStyle = '#0b0f14';
    bctx.fillRect(0,0,W,H);

    // ---- ground image + veil/vignette ----
    if (bgMode > 0) {
      if (BG_GROUND_READY) {
        const iw = BG_GROUND.width || 1, ih = BG_GROUND.height || 1;
        const s = Math.max(W/iw, H/ih);
        const dw = iw*s, dh = ih*s;
        const dx = (W - dw)/2;
        const dy = (H - dh)/2;
        bctx.save();
        bctx.globalAlpha = (bgMode === 2) ? 0.88 : 0.62;
        bctx.drawImage(BG_GROUND, dx, dy, dw, dh);
        bctx.restore();
      } else {
        // fallback: soft stone tiles (very cheap)
        bctx.save();
        bctx.fillStyle = '#101827';
        for (let y=0;y<H;y+=96){
          for (let x=0;x<W;x+=96){
            const o = ((x/96 + y/96) % 2) ? 0.06 : 0.03;
            bctx.globalAlpha = o;
            bctx.fillRect(x, y, 92, 92);
          }
        }
        bctx.restore();
      }

      // readability veil
      bctx.save();
      bctx.fillStyle = (bgMode === 2) ? 'rgba(10,14,20,0.16)' : 'rgba(10,14,20,0.26)';
      bctx.fillRect(0,0,W,H);

      // vignette
      const vg = bctx.createRadialGradient(W*0.5, H*0.5, Math.min(W,H)*0.18, W*0.5, H*0.5, Math.max(W,H)*0.72);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, (bgMode === 2) ? 'rgba(0,0,0,0.32)' : 'rgba(0,0,0,0.38)');
      bctx.fillStyle = vg;
      bctx.fillRect(0,0,W,H);
      bctx.restore();
    }

    // ---- grid (static) ----
    bctx.globalAlpha = 0.15;
    bctx.strokeStyle = '#233047';
    bctx.lineWidth = 1;
    for (let x=0;x<=W;x+=32){ bctx.beginPath(); bctx.moveTo(x,0); bctx.lineTo(x,H); bctx.stroke(); }
    for (let y=0;y<=H;y+=32){ bctx.beginPath(); bctx.moveTo(0,y); bctx.lineTo(W,y); bctx.stroke(); }
    bctx.globalAlpha = 1;

    // ---- build radius (static) ----
    // CORE_POS/BUILD_RADIUS는 아래에서 정의되지만, draw에서 호출되는 시점에는 이미 값이 준비되어 있습니다.
    try {
      bctx.globalAlpha = 0.16;
      bctx.beginPath();
      bctx.arc(CORE_POS.x, CORE_POS.y, BUILD_RADIUS, 0, Math.PI*2);
      bctx.fillStyle = '#1f2937';
      bctx.fill();
      bctx.globalAlpha = 1;
    } catch {}
  }

  const wireCanvas = document.getElementById("wire");
  const wctx = wireCanvas.getContext("2d");
  const wireText = document.getElementById("wireText");

  // ---------- Utils ----------
  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
  const rand  = (a,b)=>a+Math.random()*(b-a);
  const lerp  = (a,b,t)=>a+(b-a)*t;
  const dist  = (ax,ay,bx,by)=>Math.hypot(ax-bx, ay-by);
  const nowSec = ()=>performance.now()/1000;

  // ---------- Ending ----------
  const FINAL_WAVE = 30;

  // ---------- SFX (WebAudio, 외부 파일 없이 합성) ----------
  const SFX = (() => {
    let ctx = null, master = null, noiseBuf = null;
    // BGM 전용 믹서(효과음과 분리해서 보스 웨이브에서만 강하게 만들기)
    let bgmMix = null, bgmLP = null, bgmDrive = null;
    let enabled = true;
    // 기본 볼륨(요청: 0.75)
    let volume = 0.75;

    function makeDriveCurve(amount=0.35){
      // amount: 0(거의 없음) ~ 0.8(강함)
      const n = 2048;
      const curve = new Float32Array(n);
      const k = Math.max(0.0001, Math.min(1.0, amount)) * 40;
      for (let i=0;i<n;i++){
        const x = (i*2)/(n-1) - 1;
        curve[i] = Math.tanh(k*x) / Math.tanh(k);
      }
      return curve;
    }

    function ensure(){
      if (ctx) return;
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);

      // --- BGM chain: (notes) -> LPF -> Drive -> bgmMix -> master
      bgmMix = ctx.createGain();
      bgmMix.gain.value = 0.82;
      bgmMix.connect(master);

      bgmLP = ctx.createBiquadFilter();
      bgmLP.type = "lowpass";
      bgmLP.frequency.value = 8000;
      bgmLP.Q.value = 0.8;

      bgmDrive = ctx.createWaveShaper();
      bgmDrive.curve = makeDriveCurve(0.30);
      bgmDrive.oversample = "2x";

      bgmLP.connect(bgmDrive).connect(bgmMix);

      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i=0;i<d.length;i++) d[i] = Math.random()*2 - 1;
    }

    async function unlock(){
      ensure();
      if (ctx.state === "suspended") {
        try { await ctx.resume(); } catch {}
      }
      // iOS/Safari 대응: 매우 짧은 무음 재생
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      o.connect(g).connect(master);
      o.start();
      o.stop(ctx.currentTime + 0.01);
      if (enabled && volume > 0.001) startBgm();
    }

    function setEnabled(v){
      enabled = !!v;
      if (!enabled) stopBgm();
      else if (ctx && ctx.state === "running" && volume > 0.001) startBgm();
    }
    function getEnabled(){ return enabled; }

    function setVolume(v){
      volume = clamp(v, 0, 1);
      ensure();
      master.gain.value = volume;
      if (volume <= 0.001) stopBgm();
      else if (enabled && ctx && ctx.state === "running") startBgm();
    }
    function getVolume(){ return volume; }

    

    // ---------- BGM (WebAudio, 외부 파일 없이 합성 루프) ----------
    // 목표: 기본은 더 긴장감 있게, 보스 웨이브에서는 확실히 "강하게"(템포/사운드/레이어 증가)
    let bgmPlaying = false;
    let bgmTimer = null;
    let bgmStep = 0;
    let bgmNextTime = 0;

    const BGM_TICK_MS = 35;       // 스케줄러 주기(조금 더 촘촘)
    const BGM_AHEAD = 0.22;       // 앞서서 스케줄할 시간(초)
    let bgmStepsPerBar = 16; // 기본 4/4(16 x 16th)
    let bgmBars = 4;
    let bgmLoopSteps = bgmStepsPerBar * bgmBars;
    let bgmSwing = 0.0; // 0.0~0.20 정도(홀수 16분을 뒤로 미는 셔플)

    // BGM 모드: build(기본) / wave(전투) / boss(보스) / fail / win
    let bgmMode = "build";
    let bgmBpm = 112;

        const BGM_MODES = {
      // ✅ 전체 테마 교체: 더 부드럽고(덜 삐-), 공간감 있는 '사원/우주' 느낌
      build:{ bpm:104, mix:0.72, lp:7200,  drive:0.20, spb:16, bars:4, swing:0.00 },
      wave: { bpm:118, mix:0.88, lp:10500, drive:0.32, spb:16, bars:4, swing:0.04 },
      boss: { bpm:132, mix:1.02, lp:14000, drive:0.52, spb:16, bars:4, swing:0.08 },
      // ✅ 최종 보스: 페이즈별로 테마/밀도/드라이브가 확실히 달라짐
      final1:{ bpm:144, mix:1.08, lp:16000, drive:0.62, spb:16, bars:4, swing:0.10 },
      final2:{ bpm:152, mix:1.12, lp:17500, drive:0.70, spb:16, bars:4, swing:0.12 },
      final3:{ bpm:160, mix:1.18, lp:19000, drive:0.78, spb:16, bars:4, swing:0.13 },
      // game over: 4/4 느리게(박자 안정), 슬픈 패드 중심
      fail: { bpm: 76, mix:0.42, lp:2600,  drive:0.08, spb:16, bars:4, swing:0.00 },
      // ending: 4/4 밝은 진행(박자 안정)
      win:  { bpm:112, mix:0.66, lp:12000, drive:0.16, spb:16, bars:4, swing:0.03 },
    };

    // 코드 진행(4마디 루프) — 전체 테마 교체(덜 삐- + 공간감)
    const CHORDS_BUILD = [
      [60, 64, 67, 74], // C(add9)
      [57, 60, 64, 67], // Am7
      [53, 57, 60, 64], // Fmaj7
      [55, 60, 62, 67], // Gsus4
    ];
    const ROOTS_BUILD = [36, 45, 41, 43]; // C2, A2, F2, G2 // A2, D2, F2, E2

    const CHORDS_WAVE = [
      [62, 65, 69, 72], // Dm7
      [58, 62, 65, 69], // Bbmaj7
      [53, 57, 60, 67], // F(add9)
      [60, 64, 67, 74], // C(add9)
    ];
    const ROOTS_WAVE = [38, 34, 41, 36]; // D2, Bb1, F2, C2 // E2, C2, G2, D2

    const CHORDS_BOSS = [
      [55, 58, 62, 65], // Gm7
      [51, 55, 58, 62], // Ebmaj7
      [53, 57, 60, 64], // Fmaj7
      [50, 54, 57, 60], // D7
    ];
    const ROOTS_BOSS = [43, 39, 41, 38]; // G2, Eb2, F2, D2 // F2, Db2, Eb2, C2

    // final1: Fm - Gb - Db - C7
    const CHORDS_FINAL1 = [
      [62, 65, 69, 72], // Dm7
      [63, 67, 70],     // Eb
      [58, 62, 65],     // Bb
      [57, 61, 64, 67], // A7
    ];
    const ROOTS_FINAL1 = [38, 39, 34, 45]; // D2, Eb2, Bb1, A2

    // final2: Fm - Ab - Eb - C7
    const CHORDS_FINAL2 = [
      [62, 65, 69, 72], // Dm7
      [55, 58, 62, 65], // Gm7
      [51, 55, 58, 62], // Ebmaj7
      [57, 61, 64, 67], // A7
    ];
    const ROOTS_FINAL2 = [38, 43, 39, 45];

    // final3: Fm - Gb - Ab - C7
    const CHORDS_FINAL3 = [
      [62, 65, 69, 72], // Dm7
      [63, 66, 70],     // Ebm(어둡게)
      [53, 57, 60, 64], // Fmaj7
      [57, 61, 64, 67], // A7
    ];
    const ROOTS_FINAL3 = [38, 39, 41, 45];

    // fail: 슬픈 진행(Am - F - Dm - Em)
    const CHORDS_FAIL = [
      [57, 60, 64, 67], // Am7
      [55, 59, 62],     // G
      [53, 57, 60, 64], // Fmaj7
      [52, 55, 59],     // E
    ];
    const ROOTS_FAIL = [45, 43, 41, 40]; // A2, G2, F2, E2 // A2, F2, D2, E2

    // win: 엔딩 진행(C - G - Am - F)
    const CHORDS_WIN = [
      [60, 64, 67, 72], // C
      [55, 59, 62, 67], // G
      [57, 60, 64, 69], // Am
      [53, 57, 60],     // F
    ];
    const ROOTS_WIN = [36, 43, 45, 41]; // C2, G2, A2, F2 // C2, G2, A2, F2



// C2, G2, A2, F2


    function mtof(m){ return 440 * Math.pow(2, (m - 69) / 12); }

    function kick(t){
      // punch + click
      toneAt("sine", 170, 52, 0.095, 0.12, t);
      noiseAt({hp:5200, lp:16000, dur:0.012, vol:0.010, t});
    }
    function snare(t){
      // noise snap + short body
      noiseAt({hp:1200, lp:9000, dur:0.080, vol:0.065, t});
      toneAt("triangle", 260, 190, 0.060, 0.030, t);
    }
    function hat(t, strong=false){
      noiseAt({hp:9000, lp:18000, dur: strong ? 0.030 : 0.016, vol: strong ? 0.022 : 0.014, t});
    }
    function bass(t, f){
      // square bass + sub
      toneAt("square", f, f*0.98, 0.18, 0.042, t);
      toneAt("sine",   f*0.5, f*0.5, 0.22, 0.012, t);
    }
    function arp(t, f){
      // crisp arpeggio
      toneAt("square", f, f*1.01, 0.090, 0.030, t);
    }
    function melody(t, f){
      toneAt("triangle", f, f, 0.12, 0.020, t);
    }
    function lead(t, f){
      // detuned dual-osc for a "new" lead color
      toneAt("sawtooth", f, f*1.01, 0.14, 0.012, t);
      toneAt("square",   f*1.005, f, 0.14, 0.010, t + 0.002);
    }
    function riser(t, f0, f1){
      toneAt("sawtooth", f0, f1, 0.16, 0.010, t);
    }

    // fail용 패드(길게/부드럽게)
    function pad(t, f){
      toneAt("triangle", f, f, 0.95, 0.010, t);
      toneAt("sine", f*1.5, f*1.5, 0.85, 0.006, t + 0.01);
    }
    // win용 벨(짧고 밝게)
    function bell(t, f){
      toneAt("sine", f, f*1.002, 0.20, 0.016, t);
      toneAt("triangle", f*2, f*1.99, 0.12, 0.008, t);
    }


    function toneAt(type, f0, f1, dur, vol, t0){
      if (!enabled || volume <= 0.001) return;
      ensure();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t0);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur*0.85);
      env(g.gain, t0, 0.0008, 0.02, 0.22, dur, vol);
      // BGM은 전용 체인(bgmLP->drive->mix)을 통과
      o.connect(g).connect(bgmLP || master);
      o.start(t0);
      o.stop(t0 + dur + 0.08);
    }

    function noiseAt({hp=2000, lp=12000, dur=0.03, vol=0.03, t=0} = {}){
      if (!enabled || volume <= 0.001) return;
      ensure();
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      const bp = ctx.createBiquadFilter(); bp.type = "highpass"; bp.frequency.value = hp;
      const lpF = ctx.createBiquadFilter(); lpF.type = "lowpass";  lpF.frequency.value = lp;
      const g = ctx.createGain();
      env(g.gain, t, 0.001, 0.01, 0.18, dur, vol);
      src.connect(bp).connect(lpF).connect(g).connect(bgmLP || master);
      src.start(t);
      src.stop(t + dur + 0.02);
    }

    function applyBgmMode(){
      if (!ctx) return;
      const m = BGM_MODES[bgmMode] || BGM_MODES.build;

      bgmBpm = m.bpm;

      // 박자/루프 구조도 모드별로 바꿔서 "곡만 바뀐 느낌"이 아니라 리듬 자체가 달라지게
      bgmStepsPerBar = m.spb || 16;
      bgmBars = m.bars || 4;
      bgmLoopSteps = bgmStepsPerBar * bgmBars;
      bgmSwing = m.swing || 0.0;

      if (bgmMix)  bgmMix.gain.setTargetAtTime(m.mix, ctx.currentTime, 0.06);
      if (bgmLP)   bgmLP.frequency.setTargetAtTime(m.lp,  ctx.currentTime, 0.08);
      if (bgmDrive) bgmDrive.curve = makeDriveCurve(m.drive);
    }

    function setBgmMode(mode){
      const next = (mode && BGM_MODES[mode]) ? mode : "build";
      if (next === bgmMode) return;

      const prev = bgmMode;
      const prevSpb = bgmStepsPerBar;
      const prevBars = bgmBars;

      bgmMode = next;
      if (ctx) applyBgmMode();

      // 보스/최종전 진입, 또는 박자 구조(steps-per-bar)가 바뀌면 루프를 처음부터 시작
      const sigChanged = (bgmStepsPerBar !== prevSpb) || (bgmBars !== prevBars);

      if (bgmPlaying && ctx && ctx.state === "running") {
        const prevIsFinal = (prev && String(prev).startsWith("final"));
        const nextIsFinal = (next && String(next).startsWith("final"));
        // 보스 진입 / 최종전 진입(처음) / 박자 구조 변경이면 루프를 처음부터 시작
        if ((next === "boss" && prev !== "boss") || (nextIsFinal && !prevIsFinal) || sigChanged) {
          bgmStep = 0;
          bgmNextTime = ctx.currentTime + 0.06;
        }
      }
    }
    function getBgmMode(){ return bgmMode; }

    function scheduleBgm(step, t, stepDur){
      const bar = Math.floor(step / bgmStepsPerBar) % bgmBars;
      const pos = step % bgmStepsPerBar;

      // 셔플/스윙: 홀수 16분을 약간 뒤로 밀기
      const tt = t + (((pos & 1) === 1) ? (stepDur * bgmSwing) : 0);

      const isFinal = (bgmMode === "final1" || bgmMode === "final2" || bgmMode === "final3");
      const finalLv = (bgmMode === "final1") ? 1 : (bgmMode === "final2") ? 2 : (bgmMode === "final3") ? 3 : 0;

      const chord =
        (bgmMode === "final1") ? CHORDS_FINAL1[bar] :
        (bgmMode === "final2") ? CHORDS_FINAL2[bar] :
        (bgmMode === "final3") ? CHORDS_FINAL3[bar] :
        (bgmMode === "boss")   ? CHORDS_BOSS[bar]  :
        (bgmMode === "wave")   ? CHORDS_WAVE[bar]  :
        (bgmMode === "fail")   ? CHORDS_FAIL[bar]  :
        (bgmMode === "win")    ? CHORDS_WIN[bar]   :
                                  CHORDS_BUILD[bar];
      const root  =
        (bgmMode === "final1") ? ROOTS_FINAL1[bar] :
        (bgmMode === "final2") ? ROOTS_FINAL2[bar] :
        (bgmMode === "final3") ? ROOTS_FINAL3[bar] :
        (bgmMode === "boss")   ? ROOTS_BOSS[bar]  :
        (bgmMode === "wave")   ? ROOTS_WAVE[bar]  :
        (bgmMode === "fail")   ? ROOTS_FAIL[bar]  :
        (bgmMode === "win")    ? ROOTS_WIN[bar]   :
                                  ROOTS_BUILD[bar];

// ----------------- 드럼(모드별 리듬을 확실히 다르게) -----------------
      if (bgmMode === "build") {
        // 거의 앰비언트(덜 시끄럽게)
        if (pos === 0 || pos === 8) kick(tt);
        if (pos === 4 || pos === 12) hat(tt, pos === 12);
      } else if (bgmMode === "wave") {
        // 기본 4/4 전투
        if (pos === 0 || pos === 8) kick(tt);
        if (pos === 4 || pos === 12) snare(tt);
        if (pos === 2 || pos === 6 || pos === 10 || pos === 14) hat(tt, pos === 2);
      } else if (bgmMode === "boss") {
        // 묵직한 보스 그루브
        if (pos === 0 || pos === 6 || pos === 8 || pos === 14) kick(tt);
        if (pos === 4 || pos === 12) snare(tt);
        if (pos % 2 === 0) hat(tt, pos === 0 || pos === 8);
        if (pos === 15) noiseAt({hp:1600, lp:9000, dur:0.09, vol:0.040, t:tt});
      } else if (isFinal) {
        // final(phase1~3): 페이즈가 올라갈수록 밀도 상승
        if (pos === 0 || pos === 3 || pos === 6 || pos === 8 || pos === 10 || pos === 12 || pos === 15) kick(tt);
        if (finalLv >= 2 && (pos === 5 || pos === 13)) kick(tt);
        if (pos === 4 || pos === 12) snare(tt);

        if (finalLv === 1) {
          if (pos % 2 === 0) hat(tt, pos === 0 || pos === 8);
          if (pos === 14 || pos === 15) hat(tt, true);
        } else if (finalLv === 2) {
          if (pos % 2 === 0) hat(tt, pos === 0 || pos === 8);
          if (pos === 10 || pos === 14 || pos === 15) hat(tt, true);
        } else {
          // phase3: 가장 압박감(볼륨은 낮게)
          hat(tt, pos === 0 || pos === 8);
          if (pos % 2 === 1) hat(tt, false);
          if (pos === 7 || pos === 15) hat(tt, true);
        }

        if (pos === 0) noiseAt({hp:5200, lp:18000, dur:0.12, vol:0.045, t:tt});
        if (pos === 8) noiseAt({hp:1700, lp:9000, dur:0.08, vol:0.045, t:tt});
      } else if (bgmMode === "fail") {
        // fail(4/4): 느린 심장박동 + 얇은 먼지
        if (pos === 0 || pos === 9) toneAt("sine", 68, 54, 0.30, 0.012, tt);
        if (pos === 4) noiseAt({hp:950, lp:2600, dur:0.11, vol:0.030, t:tt});
      } else if (bgmMode === "win") {
        // win: 4/4 가벼운 스네어 + 씬한 햇
        if (pos === 0 || pos === 8) kick(tt);
        if (pos === 4 || pos === 12) snare(tt);
        if (pos === 2 || pos === 6 || pos === 10 || pos === 14) hat(tt, pos === 2);
      }

// ----------------- 베이스(모드별 박자) -----------------
      if (bgmMode === "fail") {
        if (pos === 0 || pos === 8) bass(tt, mtof(root));
      } else if (bgmMode === "win") {
        if (pos === 0 || pos === 4 || pos === 8 || pos === 12) bass(tt, mtof(root));
      } else if (isFinal) {
        if (finalLv === 1) {
          if (pos === 0 || pos === 6 || pos === 8 || pos === 14) bass(tt, mtof(root));
        } else if (finalLv === 2) {
          if (pos === 0 || pos === 4 || pos === 6 || pos === 8 || pos === 12 || pos === 14) bass(tt, mtof(root));
        } else {
          if (pos === 0 || pos === 3 || pos === 6 || pos === 8 || pos === 10 || pos === 12 || pos === 15) bass(tt, mtof(root));
        }
      } else if (bgmMode === "boss") {
        if (pos === 0 || pos === 6 || pos === 8 || pos === 14) bass(tt, mtof(root));
      } else if (bgmMode === "wave") {
        if (pos === 0 || pos === 7 || pos === 8 || pos === 15) bass(tt, mtof(root));
      } else {
        if (pos === 0 || pos === 8) bass(tt, mtof(root));
      }

      // ----------------- 멜로디(모드별 리듬 위치 다르게) -----------------
      const scaleBuild = [60, 62, 64, 67, 69, 72, 74, 76]; // C major pentatonic-ish (calm) // A Dorian (build: 차분)
      const scaleWave  = [62, 64, 65, 67, 69, 70, 72, 74]; // D minor (battle) // E Dorian (wave: 전투)
      const scaleBoss  = [55, 58, 60, 62, 63, 65, 67, 70]; // G minor-ish (tense) // F harmonic minor-ish (boss)
      const scaleFinal = [62, 63, 65, 67, 69, 70, 72, 74]; // D harmonic minor-ish (final) // F phrygian dominant-ish (final)
      const scaleFail  = [57, 60, 62, 64, 65, 67, 69];     // A minor (slow)     // 느린 애가토(부드럽게)
      const scaleWin   = [60, 62, 64, 65, 67, 69, 71, 72]; // C major (victory) // C major-ish

      let scale = scaleBuild;
      if (bgmMode === "wave") scale = scaleWave;
      else if (bgmMode === "boss") scale = scaleBoss;
      else if (isFinal) scale = scaleFinal;
      else if (bgmMode === "fail") scale = scaleFail;
      else if (bgmMode === "win") scale = scaleWin;

      let melodyPos = [3, 11]; // build(기본): 드문드문
      if (bgmMode === "wave") {
        melodyPos = [1, 6, 9, 14];
      } else if (bgmMode === "boss") {
        melodyPos = [1, 3, 7, 9, 11, 13, 15];
      } else if (isFinal) {
        melodyPos = (finalLv === 1) ? [1, 4, 7, 9, 11, 15]
                  : (finalLv === 2) ? [1, 3, 4, 7, 9, 11, 13, 15]
                                   : [1, 3, 4, 5, 7, 9, 11, 13, 15];
      } else if (bgmMode === "fail") {
        melodyPos = [4, 9, 12];
      } else if (bgmMode === "win") {
        melodyPos = [2, 6, 10, 14];
      }

      if (melodyPos.includes(pos)){
        const idx = (bar * 13 + pos * 3) % scale.length;
        if (bgmMode === "fail"){
          melody(tt, mtof(scale[idx] - 12));
        } else if (bgmMode === "win"){
          bell(tt, mtof(scale[idx]));
        } else {
          melody(tt, mtof(scale[idx]));
          if (bgmMode === "wave" && (pos === 9 || pos === 14)) arp(tt + 0.02, mtof(scale[(idx+4)%scale.length]));
          if (bgmMode === "boss" || isFinal) lead(tt + 0.02, mtof(scale[(idx+2)%scale.length]));
        }
      }

      // fail에서는 바마다 패드(코드톤)로 공간감
      if (bgmMode === "fail" && pos === 0) {
        for (let i=0;i<chord.length;i++){
          pad(tt, mtof(chord[i]) * (i===0 ? 0.5 : 1)); // 루트는 한 옥타브 아래도 함께
        }
      }

      // win에서는 2박마다 살짝 반짝임
      if (bgmMode === "win" && (pos === 0 || pos === 8)) {
        for (let i=0;i<chord.length;i++){
          bell(tt + i*0.03, mtof(chord[i] + 12));
        }
      }

      // 마디 끝 상승(긴장 유지) — 모드별 스텝 길이에 대응
      if (pos === (bgmStepsPerBar - 1)) {
        if (isFinal) {
          const a = (finalLv === 1) ? 620 : (finalLv === 2) ? 660 : 700;
          const b = (finalLv === 1) ? 1280 : (finalLv === 2) ? 1450 : 1620;
          riser(tt, a, b);
        } else if (bgmMode === "boss") {
          riser(tt, 520, 980);
        }
      }
    }

    function bgmTick(){
      if (!enabled || !ctx || ctx.state !== "running" || volume <= 0.001) return;
      const stepDur = (60 / Math.max(30, bgmBpm)) / 4; // 16th
      while (bgmNextTime < ctx.currentTime + BGM_AHEAD){
        scheduleBgm(bgmStep, bgmNextTime, stepDur);
        bgmNextTime += stepDur;
        bgmStep = (bgmStep + 1) % bgmLoopSteps;
      }
    }

    function startBgm(){
      if (bgmPlaying) return;
      ensure();
      if (!enabled || volume <= 0.001) return;
      if (ctx.state !== "running") return; // 잠겨있으면 unlock 이후 시작
      applyBgmMode();
      bgmPlaying = true;
      bgmStep = 0;
      bgmNextTime = ctx.currentTime + 0.05;
      bgmTimer = setInterval(bgmTick, BGM_TICK_MS);
    }

    function stopBgm(){
      if (!bgmPlaying) return;
      bgmPlaying = false;
      if (bgmTimer){ clearInterval(bgmTimer); bgmTimer = null; }
    }
function env(param, t, a, d, s, r, peak){
      param.cancelScheduledValues(t);
      param.setValueAtTime(0.0001, t);
      param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
      param.exponentialRampToValueAtTime(Math.max(0.0001, peak*s), t + a + d);
      param.exponentialRampToValueAtTime(0.0001, t + a + d + r);
    }

    function noise({hp=900, lp=9000, dur=0.10, vol=0.25} = {}){
      ensure();
      const t = ctx.currentTime;

      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;

      const hpF = ctx.createBiquadFilter();
      hpF.type = "highpass";
      hpF.frequency.value = hp;

      const lpF = ctx.createBiquadFilter();
      lpF.type = "lowpass";
      lpF.frequency.value = lp;

      const g = ctx.createGain();
      env(g.gain, t, 0.001, 0.02, 0.2, dur, vol);

      src.connect(hpF).connect(lpF).connect(g).connect(master);
      src.start(t);
      src.stop(t + dur + 0.05);
    }

    function tone(type, f0, f1, dur, vol){
      ensure();
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur*0.85);
      env(g.gain, t, 0.001, 0.03, 0.25, dur, vol);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + dur + 0.08);
    }

    // band-pass tone (used for clean crystal SFX)
    function toneBP(type, f0, f1, dur, vol, bpFreq=1150, q=1.2, a=0.001, d=0.095, s=0.08, r=0.02){
      ensure();
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const bp = ctx.createBiquadFilter();
      const g = ctx.createGain();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(bpFreq, t);
      bp.Q.setValueAtTime(q, t);
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur*0.85);
      env(g.gain, t, a, d, s, r, vol);
      o.connect(bp).connect(g).connect(master);
      o.start(t);
      o.stop(t + dur + 0.08);
    }

    function toneBPDetune(type, f0, f1, dur, vol, bpFreq=1150, q=1.2, cents=6){
      const k = Math.pow(2, cents/1200);
      toneBP(type, f0*k, f1*k, dur, vol*0.55, bpFreq, q);
      toneBP(type, f0/k, f1/k, dur, vol*0.55, bpFreq, q);
    }

    // 사운드들(효과음 전체 교체: 더 또렷한 네온/사이버 톤)
    // - 반복 재생에도 덜 피로하게(짧고 정돈된 어택)
    // - 타입별/상황별 구분이 확실하도록(피치·노이즈·질감 분리)
    function j(f, cents=12){ return f * Math.pow(2, ((Math.random()*2-1)*cents)/1200); }

    function s_click(){
      tone("triangle", j(2100,14), j(1650,14), 0.040, 0.20);
      noise({hp:3200, lp:16000, dur:0.035, vol:0.06});
    }
    function s_place(){
      // 설치: 짧은 저역 '툭' + 금속성 하이라이트
      tone("sine",     j(165,8),  j(95,8),   0.090, 0.22);
      tone("triangle", j(820,10), j(1220,10),0.060, 0.14);
      noise({hp:1400, lp:9000, dur:0.060, vol:0.07});
    }
    function s_shoot(){
      // 포탑 발사(레이저): 빠른 하이→로우 스윕 + 스냅 노이즈
      tone("sawtooth", j(1800,18), j(420,18), 0.065, 0.16);
      tone("triangle", j(2600,14), j(1200,14),0.045, 0.10);
      noise({hp:2600, lp:12000, dur:0.040, vol:0.06});
    }

    
    function s_coreShoot(){
      // 코어(오버드라이브) 직접 사격: 맑은 수정 '팅' (메인 레이어만)
      // - Triangle 기반, 짧은 하강 피치, Band-pass로 유리 공명 느낌
      // - 포탑 발사음(레이저)과 재질이 다르게 들리도록 설계
      toneBPDetune("triangle", 1040, 860, 0.115, 0.30, 1150, 1.2, 6);
    }

// 에너지포(야마토포) 전용 사운드: 충전은 단계별로 더 선명, 발사는 '빔' 체감 강화
    function s_yamatoCharge1(){
      tone("sine",     j(95,6),  j(140,6),  0.16, 0.26);  // 저역 허밍
      tone("triangle", j(520,10),j(760,10), 0.06, 0.10);  // 스파크
      noise({hp:800, lp:4200, dur:0.14, vol:0.10});
    }
    function s_yamatoCharge2(){
      tone("triangle", j(720,10),j(980,10), 0.07, 0.13);
      tone("sine",     j(140,6), j(190,6),  0.10, 0.18);
      noise({hp:1400, lp:6200, dur:0.12, vol:0.09});
    }
    function s_yamatoCharge3(){
      tone("square",   j(980,12), j(1220,12),0.06, 0.12);
      tone("triangle", j(1680,12),j(2380,12),0.05, 0.10);
      noise({hp:2200, lp:10000, dur:0.10, vol:0.09});
    }
    function s_yamatoChargeReady(){
      // 발사 직전: 밝은 '락-온' 핑
      tone("triangle", j(1200,12), j(2800,12), 0.10, 0.18);
      noise({hp:3400, lp:18000, dur:0.09, vol:0.10});
    }
    function s_yamatoFire(){
      // 발사: 저역 충격 + 고역 스냅 + 에너지 폭발
      tone("sine",     j(95,6),   j(40,6),   0.70, 0.65);
      noise({hp:80,   lp:1600,  dur:0.50,  vol:0.26});
      tone("sawtooth", j(1100,16), j(180,16),0.42, 0.26);
      tone("triangle", j(3200,16), j(900,16),0.20, 0.30);
      noise({hp:3200, lp:19000, dur:0.16, vol:0.16});
    }

    function s_shieldHit(){
      // 보호막 피격: 금속성 '핑' + 전기성 히스
      tone("triangle", j(1650,10), j(1050,10), 0.11, 0.22);
      tone("sine",     j(2550,12), j(1800,12), 0.06, 0.10);
      noise({hp:2400, lp:15000, dur:0.08, vol:0.10});
    }
    function s_shieldBreak(){
      // 보호막 파괴: 크랙(하강) + 파편 노이즈 + 저역 잔향
      tone("sawtooth", j(1200,16), j(140,16), 0.28, 0.26);
      noise({hp:1800, lp:13000, dur:0.22, vol:0.22});
      tone("triangle", j(2200,14), j(1600,14), 0.09, 0.14);
      tone("triangle", j(2800,14), j(1900,14), 0.07, 0.12);
      tone("sine",     j(140,8),   j(70,8),    0.30, 0.18);
    }
    function s_coreBreak(){
      // 수정탑 파괴(약 1초): 크리스탈 크랙 + 스파클 + 저역 잔향
      tone("triangle", j(2400,12), j(1100,12), 0.16, 0.22);
      tone("sawtooth", j(980,14),  j(70,14),   1.05, 0.36);
      noise({hp:1600, lp:14000, dur:0.95, vol:0.22});
      tone("sine",     j(3200,18), j(2100,18), 0.22, 0.08);
      tone("sine",     j(2600,18), j(1700,18), 0.26, 0.08);
      tone("sine",     j(150,8),   j(60,8),    1.05, 0.16);
    }

    function s_enemyShoot(){
      // 적 발사: 더 '거칠고 낮게' (플레이어 발사와 구분)
      tone("square", j(780,14), j(260,14), 0.080, 0.13);
      noise({hp:1800, lp:9000, dur:0.045, vol:0.05});
    }
    function s_blast(){
      // 폭파병: 짧은 폭발(저역+노이즈)
      tone("sine", j(140,8), j(55,8), 0.38, 0.34);
      noise({hp:90, lp:1800, dur:0.32, vol:0.16});
      noise({hp:2200, lp:12000, dur:0.08, vol:0.06});
    }
    function s_hpHit(){
      // HP 피격: 보호막보다 훨씬 둔탁하게
      tone("sine", j(110,6), j(70,6), 0.20, 0.28);
      noise({hp:120, lp:1600, dur:0.14, vol:0.10});
    }
    function s_boom(){
      // 큰 폭발
      tone("sine", j(90,6), j(28,6), 0.95, 0.48);
      noise({hp:60, lp:1400, dur:0.85, vol:0.18});
      noise({hp:2000, lp:11000, dur:0.12, vol:0.08});
    }
    function s_aegis(){
      // 긴급 보호막: 상승 스윕 + shimmer
      tone("triangle", j(420,10), j(1520,10), 0.22, 0.22);
      tone("sine",     j(980,12), j(2060,12), 0.18, 0.12);
      noise({hp:2800, lp:17000, dur:0.18, vol:0.10});
    }
    function s_repair(){
      // 수리: 밝은 치임 + 스파클
      tone("sine",     j(520,10), j(880,10),  0.20, 0.18);
      tone("triangle", j(1200,10),j(1720,10), 0.16, 0.12);
      noise({hp:2400, lp:16000, dur:0.12, vol:0.08});
    }

    function s_clear(){
      // 웨이브 클리어: 짧은 '상승' 스팅
      tone("triangle", j(720,8),  j(1440,8), 0.22, 0.20);
      tone("triangle", j(1040,8), j(2080,8), 0.18, 0.10);
    }
    function s_wave(){
      // 웨이브 시작: '삐-업' + 가벼운 히스
      tone("square", j(360,10), j(720,10), 0.14, 0.18);
      noise({hp:1900, lp:9000, dur:0.10, vol:0.07});
    }

    function s_warning(){
      // 최종전/보스 경고: 짧은 사이렌 + 트레몰로
      ensure();
      const t0 = ctx.currentTime;

      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();

      // tremolo
      const lfo = ctx.createOscillator();
      const lfoG = ctx.createGain();

      o.type = "sawtooth";
      o.frequency.setValueAtTime(520, t0);
      o.frequency.exponentialRampToValueAtTime(980, t0+0.18);
      o.frequency.exponentialRampToValueAtTime(520, t0+0.36);
      o.frequency.exponentialRampToValueAtTime(980, t0+0.54);
      o.frequency.exponentialRampToValueAtTime(620, t0+0.78);

      f.type = "bandpass";
      f.frequency.setValueAtTime(1300, t0);
      f.Q.value = 0.9;

      lfo.type = "sine";
      lfo.frequency.setValueAtTime(10, t0);
      lfoG.gain.setValueAtTime(0.18, t0);

      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.20, t0+0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0+0.80);

      lfo.connect(lfoG).connect(g.gain);
      o.connect(f).connect(g).connect(master);
      o.start(t0); lfo.start(t0);
      o.stop(t0+0.82); lfo.stop(t0+0.82);

      // 아주 약한 히스(상황 경고감)
      noise({hp:2400, lp:14000, dur:0.10, vol:0.06});
    }

    function s_victory(){
      // 승리: 2단 아르페지오 + 짧은 코드 스웰
      ensure();
      const t0 = ctx.currentTime;

      function toneAt(type, f, dt, dur, vol){
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(f, t0 + dt);
        env(g.gain, t0 + dt, 0.001, 0.02, 0.25, dur, vol);
        o.connect(g).connect(master);
        o.start(t0 + dt);
        o.stop(t0 + dt + dur + 0.08);
      }

      const seq = [
        [0.00, 523.25], // C5
        [0.10, 659.25], // E5
        [0.20, 783.99], // G5
        [0.30, 1046.50],// C6
        [0.52, 783.99], // G5
        [0.62, 880.00], // A5
        [0.72, 1046.50],// C6
        [0.82, 1318.51],// E6
      ];
      for (const [dt, f] of seq){
        toneAt("triangle", f, dt, 0.16, 0.16);
      }

      const chordT = 0.98;
      toneAt("sine",     523.25, chordT, 0.45, 0.10);
      toneAt("sine",     659.25, chordT, 0.45, 0.08);
      toneAt("sine",     783.99, chordT, 0.45, 0.08);
      toneAt("triangle", 1046.50, chordT, 0.36, 0.08);

      setTimeout(()=>{ try { noise({hp:2600, lp:16000, dur:0.09, vol:0.08}); } catch {} }, 280);
    }


    function play(name){
      if (!enabled) return;
      // 잠금 해제는 각 입력에서 unlock()로 처리 (여기서 강제 resume하지 않음)
      switch(name){
        case "click": return s_click();
        case "place": return s_place();
        case "shoot": return s_shoot();
        case "core_shoot": return s_coreShoot();
        case "y_charge1": return s_yamatoCharge1();
        case "y_charge2": return s_yamatoCharge2();
        case "y_charge3": return s_yamatoCharge3();
        case "y_charge_ready": return s_yamatoChargeReady();
        case "y_fire": return s_yamatoFire();
        case "enemy_shoot": return s_enemyShoot();
        case "blast": return s_blast();
        case "shield_hit": return s_shieldHit();
        case "shield_break": return s_shieldBreak();
        case "hp_hit": return s_hpHit();
        case "boom": return s_boom();
        case "core_break": return s_coreBreak();
        case "aegis": return s_aegis();
        case "repair": return s_repair();
        case "clear": return s_clear();
        case "wave": return s_wave();
        case "warning": return s_warning();
        case "victory": return s_victory();
      }
    }
    return { unlock, play, setEnabled, getEnabled, setVolume, getVolume, startBgm, stopBgm, setBgmMode, getBgmMode };
  })();

  // SFX 과다 재생 방지(리미터)
  let _lastShootSfx = 0;
  let _lastShieldHitSfx = 0;
  let _lastHpHitSfx = 0;
  function sfxShoot(){
    const t = nowSec();
    if (t - _lastShootSfx > 0.05){ SFX.play("shoot"); _lastShootSfx = t; }
  }
  function sfxShieldHit(){
    const t = nowSec();
    if (t - _lastShieldHitSfx > 0.10){ SFX.play("shield_hit"); _lastShieldHitSfx = t; }
  }
  function sfxHpHit(){
    const t = nowSec();
    if (t - _lastHpHitSfx > 0.12){ SFX.play("hp_hit"); _lastHpHitSfx = t; }
  }
  function ensureAudio(){ SFX.unlock(); }

  function setMsg(msg, secs=1.6){
    state.uiMsg = String(msg||"");
    state.uiMsgUntil = nowSec() + (secs||0);
    if (uiMsg) uiMsg.textContent = state.uiMsg;
  }

  function mulberry32(seed){
    let t = seed >>> 0;
    return function() {
      t += 0x6D2B79F5;
      let x = Math.imul(t ^ (t >>> 15), 1 | t);
      x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- Layout ----------
  const CORE_POS = { x: W*0.5, y: H*0.5 };
  const CORE_RADIUS = 34;
  const BUILD_RADIUS = 240;

  // ---------- Assets (코어 아이콘 내장: 로컬/모바일에서 파일 로딩이 막혀도 항상 표시) ----------
  const CORE_ICON_DATA_URL = "data:image/png;base64,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";
  const coreIcon = new Image();
  let coreIconReady = false;
  coreIcon.onload = () => coreIconReady = true;
  coreIcon.onerror = () => {
    // 로컬 파일/압축뷰어 등에서 core_icon.png 로딩이 실패하는 경우 내장 데이터로 폴백
    if (coreIcon.src !== CORE_ICON_DATA_URL) coreIcon.src = CORE_ICON_DATA_URL;
  };
  // 1) 먼저 외부 파일을 시도하고, 2) 실패/지연 시 내장 데이터로 자동 폴백
  coreIcon.src = "core_icon.png";
  setTimeout(() => {
    if (!coreIconReady) coreIcon.src = CORE_ICON_DATA_URL;
  }, 800);

  // ---------- Turrets ----------
  const TURRET_TYPES = {
    basic:  { key:"1", name:"기본 포탑",   cost:35, range:175, fireRate:3.0, dmg:9,  projSpd:350, splash:0,  slow:0,    desc:"단일 타겟, 안정형" },
    slow:   { key:"2", name:"슬로우 포탑", cost:45, range:165, fireRate:2.2, dmg:6,  projSpd:330, splash:0,  slow:0.35, desc:"피격 시 둔화" },
    splash: { key:"3", name:"스플래시",    cost:60, range:155, fireRate:1.5, dmg:12, projSpd:310, splash:48, slow:0,    desc:"범위 폭발 피해" },

    // 4) 실드 분쇄: 적 실드(파란 보호막)를 빠르게 깎음
    shred: {
      name: "실드 분쇄",
      key: "4",
      cost: 70,
      dmg: 7,
      fireRate: 2.6,
      range: 170,
      projSpd: 340,
      shieldMul: 2.25,
      desc: "적 보호막에 추가 피해",
    },
    // 5) 방호 파괴: 적을 취약 상태로 만들어 추가 피해
    breaker: {
      name: "방호 파괴",
      key: "5",
      cost: 85,
      dmg: 10,
      fireRate: 2.0,
      range: 175,
      projSpd: 330,
      vulnBonus: 0.22,
      vulnDur: 2.6,
      desc: "취약 표식(받피증) 부여",
    },

  };

  // ---------- Build helpers ----------
  // 포탑 판매 환불 비율(기본 80%)
  const SELL_REFUND = 0.80;
  function sellRefundRate(){
    return SELL_REFUND;
  }

  function findTurretIndexAt(x,y, rad=18){
    let best = -1, bestD = 1e9;
    for (let i=0;i<state.turrets.length;i++){
      const t = state.turrets[i];
      const d = dist(x,y, t.x,t.y);
      if (d <= rad && d < bestD){ best = i; bestD = d; }
    }
    return best;
  }

  function sellTurretAt(x,y){
    const idx = findTurretIndexAt(x,y, 18);
    if (idx < 0) return false;
    const tr = state.turrets[idx];
    const cost = (TURRET_TYPES[tr.type] ? TURRET_TYPES[tr.type].cost : 0);
    const refund = Math.max(0, Math.floor(cost * sellRefundRate()));
    state.crystals += refund;
    state.turrets.splice(idx, 1);
    fxRing(x,y, 18, 72, "#fcd34d");
    fxText(`판매 +${refund}`, x, y - 18, "#fcd34d");
    SFX.play("click");
    return true;
  }


  const EVENTS = [
    { id:"barrier_null",  name:"보호막 교란", desc:"이번 웨이브 동안 보호막 흡수 효율이 크게 감소합니다(일부 HP 직격).",
      apply(s){ s.mods.shieldAbsorbMul = 0.25; s.mods.shieldRegenMul = 0.60; s.mods.rewardMul = 1.25; } },
    { id:"proj_slow",    name:"탄속 감소",  desc:"이번 웨이브 동안 포탑 탄속/연사력이 감소합니다.",
      apply(s){ s.mods.turretProjMul = 0.72; s.mods.turretFireMul = 0.78; } },
    { id:"double_crystal", name:"자원 2배", desc:"이번 웨이브 동안 처치 보상이 2배입니다.",
      apply(s){ s.mods.rewardMul = 2.0; } },
{ id:"turret_boost", name:"포탑 강화", desc:"이번 웨이브 동안 포탑 피해 +20%.",
  apply(s){ s.mods.turretDmgMul = 1.20; } },

{ id:"shield_surge", name:"실드 과충전", desc:"이번 웨이브 동안 보호막 재생 +60%.",
  apply(s){ s.mods.shieldRegenMul = 1.60; } },
{ id:"overclock_rounds", name:"가속 탄환", desc:"이번 웨이브 동안 포탑 탄속 +30%, 연사력 +10%.",
  apply(s){ s.mods.turretProjMul = 1.30; s.mods.turretFireMul = 1.10; } },

{ id:"precision_mode", name:"정밀 조준", desc:"이번 웨이브 동안 포탑 피해 +30%, 연사력 -12%.",
  apply(s){ s.mods.turretDmgMul = 1.30; s.mods.turretFireMul = 0.88; } },


{ id:"emp_storm", name:"EMP 폭풍", desc:"이번 웨이브 동안 포탑 연사력 -35%.",
  apply(s){ s.mods.turretFireMul = 0.65; } },

{ id:"resource_tax", name:"보급 차감", desc:"이번 웨이브 동안 크리스탈 보상 -40%.",
  apply(s){ s.mods.rewardMul = 0.60; } },


  ];



  // ---------- Difficulty Presets (저장 안 함) ----------
  // 프리셋은 적 스탯/스폰/보상에만 곱해지고, 웨이브 기본 곡선(waveSpec)은 그대로 둡니다.
  const DIFF_PRESETS = {
    easy:   { key:"easy",   name:"쉬움",   hpMul:0.92, dmgMul:0.90, spdMul:0.98, spawnMul:0.94, rewardMul:1.10 },
    normal: { key:"normal", name:"보통",   hpMul:1.00, dmgMul:1.00, spdMul:1.00, spawnMul:1.00, rewardMul:1.00 },
    hard:   { key:"hard",   name:"어려움", hpMul:1.12, dmgMul:1.10, spdMul:1.02, spawnMul:1.06, rewardMul:0.92 },
  };

  function getDiff(){
    const k = (state && state.diffId) ? String(state.diffId) : "normal";
    return DIFF_PRESETS[k] || DIFF_PRESETS.normal;
  }

  function setDiffPreset(key){
    const k = (key && DIFF_PRESETS[key]) ? key : "normal";
    state.diffId = k;
    state.diff = DIFF_PRESETS[k];
    // (legacy) 일부 UI/디버그에서 difficulty를 쓰는 경우를 대비해 동기화
    state.difficulty = state.diff.hpMul;
    try { refreshDiffUI(); } catch {}
    try { if (typeof setMsg === 'function') setMsg(`난이도: ${state.diff.name}`, 1.4); } catch {}
    try { if (typeof refreshUI === 'function') refreshUI(); } catch {}
  }

  // UI에서 프리셋 버튼 하이라이트 (DOM이 없으면 조용히 무시)
  function refreshDiffUI(){
    try {
      const k = (state && state.diffId) ? String(state.diffId) : "normal";
      const bE = document.getElementById("btnDiffEasy");
      const bN = document.getElementById("btnDiffNormal");
      const bH = document.getElementById("btnDiffHard");
      if (bE) bE.classList.toggle("active", k==="easy");
      if (bN) bN.classList.toggle("active", k==="normal");
      if (bH) bH.classList.toggle("active", k==="hard");
    } catch {}
  }

  // ---------- State ----------
  const state = {
    diffId: "normal",
    diff: DIFF_PRESETS.normal,
    difficulty: DIFF_PRESETS.normal.hpMul,
    speed: 1.0,
    cheat: false,
    god: false,
    gtime: 0,
    wave: 1,
    phase: "build", // build | wave | clear | finalprep | fail | win
    crystals: 80,
    selected: "basic",
    lastTime: nowSec(),
    time: 0,
    _finalBossJustDied: false,
win: null,
    stats: { runStart: nowSec(), runEnd: 0, finalWave: 0, kills: 0, damageTaken: 0, repairs: 0, turretBuilt: { basic:0, slow:0, splash:0, shred:0, breaker:0 } },

    hardError: "",
    uiMsg: "",
    uiMsgUntil: 0,

    // 연출/UX(저장 안 함): 웨이브/보스/패시브 등 중요한 순간에 중앙 카드 표시
    cine: {
      cards: []
    },

ui: {
  bgMode: 1,
  autoStartEnabled: false,  // 다음 웨이브 자동 시작(저장 안 함)

  upgTab: "all",        // all | core | turret | util
  upgSearch: "",
  upgOnlyCanBuy: false,
  upgSortMode: 0,       // 0 기본 | 1 비용↑ | 2 비용↓
  upgCollapse: { core:false, turret:false, util:false },
},

    autoStartDelay: 10.0,
    autoStartAt: 0,

// 최종전 준비(웨이브 30 직전)
finalPrepEndsAt: 0,
finalChoice: null, // "offense" | "defense"
final: null,       // 최종 보스 패턴 상태


    upg: {
      coreHp: 0,
      coreShield: 0,
      hpArmor: 0,
      shieldArmor: 0,
      shieldRegen: 0,
      energyCannon: 0,
      repair: 0,
      turretDmg: 0,
      turretFire: 0,
      turretRange: 0,
      slowPower: 0,
      splashRadius: 0,
      projSpeed: 0,
      turretCrit: 0,
      slowDuration: 0,
      // sellRefund(회수 효율 업그레이드) 제거됨
      aegisTune: 0,
      waveShield: 0,
    },

    enemies: [],
    turrets: [],
    projectiles: [],
    fx: [],

    flames: [],
    flameSpawnAcc: 0,

    debris: [],
    collapse: null, // {t, boomT, shake, fade}

    event: null,
    eventTextTimer: 0,

    mods: {
      shieldAbsorbMul: 1,
      shieldRegenMul: 1,
      turretDmgMul: 1,
      turretProjMul: 1,
      turretFireMul: 1,
      rewardMul: 1,
    },

    core: {
      hpMax: 420, hp: 420,
      shieldMax: 300, shield: 300,
      shieldRegen: 7,
      hpArmor: 2,
      shieldArmor: 2,

      // 코어 패시브(4택1)
      passiveId: null,        // "
      passiveLocked: false, // 재시작 전까지 패시브 변경 금지 ("rebuild" | "resonance" | "overload" | "overdrive")
      passiveStacks: 0,       // 공명 반격 스택
      passiveLastHitAt: -999, // 마지막 피격(스택 유지/감소용)
      passiveStackDecayAcc: 0,
      overdriveShotAcc: 0,      // 코어 오버드라이브 발사 누적
      passiveSalvageThisWave: 0, // 회수 프로토콜: 이번 웨이브 추가 획득량
      hpDirectDamaged: false, // HP에 "직접" 피해를 입은 적이 있으면 true (재건 코어 자동수리 조건)
      // 자동 회복 옵션
      // - 사용자가 원하시면 true로 바꾸면, 웨이브가 아닌 구간에서 HP가 천천히 회복됩니다.
      passiveHpRegenEnabled: false,
      // - 보호막 자동 재생을 웨이브 중에만 하려면 false (현재 기본 false)
      shieldRegenOutOfWave: false,
// 최종 보스 패턴 등으로 일시적으로 보호막 재생이 차단될 수 있음
shieldRegenBlockedUntil: 0,
// 실드/수리/포탑 EMP 디버프(적/보스 패턴)
repairBlockedUntil: 0,
empUntil: 0,
empMul: 0.75,
      // 웨이브 30(최종전): 수정탑 에너지 집속 연출(시각효과용)
      finalCharge: 0,
      finalChargeAcc: 0,
      finalChargeOrbs: [],



      // ----- Repair (HP 회복) -----
      // 자동 수리: build/clear 단계에서, 최근 HP 피해 후 일정 시간 지나면 초당 회복
      hpRegenPerSec: 6,
      hpRegenDelay: 4.0,
      lastHpDamageAt: -999,

      // 수리 버튼/키(F): 자원 소모 + 즉시 회복 + 쿨다운
      repairCost: 20,
      repairAmount: 90,
      repairCd: 12.0,
      repairReadyAt: 0,
      energyCd: 40.0,
      energyReadyAt: 0,


      energyDmg: 800,
      energyChargeDur: 3.0,
      energyCharging: false,
      energyChargeStartAt: 0,
      energyChargeUntil: 0,
      energyChargeFxAt: 0,
      energyLock: null,
      aegisCd: 18.0,
      aegisReadyAt: 0,
      aegisActiveUntil: 0,

      // ----- Overload (임계 과부하) burst/mark -----
      overloadBurstUntil: 0,
      overloadBurstReadyAt: 0,
      overloadWasAbove30: true,
      overloadExtendReadyAt: 0,
      overloadKickReadyAt: 0,
    },

    spawn: null
  };

  // ---------- Performance caps (모바일 렉 방지) ----------
  function isNarrowScreen(){ return (detectMobile && detectMobile()) || window.innerWidth <= 640; }

  function enemyCap(){
    if (state.wave === 30) return isNarrowScreen() ? 55 : 70; // 최종전은 특히 제한
    return isNarrowScreen() ? 85 : 110;
  }
  function projCap(){
    if (state.wave === 30) return isNarrowScreen() ? 140 : 220;
    return isNarrowScreen() ? 220 : 320;
  }


  // ---------- Time (real vs game) ----------
  function gameSec(){ return state.gtime; }

  function setSpeed(v){
    state.speed = clamp(v, 0.25, 8);
    if (btnSpeed) btnSpeed.textContent = `배속 ${state.speed.toFixed(2).replace(/\.00$/,".0")}x`;
  }

  function cycleSpeed(){
    const steps = [0.5, 1, 1.5, 2, 3, 4];
    const cur = state.speed;
    let i = steps.findIndex(s => Math.abs(s-cur) < 0.01);
    if (i < 0) i = 1;
    i = (i + 1) % steps.length;
    setSpeed(steps[i]);
    setMsg(`배속: ${state.speed.toFixed(2).replace(/\.00$/,".0")}x`, 1.8);
  }

  function toggleCheat(){
    state.cheat = !state.cheat;
    setMsg(state.cheat ? "치트 ON (T로 끄기)" : "치트 OFF", 2.0);
    syncCheatButtons();
  }

  function cheatGuard(){
    if (!state.cheat) { setMsg("치트가 OFF 입니다. (T)", 1.6); return false; }
    return true;
  }

  function cheatAddCrystals(n=500){
    if (!cheatGuard()) return;
    state.crystals += (n|0);
    setMsg(`크리스탈 +${n}`, 1.8);
  }

  function cheatHealHP(){
    if (!cheatGuard()) return;
    state.core.hp = state.core.hpMax;
    setMsg("HP 풀회복", 1.8);
  }

  function cheatRefillShield(){
    if (!cheatGuard()) return;
    state.core.shield = state.core.shieldMax;
    setMsg("보호막 풀충전", 1.8);
  }

  function cheatKillAll(){
    if (!cheatGuard()) return;
    const n = state.enemies.length;
    state.enemies.length = 0;
    state.projectiles = state.projectiles.filter(p=>p.kind !== "enemy");
    setMsg(`적 제거: ${n}마리`, 1.8);
  }

  function cheatSkipWave(){
    if (!cheatGuard()) return;
    if (state.phase === "wave") {
      cheatKillAll();
      clearWave();
    } else if (state.phase === "build" || state.phase === "clear" || state.phase === "finalprep") {
      startWave();
    }
    setMsg("웨이브 스킵", 1.8);
  }

  function cheatMaxUpgrades(){
    if (!cheatGuard()) return;
    for (const def of UPGRADE_DEFS) state.upg[def.id] = def.max;
    applyUpgrades();
    setMsg("업그레이드 MAX", 2.0);
  }

  function toggleGod(){
    if (!cheatGuard()) return;
    state.god = !state.god;
    setMsg(state.god ? "무적 ON" : "무적 OFF", 2.0);
  }

  // 치트: 현재 선택된 코어 패시브를 "100%" 상태로 강제
  // - 공명: 게이지 100%(즉시 방출 가능)
  // - 과부하: 버스트 즉시 발동
  // - 재건: 긴급 보강 즉시 발동
  // - 오버드라이브: 8초간 최대 출력(HP와 무관)
  function cheatPassiveFull(){
    if (!cheatGuard()) return;
    const id = state.core.passiveId;
    const t = gameSec();
    if (!id) {
      setMsg("패시브가 선택되지 않았습니다.", 1.8);
      return;
    }

    if (id === "resonance") {
      resonanceEnsure();
      state.core.resGauge = 100;
      state.core.resDischargeReadyAt = 0;
      setMsg("공명 게이지 100%", 1.8);
      return;
    }

    if (id === "overload") {
      overloadEnsure();
      state.core.overloadBurstReadyAt = 0;
      overloadShockBurst();
      setMsg("과부하 버스트 발동", 1.8);
      return;
    }

    if (id === "rebuild") {
      const dur = (state.wave === FINAL_WAVE) ? 1.9 : 1.5;
      state.core.rebuildEmergencyUntil = t + dur;
      state.core.rebuildEmergencyReadyAt = t + 7.0;
      fxText("긴급 보강!(치트)", CORE_POS.x, CORE_POS.y - 128, "#93c5fd");
      fxRing(CORE_POS.x, CORE_POS.y, CORE_RADIUS+10, CORE_RADIUS+150, "#93c5fd");
      try { cineToast("재건 코어", `긴급 보강 ${dur.toFixed(1)}s`, "#60a5fa", 1.05); } catch {}
      setMsg("긴급 보강 발동", 1.8);
      return;
    }

    if (id === "overdrive") {
      state.core.overdriveCheatUntil = t + 8.0;
      fxText("오버드라이브!(치트)", CORE_POS.x, CORE_POS.y - 128, "#c4b5fd");
      fxRing(CORE_POS.x, CORE_POS.y, CORE_RADIUS+10, CORE_RADIUS+150, "#c4b5fd");
      try { cineToast("코어 오버드라이브", "최대 출력 8s", "#a78bfa", 1.05); } catch {}
      setMsg("오버드라이브 최대 출력 8s", 1.8);
      return;
    }

    setMsg("패시브 100% (치트)", 1.8);
  }

  // ---------- Upgrades ----------
  const CORE_BASE = {
    hpMax: state.core.hpMax,
    shieldMax: state.core.shieldMax,
    shieldRegen: state.core.shieldRegen,
    hpArmor: state.core.hpArmor,
    shieldArmor: state.core.shieldArmor,
    repairCost: state.core.repairCost,
    repairAmount: state.core.repairAmount,
    repairCd: state.core.repairCd,
    // 에너지포(스킬) 기본값
    energyDmg: state.core.energyDmg,
    energyChargeDur: state.core.energyChargeDur,
    energyCd: state.core.energyCd,
    aegisCd: state.core.aegisCd,
  };

  const UPGRADE_DEFS = [
    { id:"coreHp", cat:"core", name:"본체 내구(HP)", max:5, base:55, grow:1.55, desc:(lv)=>`최대 HP +${40*lv}`, apply(){ state.core.hpMax = CORE_BASE.hpMax + 40*state.upg.coreHp; } },
    { id:"coreShield", cat:"core", name:"보호막 용량", max:5, base:55, grow:1.55, desc:(lv)=>`최대 보호막 +${30*lv}`, apply(){ state.core.shieldMax = CORE_BASE.shieldMax + 30*state.upg.coreShield; } },
    { id:"hpArmor", cat:"core", name:"방어력", max:5, base:60, grow:1.60, desc:(lv)=>`방어력 +${2*lv}`, apply(){ state.core.hpArmor = CORE_BASE.hpArmor + 2*state.upg.hpArmor; } },
    { id:"shieldArmor", cat:"core", name:"보호막 방어력", max:5, base:60, grow:1.60, desc:(lv)=>`보호막 방어력 +${2*lv}`, apply(){ state.core.shieldArmor = CORE_BASE.shieldArmor + 2*state.upg.shieldArmor; } },
    { id:"shieldRegen", cat:"core", name:"보호막 재생", max:5, base:70, grow:1.60, desc:(lv)=>`재생 +${(0.8*lv).toFixed(1)}/s`, apply(){ state.core.shieldRegen = CORE_BASE.shieldRegen + 0.8*state.upg.shieldRegen; } },

    { id:"repair", cat:"core", name:"수리 공학", max:6, base:75, grow:1.62,
      desc:(lv)=>`회복 +${15*lv} / 비용 -${2*lv} / 쿨 -${1*lv}s`,
      apply(){
        const lv = state.upg.repair;
        state.core.repairAmount = CORE_BASE.repairAmount + 15*lv;
        state.core.repairCost   = Math.max(8, CORE_BASE.repairCost - 2*lv);
        state.core.repairCd     = Math.max(6, CORE_BASE.repairCd - 1*lv);
      } },

    { id:"turretDmg", cat:"turret", name:"포탑 화력", max:6, base:80, grow:1.62, desc:(lv)=>`피해 +${Math.round(15*lv)}%`, apply(){} },
    { id:"turretFire", cat:"turret", name:"포탑 연사", max:6, base:80, grow:1.62, desc:(lv)=>`연사 +${Math.round(10*lv)}%`, apply(){} },
    { id:"turretRange", cat:"turret", name:"포탑 사거리", max:6, base:70, grow:1.58, desc:(lv)=>`사거리 +${12*lv}`, apply(){} },

    { id:"projSpeed", cat:"turret", name:"탄속 가속", max:5, base:65, grow:1.58, desc:(lv)=>`탄속 +${Math.round(15*lv)}%`, apply(){} },
    { id:"turretCrit", cat:"turret", name:"치명타", max:5, base:75, grow:1.60, desc:(lv)=>`치명타 확률 +${2*lv}% (x1.5)`, apply(){} },

    { id:"waveShield", cat:"core", name:"개전 과충전", max:5, base:70, grow:1.60, desc:(lv)=>`웨이브 시작 시 보호막 +${20*lv}`, apply(){} },
    { id:"slowDuration", cat:"turret", name:"둔화 지속", max:5, base:60, grow:1.55, desc:(lv)=>`둔화 지속 +${(0.25*lv).toFixed(2)}s`, apply(){} },
    { id:"aegisTune", cat:"core", name:"아이기스 튜닝", max:6, base:85, grow:1.62,
      desc:(lv)=>`긴급 보호막 쿨 -${(1.5*lv).toFixed(1)}s`,
      apply(){
        const lv = state.upg.aegisTune;
        state.core.aegisCd = Math.max(6, CORE_BASE.aegisCd - 1.5*lv);
      } },

    // 에너지포 업그레이드: 레벨에 따라 피해/충전/쿨을 개량 (총 6레벨)
    { id:"energyCannon", cat:"core", name:"에너지포 개량", max:6, base:95, grow:1.62,
      // 업그레이드 UI에서 "현재/다음"을 보여주기 위해, lv(현재 레벨)에 해당하는 '현재 스탯'을 반환합니다.
      desc:(lv)=>{
        const L = clamp(lv|0, 0, 6);
        // 기본값
        let dmg = CORE_BASE.energyDmg;
        let charge = CORE_BASE.energyChargeDur;
        let cd = CORE_BASE.energyCd;

        if (L >= 1) dmg = CORE_BASE.energyDmg + 100;
        if (L >= 4) dmg = CORE_BASE.energyDmg + 200;

        if (L >= 2) charge = CORE_BASE.energyChargeDur - 0.4;
        if (L >= 5) charge = CORE_BASE.energyChargeDur - 0.8;

        if (L >= 3) cd = CORE_BASE.energyCd - 5;
        if (L >= 6) cd = CORE_BASE.energyCd - 10;

        return `피해 ${dmg} / 충전 ${Math.max(1.2, charge).toFixed(1)}s / 쿨 ${Math.max(8, cd)}s`;
      },
      apply(){
        const lv = (state.upg.energyCannon|0);

        // 기본값
        let dmg = CORE_BASE.energyDmg;
        let charge = CORE_BASE.energyChargeDur;
        let cd = CORE_BASE.energyCd;

        if (lv >= 1) dmg = CORE_BASE.energyDmg + 100;
        if (lv >= 4) dmg = CORE_BASE.energyDmg + 200;

        if (lv >= 2) charge = CORE_BASE.energyChargeDur - 0.4;
        if (lv >= 5) charge = CORE_BASE.energyChargeDur - 0.8;

        if (lv >= 3) cd = CORE_BASE.energyCd - 5;
        if (lv >= 6) cd = CORE_BASE.energyCd - 10;

        state.core.energyDmg = dmg;
        state.core.energyChargeDur = Math.max(1.2, charge);
        state.core.energyCd = Math.max(8, cd);
      } },

    { id:"slowPower", cat:"turret", name:"슬로우 강화", max:5, base:65, grow:1.58, desc:(lv)=>`둔화 +${Math.round(6*lv)}%`, apply(){} },
    { id:"splashRadius", cat:"turret", name:"스플래시 반경", max:5, base:65, grow:1.58, desc:(lv)=>`반경 +${8*lv}`, apply(){} },

    // 신규 포탑 전용 업그레이드
    { id:"shredFocus", cat:"turret", name:"실드 분쇄 강화", max:5, base:75, grow:1.60,
      desc:(lv)=>`보호막 추가피해 배율 +${(0.15*lv).toFixed(2)}`, apply(){} },
    { id:"breakerMark", cat:"turret", name:"취약 표식 강화", max:5, base:80, grow:1.60,
      desc:(lv)=>`받피증 +${Math.round(3*lv)}% / 지속 +${(0.2*lv).toFixed(1)}s`, apply(){} },
  ];

  function upgCost(def){
    const lv = state.upg[def.id];
    const cost = def.base * Math.pow(def.grow, lv);
    return Math.round(cost/5)*5;
  }

  function applyUpgrades(){
    // base -> upgraded
    for (const def of UPGRADE_DEFS) def.apply();
    // clamp current values to new max
    state.core.hp = clamp(state.core.hp, 0, state.core.hpMax);
    state.core.shield = clamp(state.core.shield, 0, state.core.shieldMax);
  }

  function buyUpgrade(id){
    const def = UPGRADE_DEFS.find(d=>d.id===id);
    if (!def) return;
    const lv = state.upg[id];
    if (lv >= def.max) return;

    const cost = upgCost(def);
    if (state.crystals < cost) return;

    state.crystals -= cost;
    state.upg[id]++;

    applyUpgrades();
    SFX.play("click");
    setMsg(`업그레이드 완료: ${def.name} (-${cost})`, 1.8);
    fxText(`강화: ${def.name}`, CORE_POS.x, CORE_POS.y - 92, "#93c5fd");
  }

function ensureUpgUI(){
  if (!state.ui) {
    state.ui = { upgTab:"all", upgSearch:"", upgOnlyCanBuy:false, upgSortMode:0, upgCollapse:{core:false,turret:false,util:false}, upgPanelCollapsed:{pc:false, side:false} };
  }
  if (!state.ui.upgCollapse) state.ui.upgCollapse = { core:false, turret:false, util:false };
  if (!state.ui.upgPanelCollapsed) state.ui.upgPanelCollapsed = { pc:false, side:false };
  if (!("upgOnlyCanBuy" in state.ui)) state.ui.upgOnlyCanBuy = false;
  if (!("upgSortMode" in state.ui)) state.ui.upgSortMode = 0;
  if (!state.ui.upgTab) state.ui.upgTab = "all";
  if (state.ui.upgSearch == null) state.ui.upgSearch = "";
  if (!("pc" in state.ui.upgPanelCollapsed)) state.ui.upgPanelCollapsed.pc = false;
  if (!("side" in state.ui.upgPanelCollapsed)) state.ui.upgPanelCollapsed.side = false;
}

function sortLabel(mode){
  return mode === 1 ? "비용↑" : mode === 2 ? "비용↓" : "기본";
}

function syncUpgControls(){
  const ui = state.ui;
  const wraps = [document.getElementById("uiUpgrades"), document.getElementById("uiUpgradesPC")].filter(Boolean);
  for (const w of wraps){
    // tabs
    const tabs = w.querySelectorAll("[data-upg-tab]");
    tabs.forEach(btn=>{
      btn.classList.toggle("active", btn.dataset.upgTab === ui.upgTab);
    });
    // search
    const inp = w.querySelector("[data-upg-search]");
    if (inp && inp.value !== ui.upgSearch) inp.value = ui.upgSearch;
    // only
    const onlyBtn = w.querySelector("[data-upg-only]");
    if (onlyBtn) onlyBtn.textContent = `구매가능만: ${ui.upgOnlyCanBuy ? "ON" : "OFF"}`;
    // sort
    const sortBtn = w.querySelector("[data-upg-sort]");
    if (sortBtn) sortBtn.textContent = `정렬: ${sortLabel(ui.upgSortMode)}`;
  }

  const panels = [
    { key: "pc", el: document.getElementById("upgPanelPC") },
    { key: "side", el: document.getElementById("upgPanelSide") },
  ];
  for (const { key, el } of panels) {
    if (!el) continue;
    const collapsed = !!(ui.upgPanelCollapsed && ui.upgPanelCollapsed[key]);
    el.classList.toggle("collapsed", collapsed);
    const btn = el.querySelector(`[data-upg-panel-toggle="${key}"]`);
    if (btn) {
      btn.textContent = collapsed ? "펼치기" : "접기";
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
  }
}

function renderUpgrades(){
  if (!upgContainers || upgContainers.length === 0) return;
  ensureUpgUI();

  const ui = state.ui;
  const q = (ui.upgSearch || "").trim().toLowerCase();

  const canBuyOf = (def) => {
    const lv = state.upg[def.id];
    const cost = upgCost(def);
    const enough = (state.crystals >= cost);
    return (lv < def.max) && enough && (state.phase !== "fail") && (state.phase !== "win");
  };

  const match = (def) => {
    if (ui.upgTab !== "all" && def.cat !== ui.upgTab) return false;
    if (ui.upgOnlyCanBuy && !canBuyOf(def)) return false;
    if (!q) return true;
    const hay = `${def.name} ${def.cat || ""}`.toLowerCase();
    return hay.includes(q);
  };

  // 필터 + 정렬 준비
  const filtered = UPGRADE_DEFS.filter(match);

  const sortMode = ui.upgSortMode|0;
  const sorter = (a,b) => {
    if (sortMode === 1) return upgCost(a) - upgCost(b);
    if (sortMode === 2) return upgCost(b) - upgCost(a);
    return 0; // 기본(정의 순서 유지)
  };

  const CAT_META = [
    ["core",   "코어 강화"],
    ["turret", "포탑/전투"],
    ["util",   "유틸/경제"],
  ];

  const totalByCat = {};
  for (const def of UPGRADE_DEFS) totalByCat[def.cat] = (totalByCat[def.cat]||0) + 1;

  let out = "";
  for (const [cat, title] of CAT_META) {
    const defs = filtered.filter(d=>d.cat===cat);
    if (!defs.length) continue;

    // 정렬(기본이면 안정 정렬 유지)
    const list = (sortMode === 0) ? defs : defs.slice().sort(sorter);

    const collapsed = !!(ui.upgCollapse && ui.upgCollapse[cat]);

    out += `<div class="upgSection ${collapsed ? "collapsed" : ""}" data-upg-sec="${cat}">
      <div class="upgSectionHeader" data-upg-toggle="${cat}">
        <div>${title}</div>
        <div style="display:flex; gap:10px; align-items:center;">
          <div class="count">${defs.length}/${totalByCat[cat]||defs.length}</div>
          <div class="chev">${collapsed ? "▶" : "▼"}</div>
        </div>
      </div>
      <div class="upgGrid">
    `;

    for (const def of list) {
      const lv = state.upg[def.id];
      const max = def.max;
      const cost = upgCost(def);
      const enough = (state.crystals >= cost);
      const canBuy = canBuyOf(def);

      const descCur = def.desc(lv);
      const descNext = (lv >= max) ? "MAX" : def.desc(lv + 1);

      const rowClass = canBuy ? "upgRow canBuy" : "upgRow disabled";
      const btnLabel = (lv >= max) ? "MAX" : `${cost}`;
      const btnDisabled = (lv >= max) || (!enough) || (state.phase === "fail") || (state.phase === "win");
      const btnClass = btnDisabled ? "miniBtn isDisabled" : "miniBtn";

      const hint = (lv >= max)
        ? "최대 레벨입니다."
        : (!enough ? `자원 부족 (필요 ${cost}, 보유 ${state.crystals})` : (state.phase === "win" ? "클리어 후에는 강화할 수 없습니다." : "구매 가능"));

      out += `
        <div class="${rowClass}" data-upg="${def.id}" data-can="${canBuy ? 1 : 0}" title="${hint}">
          <div class="upgTop">
            <div class="upgNameLine">
              <b>${def.name}</b>
              <span class="muted">Lv ${lv}/${max}</span>
            </div>
            <button class="${btnClass}">${btnLabel}</button>
          </div>
          <div class="upgDesc">
            <div><span class="muted">현재</span> ${descCur}</div>
            <div><span class="muted">다음</span> ${descNext}</div>
          </div>
        </div>
      `;
    }

    out += `</div></div>`;
  }

  // 아무것도 없을 때
  if (!out) {
    out = `<div class="muted" style="padding:10px; opacity:0.8;">조건에 맞는 업그레이드가 없습니다.</div>`;
  }

  for (const el of upgContainers) el.innerHTML = out;
  syncUpgControls();
}

  // ---------- UI ----------
  const uiStats = document.getElementById("uiStats");
    const uiCrystals = document.getElementById("uiCrystals");
  // HUD (상단 오버레이)
  const hudWave = document.getElementById("hudWave");
  const hudHpFill = document.getElementById("hudHpFill");
  const hudHpText = document.getElementById("hudHpText");
    const hudHpRow = (hudHpFill && hudHpFill.closest) ? hudHpFill.closest(".hudBarRow") : null;
const hudShFill = document.getElementById("hudShFill");
  const hudShText = document.getElementById("hudShText");
  const hudArmor = document.getElementById("hudArmor");
  const hudShArmor = document.getElementById("hudShArmor");
  const hudMeta = document.getElementById("hudMeta");
  const hudPassiveText = document.getElementById("hudPassiveText");
  const hudPassiveFill = document.getElementById("hudPassiveFill");
  const hudStatusRow = document.getElementById("hudStatusRow");

const uiMsg   = document.getElementById("uiMsg");
const uiCheat = document.getElementById("uiCheat");
const uiUpgradesWrap = document.getElementById("uiUpgrades");
const uiUpgradesPCWrap = document.getElementById("uiUpgradesPC");
const upgPanelPC = document.getElementById("upgPanelPC");
const upgPanelSide = document.getElementById("upgPanelSide");
const uiUpgListSide = document.getElementById("uiUpgListSide") || uiUpgradesWrap;
const uiUpgListPC   = document.getElementById("uiUpgListPC")   || uiUpgradesPCWrap;
const upgContainers = [uiUpgListSide, uiUpgListPC].filter(Boolean);
const upgWraps = [uiUpgradesWrap, uiUpgradesPCWrap].filter(Boolean);

// 업그레이드 UI 컨트롤(탭/검색/토글/섹션 접기)
function bindUpgradeControls(){
  ensureUpgUI();

  for (const w of upgWraps){
    if (!w || w.__upgCtlBound) continue;
    w.__upgCtlBound = true;

    // 클릭: 탭/토글 버튼
    w.addEventListener("click", (ev)=>{
      const tabBtn = ev.target.closest("[data-upg-tab]");
      if (tabBtn) {
        ev.preventDefault(); ev.stopPropagation();
        ensureUpgUI();
        state.ui.upgTab = tabBtn.dataset.upgTab || "all";
        window.__upgLastRenderAt = 0;
        refreshUI();
        return;
      }

      const onlyBtn = ev.target.closest("[data-upg-only]");
      if (onlyBtn) {
        ev.preventDefault(); ev.stopPropagation();
        ensureUpgUI();
        state.ui.upgOnlyCanBuy = !state.ui.upgOnlyCanBuy;
        window.__upgLastRenderAt = 0;
        refreshUI();
        return;
      }

      const sortBtn = ev.target.closest("[data-upg-sort]");
      if (sortBtn) {
        ev.preventDefault(); ev.stopPropagation();
        ensureUpgUI();
        state.ui.upgSortMode = ((state.ui.upgSortMode|0) + 1) % 3;
        window.__upgLastRenderAt = 0;
        refreshUI();
        return;
      }

      const panelBtn = ev.target.closest("[data-upg-panel-toggle]");
      if (panelBtn) {
        ev.preventDefault(); ev.stopPropagation();
        ensureUpgUI();
        const key = panelBtn.dataset.upgPanelToggle;
        if (key) {
          state.ui.upgPanelCollapsed[key] = !state.ui.upgPanelCollapsed[key];
          window.__upgLastRenderAt = 0;
          refreshUI();
        }
        return;
      }
    }, { capture:true });

    // 검색
    const inp = w.querySelector("[data-upg-search]");
    if (inp && !inp.__bound) {
      inp.__bound = true;
      inp.addEventListener("input", ()=>{
        ensureUpgUI();
        state.ui.upgSearch = inp.value || "";
        window.__upgLastRenderAt = 0;
        refreshUI();
      });
      // 패널/캔버스로 입력이 새지 않게
      inp.addEventListener("pointerdown", (ev)=>{ ev.stopPropagation(); }, { capture:true });
      inp.addEventListener("keydown", (ev)=>{
        if (ev.key === "Escape") {
          inp.value = "";
          ensureUpgUI();
          state.ui.upgSearch = "";
          window.__upgLastRenderAt = 0;
          refreshUI();
        }
      });
    }
  }

  // 섹션 접기/펼치기(리스트 내부 요소이므로 위임)
  for (const list of upgContainers){
    if (!list || list.__upgListBound) continue;
    list.__upgListBound = true;
    list.addEventListener("click", (ev)=>{
      const t = ev.target.closest("[data-upg-toggle]");
      if (!t) return;
      ev.preventDefault(); ev.stopPropagation();
      ensureUpgUI();
      const cat = t.dataset.upgToggle;
      if (!cat) return;
      state.ui.upgCollapse[cat] = !state.ui.upgCollapse[cat];
      window.__upgLastRenderAt = 0;
      refreshUI();
    }, { capture:true });
  }
}
bindUpgradeControls();

document.addEventListener("keydown", (ev)=>{
  if (ev.key !== "/") return;
  if (ev.target && (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA")) return;
  ensureUpgUI();
  const pickSearch = () => {
    if (upgPanelPC && !state.ui.upgPanelCollapsed.pc && upgPanelPC.offsetParent) {
      const input = upgPanelPC.querySelector("[data-upg-search]");
      if (input) return input;
    }
    if (upgPanelSide && !state.ui.upgPanelCollapsed.side && upgPanelSide.offsetParent) {
      const input = upgPanelSide.querySelector("[data-upg-search]");
      if (input) return input;
    }
    return document.querySelector("[data-upg-search]");
  };
  const input = pickSearch();
  if (input) {
    ev.preventDefault();
    input.focus();
  }
});

  const uiEvent = document.getElementById("uiEvent");
  const uiRecords = document.getElementById("uiRecords");
  const btnResetRecords = document.getElementById("btnResetRecords");

  const uiPreview = document.getElementById("uiPreview");

  const btnCoreRebuild   = document.getElementById("btnCoreRebuild");
  const btnCoreResonance = document.getElementById("btnCoreResonance");
  const btnCoreOverload  = document.getElementById("btnCoreOverload");
  const btnCoreOverdrive = document.getElementById("btnCoreOverdrive");
  const uiCorePassiveDesc = document.getElementById("uiCorePassiveDesc");
  // (PC) 코어 패시브 상태 표시: 상단 미선택 배지 삭제됨
  const uiCorePassiveChosenWrap = document.getElementById("uiCorePassiveChosenWrap");
  const uiCorePassiveChosenName = document.getElementById("uiCorePassiveChosenName");
  const uiCorePassiveChosenTag  = document.getElementById("uiCorePassiveChosenTag");
const finalSupportPanel = document.getElementById("finalSupportPanel");
const btnFinalOffense   = document.getElementById("btnFinalOffense");
const btnFinalDefense   = document.getElementById("btnFinalDefense");
const uiFinalSupportDesc = document.getElementById("uiFinalSupportDesc");

// ===== Run Records (localStorage) =====
const RECORD_KEY = "shield_defense_records_v1";
let __records = null;
let __recordsLastRenderAt = 0;

function loadRecords(){
  try {
    const raw = localStorage.getItem(RECORD_KEY);
    if (!raw) return { bestRun:null, lastRun:null };
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return { bestRun:null, lastRun:null };
    if (!("bestRun" in obj)) obj.bestRun = null;
    if (!("lastRun" in obj)) obj.lastRun = null;
    return obj;
  } catch(e) {
    return { bestRun:null, lastRun:null };
  }
}

function saveRecords(){
  try { localStorage.setItem(RECORD_KEY, JSON.stringify(__records||{bestRun:null,lastRun:null})); } catch(e) {}
}

function passiveName(pid){
  try {
    if (!pid) return "미선택";
    const d = CORE_PASSIVES && CORE_PASSIVES[pid];
    return d ? d.name : String(pid);
  } catch(e) { return pid || "미선택"; }
}

function turretRatioText(tb){
  const keys = ["basic","slow","splash","shred","breaker"];
  const names = { basic:"기본", slow:"감속", splash:"스플래시", shred:"실드분쇄", breaker:"방호파괴" };
  const total = keys.reduce((a,k)=> a + ((tb && tb[k])|0), 0);
  if (!total) return "없음";
  const parts = keys
    .map(k=> ({k, n: (tb && tb[k])|0}))
    .filter(x=> x.n>0)
    .sort((a,b)=> b.n-a.n)
    .map(x=>{
      const pct = Math.round((x.n/total)*100);
      return `${names[x.k]||x.k} ${pct}%(${x.n})`;
    });
  return parts.join(" · ");
}

function buildRunSummary(isWin){
  const wave = isWin ? FINAL_WAVE : (state.wave|0);
  const time = Math.max(0, state.gtime||0);
  const passive = state.core ? (state.core.passiveId||null) : null;
  const tb = (state.stats && state.stats.turretBuilt) ? state.stats.turretBuilt : null;
  const turretBuilt = {
    basic: (tb && tb.basic)|0,
    slow: (tb && tb.slow)|0,
    splash: (tb && tb.splash)|0,
    shred: (tb && tb.shred)|0,
    breaker: (tb && tb.breaker)|0,
  };
  return {
    at: Date.now(),
    win: !!isWin,
    wave,
    time,
    passive,
    turretBuilt
  };
}

function updateRecordsWithRun(run){
  if (!__records) __records = loadRecords();
  __records.lastRun = run;

  const best = __records.bestRun;
  const better =
    (!best) ||
    (run.wave > (best.wave|0)) ||
    (run.wave === (best.wave|0) && run.time < (best.time||1e18));
  if (better) __records.bestRun = run;

  saveRecords();
}

function renderRecords(force=false){
  if (!uiRecords) return;
  if (!__records) __records = loadRecords();

  const tNow = nowSec();
  if (!force && (tNow - __recordsLastRenderAt) < 0.6) return;
  __recordsLastRenderAt = tNow;

  const best = __records.bestRun;
  const last = __records.lastRun;

  const lines = [];
  if (best) {
    lines.push(`<b>최고 웨이브</b>: WAVE ${best.wave} · ${formatTime(best.time||0)} · ${passiveName(best.passive)}`);
    lines.push(`<span class="small">포탑 비율: ${turretRatioText(best.turretBuilt)}</span>`);
  } else {
    lines.push("아직 저장된 기록이 없습니다.");
    lines.push(`<span class="small">한 판 플레이하면 자동 저장됩니다.</span>`);
  }

  if (last) {
    const sep = `<div style="height:8px;"></div>`;
    lines.push(sep + `<b>마지막 런</b>: WAVE ${last.wave} · ${formatTime(last.time||0)} · ${passiveName(last.passive)} ${last.win ? "(승리)" : "(실패)"}`);
    lines.push(`<span class="small">포탑 비율: ${turretRatioText(last.turretBuilt)}</span>`);
  }

  uiRecords.innerHTML = lines.join("<br>");
}

if (btnResetRecords) {
  btnResetRecords.onclick = ()=>{
    try {
      __records = { bestRun:null, lastRun:null };
      saveRecords();
      renderRecords(true);
      try { SFX.play("click"); } catch(e) {}
      state.uiMsg = "런 기록이 초기화되었습니다.";
      state.uiMsgUntil = nowSec() + 2.0;
    } catch(e) {}
  };
}
// ===== End Records =====



    const CORE_PASSIVES = {
    rebuild: {
      id:"rebuild", name:"재건 코어", colorClass:"passiveBlue",
      desc:[
        "저체력(HP 70%↓)부터 피해감소가 붙습니다. (10%에서 최대 -12%)",
        "실드가 깨지면 짧은 시간 ‘긴급 보강’(피해 -38%)이 발동합니다. (쿨 7초)",
        "보호막 재생 +15% (최종전 추가 +10%)",
        "저체력일수록 방어/보호막방어가 증가합니다. (최대 방어 +15 / 보호막방어 +7.5)",
        "HP 자동 수리가 강화됩니다. (저체력일수록 회복량↑ / 최종전 딜레이↓)"
      ]
    },
    resonance: {
      id:"resonance", name:"공명 반격 코어", colorClass:"passiveOrange",
      desc:[
        "보호막이 흡수한 피해로 ‘공명 게이지’가 차오릅니다.",
        "게이지에 따라 포탑 피해/공속이 증가합니다. (최대 피해 +30%, 공속 +18%)",
        "게이지 100%가 되면 최근 흡수량 기반의 ‘공명 방출’이 자동 발동합니다.",
        "방출 시 주변 확산 피해 + ‘노출’(받는 피해↑) 디버프가 걸립니다.",
	        "피격 후 즉시 반격하는 타입이 아니라, 누적→방출형 패시브입니다."
      ]
    },
    overload: {
      id:"overload", name:"임계 과부하", colorClass:"passiveRed",
      desc:[
        "HP 30%↓ 진입 시(내려올 때) 쇼크웨이브(넉백+둔화 0.6s) + 과부하 버스트 6s 발동 (쿨 18s)",
        "포탑 적중 시 표식(최대 5중첩/4s 갱신): 일반/엘리트 +3%p×중첩, 보스/최종보스 +1.5%p×중첩",
        "버스트 6초: 포탑 탄 관통 +1 / (스플래시 없는 포탑은) 90px 소형 폭발(35%) 추가",
        "버스트 6초: 최종보스 ‘포탑 내성’ 25% 부분 무시 + 투사체 붉은 트레일",
        "연계: HP≤40% 수리 시 주변 적(보스 우선) 표식 +2 / 버스트 남은 <2s면 +2s 연장(20s ICD) / 긴급 보호막 사용 시 다음 쿨 -6s(20s ICD)"
]
    },
    overdrive: {
      id:"overdrive", name:"코어 오버드라이브", colorClass:"passivePurple",
      desc:[
        "수정탑이 직접 적을 공격합니다.",
        "HP가 낮을수록 공격 속도와 공격력이 증가합니다.",
        "저체력 구간에서 보호막 재생이 증가합니다.",
        "저체력일수록 받는 피해가 소폭 감소합니다.",
        "에너지포가 광역 피해(30%)를 추가로 입힙니다."
      ]
    }
  };

  // ---------- Resonance core (공명 반격) ----------
  const RESONANCE_CFG = {
    // ✅ 공명 반격: 패널티 없이(쿨/상한으로만) 운영 + HP 피해도 충전(B안 확장)
    denomMul: 0.40,        // shieldMax * 0.40 를 100% 기준 흡수량으로(조금 더 잘 참)
    hitCap: 30,            // 1회 충전 상한(+%)
    secCap: 60,            // 1초 충전 상한(+%)
    hpMul: 0.60,           // HP 피해 환산 계수(공명 충전)
    decayWait: 4.0,        // 흡수 공백(초)
    decayPerSec: 4.0,      // 공백 이후 초당 감소(%p)
    dischargeCd: 2.5,      // 방출 쿨(초)
    dischargeMul: 1.05,    // 최근 흡수량의 105%
    dischargeCapMul: 3.00  // 방출 피해 상한(=shieldMax*3.0)
  };

  // ---------- Overload core (임계 과부하) ----------
  const OVERLOAD_CFG = {
    triggerHp: 0.30,
    shockR: 240,
    shockKnock: 78,
    shockSlowDur: 0.6,
    shockSlowMul: 0.55,
    burstDur: 6.0,
    burstCd: 18.0,

    markMax: 5,
    markDur: 4.0,
    markBonus: 0.03,       // normal/elite
    markBonusBoss: 0.015,  // boss/final

    burstPierceAdd: 1,
    miniSplashR: 90,
    miniSplashMul: 0.35,

    finalBossResistIgnore: 0.25,

    repairMarkHp: 0.40,
    repairMarkAdd: 2,
    repairMarkTargets: 4,

    extendIfRemainLt: 2.0,
    extendAdd: 2.0,
    extendIcd: 20.0,

    aegisCdReduce: 6.0,
    aegisIcd: 20.0,
  };


  function resonanceEnsure(){
    const c = state.core;
    if (typeof c.resGauge !== 'number') c.resGauge = 0;
    if (typeof c.resLastAbsorbAt !== 'number') c.resLastAbsorbAt = -999;
    if (typeof c.resChargeSecStartAt !== 'number') c.resChargeSecStartAt = gameSec();
    if (typeof c.resChargeThisSec !== 'number') c.resChargeThisSec = 0;
    if (typeof c.resDischargeReadyAt !== 'number') c.resDischargeReadyAt = 0;
    if (!Array.isArray(c.resAbsorbEvents)) c.resAbsorbEvents = [];
  }

  function resonanceReset(){
    const c = state.core;
    c.resGauge = 0;
    c.resLastAbsorbAt = -999;
    c.resChargeSecStartAt = gameSec();
    c.resChargeThisSec = 0;
    c.resDischargeReadyAt = 0;
    c.resAbsorbEvents = [];
  }

  function resonanceGauge01(){
    resonanceEnsure();
    return clamp((state.core.resGauge||0)/100, 0, 1);
  }

  function resonancePrune(){
    const c = state.core;
    if (!Array.isArray(c.resAbsorbEvents) || c.resAbsorbEvents.length === 0) return;
    const t = gameSec();
    // 5.7초 이상 지난 기록 제거(여유)
    let cut = 0;
    while (cut < c.resAbsorbEvents.length && (t - c.resAbsorbEvents[cut].t) > 5.7) cut++;
    if (cut > 0) c.resAbsorbEvents.splice(0, cut);
  }

  function resonanceRecentAbsSum(){
    const c = state.core;
    if (!Array.isArray(c.resAbsorbEvents) || c.resAbsorbEvents.length === 0) return 0;
    const t = gameSec();
    let sum = 0;
    for (let i = c.resAbsorbEvents.length - 1; i >= 0; i--) {
      const a = c.resAbsorbEvents[i];
      if ((t - a.t) > 5.5) break;
      sum += (a.v||0);
    }
    return sum;
  }

  function resonanceOnAbsorb(absAmt){
    if (state.core.passiveId !== 'resonance') return;
    resonanceEnsure();
    const c = state.core;
    const t = gameSec();
    c.resAbsorbEvents.push({ t, v: absAmt });
    c.resLastAbsorbAt = t;

    // 1회/초 상한 포함 충전
    if ((t - c.resChargeSecStartAt) >= 1.0) { c.resChargeSecStartAt = t; c.resChargeThisSec = 0; }
    const denom = Math.max(1, c.shieldMax * RESONANCE_CFG.denomMul);
    let add = (absAmt / denom) * 100;

    // ✅ 패널티 제거: 충전 효율 100% 고정

    add = Math.min(add, RESONANCE_CFG.hitCap);
    const room = RESONANCE_CFG.secCap - (c.resChargeThisSec||0);
    if (room <= 0) return;
    add = Math.min(add, room);
    if (add <= 0.01) return;
    c.resChargeThisSec += add;
    c.resGauge = clamp((c.resGauge||0) + add, 0, 100);
  }

  function resonancePenaltyHp(){ /* 패널티 제거됨 */ }


  function resonancePenaltyBreak(){ /* 패널티 제거됨 */ }


  function resonancePickTarget(){
    if (!state.enemies || state.enemies.length === 0) return null;
    // 보스 우선
    for (const e of state.enemies) {
      if (e && e.kind === 'boss' && e.hp > 0) return e;
    }
    // 그 외: 코어에 가장 가까운 적
    let best = null, bestD = 1e9;
    for (const e of state.enemies) {
      if (!e || e.hp <= 0) continue;
      const d = dist(e.x, e.y, CORE_POS.x, CORE_POS.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }
  function resonanceDischarge(){
    const c = state.core;
    const t = gameSec();
    const target = resonancePickTarget();
    if (!target) { c.resDischargeReadyAt = t + RESONANCE_CFG.dischargeCd; return; }

    resonancePrune();
    const recent = resonanceRecentAbsSum();

    // 메인 데미지(최근 5.5초 흡수량 기반)
    let dmg = recent * RESONANCE_CFG.dischargeMul;
    const cap = c.shieldMax * RESONANCE_CFG.dischargeCapMul;
    dmg = Math.min(dmg, cap);

    // 최소 보장(너무 약하게 느껴지는 상황 방지)
    dmg = Math.max(dmg, Math.max(c.shieldMax * 0.75, 40 + state.wave*3));

    // 최종보스 내성 로직만 적용(추가 감쇄 없음)
    if (target.isFinalBoss) dmg *= finalBossIncomingMul();

    const mainDmg = dmg;

    // 메인 타격 + 노출
    target.hp -= mainDmg;
    applyResExpose(target, 4.0);

    // 주변 확산 피해(190px)
    const R = 205;
    for (const e of state.enemies) {
      if (!e || e.hp <= 0 || e === target) continue;
      const d = dist(e.x, e.y, target.x, target.y);
      if (d > R) continue;
      const k = clamp(d / R, 0, 1);
      const fall = lerp(1.0, 0.40, k); // edge => 0.35
      let sdmg = mainDmg * 0.40 * fall; // center 0.35, edge 0.1225
      if (e.isFinalBoss) sdmg *= finalBossIncomingMul();
      e.hp -= sdmg;
      applyResExpose(e, 3.2);
    }

    // 연출: 다중 빔(2겹) + 링 2중 + 화면 플래시 + 카메라 흔들림
    fxLine(CORE_POS.x, CORE_POS.y, target.x, target.y, '#fb923c', 0.55, 10);
    fxLine(CORE_POS.x, CORE_POS.y, target.x, target.y, '#fdba74', 0.55, 3);
    fxRing(CORE_POS.x, CORE_POS.y, CORE_RADIUS+12, CORE_RADIUS+170, '#fdba74');
    fxRing(target.x, target.y, 10, 120, '#fdba74');
    fxRing(target.x, target.y, 16, 160, '#fb923c');

    fxText(`공명 방출! -${Math.round(mainDmg)}`, CORE_POS.x, CORE_POS.y - 128, '#fdba74');

    // 연출: 너무 자주 뜨지 않도록 3초 간격 제한
    if (t >= (c.resCineAt||0)) {
      try { cineToast("공명 방출", `피해 -${Math.round(mainDmg)}`, "#fdba74", 1.05); } catch {}
      c.resCineAt = t + 3.0;
    }

    state.resFlashX = target.x;
    state.resFlashY = target.y;
    state.resFlashDur = 0.16;
    state.resFlashUntil = t + state.resFlashDur;

    state.camShakeMag = 10;
    state.camShakeDur = 0.11;
    state.camShakeUntil = t + state.camShakeDur;

    try { SFX.play('blast'); } catch {}
    try { sfxShieldHit(); } catch {}

    // 끊김 완화: 0이 아니라 25% 남김
    c.resGauge = 25;
    c.resDischargeReadyAt = t + RESONANCE_CFG.dischargeCd;
  }

  function updateResonance(dt){
    if (state.core.passiveId !== 'resonance') return;
    if (state.phase !== "wave") return; // 대기시간에는 공명 게이지/자동방출 유지
    resonanceEnsure();
    const c = state.core;
    const t = gameSec();
    resonancePrune();

    // 흡수 공백 후 감쇠 (최종전은 유지시간을 조금 더 늘려 체감 강화)
    const since = t - (c.resLastAbsorbAt||-999);
    const isFinal = (state.wave === FINAL_WAVE);
    const decayWait = isFinal ? (RESONANCE_CFG.decayWait + 1.0) : RESONANCE_CFG.decayWait;
    const decayPerSec = isFinal ? (RESONANCE_CFG.decayPerSec * 0.60) : RESONANCE_CFG.decayPerSec;
    if (since > decayWait && (c.resGauge||0) > 0) {
      c.resGauge = clamp((c.resGauge||0) - decayPerSec*dt, 0, 100);
    }

    // 100% 도달 시 자동 방출
    if ((c.resGauge||0) >= 100 && t >= (c.resDischargeReadyAt||0)) {
      resonanceDischarge();
    }
  }


function passiveSelected(){ return !!state.core.passiveId; }

  // UI glow trigger guard
  let _lastCorePassiveShowId = null;
  let _lastCorePassiveConfirmedId = null;

  function pulseCorePassiveBox(){
    if (!uiCorePassiveChosenWrap) return;
    uiCorePassiveChosenWrap.classList.remove("glowPulse");
    // reflow to restart CSS animation
    void uiCorePassiveChosenWrap.offsetWidth;
    uiCorePassiveChosenWrap.classList.add("glowPulse");
  }

  function refreshCorePassiveUI(){
    const id = state.core.passiveId;
    const preview = state.core.passivePreviewId;
    const showId = id || preview || null;
    const locked = !!(id && state.core.passiveLocked);

    // (PC) 상단 미선택 배지는 제거됨 — 대신 아래 박스에 글로우를 줌
    if (uiCorePassiveChosenWrap) {
      // (Fix) 색상 클래스 동기화 — 재건(파랑) / 공명(주황) / 과부하(빨강) / 오버드라이브(보라)
      uiCorePassiveChosenWrap.classList.remove("passiveBlue","passiveOrange","passiveRed","passivePurple");
      if (showId && CORE_PASSIVES[showId] && CORE_PASSIVES[showId].colorClass) {
        uiCorePassiveChosenWrap.classList.add(CORE_PASSIVES[showId].colorClass);
      }

      // confirmed/preview passive: subtle always-on glow loop
      uiCorePassiveChosenWrap.classList.toggle("glowLoop", !!showId);

      const changedPreview = (showId && showId !== _lastCorePassiveShowId);
      _lastCorePassiveShowId = showId || null;

      const changedConfirmed = (id && id !== _lastCorePassiveConfirmedId);
      _lastCorePassiveConfirmedId = id || null;

      if (changedPreview || changedConfirmed) pulseCorePassiveBox();
    }

    // 스케치 UI: 상단(무엇을 골랐는지) 표시
    if (uiCorePassiveChosenName) {
      uiCorePassiveChosenName.textContent = showId ? CORE_PASSIVES[showId].name : "미선택";
    }
    if (uiCorePassiveChosenTag) {
      if (!showId) uiCorePassiveChosenTag.textContent = "게임 화면에서 코어 패시브를 선택하십시오.";
      else uiCorePassiveChosenTag.textContent = CORE_PASSIVE_TAG[showId] || "";
    }

    const setActive = (btn, on) => { if(!btn) return; btn.classList.toggle("active", !!on); };
    const setDisabled = (btn, v) => { if(!btn) return; btn.disabled = !!v; btn.classList.toggle("isDisabled", !!v); };

    setActive(btnCoreRebuild,   showId==="rebuild");
    setActive(btnCoreResonance, showId==="resonance");
    setActive(btnCoreOverload,  showId==="overload");
    setActive(btnCoreOverdrive, showId==="overdrive");

    // ✅ 최초 선택 후 재시작 전까지는 변경 불가
    setDisabled(btnCoreRebuild,   locked);
    setDisabled(btnCoreResonance, locked);
    setDisabled(btnCoreOverload,  locked);
    setDisabled(btnCoreOverdrive, locked);

    // 웨이브 시작은 '미리보기(선택 대상)' 또는 '선택 완료' 상태에서 가능
    if (btnWave) btnWave.disabled = !(id || preview);

    if (uiCorePassiveDesc) {
      if (!showId) {
        uiCorePassiveDesc.innerHTML = `패시브를 선택하면 <span class=\"kbd\">웨이브 시작</span>이 가능합니다. (재시작 시 다시 선택)`;
      } else {
        const d = CORE_PASSIVES[showId];
        const hint = id
          ? (locked ? "재시작 전까지 패시브 변경 불가" : "첫 웨이브 시작 시 잠김")
          : "오른쪽 아래 [적용]을 누르면 확정됩니다.";
        uiCorePassiveDesc.innerHTML =
          d.desc.map(s=>`• ${s}`).join("<br>") +
          `<div class=\"muted\" style=\"margin-top:6px;\">${hint}</div>`;
      }
    }
  }



  function selectCorePassive(id){
    if (!(id in CORE_PASSIVES)) return;
    ensureAudio();
    SFX.play("click");

    // 웨이브 중에는 변경 불가
    if (!(state.phase==="build" || state.phase==="clear" || state.phase==="finalprep")) {
      setMsg("웨이브 중에는 패시브를 바꿀 수 없습니다.", 2.0);
      return;
    }

    // ✅ 재시작 전까지는 변경 불가(최초 선택만 허용)
    if (state.core.passiveLocked && state.core.passiveId) {
      setMsg("패시브는 재시작 전까지 변경할 수 없습니다.", 2.2);
      return;
    }

    state.core.passiveId = id;
    // passiveLocked는 "첫 웨이브 시작" 시점에 잠금됩니다.
    state.core.passiveStacks = 0;
    state.core.passiveLastHitAt = gameSec();
    state.core.passiveStackDecayAcc = 0;
    state.core.overdriveShotAcc = 0;
    state.core.hpDirectDamaged = false;

    // 패시브별 누적 상태 리셋
    resonanceReset();
    state.core.rebuildEmergencyUntil = 0;
    state.core.rebuildEmergencyReadyAt = 0;

    // 임계 과부하 누적 상태 리셋
    state.core.overloadBurstUntil = 0;
    state.core.overloadBurstReadyAt = 0;
    state.core.overloadWasAbove30 = true;
    state.core.overloadExtendReadyAt = 0;
    state.core.overloadKickReadyAt = 0;

    // 연출: 패시브 선택 카드 + 코어 펄스
    try {
      const col = passiveAccent(id);
      cineCard("패시브 선택", CORE_PASSIVES[id].name, col, 1.45);
      fxRing(CORE_POS.x, CORE_POS.y, CORE_RADIUS+10, CORE_RADIUS+160, col);
    } catch {}

    setMsg(`패시브 선택: ${CORE_PASSIVES[id].name}`, 2.0);
    refreshCorePassiveUI();
    refreshUI();
  }

  const corePassivePanelClick = (pid) => {
    // 상태 패널에서는 '선택'을 하지 않고, 미리보기만 갱신합니다.
    // (선택 확정은 게임 화면의 패널 오른쪽 아래 [적용] 버튼으로)
    if (state.core.passiveId) {
      setMsg("패시브는 상태 패널에서 확인만 가능합니다. (변경은 재시작 후)", 2.2);
      return;
    }
    state.core.passivePreviewId = pid;
    setMsg("게임 화면 중앙 패널 오른쪽 아래 [적용]으로 확정하십시오.", 2.0);
    refreshUI();
  };

  if (btnCoreRebuild)   btnCoreRebuild.addEventListener("click", ()=>corePassivePanelClick("rebuild"));
  if (btnCoreResonance) btnCoreResonance.addEventListener("click", ()=>corePassivePanelClick("resonance"));
  if (btnCoreOverload)  btnCoreOverload.addEventListener("click", ()=>corePassivePanelClick("overload"));
  if (btnCoreOverdrive) btnCoreOverdrive.addEventListener("click", ()=>corePassivePanelClick("overdrive"));

function selectFinalChoice(choice){
  if (state.phase !== "finalprep") return;
  state.finalChoice = choice;
  SFX.play("click");
  refreshUI();
}
if (btnFinalOffense) btnFinalOffense.addEventListener("click", ()=>selectFinalChoice("offense"));
if (btnFinalDefense) btnFinalDefense.addEventListener("click", ()=>selectFinalChoice("defense"));

// 업그레이드 입력: 클릭이 씹히는 환경(프레임마다 innerHTML 갱신 등) 대비
// - pointerdown에서 "즉시 구매" 처리(마우스 업 전에 DOM이 바뀌어도 확실히 반영)
// - 클릭 이벤트는 백업용
if (upgContainers.length) {
  let lastUpgHandledAt = 0;
  const handleUpg = (ev) => {
    const now = performance.now();
    if (ev.type === "click" && (now - lastUpgHandledAt) < 350) return;
    lastUpgHandledAt = now;
    const row = ev.target.closest("[data-upg]");
    if (!row) return;

    // 패널 클릭이 캔버스 설치 등으로 흘러가지 않게
    ev.preventDefault();
    ev.stopPropagation();

    ensureAudio();

    const id = row.dataset.upg;
    const def = UPGRADE_DEFS.find(d=>d.id===id);
    if (!def) return;

    const lv = state.upg[id];
    const cost = upgCost(def);

    const canBuy = (lv < def.max) && (state.phase !== "fail") && (state.phase !== "win") && (state.crystals >= cost);
    if (!canBuy) {
      SFX.play("click");
      const msg =
        (lv >= def.max) ? "이미 MAX입니다!" :
        (state.phase === "fail") ? "붕괴 후에는 강화할 수 없습니다!" :
        (state.crystals < cost) ? `자원이 부족합니다! (${state.crystals}/${cost})` :
        "지금은 강화할 수 없습니다!";
      fxText(msg, CORE_POS.x, CORE_POS.y - 92, "#ff9fb2");
      setMsg("업그레이드 실패: " + msg, 2.2);
      return;
    }

    buyUpgrade(id);
    // 즉시 UI 갱신(다음 프레임 기다리지 않기)
    window.__upgLastRenderAt = 0;
    refreshUI();
  };

  for (const el of upgContainers) {
    el.addEventListener("pointerdown", handleUpg, { capture:true });
    el.addEventListener("click", handleUpg, { capture:true });
  }
  }

  const btnWave = document.getElementById("btnWave");
  const btnRestart = document.getElementById("btnRestart");
  const chkAutoStart = document.getElementById("chkAutoStart");
  const autoStartSlider = document.getElementById("autoStartSlider");
  const autoStartVal = document.getElementById("autoStartVal");
  const btnRepair  = document.getElementById("btnRepair");
  const btnEnergy = document.getElementById("btnEnergy");
  const btnBg = document.getElementById("btnBg");
  const btnDiffEasy = document.getElementById("btnDiffEasy");
  const btnDiffNormal = document.getElementById("btnDiffNormal");
  const btnDiffHard = document.getElementById("btnDiffHard");

  const btnSound = document.getElementById("btnSound");
  const btnVol   = document.getElementById("btnVol");
  
  const volSlider = document.getElementById("volSlider");
  const volVal    = document.getElementById("volVal");
const btnToggleWire = document.getElementById("btnToggleWire");
  const btnSpeed = document.getElementById("btnSpeed");
  const btnCheat = document.getElementById("btnCheat");

  // ---------- Mobile / Touch controls ----------
  const mobileBar = document.getElementById("mobileBar");
  const mbBasic = document.getElementById("mbBasic");
  const mbSlow = document.getElementById("mbSlow");
  const mbSplash = document.getElementById("mbSplash");
  const mbShred = document.getElementById("mbShred");
  const mbBreaker = document.getElementById("mbBreaker");
  const mbWave = document.getElementById("mbWave");
  const mbRepair = document.getElementById("mbRepair");
  const mbAegis = document.getElementById("mbAegis");
  const mbSell = document.getElementById("mbSell");
const mbFinalRow = document.getElementById("mbFinalRow");
const mbFinalOffense = document.getElementById("mbFinalOffense");
const mbFinalDefense = document.getElementById("mbFinalDefense");


  const mbCheatRow = document.getElementById("mbCheatRow");
  const mbCheat = document.getElementById("mbCheat");
  const mbCheatMenu = document.getElementById("mbCheatMenu");
  const mbEnergy = document.getElementById("mbEnergy");

  
  const mbMenu = document.getElementById("mbMenu");
  const panelEl = document.querySelector(".panel");
  const panelBackdrop = document.getElementById("panelBackdrop");
  const btnPanelClose = document.getElementById("btnPanelClose");
const cheatModal = document.getElementById("cheatModal");
  const chCrystals = document.getElementById("chCrystals");
  const chMaxUpg = document.getElementById("chMaxUpg");
  const chHeal = document.getElementById("chHeal");
  const chShield = document.getElementById("chShield");
  const chKill = document.getElementById("chKill");
  const chSkip = document.getElementById("chSkip");
  const chPassiveFull = document.getElementById("chPassiveFull");
  const chGod = document.getElementById("chGod");
  const chClose = document.getElementById("chClose");

  // Final support buttons (mobile)
  if (mbFinalOffense) mbFinalOffense.addEventListener("click", ()=>selectFinalChoice("offense"));
  if (mbFinalDefense) mbFinalDefense.addEventListener("click", ()=>selectFinalChoice("defense"));

  // Mobile cheat menu
  function setCheatModalOpen(on){
    if (!cheatModal) return;
    cheatModal.classList.toggle("hidden", !on);
  }

  function syncCheatButtons(){
    if (mbCheat){
      mbCheat.firstElementChild.textContent = state.cheat ? "치트 ON" : "치트 OFF";
    }
    if (mbCheatMenu){
      mbCheatMenu.disabled = !state.cheat;
    }
    if (chGod){
      chGod.textContent = state.god ? "무적 OFF" : "무적 ON";
    }
  }

  if (mbCheat) mbCheat.addEventListener("click", ()=>{
    ensureAudio(); SFX.play("click"); toggleCheat(); syncCheatButtons();
  });
  if (mbCheatMenu) mbCheatMenu.addEventListener("click", ()=>{
    ensureAudio();
    if (!state.cheat){ setMsg("치트가 OFF 입니다. (T)", 1.6); SFX.play("click"); return; }
    SFX.play("click");
    setCheatModalOpen(true);
  });

  if (cheatModal) cheatModal.addEventListener("click", (e)=>{
    if (e.target === cheatModal){
      ensureAudio(); SFX.play("click"); setCheatModalOpen(false);
    }
  });
  if (chClose) chClose.addEventListener("click", ()=>{
    ensureAudio(); SFX.play("click"); setCheatModalOpen(false);
  });

  const bindCheatBtn = (el, fn) => {
    if (!el) return;
    el.addEventListener("click", ()=>{
      ensureAudio(); SFX.play("click");
      fn();
      syncCheatButtons();
    });
  };

  bindCheatBtn(chCrystals, ()=>cheatAddCrystals(500));
  bindCheatBtn(chMaxUpg, ()=>cheatMaxUpgrades());
  bindCheatBtn(chHeal, ()=>cheatHealHP());
  bindCheatBtn(chShield, ()=>cheatRefillShield());
  bindCheatBtn(chKill, ()=>cheatKillAll());
  bindCheatBtn(chSkip, ()=>cheatSkipWave());
  bindCheatBtn(chPassiveFull, ()=>cheatPassiveFull());
  bindCheatBtn(chGod, ()=>toggleGod());



  state.mobileSellMode = false;

  function detectMobile(){
    try{
      if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) return true;
    }catch(e){}
    return (window.innerWidth < 900);
  }

  // Wire panel toggle (mobile + desktop button)
  function setWireVisible(show){
    const p = document.getElementById("wirePanel");
    if (!p) return;
    p.classList.toggle("hidden", !show);
    if (btnToggleWire) btnToggleWire.textContent = show ? "와이어 숨김" : "와이어 표시";
  }

  try{
    const p = document.getElementById("wirePanel");
    setWireVisible(p && !p.classList.contains("hidden"));
  }catch(e){}


  function setMobileUIEnabled(on){
    if (!mobileBar) return;
    if (on){
      mobileBar.classList.remove("hidden");
      document.body.classList.add("hasMobileBar");
      // 실제 모바일 바 높이에 맞춰 여백 조정 (줄바꿈/추가 버튼에도 안전)
      requestAnimationFrame(updateMobilePad);
      // 모바일에서는 패널을 원래대로 항상 표시 (오버레이 비활성화)
      // Mobile default: show wire panel
      setWireVisible(true);
    } else {
      mobileBar.classList.add("hidden");
      document.body.classList.remove("hasMobileBar");
      state.mobileSellMode = false;
      if (panelEl) panelEl.classList.remove("mobileOpen");
      if (panelBackdrop) panelBackdrop.classList.add("hidden");
    }
  }


  function updateMobilePad(){
    if (!mobileBar) return;
    const h = mobileBar.getBoundingClientRect().height || 0;
    document.documentElement.style.setProperty("--mbPad", Math.ceil(h) + "px");
  }

  function openMobilePanel(open){
    if (!panelEl || !panelBackdrop) return;
    if (open){
      panelEl.classList.add("mobileOpen");
      panelBackdrop.classList.remove("hidden");
      panelBackdrop.setAttribute("aria-hidden","false");
      updateMobilePad();
    } else {
      panelEl.classList.remove("mobileOpen");
      panelBackdrop.classList.add("hidden");
      panelBackdrop.setAttribute("aria-hidden","true");
    }
  }

  // 모바일 메뉴(업그레이드/패시브/치트 등) 열기/닫기

  if (mbMenu){
    mbMenu.addEventListener("click", ()=>{
      const isOpen = panelEl && panelEl.classList.contains("mobileOpen");
      openMobilePanel(!isOpen);
      try{ SFX.play("click"); }catch{}
    });
  }
  if (btnPanelClose){
    btnPanelClose.addEventListener("click", ()=>{
      openMobilePanel(false);
      try{ SFX.play("click"); }catch{}
    });
  }
  if (panelBackdrop){
    panelBackdrop.addEventListener("click", ()=> openMobilePanel(false));
  }
  window.addEventListener("resize", ()=> requestAnimationFrame(updateMobilePad), {passive:true});

  function setSelectedTurret(type){
    if (!TURRET_TYPES[type]) return;
    state.selected = type;
    ensureAudio();
    SFX.play("click");
    syncMobileButtons();
  }

  function syncMobileButtons(){
    if (!mobileBar || mobileBar.classList.contains("hidden")) return;
    const s = state.selected;
    if (mbBasic)   mbBasic.classList.toggle("active", s==="basic");
    if (mbSlow)    mbSlow.classList.toggle("active", s==="slow");
    if (mbSplash)  mbSplash.classList.toggle("active", s==="splash");
    if (mbShred)   mbShred.classList.toggle("active", s==="shred");
    if (mbBreaker) mbBreaker.classList.toggle("active", s==="breaker");

    if (mbSell){
      mbSell.classList.toggle("on", !!state.mobileSellMode);
      mbSell.firstElementChild.textContent = state.mobileSellMode ? "판매 ON" : "판매 OFF";
    }

    // 버튼에 현재 비용 표시(난이도/밸런스 바뀌어도 자동 반영)
    if (mbBasic)   mbBasic.querySelector("small").textContent = `설치(${TURRET_TYPES.basic.cost})`;
    if (mbSlow)    mbSlow.querySelector("small").textContent = `설치(${TURRET_TYPES.slow.cost})`;
    if (mbSplash)  mbSplash.querySelector("small").textContent = `설치(${TURRET_TYPES.splash.cost})`;
    if (mbShred)   mbShred.querySelector("small").textContent = `설치(${TURRET_TYPES.shred.cost})`;
    if (mbBreaker) mbBreaker.querySelector("small").textContent = `설치(${TURRET_TYPES.breaker.cost})`;
  }

  function canvasXYFromClient(cx, cy){
    const r = canvas.getBoundingClientRect();
    const mx = (cx - r.left) * (canvas.width / r.width);
    const my = (cy - r.top)  * (canvas.height / r.height);
    return {mx, my};
  }

  function mobileSellAt(mx, my){
    const ok = sellTurretAt(mx,my);
    if (!ok) fxText("판매할 포탑이 없습니다.", mx, my, "#fcd34d");
  }

  function mobilePlaceAt(mx, my){
    const tt = TURRET_TYPES[state.selected];
    const dCore = dist(mx,my, CORE_POS.x, CORE_POS.y);
    if (dCore < CORE_RADIUS + 30) return;
    if (dCore > BUILD_RADIUS) return;
    if (overlapsTurret(mx,my)) return;

    if (state.crystals < tt.cost) { fxText("자원이 부족합니다!", mx, my, "#ff9fb2"); return; }

    state.crystals -= tt.cost;
    state.turrets.push({ type: state.selected, x: mx, y: my, cd: 0 });
    try { if (state.stats && state.stats.turretBuilt) state.stats.turretBuilt[state.selected] = (state.stats.turretBuilt[state.selected]|0) + 1; } catch(e) {}
    fxRing(mx,my, 14, 64, "#7dd3fc");
    SFX.play("place");
  }

  if (mbBasic)   mbBasic.onclick = ()=> setSelectedTurret("basic");
  if (mbSlow)    mbSlow.onclick = ()=> setSelectedTurret("slow");
  if (mbSplash)  mbSplash.onclick = ()=> setSelectedTurret("splash");
  if (mbShred)   mbShred.onclick = ()=> setSelectedTurret("shred");
  if (mbBreaker) mbBreaker.onclick = ()=> setSelectedTurret("breaker");

  if (mbWave)   mbWave.onclick = ()=> { ensureAudio(); SFX.play("click"); if (state.phase==="win") return; if (state.phase==="build"||state.phase==="clear"||state.phase==="finalprep") startWave(); };
  if (mbRepair) mbRepair.onclick = ()=> { ensureAudio(); tryRepair(); };
  if (mbAegis)  mbAegis.onclick  = ()=> { ensureAudio(); tryAegis(); };
  if (mbEnergy) mbEnergy.onclick = ()=> { ensureAudio(); tryEnergyCannon(); };
  if (mbSell)   mbSell.onclick   = ()=> { ensureAudio(); SFX.play("click"); state.mobileSellMode = !state.mobileSellMode; syncMobileButtons(); };

  // Touch: tap to place / sell. Long-press sells (even if sell-mode off).
  let _lpTimer = null;
  let _lpFired = false;
  let _down = null;

  canvas.addEventListener("pointerdown", (e)=>{
    if (!detectMobile()) return;
    if (e.pointerType === "mouse") return; // 데스크탑 마우스는 기존 로직 사용
    ensureAudio();
    canvas.setPointerCapture(e.pointerId);
    const {mx, my} = canvasXYFromClient(e.clientX, e.clientY);
    _lpFired = false;
    _down = { id: e.pointerId, mx, my, cx: e.clientX, cy: e.clientY };

    // 길게 누르면 판매(빌드/클리어에서만)
    if (state.phase === "build" || state.phase === "clear" || state.phase === "finalprep"){
      clearTimeout(_lpTimer);
      _lpTimer = setTimeout(()=>{
        if (!_down) return;
        const dx = Math.abs(_down.cx - e.clientX);
        const dy = Math.abs(_down.cy - e.clientY);
        if (dx > 14 || dy > 14) return; // 드래그면 취소
        mobileSellAt(_down.mx, _down.my);
        _lpFired = true;
      }, 420);
    }
    e.preventDefault();
  }, {passive:false});

  canvas.addEventListener("pointermove", (e)=>{
    if (!detectMobile()) return;
    if (e.pointerType === "mouse") return;
    // 프리뷰/호버용 좌표 갱신
    try{
      const r = canvas.getBoundingClientRect();
      if (typeof mouse !== "undefined"){
        mouse.x = (e.clientX - r.left) * (canvas.width / r.width);
        mouse.y = (e.clientY - r.top)  * (canvas.height / r.height);
        mouse.inside = (mouse.x>=0 && mouse.x<=W && mouse.y>=0 && mouse.y<=H);
      }
    }catch(err){} 

    // 드래그하면 롱프레스 취소
    if (_down){
      const dx = Math.abs(_down.cx - e.clientX);
      const dy = Math.abs(_down.cy - e.clientY);
      if (dx > 14 || dy > 14) { clearTimeout(_lpTimer); }
    }
    e.preventDefault();
  }, {passive:false});

  canvas.addEventListener("pointerup", (e)=>{
    if (!detectMobile()) return;
    if (e.pointerType === "mouse") return;
    clearTimeout(_lpTimer);
    if (_lpFired){ _down=null; return; }

    const {mx, my} = canvasXYFromClient(e.clientX, e.clientY);
    if (state.phase === "build" || state.phase === "clear" || state.phase === "finalprep"){
      if (state.mobileSellMode) mobileSellAt(mx,my);
      else mobilePlaceAt(mx,my);
    }
    _down = null;
    e.preventDefault();
  }, {passive:false});

  // 모바일 UI 표시 초기화
  setMobileUIEnabled(detectMobile());
  syncMobileButtons();
  window.addEventListener("resize", ()=>{
    const on = detectMobile();
    setMobileUIEnabled(on);
    syncMobileButtons();
  });

  btnWave.onclick = () => { ensureAudio(); SFX.play("click"); if (state.phase === "win") { setMsg("승리! 재시작으로 새 게임을 시작하세요.", 2.2); return; } if (state.phase === "build" || state.phase === "clear" || state.phase === "finalprep") startWave(); };
  btnRestart.onclick = () => { ensureAudio(); SFX.play("click"); restart(); };
  // 다음 웨이브 자동 시작(저장 안 함)
  if (chkAutoStart) {
    chkAutoStart.checked = !!state.ui.autoStartEnabled;
    chkAutoStart.addEventListener("change", ()=>{
      state.ui.autoStartEnabled = chkAutoStart.checked;
      if (!state.ui.autoStartEnabled) {
        state.autoStartAt = 0;
      } else if (state.phase === "clear" && state.autoStartAt <= 0) {
        state.autoStartAt = gameSec() + state.autoStartDelay;
      }
      refreshUI();
    });
  }
  if (autoStartSlider) {
    autoStartSlider.value = String(Math.round(state.autoStartDelay||0));
    const syncVal = ()=>{
      const v = Math.max(0, Math.min(15, Math.round(Number(autoStartSlider.value)||0)));
      state.autoStartDelay = v;
      if (autoStartVal) autoStartVal.textContent = `${v}s`;
      if (state.ui.autoStartEnabled && state.phase === "clear") state.autoStartAt = gameSec() + state.autoStartDelay;
      refreshUI();
    };
    autoStartSlider.addEventListener("input", syncVal);
    autoStartSlider.addEventListener("change", syncVal);
    if (autoStartVal) autoStartVal.textContent = `${Math.round(state.autoStartDelay||0)}s`;
  }

  btnRepair.onclick  = () => { ensureAudio(); tryRepair(); };
  if (btnEnergy) btnEnergy.onclick = () => { ensureAudio(); tryEnergyCannon(); };
  if (btnBg) btnBg.onclick = () => {
    ensureAudio(); SFX.play("click");
    state.ui.bgMode = ((state.ui.bgMode||0) + 1) % 3;
    syncBackground();
  };
  if (btnDiffEasy) btnDiffEasy.onclick = () => { ensureAudio(); SFX.play("click"); setDiffPreset("easy"); };
  if (btnDiffNormal) btnDiffNormal.onclick = () => { ensureAudio(); SFX.play("click"); setDiffPreset("normal"); };
  if (btnDiffHard) btnDiffHard.onclick = () => { ensureAudio(); SFX.play("click"); setDiffPreset("hard"); };
  try { refreshDiffUI(); } catch {}

  // ---------- Sound UI ----------
  // 버튼(프리셋) + 슬라이더(정밀)로 볼륨을 조절합니다.
  const VOL_PRESETS = [0.00, 0.25, 0.50, 0.75, 1.00];
  let presetIdx = 0;

  function syncPresetIdx(){
    const v = SFX.getVolume();
    let best = 0, bestD = 999;
    for (let i=0;i<VOL_PRESETS.length;i++){
      const d = Math.abs(VOL_PRESETS[i] - v);
      if (d < bestD){ bestD = d; best = i; }
    }
    presetIdx = best;
  }

  function refreshSoundUI(){
    btnSound.textContent = SFX.getEnabled() ? "사운드 ON" : "사운드 OFF";
    const pct = Math.round(SFX.getVolume() * 100);
    btnVol.textContent   = `볼륨 ${pct}%`;
    if (volSlider) volSlider.value = String(pct);
    if (volVal)    volVal.textContent = `${pct}%`;
  }
  refreshSoundUI();

  btnSound.onclick = () => {
    ensureAudio();
    const next = !SFX.getEnabled();
    SFX.setEnabled(next);
    SFX.play("click");
    refreshSoundUI();
  };

  if (volSlider){
    volSlider.addEventListener("input", () => {
      ensureAudio();
      const v = clamp(parseInt(volSlider.value, 10) / 100, 0, 1);
      SFX.setVolume(v);
      refreshSoundUI();
    });
    volSlider.addEventListener("change", () => {
      ensureAudio();
      if (SFX.getVolume() > 0) SFX.play("click");
      syncPresetIdx();
      refreshSoundUI();
    });
  }

  btnVol.onclick = () => {
    ensureAudio();
    syncPresetIdx();
    presetIdx = (presetIdx + 1) % VOL_PRESETS.length;
    SFX.setVolume(VOL_PRESETS[presetIdx]);
    // 볼륨 0이면 자동으로 끔처럼 느껴지니, enabled는 유지
    if (SFX.getVolume() > 0) SFX.play("click");
    refreshSoundUI();
  };

  if (btnToggleWire) btnToggleWire.onclick = () => {
    const p = document.getElementById("wirePanel");
    if (!p) return;
    const hidden = p.classList.contains("hidden");
    setWireVisible(hidden);
  };

  if (btnSpeed) btnSpeed.onclick = () => { ensureAudio(); SFX.play("click"); cycleSpeed(); };
  if (btnCheat) btnCheat.onclick = () => { ensureAudio(); SFX.play("click"); toggleCheat(); };

  window.addEventListener("keydown", (e) => {
    if (["Digit1","Digit2","Digit3","Digit4","Digit5","Space","KeyR","KeyF","KeyX","KeyE"].includes(e.code)) e.preventDefault();
    if (["Digit1","Digit2","Digit3","Digit4","Digit5","Space","KeyR","KeyF","KeyX","KeyE"].includes(e.code)) ensureAudio();
    if (e.code === "Digit1") { state.selected = "basic"; SFX.play("click"); }
    if (e.code === "Digit2") {
      if (state.phase === "wave") {
        tryEnergyCannon();
      } else {
        state.selected = "slow";
        SFX.play("click");
      }
    }
    if (e.code === "Digit3") { state.selected = "splash"; SFX.play("click"); }
    if (e.code === "Digit4") { state.selected = "shred";  SFX.play("click"); }
    if (e.code === "Digit5") { state.selected = "breaker"; SFX.play("click"); }
    if (e.code === "Space")  tryAegis();
    if (e.code === "KeyF")  tryRepair();
    if (e.code === "KeyE")  tryEnergyCannon();
    if (e.code === "KeyX")  { if (state.phase==="build" || state.phase==="clear") { const ok = sellTurretAt(mouse.x, mouse.y); if (!ok) fxText("판매할 포탑이 없습니다.", mouse.x, mouse.y, "#fcd34d"); } }
    if (e.code === "KeyR") { SFX.play("click"); restart(); }
    // Speed controls
    if (["Minus","Equal","BracketLeft","BracketRight"].includes(e.code)) { e.preventDefault(); ensureAudio(); }
    if (e.code === "Minus" || e.code === "BracketLeft") { SFX.play("click"); setSpeed(state.speed/1.25); setMsg(`배속: ${state.speed.toFixed(2).replace(/\.00$/,".0")}x`, 1.6); }
    if (e.code === "Equal" || e.code === "BracketRight") { SFX.play("click"); setSpeed(state.speed*1.25); setMsg(`배속: ${state.speed.toFixed(2).replace(/\.00$/,".0")}x`, 1.6); }

    // Cheat toggle
    if (e.code === "KeyT") { e.preventDefault(); ensureAudio(); SFX.play("click"); toggleCheat(); }

    // Cheat actions (only when cheat ON)
    if (state.cheat){
      if (["KeyK","KeyH","KeyJ","KeyB","KeyN","KeyU","KeyG","KeyP"].includes(e.code)) { e.preventDefault(); ensureAudio(); }
      if (e.code === "KeyK") cheatAddCrystals(500);
      if (e.code === "KeyH") cheatHealHP();
      if (e.code === "KeyJ") cheatRefillShield();
      if (e.code === "KeyB") cheatKillAll();
      if (e.code === "KeyN") cheatSkipWave();
      if (e.code === "KeyU") cheatMaxUpgrades();
      if (e.code === "KeyP") cheatPassiveFull();
      if (e.code === "KeyG") toggleGod();
    }

  });

  // ---------- Build placement ----------
  const mouse = { x:0, y:0, inside:false };
  canvas.addEventListener("mousemove", (e)=>{
    const r = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) * (canvas.width / r.width);
    mouse.y = (e.clientY - r.top)  * (canvas.height / r.height);
    mouse.inside = (mouse.x>=0 && mouse.x<=W && mouse.y>=0 && mouse.y<=H);
  });
  canvas.addEventListener("mouseleave", ()=> mouse.inside=false);
  canvas.addEventListener("contextmenu", (e)=>e.preventDefault());

  canvas.addEventListener("mousedown", (e) => {
    if (state.phase !== "build" && state.phase !== "clear") return;

    ensureAudio();

    const r = canvas.getBoundingClientRect();
    const mx = (e.clientX - r.left) * (canvas.width / r.width);
    const my = (e.clientY - r.top)  * (canvas.height / r.height);

    // 좌클릭: 설치 / 우클릭: 판매
    if (e.button === 2) {
      const ok = sellTurretAt(mx,my);
      if (!ok) fxText("판매할 포탑이 없습니다.", mx, my, "#fcd34d");
      return;
    }

    // ✅ 왼쪽 클릭만 설치
    if (e.button !== 0) return;

    const tt = TURRET_TYPES[state.selected];
    const dCore = dist(mx,my, CORE_POS.x, CORE_POS.y);

    if (dCore < CORE_RADIUS + 30) return;
    if (dCore > BUILD_RADIUS) return;
    if (overlapsTurret(mx,my)) return;

    if (state.crystals < tt.cost) { fxText("자원이 부족합니다!", mx, my, "#ff9fb2"); return; }

    state.crystals -= tt.cost;
    state.turrets.push({ type: state.selected, x: mx, y: my, cd: 0 });
    try { if (state.stats && state.stats.turretBuilt) state.stats.turretBuilt[state.selected] = (state.stats.turretBuilt[state.selected]|0) + 1; } catch(e) {}
    fxRing(mx,my, 14, 64, "#7dd3fc");
    SFX.play("place");
  });

  function overlapsTurret(x,y){
    for (const t of state.turrets) if (dist(x,y, t.x,t.y) < 34) return true;
    return false;
  }

  // ---------- Wave Spec ----------
  function waveTheme(w){
  if (w === FINAL_WAVE) return { key:"final", name:"최종", desc:"최종 보스" };
  if (w % 5 === 0) return { key:"boss", name:"보스", desc:"정예 등장" };

  // 테마 웨이브(가볍게 변주)
  // - 러시: 빠른 적 위주 + 스폰 속도↑
  // - 중장갑: 체력 높은 적 위주 + 스폰 수↓
  // - 폭파: 폭파/실드브레이커 비중↑
  if (w % 10 === 3 || w % 10 === 8) return { key:"rush", name:"러시", desc:"빠른 적 급습" };
  if (w % 10 === 4 || w % 10 === 9) return { key:"siege", name:"중장갑", desc:"단단한 적" };
  if (w % 10 === 6 || w % 10 === 1) return { key:"bomb", name:"폭파", desc:"폭파/브레이커" };
  if (w % 10 === 2) return { key:"swarm", name:"군단", desc:"다수의 약한 적" };
  if (w % 10 === 7) return { key:"sniper", name:"저격", desc:"원거리 압박" };
  return { key:"mix", name:"혼합", desc:"혼합 편성" };
}

function waveSpec(w){
  const isBoss = (w % 5 === 0) || (w === FINAL_WAVE);
  const isFinal = (w === FINAL_WAVE);
  const th = waveTheme(w);

  // 최종 웨이브(30): 보스 1마리만 기본 스폰. (추가 소환은 보스 패턴에서 처리)
  const baseCount = Math.floor(10 + w*2.0);
  let count = isFinal ? 1 : (isBoss ? Math.max(8, Math.floor(baseCount*0.65)) : baseCount);

  let hp  = (25 + w*5.8) * (isFinal ? 4.2 : (isBoss ? 2.25 : 1.0));
  let spd = (42 + w*2.2) * (isFinal ? 0.95 : (isBoss ? 0.92 : 1.0));
  let spawnRate = (isFinal ? 0.88 : (isBoss ? 0.88 : 1.22)) + w*0.028;

  // 테마 웨이브 보정 (체감만 주고 과하지 않게)
  if (!isBoss && !isFinal){
    if (th.key === "rush"){
      spd *= 1.14; hp *= 0.93; spawnRate *= 1.12;
    } else if (th.key === "siege"){
      hp *= 1.18; spd *= 0.93; count = Math.max(8, Math.floor(count*0.88));
    } else if (th.key === "bomb"){
      hp *= 1.05; spawnRate *= 1.04;
    } else if (th.key === "swarm"){
      spd *= 1.05; hp *= 0.90; count = Math.max(10, Math.floor(count*1.15)); spawnRate *= 1.08;
    } else if (th.key === "sniper"){
      hp *= 1.04; spd *= 0.97; count = Math.max(8, Math.floor(count*0.97)); spawnRate *= 0.99;
    }
  }

  return { count, hp, spd, spawnRate, isBoss, isFinal, themeKey: th.key, themeName: th.name, themeDesc: th.desc };
}



  // ---------- Enemy types ----------
  const ENEMY_ARCH = {
    grunt: { name:"돌격병",  hpMul:1.00, spdMul:1.00, r:12, reward:10, touchDmg:9,  touchCd:0.70, color:"#fb7185" },
    shooter:{ name:"사수",    hpMul:0.90, spdMul:0.92, r:11, reward:12, touchDmg:7,  touchCd:0.85,
              ranged:true, shootRange:260, holdDist:230, shotCd:1.15, projDmg:8, projSpd:320,
              coreOpts:{ hpArmorPierce:0.20 }, color:"#fbbf24" },
    shieldbreaker:{ name:"실드 브레이커", hpMul:1.05, spdMul:1.02, r:12, reward:13, touchDmg:8, touchCd:0.72,
              coreOpts:{ shieldBonusMul:1.55 }, color:"#60a5fa" },
    piercer:{ name:"관통병",  hpMul:0.95, spdMul:1.12, r:12, reward:13, touchDmg:10, touchCd:0.72,
              coreOpts:{ hpArmorPierce:0.65 }, color:"#a78bfa" },
    
    runner:{ name:"질주병",  hpMul:0.70, spdMul:1.65, r:11, reward:9, touchDmg:7, touchCd:0.65,
              coreOpts:{}, color:"#fca5a5" },
    bruiser:{ name:"중장갑", hpMul:1.85, spdMul:0.78, r:14, reward:16, touchDmg:12, touchCd:0.78,
              coreOpts:{ shieldBonusMul:1.10 }, color:"#94a3b8" },

    disruptor:{ name:"교란기", hpMul:1.10, spdMul:0.90, r:12, reward:15, touchDmg:6, touchCd:0.95,
              ranged:true, shootRange:280, holdDist:245, shotCd:1.45, projDmg:7, projSpd:330,
              shieldMul:0.75,
              coreOpts:{ empDur:2.4, empMul:0.72, shieldRegenBlockDur:2.4, repairBlockDur:2.4 }, color:"#22c55e" },

bomber:{ name:"폭파병",   hpMul:0.82, spdMul:1.25, r:12, reward:14, touchDmg:0, touchCd:0,
              bomber:true, explodeDmg:32, explodeRad:120, turretBreakChance:0.35,
              coreOpts:{ shieldBonusMul:1.20 }, color:"#34d399" },

    boss: { name:"정예 코어브레이커", hpMul:6.5, spdMul:0.85, r:22, reward:80, touchDmg:20, touchCd:0.55,
            ranged:true, shootRange:320, holdDist:260, shotCd:0.95, projDmg:14, projSpd:360,
            coreOpts:{ hpArmorPierce:0.35, shieldBonusMul:1.15 }, color:"#f472b6" },
  };

  function pickEnemyId(w, spec, idx){
    // boss wave: 첫 스폰은 보스 1마리
    if (spec.isBoss && idx === 0) return "boss";

    const pool = [];
    pool.push(["grunt",  60]);

    if (w >= 2) pool.push(["shooter", 18]);
    if (w >= 3) pool.push(["shieldbreaker", 16]);
    if (w >= 4) pool.push(["piercer", 16]);
    if (w >= 2) pool.push(["runner", 14]);
    if (w >= 2) pool.push(["shooter", 18]);
    if (w >= 3) pool.push(["shieldbreaker", 16]);
    if (w >= 4) pool.push(["piercer", 16]);
    if (w >= 6) pool.push(["bruiser", 12]);
    if (w >= 6) pool.push(["bomber", 14]);
    if (w >= 8) pool.push(["disruptor", 12]);

    // boss wave: 특수 몹 비중 증가
    if (spec.isBoss) {
      for (let i=0;i<pool.length;i++) pool[i][1] *= (pool[i][0]==="grunt" ? 0.55 : 1.25);
    }

    // theme wave: 테마별 가중치 조정(체감용, 과하지 않게)
    if (spec.themeKey === "rush") {
      for (let i=0;i<pool.length;i++){
        const id = pool[i][0];
        if (id==="runner") pool[i][1] *= 2.4;
        else if (id==="piercer") pool[i][1] *= 1.35;
        else if (id==="shooter") pool[i][1] *= 0.75;
        else if (id==="bruiser") pool[i][1] *= 0.55;
      }
    } else if (spec.themeKey === "siege") {
      for (let i=0;i<pool.length;i++){
        const id = pool[i][0];
        if (id==="bruiser") pool[i][1] *= 2.3;
        else if (id==="grunt") pool[i][1] *= 0.85;
        else if (id==="runner") pool[i][1] *= 0.55;
      }
    } else if (spec.themeKey === "bomb") {
      for (let i=0;i<pool.length;i++){
        const id = pool[i][0];
        if (id==="bomber") pool[i][1] *= 2.1;
        else if (id==="shieldbreaker") pool[i][1] *= 1.45;
      }
    } else if (spec.themeKey === "swarm") {
      for (let i=0;i<pool.length;i++){
        const id = pool[i][0];
        if (id==="grunt") pool[i][1] *= 1.55;
        else if (id==="runner") pool[i][1] *= 2.6;
        else if (id==="bruiser") pool[i][1] *= 0.45;
        else if (id==="shooter") pool[i][1] *= 0.75;
      }
    } else if (spec.themeKey === "sniper") {
      for (let i=0;i<pool.length;i++){
        const id = pool[i][0];
        if (id==="shooter") pool[i][1] *= 2.35;
        else if (id==="piercer") pool[i][1] *= 1.65;
        else if (id==="bruiser") pool[i][1] *= 0.70;
        else if (id==="runner") pool[i][1] *= 0.70;
      }
    }

    let sum = 0; for (const [,wgt] of pool) sum += wgt;
    let r = Math.random()*sum;
    for (const [id,wgt] of pool) { r -= wgt; if (r <= 0) return id; }
    return "grunt";
  }

  function resetMods(){
    state.mods.shieldAbsorbMul = 1;
    state.mods.shieldRegenMul  = 1;
    state.mods.turretDmgMul    = 1;
    state.mods.turretProjMul   = 1;
    state.mods.turretFireMul   = 1;
    state.mods.rewardMul       = 1;
  }
  function chooseEvent(){
    if (state.wave % 3 !== 0) return null;
    return EVENTS[Math.floor(Math.random()*EVENTS.length)];
  }

  // ---------- Emergency barrier ----------
  function tryAegis(){
    if (state.phase === "fail") return;
    const t = gameSec();
    if (t < state.core.aegisReadyAt) return;

    state.core.aegisReadyAt = t + state.core.aegisCd;
    state.core.aegisActiveUntil = t + 3.0;
    state.core.shield = clamp(state.core.shield + 90, 0, state.core.shieldMax);

    SFX.play("aegis");

    fxText("긴급 보호막!", CORE_POS.x, CORE_POS.y - 64, "#93c5fd");
    fxShieldWave(CORE_POS.x, CORE_POS.y, CORE_RADIUS + 18);
    fxRing(CORE_POS.x, CORE_POS.y, CORE_RADIUS+10, 120, "#60a5fa");

    // 임계 과부하 연계: 다음 버스트/쇼크 쿨 -6s (20s ICD)
    overloadOnAegis();
  }

  
  function tryRepair(){
    if (state.phase === "fail") return;

    const t = gameSec();
    const hpFracBefore = (state.core.hpMax>0) ? (state.core.hp / state.core.hpMax) : 1;
    const cdLeft = Math.max(0, state.core.repairReadyAt - t);

    const blockLeft = Math.max(0, (state.core.repairBlockedUntil||0) - t);
    if (blockLeft > 0) {
      fxText(`수리 차단 ${blockLeft.toFixed(1)}s`, CORE_POS.x, CORE_POS.y - 70, "#fbbf24");
      SFX.play("click");
      return;
    }

    if (cdLeft > 0) {
      fxText(`수리 쿨다운 ${cdLeft.toFixed(1)}s`, CORE_POS.x, CORE_POS.y - 70, "#ffd166");
      SFX.play("click");
      return;
    }
    if (state.core.hp >= state.core.hpMax - 0.01) {
      fxText("HP가 이미 가득합니다", CORE_POS.x, CORE_POS.y - 70, "#93c5fd");
      SFX.play("click");
      return;
    }
    if (state.crystals < state.core.repairCost) {
      fxText("자원이 부족합니다", CORE_POS.x, CORE_POS.y - 70, "#ff9fb2");
      SFX.play("click");
      return;
    }

    state.crystals -= state.core.repairCost;
    state.stats.repairs = (state.stats.repairs|0) + 1;

    const want = state.core.repairAmount;
    const heal = Math.min(want, state.core.hpMax - state.core.hp);
    state.core.hp = clamp(state.core.hp + heal, 0, state.core.hpMax);

    state.core.repairReadyAt = t + state.core.repairCd;

    SFX.play("repair");
    fxRing(CORE_POS.x, CORE_POS.y, CORE_RADIUS+10, CORE_RADIUS+90, "#67f3a6");
    fxText(`수리 +${(heal|0)}`, CORE_POS.x, CORE_POS.y - 64, "#67f3a6");

    // 임계 과부하 연계(HP<=40% 표식/버스트 연장)
    overloadOnRepair(hpFracBefore);
  }

    function pickEnergyTarget(){
    if (!state.enemies) return null;

    // 우선순위: 보스(kind==="boss") → 그 다음 현재 HP 최대
    let target = null;
    let bestHp = -1;

    for (const e of state.enemies) {
      if (!e || e.hp <= 0) continue;
      if (e.kind === "boss") {
        if (e.hp > bestHp) { bestHp = e.hp; target = e; }
      }
    }
    if (!target) {
      bestHp = -1;
      for (const e of state.enemies) {
        if (!e || e.hp <= 0) continue;
        if (e.hp > bestHp) { bestHp = e.hp; target = e; }
      }
    }
    return target;
  }

  function updateEnergyCharge(){
    if (!state.core.energyCharging) return;

    // 웨이브가 아니면 충전 취소
    if (state.phase !== "wave") {
      state.core.energyCharging = false;
      state.core.energyLock = null;
      state.core.energyChargeOrbs = [];
      state.core.energyChargeReadySfx = false;
      state.core.energyFlashUntil = 0;
      return;
    }

    const t = gameSec();
    const dur = state.core.energyChargeDur || 3.0;
    const rem = state.core.energyChargeUntil - t;
    const prog = clamp(1 - (rem / dur), 0, 1);

    // dt(프레임 간격)
    const lastT = state.core.energyChargeLastT || t;
    const dt = clamp(t - lastT, 0, 0.05);
    state.core.energyChargeLastT = t;

    // --- 코어로 빨려드는 오브(빛) ---
    if (!state.core.energyChargeOrbs) state.core.energyChargeOrbs = [];
    if (t >= (state.core.energyChargeOrbAt || 0)) {
      // 후반으로 갈수록 더 촘촘하게
      const interval = lerp(0.12, 0.045, prog);
      state.core.energyChargeOrbAt = t + interval;

      const a = Math.random() * Math.PI * 2;
      const r = lerp(170, 110, prog) + (Math.random()*26);
      const life = lerp(0.58, 0.34, prog);
      state.core.energyChargeOrbs.push({ a, r, t:0, life });
    }

    // 오브 이동/소멸
    const orbs = state.core.energyChargeOrbs;
    for (let i = orbs.length - 1; i >= 0; i--) {
      const o = orbs[i];
      o.t += dt;
      o.r -= (lerp(260, 520, prog)) * dt;
      // 약간의 흔들림(에너지 불안정)
      o.a += (0.9 + 1.6*prog) * dt * (Math.random() < 0.5 ? -1 : 1);

      if (o.t >= o.life || o.r <= 6) orbs.splice(i, 1);
    }

    // --- 락온 타겟 유지(죽었으면 재탐색) ---
    let lock = state.core.energyLock;
    if (!lock || lock.hp <= 0 || !(state.enemies && state.enemies.includes(lock))) {
      lock = pickEnergyTarget();
      state.core.energyLock = lock;
    }

    // --- 충전 사운드: 진행도에 따라 점점 촘촘하고 높은 톤 ---
    if (t >= (state.core.energyChargeSfxAt || 0)) {
      const interval = lerp(0.34, 0.12, prog);
      state.core.energyChargeSfxAt = t + interval;

      if (prog < 0.40) SFX.play("y_charge1");
      else if (prog < 0.75) SFX.play("y_charge2");
      else SFX.play("y_charge3");
    }

    // 발사 직전(거의 완충) 사운드 1회
    if (prog >= 0.92 && !state.core.energyChargeReadySfx) {
      state.core.energyChargeReadySfx = true;
      SFX.play("y_charge_ready");
    }

    // 충전 중 이펙트(과도한 생성 방지) — 타겟 라인/링은 FX로 유지
    if (t >= (state.core.energyChargeFxAt || 0)) {
      state.core.energyChargeFxAt = t + 0.18; // 약 5~6회/초

      const r0 = CORE_RADIUS + 8 + prog*6;
      const r1 = CORE_RADIUS + 54 + prog*92;
      fxRing(CORE_POS.x, CORE_POS.y, r0, r1, "#93c5fd");

      if (lock && lock.hp > 0) {
        fxRing(lock.x, lock.y, 12, 46, "#93c5fd");
        fxLine(CORE_POS.x, CORE_POS.y, lock.x, lock.y, "#93c5fd", 0.16, 2.2);
      }
    }

    // 3초(또는 설정값) 후 자동 발사 — 코어가 가장 밝아지는 순간
    if (rem <= 0) fireEnergyCannon();
  }

  function fireEnergyCannon(){
    const t = gameSec();

    // 발사 순간 미세 카메라 흔들림(짧게)
    state.camShakeDur = 0.12;
    state.camShakeMag = 6.0;
    state.camShakeUntil = t + state.camShakeDur;

    // 발사 순간: 코어가 가장 밝아지는 플래시
    state.core.energyFlashUntil = t + 0.16;

    // 락온 타겟이 유효하지 않으면 재탐색
    let target = state.core.energyLock;
    if (!target || target.hp <= 0 || !(state.enemies && state.enemies.includes(target))) {
      target = pickEnergyTarget();
    }

    // 충전 상태 종료
    state.core.energyCharging = false;
    state.core.energyLock = null;

    if (!target) {
      SFX.play("click");
      fxText("대상이 없습니다", CORE_POS.x, CORE_POS.y - 70, "#93c5fd");
      return;
    }

    const dmg = (state.core.energyDmg || 800) * (1 + Math.max(0, state.wave-1)*0.018);
    target.hp -= dmg;

    // 오버드라이브 패시브: 에너지포가 광역 피해(30%)를 추가로 입힘
    if (state.core.passiveId === "overdrive") {
      const splashMul = 0.30;
      const splashDmg = dmg * splashMul;
      const rad = 120;
      let hitN = 0;

      if (state.enemies && state.enemies.length) {
        for (const e of state.enemies) {
          if (!e || e === target || e.hp <= 0) continue;
          const d = dist(e.x, e.y, target.x, target.y);
          if (d <= rad + (e.r||0)) {
            e.hp -= splashDmg;
            hitN++;
          }
        }
      }

      if (hitN > 0) {
        fxRing(target.x, target.y, 26, rad, "#c4b5fd");
        fxText(`오버드라이브 광역 x${hitN}`, target.x, target.y - 40, "#c4b5fd");
        try { SFX.play("shield_hit"); } catch {}
      }
    }

    // 야마토포 스타일 빔(굵은 코어 + 하이라이트)
    fxLine(CORE_POS.x, CORE_POS.y, target.x, target.y, "#93c5fd", 0.26, 16);
    fxLine(CORE_POS.x, CORE_POS.y, target.x, target.y, "#cbe6ff", 0.22, 7);
    fxLine(CORE_POS.x, CORE_POS.y, target.x, target.y, "rgba(255,255,255,0.85)", 0.14, 2.2);

    // 발사 쇼크(코어/타겟)
    fxRing(CORE_POS.x, CORE_POS.y, CORE_RADIUS+8, CORE_RADIUS+140, "#93c5fd");
    fxRing(target.x, target.y, 14, 92, "#93c5fd");
    fxRing(target.x, target.y, 10, 64, "#cbe6ff");

    fxText(`-${Math.round(dmg)}`, target.x, target.y - 18, "#93c5fd");
    SFX.play("y_fire");

    // 쿨타임은 발사 시점부터
    state.core.energyReadyAt = t + state.core.energyCd;
  }

  function tryEnergyCannon(){
    if (state.phase === "fail") return;

    const t = gameSec();

    // 이미 충전 중이면 안내만
    if (state.core.energyCharging) {
      const rem = Math.max(0, state.core.energyChargeUntil - t);
      fxText(`에너지포 충전중 ${rem.toFixed(1)}s`, CORE_POS.x, CORE_POS.y - 70, "#93c5fd");
      SFX.play("click");
      return;
    }

    const cdLeft = Math.max(0, state.core.energyReadyAt - t);

    if (state.phase !== "wave") {
      fxText("웨이브 중에만 사용 가능", CORE_POS.x, CORE_POS.y - 70, "#93c5fd");
      SFX.play("click");
      return;
    }
    if (cdLeft > 0) {
      fxText(`에너지포 쿨다운 ${cdLeft.toFixed(1)}s`, CORE_POS.x, CORE_POS.y - 70, "#ffd166");
      SFX.play("click");
      return;
    }

    const target = pickEnergyTarget();
    if (!target) {
      fxText("대상이 없습니다", CORE_POS.x, CORE_POS.y - 70, "#93c5fd");
      SFX.play("click");
      return;
    }

    // ✅ 누르면 약 3초 충전 후 자동 발사 (SC2 야마토포 느낌)
    state.core.energyCharging = true;
    state.core.energyChargeStartAt = t;
    state.core.energyChargeUntil = t + (state.core.energyChargeDur || 3.0);
    state.core.energyChargeFxAt = t; // 즉시 이펙트 1회
    state.core.energyLock = target;

    // 충전 시작 사운드(클릭 대신 집속 사운드)
    SFX.play("y_charge1");

    // 충전 중 사운드/연출 상태 초기화
    state.core.energyChargeSfxAt = t + 0.18;
    state.core.energyChargeReadySfx = false;
    state.core.energyChargeOrbAt = t;
    state.core.energyChargeOrbs = [];
    state.core.energyChargeLastT = t;

    fxText("에너지 집속…", CORE_POS.x, CORE_POS.y - 70, "#93c5fd");
    fxRing(CORE_POS.x, CORE_POS.y, CORE_RADIUS+6, CORE_RADIUS+70, "#93c5fd");
    fxRing(target.x, target.y, 10, 46, "#93c5fd");
  }



// ---------- Spawning ----------
  function spawnEnemy(spec, idx){
    const isMainBoss = !!(spec && spec.isBoss) && ((idx||0)===0);
    if (!isMainBoss && state.enemies.length >= enemyCap()) return;
    const side = (Math.random()*4)|0;
    const pad = 26;
    let x,y;
    if (side===0){ x = rand(pad, W-pad); y = -pad; }
    if (side===1){ x = W+pad; y = rand(pad, H-pad); }
    if (side===2){ x = rand(pad, W-pad); y = H+pad; }
    if (side===3){ x = -pad; y = rand(pad, H-pad); }

        const id = pickEnemyId(state.wave, spec, idx||0);
    const arch = ENEMY_ARCH[id] || ENEMY_ARCH.grunt;

    const diff = state.diff || DIFF_PRESETS.normal;

    const elite = spec.isBoss && (id !== "boss") && Math.random() < 0.22;
    const r = (arch.r || 12) * (elite ? 1.15 : 1.0);
    const hp = spec.hp * arch.hpMul * (elite ? 1.8 : 1.0) * (diff.hpMul||1);
    const spd = spec.spd * arch.spdMul * (elite ? 0.90 : 1.0) * (0.92 + 0.16*Math.random()) * (diff.spdMul||1);

    // 웨이브가 오를수록 "위력(피해)"도 상승
    // - 너무 가파르지 않게 선형 증가 (원하면 0.06 값을 조절)
    const dmgMul = (1 + Math.max(0, state.wave - 1) * 0.06) * (spec.isBoss ? 1.15 : 1.0);

        const eObj = {
          x,y, hp, hpMax: hp, spd, r,
          kind: id,
          color: arch.color,
          seedAng: Math.random()*Math.PI*2,
          orbitDir: (Math.random()<0.5 ? -1 : 1),
          reward: arch.reward * (elite ? 1.35 : 1.0),
          slowMul: 1.0, slowUntil: 0,
          touchCd: 0,
          touchBase: arch.touchDmg * dmgMul,
          touchInterval: arch.touchCd,
          ranged: !!arch.ranged,
          bomber: !!arch.bomber,
          explodeDmg: (arch.explodeDmg||0) * dmgMul,
          explodeRad: arch.explodeRad||0,
          turretBreakChance: arch.turretBreakChance||0,
          shootRange: arch.shootRange||0,
          holdDist: arch.holdDist||0,
          shotCd: arch.shotCd||0,
          shotTimer: rand(0.15, arch.shotCd||0.8),
          projDmg: (arch.projDmg||0) * dmgMul,
          projSpd: arch.projSpd||0,
          coreOpts: arch.coreOpts||null,
          elite,
          // visuals
          drawR: r
        };

        // Wave 30 final boss: keep gameplay hitbox (r) but render bigger + special styling
        if (state.wave === 30 && spec.isBoss && id === "boss" && (idx||0) === 0) {
          eObj.isFinalBoss = true;

          // 최종보스: 덕칠/업그레이드 순삭 방지 + 압박 강화 (웨이브30 전용)
          eObj.hp *= 2.05;                 // 더 단단하게
          eObj.hpMax = eObj.hp;

          // 보스 기본 탄막/접촉 압박 강화
          eObj.projDmg *= 1.25;
          eObj.shotCd  *= 0.82;            // 더 자주 발사
          eObj.shotTimer = Math.min(eObj.shotTimer, eObj.shotCd * 0.6);
          eObj.touchBase *= 1.25;
          eObj.spd *= 1.10;

          // visuals
          eObj.drawR = r * 2.00;
          eObj.color = "#a855f7"; // violet
        } else {
          eObj.isFinalBoss = false;
        }

        // enemy shield(일부 적 전용)
        const shMul = arch.shieldMul || 0;
        if (shMul > 0) {
          eObj.shieldMax = eObj.hpMax * shMul;
          eObj.shield = eObj.shieldMax;
        } else {
          eObj.shieldMax = 0;
          eObj.shield = 0;
        }

state.enemies.push(eObj);
  }
// ---------- Final boss helpers ----------
function finalBossIncomingMul(){
  // 웨이브30 최종보스 전용: 덕칠(포탑 개수) 기반 내성만 적용 (업그레이드 내성 제거)
  const tc = state.turrets.length;
  const extra = Math.max(0, tc - 10);
  const spamDR = clamp(extra * 0.055, 0, 0.70); // 포탑 많을수록 최대 70%까지 감쇄
  const mul = 1 - spamDR;
  // 최소 피해 22% 보장
  return clamp(mul, 0.22, 1.0);
}

// ---------- Expose (Resonance) ----------
function enemyExposeMul(e){
  const t = gameSec();
  if (e && t < (e.resExposeUntil||0)) return 1 + (e.resExposeBonus||0);
  return 1.0;
}
function applyResExpose(e, dur=3.2){
  const t = gameSec();
  const isBoss = (e && (e.kind === 'boss' || e.isFinalBoss));
  const bonus = isBoss ? 0.13 : 0.24;
  e.resExposeBonus = bonus;
  e.resExposeUntil = Math.max(e.resExposeUntil||0, t + dur);
}

// ---------- Overload (mark/burst) ----------
function overloadEnsure(){
  const c = state.core;
  if (typeof c.overloadBurstUntil !== 'number') c.overloadBurstUntil = 0;
  if (typeof c.overloadBurstReadyAt !== 'number') c.overloadBurstReadyAt = 0;
  if (typeof c.overloadWasAbove30 !== 'boolean') c.overloadWasAbove30 = true;
  if (typeof c.overloadExtendReadyAt !== 'number') c.overloadExtendReadyAt = 0;
  if (typeof c.overloadKickReadyAt !== 'number') c.overloadKickReadyAt = 0;
}
function overloadBurstActive(){
  overloadEnsure();
  return gameSec() < (state.core.overloadBurstUntil||0);
}
function applyOverloadMark(e, add=1){
  if (!e) return;
  const t = gameSec();
  e.ovMarkStacks = clamp((e.ovMarkStacks||0) + add, 0, OVERLOAD_CFG.markMax);
  e.ovMarkUntil  = Math.max(e.ovMarkUntil||0, t + OVERLOAD_CFG.markDur);
}
function overloadMarkBonus(e){
  if (!e) return 0;
  const t = gameSec();
  if (t >= (e.ovMarkUntil||0)) return 0;
  const st = clamp(e.ovMarkStacks||0, 0, OVERLOAD_CFG.markMax);
  if (st <= 0) return 0;
  const isBoss = (e.kind === 'boss') || e.isFinalBoss;
  return st * (isBoss ? OVERLOAD_CFG.markBonusBoss : OVERLOAD_CFG.markBonus);
}

function overloadShockBurst(){
  overloadEnsure();
  const t = gameSec();
  state.core.overloadBurstUntil   = t + OVERLOAD_CFG.burstDur;
  state.core.overloadBurstReadyAt = t + OVERLOAD_CFG.burstCd;

  // 연출: 버스트 카드
  try { cineToast("임계 과부하", `버스트 ${Math.round(OVERLOAD_CFG.burstDur)}s`, "#fb7185", 1.05); } catch {}

  // Shockwave: knockback + slow
  const R = OVERLOAD_CFG.shockR;
  for (const e of state.enemies) {
    const dx = e.x - CORE_POS.x, dy = e.y - CORE_POS.y;
    const d = Math.hypot(dx,dy) || 1;
    if (d > R) continue;
    const k = 1 - (d / R);
    const push = OVERLOAD_CFG.shockKnock * (0.35 + 0.65*k);
    e.x += (dx/d) * push;
    e.y += (dy/d) * push;
    // slow
    e.slowMul  = Math.min(e.slowMul || 1.0, OVERLOAD_CFG.shockSlowMul);
    e.slowUntil = Math.max(e.slowUntil || 0, t + OVERLOAD_CFG.shockSlowDur);
  }

  // FX + camera shake
  fxFlash(CORE_POS.x, CORE_POS.y, 640, 'rgba(251,113,133,1)');
  fxRing(CORE_POS.x, CORE_POS.y, CORE_RADIUS+14, CORE_RADIUS+R, '#fb7185');
  fxRing(CORE_POS.x, CORE_POS.y, CORE_RADIUS+28, CORE_RADIUS+R*0.78, '#fda4af');
  fxText('쇼크웨이브!', CORE_POS.x, CORE_POS.y - 156, '#fb7185');
  fxText('과부하 버스트 6s', CORE_POS.x, CORE_POS.y - 138, '#fda4af');

  state.camShakeUntil = t + 0.14;
  state.camShakeDur   = 0.14;
  state.camShakeMag   = 10;

  try { SFX.play('blast'); } catch {}
  try { SFX.play('shield_hit'); } catch {}
}

function updateOverload(dt){
  if (state.core.passiveId !== 'overload') return;
  overloadEnsure();
  const hpFrac = (state.core.hpMax>0) ? (state.core.hp/state.core.hpMax) : 1;
  const above = hpFrac > OVERLOAD_CFG.triggerHp + 1e-6;
  if (state.core.overloadWasAbove30 && !above) {
    const t = gameSec();
    if (t >= (state.core.overloadBurstReadyAt||0)) {
      overloadShockBurst();
    }
  }
  state.core.overloadWasAbove30 = above;
}

function overloadOnRepair(hpFracBefore){
  if (state.core.passiveId !== 'overload') return;
  overloadEnsure();
  const t = gameSec();

  if (hpFracBefore <= OVERLOAD_CFG.repairMarkHp) {
    const list = state.enemies.slice();
    list.sort((a,b)=>{
      const ap = (a.isFinalBoss?2:(a.kind==='boss'?1:0));
      const bp = (b.isFinalBoss?2:(b.kind==='boss'?1:0));
      if (ap !== bp) return bp - ap;
      return dist(a.x,a.y, CORE_POS.x, CORE_POS.y) - dist(b.x,b.y, CORE_POS.x, CORE_POS.y);
    });
    const n = Math.min(OVERLOAD_CFG.repairMarkTargets, list.length);
    for (let i=0;i<n;i++){
      applyOverloadMark(list[i], OVERLOAD_CFG.repairMarkAdd);
      fxRing(list[i].x, list[i].y, 10, (list[i].r||12)+22, '#fb7185');
    }
    if (n>0) fxText('표식 +2', CORE_POS.x, CORE_POS.y - 84, '#fb7185');
  }

  if (t >= (state.core.overloadExtendReadyAt||0) && overloadBurstActive()) {
    const rem = (state.core.overloadBurstUntil||0) - t;
    if (rem > 0 && rem < OVERLOAD_CFG.extendIfRemainLt) {
      state.core.overloadBurstUntil = t + rem + OVERLOAD_CFG.extendAdd;
      state.core.overloadExtendReadyAt = t + OVERLOAD_CFG.extendIcd;
      fxText('버스트 연장 +2s', CORE_POS.x, CORE_POS.y - 104, '#fda4af');
    }
  }
}

function overloadOnAegis(){
  if (state.core.passiveId !== 'overload') return;
  overloadEnsure();
  const t = gameSec();
  if (t < (state.core.overloadKickReadyAt||0)) return;
  state.core.overloadKickReadyAt = t + OVERLOAD_CFG.aegisIcd;
  state.core.overloadBurstReadyAt = Math.max(t, (state.core.overloadBurstReadyAt||0) - OVERLOAD_CFG.aegisCdReduce);
  fxText('과부하 쿨 -6s', CORE_POS.x, CORE_POS.y - 88, '#fb7185');
}


function spawnEnemyForced(id, spec, x, y, elite=false){
  const arch = ENEMY_ARCH[id] || ENEMY_ARCH.grunt;

    const diff = state.diff || DIFF_PRESETS.normal;
  const dmgMul = (1 + Math.max(0, state.wave - 1) * 0.06);
  const r = (arch.r || 12) * (elite ? 1.15 : 1.0);
  const hp = spec.hp * (arch.hpMul||1) * (elite ? 1.8 : 1.0) * (diff.hpMul||1);
  const spd = spec.spd * (arch.spdMul||1) * (elite ? 0.90 : 1.0) * (0.92 + 0.16*Math.random()) * (diff.spdMul||1);

  state.enemies.push({
    x, y,
    hp, hpMax: hp,
    shieldMax: (arch.shieldMul ? (hp*arch.shieldMul) : 0),
    shield: (arch.shieldMul ? (hp*arch.shieldMul) : 0),
    spd, r,
    kind: id,
    color: arch.color || "#f87171",
    seedAng: Math.random()*Math.PI*2,
    orbitDir: (Math.random()<0.5 ? -1 : 1),

    reward: (arch.reward || 12) * (elite ? 1.35 : 1.0),

    slowMul: 1.0,
    slowUntil: 0,

    touchBase: (arch.touchDmg || 9) * dmgMul,
    touchInterval: (arch.touchCd || 0.70),
    touchCd: rand(0.05, arch.touchCd || 0.70),

    ranged: !!arch.ranged,
    bomber: !!arch.bomber,
    explodeDmg: (arch.explodeDmg || 0) * dmgMul,
    explodeRad: arch.explodeRad || 0,
    turretBreakChance: arch.turretBreakChance || 0,

    shootRange: arch.shootRange || 0,
    holdDist: arch.holdDist || 0,
    shotCd: arch.shotCd || 0,
    shotTimer: rand(0.15, arch.shotCd || 0.8),
    projDmg: (arch.projDmg || 0) * dmgMul,
    projSpd: arch.projSpd || 0,
    coreOpts: arch.coreOpts || null,

    elite
  });
}

function spawnEnemyEdgeForced(id, spec, elite=false){
  const side = (Math.random()*4)|0;
  const pad = 26;
  let x,y;
  if (side===0){ x = rand(pad, W-pad); y = -pad; }
  if (side===1){ x = W+pad; y = rand(pad, H-pad); }
  if (side===2){ x = rand(pad, W-pad); y = H+pad; }
  if (side===3){ x = -pad; y = rand(pad, H-pad); }
  spawnEnemyForced(id, spec, x, y, elite);
}

function spawnFinalOrbs(n=3){
  for (let i=0;i<n;i++){
    const side = (Math.random()*4)|0;
    const pad = 30;
    let x,y;
    if (side===0){ x = rand(pad, W-pad); y = -pad; }
    if (side===1){ x = W+pad; y = rand(pad, H-pad); }
    if (side===2){ x = rand(pad, W-pad); y = H+pad; }
    if (side===3){ x = -pad; y = rand(pad, H-pad); }

    const dx = CORE_POS.x - x;
    const dy = CORE_POS.y - y;
    const d = Math.hypot(dx,dy) || 1;
    const sp = 140 + Math.random()*55;
    if (state.projectiles.length >= projCap()) return;
    state.projectiles.push({
      kind:"enemy",
      x, y,
      vx: dx/d * sp,
      vy: dy/d * sp,
      dmg: 18,
      life: 7.0,
      r: 10,
      coreOpts: { shieldArmorPierce: 0.30, hpArmorPierce: 0.10 }
    });
    fxRing(x,y, 8, 60, "#fbbf24");
  }
}

function updateFinalBoss(dt){
  const boss = state.enemies.find(e=>e.kind==="boss");
  if (!boss) return;

  if (!state.final) {
    state.final = {
      phase: 1,
      nextSummonAt: gameSec() + 4.5,
      nextShieldJamAt: gameSec() + 7.0,
      nextLaserAt: gameSec() + 6.0,
      nextEmpAt: gameSec() + 9.0,
      nextOrbsAt: gameSec() + 8.0,
      empUntil: 0,
      empMul: 0.55,
      pending: []
    };
  }
  if (!state.final.pending) state.final.pending = [];

  const t = gameSec();
  const hpFrac = (boss.hpMax>0) ? (boss.hp / boss.hpMax) : 1;
  let phase = 1;
  if (hpFrac <= 0.70) phase = 2;
  if (hpFrac <= 0.35) phase = 3;

  if (phase !== state.final.phase) {
    state.final.phase = phase;

    // 연출/UX: 페이즈 전환(완성감)
    try {
      cineCard("최종 보스", `페이즈 ${phase}`, "#f472b6", 1.65);
      fxFlash(CORE_POS.x, CORE_POS.y, 820, "rgba(244,114,182,1)");
      fxRing(CORE_POS.x, CORE_POS.y, CORE_RADIUS+18, CORE_RADIUS+260, "#f472b6");
      state.camShakeUntil = t + 0.18;
      state.camShakeDur   = 0.18;
      state.camShakeMag   = 10.5;
    } catch {}
    try { SFX.setBgmMode(phase === 1 ? "final1" : phase === 2 ? "final2" : "final3"); } catch {}
    boss.awakeFlash = 1.0;
    boss.awakeFlashPhase = phase;
  }

  // awaken flash decay (visual)
  boss.awakeFlash = Math.max(0, (boss.awakeFlash||0) - dt*1.8);

  // ---- Summons ----
  if (t >= state.final.nextSummonAt) {
    const spec = waveSpec(FINAL_WAVE);
    const s = { hp: spec.hp*0.55, spd: spec.spd*1.05, isBoss:false };
    const n = (phase===1) ? 2 : (phase===2 ? 3 : 4);
    for (let i=0;i<n;i++){
      let id;
      const r = Math.random();
      if (phase===1){
        id = (r < 0.60) ? "grunt" : "shooter";
      } else if (phase===2){
        id = (r < 0.40) ? "shooter" : "shieldbreaker";
      } else {
        id = (r < 0.35) ? "shieldbreaker" : (r < 0.70 ? "bomber" : "shooter");
      }
      spawnEnemyEdgeForced(id, s, Math.random()<0.18);
    }
    fxText("소환!", boss.x, boss.y - 28, "#fbbf24");
    state.final.nextSummonAt = t + ((phase===1)?5.0: (phase===2?4.2:3.6));
  }

  // ---- Shield jam ----
  if (phase >= 2 && t >= state.final.nextShieldJamAt) {
    fxWarnCircle(CORE_POS.x, CORE_POS.y, CORE_RADIUS+24, CORE_RADIUS+140, "#60a5fa", 0.95);
    state.final.pending.push({ kind:"jam", at: t + 0.95, dur: 4.2 });
    state.final.nextShieldJamAt = t + (phase===2 ? 9.5 : 7.5);
  }

  // ---- Laser / EMP / Orbs ----
  if (phase === 3) {
    if (t >= state.final.nextLaserAt) {
      fxLine(boss.x, boss.y, CORE_POS.x, CORE_POS.y, "#f472b6", 1.05, 5);
      state.final.pending.push({ kind:"laser", at: t + 1.05 });
      state.final.nextLaserAt = t + 6.8;
    }
    if (t >= state.final.nextEmpAt) {
      fxWarnCircle(CORE_POS.x, CORE_POS.y, CORE_RADIUS+34, CORE_RADIUS+165, "#fbbf24", 0.9);
      state.final.pending.push({ kind:"emp", at: t + 0.9, dur: 3.6 });
      state.final.nextEmpAt = t + 10.0;
    }
    if (t >= state.final.nextOrbsAt) {
      spawnFinalOrbs(3);
      state.final.nextOrbsAt = t + 8.5;
    }
  }

  // ---- Resolve pending attacks ----
  for (let i = state.final.pending.length - 1; i >= 0; i--) {
    const a = state.final.pending[i];
    if (t < a.at) continue;

    if (a.kind === "jam") {
      state.core.shieldRegenBlockedUntil = Math.max(state.core.shieldRegenBlockedUntil, t + (a.dur||3.0));
      fxText("실드 재생 차단!", CORE_POS.x, CORE_POS.y - 142, "#60a5fa");
    }
    if (a.kind === "laser") {
      damageCore(46, { hpArmorPierce:0.45, shieldArmorPierce:0.35 });
      fxRing(CORE_POS.x, CORE_POS.y, CORE_RADIUS+12, CORE_RADIUS+160, "#f472b6");
      fxText("코어 레이저!", CORE_POS.x, CORE_POS.y - 160, "#f472b6");
    }
    if (a.kind === "emp") {
      state.final.empUntil = Math.max(state.final.empUntil, t + (a.dur||2.5));
      fxText("EMP! 포탑 둔화", CORE_POS.x, CORE_POS.y - 156, "#fbbf24");
    }

    state.final.pending.splice(i,1);
  }
}



  // ---------- Turrets / Projectiles ----------
  function turretBase(t){
    const b = TURRET_TYPES[t.type];
    const u = state.upg;
    // global upgrades
    const dmgMul  = 1 + 0.15*u.turretDmg;
    const fireMul = 1 + 0.10*u.turretFire;
    const rangeAdd = 12*u.turretRange;

    const out = { ...b };
    out.dmg = b.dmg * dmgMul;
    out.fireRate = b.fireRate * fireMul;
    out.range = b.range + rangeAdd;

    // type-specific upgrades
    if (t.type === "slow") {
      out.slow = clamp(b.slow + 0.06*u.slowPower, 0, 0.85);
    }
    if (t.type === "splash") {
      out.splash = b.splash + 8*u.splashRadius;
    }
    if (t.type === "shred") {
      // 보호막 추가피해 배율 강화
      const baseMul = (b.shieldMul||1.0);
      out.shieldMul = baseMul + 0.15*u.shredFocus;
    }
    if (t.type === "breaker") {
      // 취약 표식(받피증/지속) 강화
      out.vulnBonus = clamp((b.vulnBonus||0) + 0.03*u.breakerMark, 0, 0.60);
      out.vulnDur = (b.vulnDur||2.6) + 0.2*u.breakerMark;
    }
    // 코어 패시브: 포탑 보너스
    if (state.core.passiveId === "resonance") {
      const g = resonanceGauge01();
      // 게이지 기반(최대): 피해 +30%, 공속 +18%
      out.dmg *= (1 + 0.30*g);
      out.fireRate *= (1 + 0.18*g);
    }
    // 임계 과부하: 저체력일수록 포탑 화력/공속 증가
    if (state.core.passiveId === "overload") {
      const hpFrac = state.core.hpMax>0 ? (state.core.hp/state.core.hpMax) : 1;
      // HP 40% 이하부터 가속, 10%에서 최대
      const tO = clamp((0.40 - hpFrac) / 0.30, 0, 1);
      // 최대: 피해 +75%, 공속 +55%
      out.dmg *= (1 + 0.75*tO);
      out.fireRate *= (1 + 0.55*tO);
      // 극저체력: 약한 관통 1회
      if (tO >= 0.95) out.pierce = Math.max(out.pierce||0, 1);
    }
    // 코어 오버드라이브: 포탑 보너스 없음 (수정탑 직접 공격)
    if (state.core.passiveId === "overdrive") {
      // intentionally no turret stat bonuses
    }
    return out;
  }

  function fireTurret(t, target){
    const s = turretBase(t);
    const dx = target.x - t.x, dy = target.y - t.y;
    const d = Math.hypot(dx,dy) || 1;

    const projMul = 1 + 0.15*state.upg.projSpeed;
    const sp = s.projSpd * state.mods.turretProjMul * projMul;

    let dmg = s.dmg * state.mods.turretDmgMul;
    const critChance = 0.02*state.upg.turretCrit;
    const isCrit = (critChance > 0) && (Math.random() < critChance);
    if (isCrit) dmg *= 1.5;

    if (state.projectiles.length >= projCap()) return;

    const isOvBurst = (state.core.passiveId === "overload") && overloadBurstActive();

    state.projectiles.push({
      kind: "turret",
      x: t.x, y: t.y,
      vx: dx/d * sp,
      vy: dy/d * sp,
      dmg: dmg,
      crit: isCrit,
      splash: s.splash,
      slow: s.slow,
      shieldMul: (s.shieldMul||1.0),
      vulnBonus: (s.vulnBonus||0),
      vulnDur: (s.vulnDur||0),
      life: 1.7,
      r: isCrit ? 4.6 : 3.5,
      pierce: (s.pierce||0) + (isOvBurst ? OVERLOAD_CFG.burstPierceAdd : 0),
      ovBurst: isOvBurst,
      ovMiniSplash: (isOvBurst && ((s.splash||0) <= 0)),
      ovTrail: isOvBurst,
      chain: (s.chain||0),
      chainRange: (s.chainRange||0),
      chainMul: (s.chainMul||0),
      hitSet: null,
      // visual-only: for projectile styling
      tType: t.type
    });

    // turret-type muzzle ring (visual only)
    const mCol = (t.type === "basic")   ? "#93c5fd" :
                 (t.type === "slow")    ? "#a7f3d0" :
                 (t.type === "shred")   ? "#22d3ee" :
                 (t.type === "breaker") ? "#fbbf24" :
                 (t.type === "splash")  ? "#f472b6" : "#93c5fd";
    fxRing(t.x,t.y, 6, 28, mCol);

    sfxShoot();
  }

  
  function enemyShoot(e){
    const dx = CORE_POS.x - e.x, dy = CORE_POS.y - e.y;
    const d = Math.hypot(dx,dy) || 1;
    const sp = e.projSpd || 320;

    if (state.projectiles.length >= projCap()) return;

    const isOvBurst = (state.core.passiveId === "overload") && overloadBurstActive();

    const diff = state.diff || DIFF_PRESETS.normal;

    state.projectiles.push({
      kind: "enemy",
      x: e.x, y: e.y,
      vx: dx/d * sp,
      vy: dy/d * sp,
      dmg: (e.projDmg || 8) * (e.elite ? 1.10 : 1.0) * (diff.dmgMul||1),
      life: 2.2,
      r: 3,
      coreOpts: e.coreOpts || null,
      projCol: (e.kind==="disruptor" ? "#22c55e" : "#fbbf24")
    });

    SFX.play("enemy_shoot");
    fxRing(e.x, e.y, 6, 26, (e.kind==="disruptor" ? "#22c55e" : "#fbbf24"));
  }

  function bombExplode(e){
    const diff = state.diff || DIFF_PRESETS.normal;
    SFX.play("blast");
    fxRing(e.x, e.y, 16, e.explodeRad || 120, "#34d399");
    fxText("폭발!", e.x, e.y - 16, "#34d399");

    const dmg = (e.explodeDmg || 32) * (e.elite ? 1.10 : 1.0) * (diff.dmgMul||1);
    damageCore(dmg, e.coreOpts || null);

    // 폭발 반경 내 포탑 파손(확률)
    const rad = e.explodeRad || 120;
    const chance = e.turretBreakChance || 0.35;
    for (let j = state.turrets.length - 1; j >= 0; j--) {
      const t = state.turrets[j];
      if (dist(t.x,t.y, e.x,e.y) <= rad) {
        if (Math.random() < chance) {
          fxText("포탑 파손!", t.x, t.y - 10, "#ff9fb2");
          fxRing(t.x,t.y, 10, 70, "#ff9fb2");
          state.turrets.splice(j,1);
        }
      }
    }
  }


function enemyVulnMul(e){
    const t = gameSec();
    if (!e) return 1.0;
    if (t < (e.vulnUntil||0)) return 1.0 + (e.vulnBonus||0);
    return 1.0;
  }

  function dealDamageEnemy(e, rawDmg, p){
    if (!e) return { hpLost:0, shieldLost:0 };
    const hpBefore = e.hp;
    const shBefore = e.shield||0;
    let remain = rawDmg;
    let shLost = 0;

    if (shBefore > 0.01) {
      const sm = (p && p.shieldMul) ? p.shieldMul : 1.0;
      const shWanted = remain * sm;
      const absorbed = Math.min(shBefore, shWanted);
      e.shield = shBefore - absorbed;
      shLost = absorbed;
      remain -= absorbed / sm;
      if (absorbed > 0.01) {
        const gt = gameSec();
        if (gt - (e._shFxAt||0) > 0.06) {
          e._shFxAt = gt;
          const inten = clamp(absorbed / Math.max(24, shBefore), 0.25, 1);
          fxEnemyShieldHit(e.x, e.y, inten, e);
        }
      }
    }

    if (remain > 0) e.hp -= remain;
    if ((e.shield||0) < 0) e.shield = 0;

    const hpLost = Math.max(0, hpBefore - e.hp);
    const shLost2 = Math.max(0, shBefore - (e.shield||0));

    if (hpLost > 0.01) {
      const gt = gameSec();
      if (gt - (e._hpFxAt||0) > 0.07) {
        e._hpFxAt = gt;
        const inten = clamp(hpLost / Math.max(30, hpBefore), 0.25, 1);
        fxEnemyHpHit(e.x, e.y, inten, e);
      }
    }

    return { hpLost: hpLost, shieldLost: shLost2 };
  }

function applyProjectileHit(p, hit){
    // 임계 과부하: 포탑 적중 시 표식(최대 5중첩/4s)
    if (p.kind === "turret" && state.core.passiveId === "overload") {
      applyOverloadMark(hit, 1);
    }

    const tNow = nowSec();

    function calcDmg(target, base){
      let dmg = base;
      dmg *= enemyExposeMul(target);
      dmg *= enemyVulnMul(target);
      // 과부하 표식: 받는 피해 증가
      if (state.core.passiveId === "overload") dmg *= (1 + overloadMarkBonus(target));
      // 공명 방출 노출(추가 배율)
      if (tNow < (target.resExposeUntil||0)) {
        const m = (target.kind === "boss") ? RESONANCE_CFG.dischargeExposeMulBoss : RESONANCE_CFG.dischargeExposeMul;
        dmg *= m;
      }
      // 최종보스: 포탑 내성 (버스트 중 25% 부분 무시)
      if (p.kind === "turret" && target.isFinalBoss) {
        let mul = finalBossIncomingMul();
        if (state.core.passiveId === "overload" && p.ovBurst) {
          mul = mul + (1 - mul) * OVERLOAD_CFG.finalBossResistIgnore;
        }
        dmg *= mul;
      }
      return dmg;
    }

    // 메인 타격
    let dmg = calcDmg(hit, p.dmg);
    dealDamageEnemy(hit, dmg, p);

    // 방호 파괴(취약): 메인 타격에서만 부여
    if (p.kind === "turret" && (p.vulnBonus||0) > 0 && hit) {
      const t = gameSec();
      hit.vulnBonus = Math.max(hit.vulnBonus||0, p.vulnBonus||0);
      hit.vulnUntil = Math.max(hit.vulnUntil||0, t + (p.vulnDur||2.6));
      const last = hit._vulnFxAt||0;
      if (t - last > 0.8) {
        hit._vulnFxAt = t;
        fxText("취약!", hit.x, hit.y - 20, "#fca5a5");
        fxRing(hit.x, hit.y, 8, 44, "#fca5a5");
      }
    }

    // 체인(공명/과부하): 추가로 가까운 적 1명에게 전이
    if ((p.chain||0) > 0 && state.enemies.length > 1) {
      let best = null, bestD = 1e9;
      const R = p.chainRange || 0;
      if (R > 1) {
        for (const e of state.enemies) {
          if (e === hit) continue;
          const d = dist(hit.x, hit.y, e.x, e.y);
          if (d <= R && d < bestD) { bestD = d; best = e; }
        }
        if (best) {
          const mul = clamp(p.chainMul||0.5, 0.1, 0.9);
          const cdmg = calcDmg(best, p.dmg * mul);
          dealDamageEnemy(best, cdmg, p);
          fxRing(best.x, best.y, 6, 30, "#fdba74");
          fxRing(hit.x, hit.y, 6, 30, "#fdba74");
        }
      }
    }

    // 슬로우
    if (p.slow > 0 && hit) {
      const t = nowSec();
      hit.slowMul = Math.min(hit.slowMul || 1.0, 1 - p.slow);
      const slowDur = 1.2 + 0.25*state.upg.slowDuration;
      hit.slowUntil = Math.max(hit.slowUntil || 0, t + slowDur);
    }

    // 스플래시
    if (p.splash > 0) {
      for (const e of state.enemies) {
        if (p.hitSet && p.hitSet.has(e)) continue;
        const d = dist(p.x,p.y, e.x,e.y);
        if (d <= p.splash) {
          const fall = 1 - (d / p.splash);
          const coreLow = (state.core.hp / state.core.hpMax) <= 0.5;
          const splashMul = coreLow ? 0.50 : 0.65;
          const sdmg = calcDmg(e, p.dmg * splashMul * fall);
          dealDamageEnemy(e, sdmg, p);
        }
      }
      fxRing(p.x,p.y, 8, p.splash, "#93c5fd");
    } else {
      fxRing(p.x,p.y, 6, 36, "#93c5fd");
    }

    // 임계 과부하: 버스트 중(스플래시 없는 포탑) 소형 폭발
    if (p.ovMiniSplash) {
      const R2 = OVERLOAD_CFG.miniSplashR;
      for (const e2 of state.enemies) {
        if (!e2 || e2===hit) continue;
        if (p.hitSet && p.hitSet.has(e2)) continue;
        const d2 = dist(p.x,p.y, e2.x,e2.y);
        if (d2 > R2) continue;
        const mdmg = calcDmg(e2, p.dmg * OVERLOAD_CFG.miniSplashMul);
        dealDamageEnemy(e2, mdmg, p);
      }
      fxRing(p.x,p.y, 10, R2, "#fb7185");
    }
  }

// ---------- FX ----------
  function fxRing(x,y, r0, r1, color){ state.fx.push({ kind:"ring", x,y, t:0, dur:0.35, r0, r1, color }); }

  function fxFlash(x,y, r=520, color="rgba(255,255,255,1)") {
    // Radial flash (used for Overload/impact moments)
    state.fx.push({ kind:"flash", x, y, t:0, dur:0.22, r, color });
  }
function fxLine(x1,y1,x2,y2, color, dur=0.9, width=4){
    state.fx.push({ kind:"line", x1,y1,x2,y2, t:0, dur, color, width });
  }
  function fxWarnCircle(x,y, r0, r1, color, dur=0.9){
    state.fx.push({ kind:"warn", x,y, t:0, dur, r0, r1, color });
  }

  function fxText(text,x,y,color){ state.fx.push({ kind:"text", x,y, t:0, dur:0.9, text, color }); }
  function fxShieldWave(x,y, radius){ state.fx.push({ kind:"shieldWave", x,y, t:0, dur:0.42, r0:radius, r1:radius+68, color:"#60a5fa" }); }

  // ---------- Enemy Hit/Death FX (visual-only) ----------
  // NOTE: HP low "blue flame" effect is handled elsewhere and remains unchanged.
  function fxSpark(x,y, dx,dy, color, dur=0.22, width=2, tail=14){
    state.fx.push({ kind:"spark", x,y, t:0, dur, dx,dy, color, width, tail });
  }

  function fxShard(x,y, dx,dy, color, dur=0.55, size=8){
    state.fx.push({ kind:"shard", x,y, t:0, dur, dx,dy, color, size,
      rot: Math.random() * Math.PI * 2,
      spin: rand(-9, 9)
    });
  }

  function fxSparksBurst(x,y, color, n=6, dist=44, dur=0.22, width=2, tail=14){
    if (state.fx.length > 520) return;
    for (let i=0;i<n;i++){
      const a = Math.random() * Math.PI * 2;
      const d = dist * (0.55 + Math.random() * 0.90);
      const dd = dur  * (0.75 + Math.random() * 0.55);
      const w  = width * (0.70 + Math.random() * 0.80);
      const tl = tail  * (0.55 + Math.random() * 0.90);
      fxSpark(x, y, Math.cos(a)*d, Math.sin(a)*d, color, dd, w, tl);
    }
  }

  function fxShardsBurst(x,y, color, n=6, dist=64, dur=0.55, size=8){
    if (state.fx.length > 520) return;
    for (let i=0;i<n;i++){
      const a = Math.random() * Math.PI * 2;
      const d = dist * (0.35 + Math.random() * 0.95);
      const dd = dur * (0.75 + Math.random() * 0.55);
      const s = size * (0.65 + Math.random() * 1.05);
      fxShard(x, y, Math.cos(a)*d, Math.sin(a)*d, color, dd, s);
    }
  }

  function enemyFxPalette(e){
    const kind = (e && e.kind) ? String(e.kind) : "";
    let shield = "#93c5fd";
    let hp     = "#fb7185";
    let death  = "#cbe6ff";
    let accent = "#93c5fd";
    if (kind === "disruptor") { death = "#86efac"; accent = "#22c55e"; }
    if (kind === "boss")      { death = "#fda4af"; accent = "#f472b6"; }
    if (e && e.isFinalBoss)    { death = "#f5d0fe"; accent = "#f472b6"; }
    return { shield, hp, death, accent };
  }

  function fxEnemyShieldHit(x,y, inten=0.6, e){
    const pal = enemyFxPalette(e);
    const n = Math.round(3 + 4*inten);
    const dist = 26 + 32*inten;
    const dur  = 0.16 + 0.14*inten;

    fxRing(x, y, 5, 28 + 28*inten, pal.shield);
    fxSparksBurst(x, y, pal.shield, n, dist, dur, 2.2, 12 + 12*inten);

    // small crack lines
    const a0 = Math.random() * Math.PI * 2;
    const len = 8 + 18*inten;
    const dx = Math.cos(a0) * len;
    const dy = Math.sin(a0) * len;
    fxLine(x-dx, y-dy, x+dx, y+dy, "rgba(191,219,254,0.95)", 0.10 + 0.08*inten, 2.2);
    if (Math.random() < 0.55) {
      const a1 = a0 + Math.PI/2 + rand(-0.35, 0.35);
      const len2 = len * (0.75 + Math.random()*0.45);
      const dx2 = Math.cos(a1) * len2;
      const dy2 = Math.sin(a1) * len2;
      fxLine(x-dx2, y-dy2, x+dx2, y+dy2, "rgba(224,242,254,0.85)", 0.09 + 0.08*inten, 1.9);
    }
  }

  function fxEnemyHpHit(x,y, inten=0.6, e){
    const pal = enemyFxPalette(e);
    const n = Math.round(4 + 5*inten);
    const dist = 22 + 42*inten;
    const dur  = 0.14 + 0.16*inten;

    fxRing(x, y, 4, 18 + 22*inten, pal.hp);
    fxSparksBurst(x, y, pal.hp, n, dist, dur, 2.4, 14 + 16*inten);
  }

  function fxEnemyDeathBurst(e){
    if (!e) return;
    const pal = enemyFxPalette(e);
    const x = e.x, y = e.y;
    const m = (e.kind === "boss") ? 1.85 : (e.elite ? 1.25 : 1.0);

    fxRing(x, y, 10, 62*m, pal.accent);
    fxSparksBurst(x, y, pal.accent, Math.round(10*m), 66*m, 0.26, 2.8, 18*m);
    fxShardsBurst(x, y, pal.death,  Math.round(7*m),  74*m, 0.56, 10*m);
  }

  // ---------- Cinematic UI (웨이브/보스/패시브 카드) ----------
  function cineEnsure(){
    if (!state.cine) state.cine = { cards: [] };
    if (!Array.isArray(state.cine.cards)) state.cine.cards = [];
  }
  function cineCard(title, sub="", color="#93c5fd", dur=1.35){
    cineEnsure();
    const t0 = gameSec();
    state.cine.cards.push({ title: String(title||""), sub: String(sub||""), color, t0, dur });
    // 너무 많이 쌓이지 않게
    if (state.cine.cards.length > 4) state.cine.cards.splice(0, state.cine.cards.length - 4);
  }


  // 중앙 카드가 화면을 가리는 경우(스킬/버스트/공명 등) — 상단 토스트로 표시
  function cineToast(title, sub="", color="#93c5fd", dur=1.05){
    cineEnsure();
    const t0 = gameSec();
    state.cine.cards.push({ title: String(title||""), sub: String(sub||""), color, t0, dur, kind:"toast" });
    if (state.cine.cards.length > 6) state.cine.cards.splice(0, state.cine.cards.length - 6);
  }

  function passiveAccent(id){
    switch(String(id||"")){
      case "rebuild":   return "#60a5fa";
      case "resonance": return "#fb923c";
      case "overload":  return "#fb7185";
      case "overdrive": return "#c4b5fd";
      default: return "#93c5fd";
    }
  }

  // ---------- Blue Flames ----------
  function spawnBlueFlame(intensity){
    const baseX = CORE_POS.x + rand(-16, 16);
    const baseY = CORE_POS.y + CORE_RADIUS*0.60 + rand(-3, 7);

    const size = lerp(6, 20, intensity) * (0.85 + Math.random()*0.35);
    const ttl  = lerp(0.35, 0.95, intensity) * (0.85 + Math.random()*0.3);

    state.flames.push({
      x: baseX, y: baseY,
      vx: rand(-18, 18) * (0.4 + intensity),
      vy: rand(-55, -145) * (0.6 + intensity),
      life: 0, ttl,
      size,
      wobble: rand(0.8, 1.6),
      phase: rand(0, Math.PI*2)
    });
  }

  function updateBlueFlames(dt){
    // ✅ 붕괴 중엔 즉시 제거
    if (state.phase === "fail") {
      state.flames.length = 0;
      state.flameSpawnAcc = 0;
      return;
    }

    const hpRatio = state.core.hp / state.core.hpMax;
    const THRESH = 0.70;

    if (hpRatio > THRESH) {
      state.flames.length = 0;
      state.flameSpawnAcc = 0;
      return;
    }

    const intensity = clamp((THRESH - hpRatio) / THRESH, 0, 1);
    const spawnPerSec = intensity * 28;
    state.flameSpawnAcc += spawnPerSec * dt;

    while (state.flameSpawnAcc >= 1) {
      spawnBlueFlame(intensity);
      state.flameSpawnAcc -= 1;
    }

    for (let i = state.flames.length - 1; i >= 0; i--) {
      const f = state.flames[i];
      f.life += dt;
      f.phase += dt * f.wobble;
      f.x += (f.vx + Math.sin(f.phase)*18) * dt;
      f.y += f.vy * dt;
      f.vx *= (1 - dt*0.9);
      f.vy *= (1 - dt*0.15);
      if (f.life >= f.ttl) state.flames.splice(i, 1);
    }
  }

  function drawBlueFlames(){
    for (const f of state.flames) {
      const t = clamp(f.life / f.ttl, 0, 1);
      const a = (1 - t) * 0.85;
      const r = f.size * (1 - t*0.45);

      ctx.save();
      ctx.globalAlpha = a;

      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r*1.5);
      g.addColorStop(0.00, `rgba(219,234,254,${a})`);
      g.addColorStop(0.35, `rgba(147,197,253,${a*0.9})`);
      g.addColorStop(1.00, `rgba(96,165,250,0)`);
      ctx.fillStyle = g;

      ctx.beginPath();
      ctx.arc(f.x, f.y, r*1.25, 0, Math.PI*2);
      ctx.fill();

      ctx.globalAlpha = a*0.95;
      ctx.fillStyle = `rgba(96,165,250,${a})`;
      ctx.beginPath();
      ctx.ellipse(f.x, f.y, r*0.55, r*0.95, 0, 0, Math.PI*2);
      ctx.fill();

      ctx.restore();
    }
  }

  // ---------- Collapse / Debris ----------
      function spawnDebrisBurst(){
    // ✅ 수정 파편(파랑) + 금속 파편(금색) + 미세 더스트(연파랑)
    const push = (kind, blue, big=false)=>{
      const ang = rand(0, Math.PI*2);
      const spd = (kind === 'dust') ? rand(140, 760) : rand(110, 520);
      const r0  = big ? rand(10, 18) : rand(3.0, 8.0);
      const r   = (kind === 'dust') ? rand(1.2, 3.0) : r0;

      let w = r*0.9, h = r*1.8;
      if (kind === 'plate') { w = r*1.8; h = r*1.0; }
      if (kind === 'dust')  { w = r; h = r; }

      state.debris.push({
        kind,
        x: CORE_POS.x + rand(-10,10),
        y: CORE_POS.y + rand(-10,10),
        vx: Math.cos(ang)*spd,
        vy: Math.sin(ang)*spd - rand(80,260),
        r,
        w,
        h,
        rot: rand(0, Math.PI*2),
        vr: rand(-10, 10),
        life: 0,
        ttl: (kind === 'dust') ? rand(0.55, 1.15) : rand(1.0, 2.6),
        color: blue ? 'rgba(147,197,253,1)' : 'rgba(230,208,122,1)',
        stroke: blue ? 'rgba(15,23,42,0.65)' : 'rgba(15,23,42,0.55)'
      });
    };

    // 큰 수정 파편(실루엣 느낌)
    for (let i=0;i<14;i++) push('shard', true, true);

    // 중간 수정 파편
    for (let i=0;i<38;i++) push('shard', Math.random()<0.85, false);

    // 금속 플레이트 파편
    for (let i=0;i<26;i++) push('plate', false, (Math.random()<0.25));

    // 미세 더스트
    for (let i=0;i<18;i++) push('dust', true, false);
  }

  function updateDebris(dt){
    for (let i=state.debris.length-1;i>=0;i--){
      const d = state.debris[i];
      d.life += dt;

      d.vy += 560 * dt;
      d.vx *= (1 - dt*0.25);
      d.vy *= (1 - dt*0.05);

      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.rot += d.vr * dt;

      const ground = CORE_POS.y + 150;
      if (d.y > ground) {
        d.y = ground;
        d.vy *= -0.25;
        d.vx *= 0.65;
      }

      if (d.life >= d.ttl) state.debris.splice(i,1);
    }
  }

      function drawDebris(){
    for (const d of state.debris){
      const t = clamp(d.life / d.ttl, 0, 1);
      const a = (1 - t) * 0.95;

      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(d.x, d.y);
      ctx.rotate(d.rot);

      if (d.kind === 'dust') {
        const rr = d.r * (1 + t*0.6);
        const g = ctx.createRadialGradient(0,0,0, 0,0, rr*2.2);
        g.addColorStop(0.0, 'rgba(219,234,254,'+(0.55*a)+')');
        g.addColorStop(0.35,'rgba(147,197,253,'+(0.35*a)+')');
        g.addColorStop(1.0, 'rgba(96,165,250,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0,0, rr*2.0, 0, Math.PI*2);
        ctx.fill();
        ctx.restore();
        continue;
      }

      // 공통: 파편 바디
      ctx.fillStyle = d.color;
      ctx.beginPath();

      if (d.kind === 'plate') {
        // 얇은 금속 플레이트(챔퍼)
        const w = d.w, h = d.h;
        const c = Math.min(w,h) * 0.25;
        ctx.moveTo(-w*0.5 + c, -h*0.5);
        ctx.lineTo(w*0.5 - c, -h*0.5);
        ctx.lineTo(w*0.5, -h*0.5 + c);
        ctx.lineTo(w*0.5, h*0.5 - c);
        ctx.lineTo(w*0.5 - c, h*0.5);
        ctx.lineTo(-w*0.5 + c, h*0.5);
        ctx.lineTo(-w*0.5, h*0.5 - c);
        ctx.lineTo(-w*0.5, -h*0.5 + c);
      } else {
        // 수정 샤드(길쭉한 다이아)
        const w = d.w, h = d.h;
        ctx.moveTo(0, -h*0.5);
        ctx.lineTo(w*0.5, 0);
        ctx.lineTo(0, h*0.5);
        ctx.lineTo(-w*0.5, 0);
      }

      ctx.closePath();
      ctx.fill();

      // 외곽선(살짝)
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = d.stroke;
      ctx.stroke();

      ctx.restore();
    }
  }

  function drawBlueExplosionFlash(){
    if (!(state.phase === "fail" && state.collapse)) return;
    const t = state.collapse.boomT;

    const flashDur = 0.28;
    if (t < flashDur) {
      const k = 1 - (t / flashDur);
      const a = 0.75 * k;
      const r = lerp(120, 520, 1 - k);

      ctx.save();
      ctx.globalAlpha = a;
      ctx.globalCompositeOperation = "lighter";

      const g = ctx.createRadialGradient(CORE_POS.x, CORE_POS.y, 0, CORE_POS.x, CORE_POS.y, r);
      g.addColorStop(0.00, "rgba(219,234,254,1)");
      g.addColorStop(0.35, "rgba(147,197,253,0.85)");
      g.addColorStop(1.00, "rgba(96,165,250,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      ctx.restore();
    }

    const glowDur = 0.55;
    if (t < glowDur) {
      const k = 1 - (t / glowDur);
      const a = 0.18 * k;
      const r = lerp(240, 760, 1 - k);

      ctx.save();
      ctx.globalAlpha = a;

      const g2 = ctx.createRadialGradient(CORE_POS.x, CORE_POS.y, 0, CORE_POS.x, CORE_POS.y, r);
      g2.addColorStop(0.00, "rgba(96,165,250,1)");
      g2.addColorStop(1.00, "rgba(96,165,250,0)");
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  // ---------- Core Damage ----------
  function triggerCollapse(){
    if (state.phase === "fail") return;

    // ✅ 붕괴 순간: 보호막/불꽃 즉시 제거
    state.core.shield = 0;
    state.core.aegisActiveUntil = 0;
    state.flames.length = 0;
    state.flameSpawnAcc = 0;

    state.phase = "fail";

    // BGM: 실패 모드(어둡게/느리게)
    try { SFX.setBgmMode("fail"); } catch {}
    state.spawn = null;
    state.autoStartAt = 0;

    // 월드 정리(멈춤/버그 방지)
    state.enemies.length = 0;
    state.projectiles.length = 0;

    state.collapse = { t:0, boomT:0, shake:1.25, fade:0 };

    SFX.play("core_break");
    SFX.play("boom");

    fxText("수정탑 붕괴!", CORE_POS.x, CORE_POS.y - 12, "#93c5fd");
    fxShieldWave(CORE_POS.x, CORE_POS.y, CORE_RADIUS + 18);
    fxShieldWave(CORE_POS.x, CORE_POS.y, CORE_RADIUS + 22);
    fxRing(CORE_POS.x, CORE_POS.y, CORE_RADIUS + 16, 360, "#93c5fd");
    fxRing(CORE_POS.x, CORE_POS.y, CORE_RADIUS + 26, 520, "#60a5fa");
    fxRing(CORE_POS.x, CORE_POS.y, CORE_RADIUS + 36, 680, "#dbeafe");

    spawnDebrisBurst();

    // 와이어는 즉시 올레드(HP=0)
    wireTick(0);

    // 기록 저장(실패)
    try {
      if (state.stats) {
        state.stats.runEnd = nowSec();
        state.stats.finalWave = state.wave|0;
      }
      updateRecordsWithRun(buildRunSummary(false));
      renderRecords(true);
    } catch(e) {}
  }

  function damageCore(amount, opts){
    if (state.phase === "fail") return;
    if (state.god) { return; }

    const prevShield = state.core.shield;
    const prevHP     = state.core.hp;

    opts = opts || null;

    // 코어 패시브: 방어/피해감소 계산
    const hpFrac0 = state.core.hpMax>0 ? (state.core.hp/state.core.hpMax) : 1;


    // 패시브 보정: 방어/보호막방어 추가치
    let bonusHpArmor = 0;
    let bonusShieldArmor = 0;
    // 임계 과부하: 저체력 피해 감소 (HP 35%↓부터, 10%에서 최대 25%)
    if (state.core.passiveId === "overload") {
      const tO = clamp((0.35 - hpFrac0) / 0.25, 0, 1);
      amount *= (1 - 0.25*tO);
    }

    // 코어 오버드라이브: 저체력 피해 감소 (HP 40%↓부터, 10%에서 최대 18%)
    if (state.core.passiveId === "overdrive") {
      const tO = clamp((0.40 - hpFrac0) / 0.30, 0, 1);
      amount *= (1 - 0.18*tO);
    }

    // 재건 코어: 저체력 피해감소 (HP 50%↓부터, 10%에서 최대 -12%)
    if (state.core.passiveId === "rebuild") {
      // HP 70%↓부터 방어/DR이 시작, HP 10%에서 최대치
      // (주의) 예전 hpPct/clamp01 참조로 런타임 에러가 나서 적/포탑 공격이 멈추는 버그가 있었음
      const tB = clamp((0.70 - hpFrac0) / 0.60, 0, 1);       // 70%->0, 10%->1
      // 저체력일수록 방어/보호막방어 보정 (최대 방어 +15 / 보호막방어 +7.5)
      bonusHpArmor = 15 * tB;
      bonusShieldArmor = 7.5 * tB;
      amount *= (1 - 0.12*tB);

      // 실드 파괴 직후 긴급 보강(피해 -38%)
      const tNow = gameSec();
      if (tNow < (state.core.rebuildEmergencyUntil||0)) {
        amount *= (1 - 0.38);
      }
    }
// 옵션: 특정 공격이 방어력을 일부 무시/강화
    const baseShieldArmor = state.core.shieldArmor + bonusShieldArmor;
    const baseHpArmor     = state.core.hpArmor + bonusHpArmor;

    const baseAbsorbMul   = state.mods.shieldAbsorbMul;

    const effShieldArmor = Math.max(0, (baseShieldArmor) * ((opts && opts.shieldArmorPierce) ? (1 - opts.shieldArmorPierce) : 1));
    const effHpArmor     = Math.max(0, (baseHpArmor) * ((opts && opts.hpArmorPierce) ? (1 - opts.hpArmorPierce) : 1));
    const effAbsorbMul   = (opts && opts.bypassShield) ? 0 : baseAbsorbMul;

    let remain = amount;
    if (opts && opts.shieldBonusMul && state.core.shield > 0.01) {
      remain *= opts.shieldBonusMul;
    }

    // 1) 보호막 흡수 (+ 보호막 방어력)
    // - shieldAbsorbMul: (0~1) 보호막이 흡수에 참여하는 비율 (이벤트로 0이 될 수 있음)
    // - shieldArmor: 보호막에 들어가는 피해를 고정 감산 (피해를 HP로 "넘기지" 않고, 총 피해를 줄임)
    if (state.core.shield > 0 && effAbsorbMul > 0) {
      const mul = clamp(effAbsorbMul, 0, 1);

      const shieldPortion = remain * mul;   // 보호막 쪽으로 들어가는 몫
      const bypassPortion = remain - shieldPortion; // 보호막을 우회해서 HP로 바로 가는 몫

      const shieldDmgWanted = Math.max((shieldPortion > 0.01 ? 1.0 : 0), shieldPortion - effShieldArmor); // 최소 1 피해
      const absorbed = Math.min(state.core.shield, shieldDmgWanted);

      state.core.shield -= absorbed;

      const spill = shieldDmgWanted - absorbed; // 보호막이 부족해서 새는 피해
      remain = bypassPortion + spill;

      if (absorbed > 0.01) {
        fxShieldWave(CORE_POS.x, CORE_POS.y, CORE_RADIUS + 18);
        sfxShieldHit();
        // 공명 반격: 보호막이 실제로 흡수한 양으로 게이지 충전
        resonanceOnAbsorb(absorbed);
      }

      // 보호막이 0으로 떨어지는 순간
      if (prevShield > 0 && state.core.shield <= 0.0001) {
        state.core.shield = 0;
        SFX.play("shield_break");

        // 재건 코어: 실드 파괴 직후 긴급 보강 발동(쿨 7초)
        if (state.core.passiveId === "rebuild") {
          const tNow = gameSec();
          const readyAt = (state.core.rebuildEmergencyReadyAt||0);
          if (tNow >= readyAt) {
            const dur = (state.wave === FINAL_WAVE) ? 1.9 : 1.5;
            state.core.rebuildEmergencyUntil = tNow + dur;
            state.core.rebuildEmergencyReadyAt = tNow + 7.0;
            fxText("긴급 보강!", CORE_POS.x, CORE_POS.y - 128, "#93c5fd");
            fxRing(CORE_POS.x, CORE_POS.y, CORE_RADIUS+10, CORE_RADIUS+150, "#93c5fd");
            try { cineToast("재건 코어", `긴급 보강 ${dur.toFixed(1)}s`, "#60a5fa", 1.05); } catch {}
          }
        }

        // 공명 반격: 패널티 제거됨
      }
    }

    // 2) HP 피해 (+ 방어력)
    if (remain > 0.01) {
      const hpDmg = Math.max(1.0, remain - effHpArmor); // 최소 1 피해는 들어가게
      state.core.hp -= hpDmg;

      fxRing(CORE_POS.x, CORE_POS.y, CORE_RADIUS+8, CORE_RADIUS+70, "#60a5fa");

      if (state.core.hp < prevHP) {
        state.core.lastHpDamageAt = gameSec();
        sfxHpHit();
      }
    }

    // 통계: 실제로 깎인 총량(보호막+HP)
    const shLost = Math.max(0, prevShield - state.core.shield);
    const hpLost = Math.max(0, prevHP - state.core.hp);
    if (hpLost > 0.001) state.core.hpDirectDamaged = true;
    // 공명 반격: HP 피해도 공명 게이지로 환산(전투/상황 무관)
    if (hpLost > 0.001 && state.core.passiveId === "resonance") {
      resonanceOnAbsorb(hpLost * RESONANCE_CFG.hpMul);
    }
    // 공명 반격: 패널티 없음(쿨/상한으로만 제어)
    state.stats.damageTaken = (state.stats.damageTaken||0) + shLost + hpLost;

    // 2.5) EMP/차단 디버프(적/보스 공격 옵션)
    if (opts) {
      const tNow = gameSec();
      if (opts.shieldRegenBlockDur) {
        state.core.shieldRegenBlockedUntil = Math.max(state.core.shieldRegenBlockedUntil||0, tNow + opts.shieldRegenBlockDur);
      }
      if (opts.repairBlockDur) {
        state.core.repairBlockedUntil = Math.max(state.core.repairBlockedUntil||0, tNow + opts.repairBlockDur);
      }
      if (opts.empDur) {
        state.core.empUntil = Math.max(state.core.empUntil||0, tNow + opts.empDur);
        if (opts.empMul !== undefined) state.core.empMul = opts.empMul;
      }

      // FX(스팸 방지)
      const showEmp = (opts.empDur || opts.shieldRegenBlockDur || opts.repairBlockDur);
      if (showEmp) {
        const last = state.core._empFxAt || 0;
        if (tNow - last > 0.9) {
          state.core._empFxAt = tNow;
          fxText("EMP 교란!", CORE_POS.x, CORE_POS.y - 120, "#fbbf24");
          fxRing(CORE_POS.x, CORE_POS.y, CORE_RADIUS+14, CORE_RADIUS+110, "#fbbf24");
        }
      }
    }


    // 3) 붕괴
    if (state.core.hp <= 0) {
      state.core.hp = 0;
      // 붕괴 시 보호막은 즉시 0
      state.core.shield = 0;
      triggerCollapse();
    }
  }

  // ---------- Flow ----------
  function startWave(){
  if (state.phase === "fail") return;

  if (!state.core.passiveId) {
    if (!state.core.passivePreviewId) { setMsg("코어 패시브를 먼저 선택하세요.", 2.2); return; }
    // 미리보기로 고른 패시브를 웨이브 시작 순간 확정
    selectCorePassive(state.core.passivePreviewId);
  }

  // ✅ 첫 웨이브(1) 시작 순간 패시브를 잠금: 재시작 전까지 변경 불가
  if (!state.core.passiveLocked && state.wave === 1) {
    state.core.passiveLocked = true;
    try { refreshCorePassiveUI(); } catch {}
  }

  SFX.play("wave");
  if (state.wave === FINAL_WAVE) {
    SFX.play("warning");
    // 최종전: 수정탑 에너지 집속 시작 연출
    fxShieldWave(CORE_POS.x, CORE_POS.y, 140, 0.75);
  }


  resetMods();
  // 회수 프로토콜: 웨이브 시작 시 카운터 리셋
  state.core.passiveSalvageThisWave = 0;
  state.core.shieldRegenBlockedUntil = 0;

  // 업그레이드: 웨이브 시작 시 보호막 보너스
  const waveShieldBonus = 20*state.upg.waveShield;
  if (waveShieldBonus > 0) {
    state.core.shield = clamp(state.core.shield + waveShieldBonus, 0, state.core.shieldMax);
  }

  // 최종 웨이브(30): 일반 이벤트는 발생하지 않음. (대신 최종 지원 선택)
  if (state.wave !== FINAL_WAVE) {
    state.event = chooseEvent();
    if (state.event) {
      state.event.apply(state);
      state.eventTextTimer = 3.2;
      fxText(`이벤트: ${state.event.name}`, CORE_POS.x, CORE_POS.y - 92, "#fbbf24");
    }
  } else {
    state.event = null;
    state.eventTextTimer = 0;

    // 최종 지원(선택 없으면 방호 강화)
    const choice = state.finalChoice || "defense";
    state.finalChoice = choice;
    if (choice === "offense") {
      state.mods.turretDmgMul *= 1.15;
    } else {
      state.mods.shieldRegenMul *= 1.25;
    }
    fxText(`최종 지원: ${choice==="offense" ? "화력 지원" : "방호 강화"}`, CORE_POS.x, CORE_POS.y - 112, "#93c5fd");

    // 최종 보스 패턴 상태 초기화
    state.final = {
      phase: 1,
      nextSummonAt: gameSec() + 4.5,
      nextShieldJamAt: gameSec() + 7.0,
      nextLaserAt: gameSec() + 6.0,
      nextEmpAt: gameSec() + 9.0,
      nextOrbsAt: gameSec() + 8.0,
      empUntil: 0,
      empMul: 0.55,
    };
  }

  state.phase = "wave";
  if (state.wave === FINAL_WAVE) {
    fxText("최종 웨이브!", CORE_POS.x, CORE_POS.y - 92, "#93c5fd");
  }
  const spec = waveSpec(state.wave);

  // 연출: 웨이브 시작 카드(완성감)
  try {
    const sub = (state.wave===FINAL_WAVE) ? "최종 보스" : (spec && spec.name ? spec.name : "");
    cineCard(`WAVE ${state.wave}`, sub, "#93c5fd", 1.25);
    fxRing(CORE_POS.x, CORE_POS.y, CORE_RADIUS+12, CORE_RADIUS+160, "#93c5fd");
  } catch {}

  state.spawn = { spec, spawned: 0, nextSpawnIn: 0 };
  // BGM: 보스 웨이브에서는 더 강하게
  try { SFX.setBgmMode((state.wave === FINAL_WAVE) ? "final1" : (spec.isBoss ? "boss" : "wave")); } catch {}
  state.crystals += Math.floor(10 + state.wave*2);
}

  function drawResonanceScreenFlash(){
    const tt = gameSec();
    const until = state.resFlashUntil || 0;
    const rem = Math.max(0, until - tt);
    if (rem <= 0) return;
    const dur = state.resFlashDur || 0.16;
    const k = clamp(rem / dur, 0, 1);
    const a = 0.32 * k;
    const x = (typeof state.resFlashX === 'number') ? state.resFlashX : CORE_POS.x;
    const y = (typeof state.resFlashY === 'number') ? state.resFlashY : CORE_POS.y;

    ctx.save();
    ctx.globalAlpha = a;
    ctx.globalCompositeOperation = 'lighter';
    const r = lerp(180, 520, 1-k);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0.0, 'rgba(255,237,213,1)');
    g.addColorStop(0.35, 'rgba(253,186,116,0.85)');
    g.addColorStop(1.0, 'rgba(253,186,116,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0,0,W,H);

    // very light full-screen blink
    ctx.globalAlpha = a * 0.22;
    ctx.fillStyle = 'rgba(253,186,116,1)';
    ctx.fillRect(0,0,W,H);
    ctx.restore();
  }




  function drawPassiveScreenVignette(){
    const id = state.core && state.core.passiveId;
    if (!id) return;
    if (state.phase === "fail" || state.phase === "win") return;

    const t = state.time || 0;
    let a = 0.0;
    let rgb = null;

    if (id === "rebuild") {
      const sh = clamp(state.core.shield / state.core.shieldMax, 0, 1);
      const hp = clamp(state.core.hp / state.core.hpMax, 0, 1);
      const need = 1 - Math.min(sh, hp);
      a = 0.08 + 0.22*need;
      rgb = [96,165,250];
    } else if (id === "resonance") {
      const g01 = (typeof resonanceGauge01 === 'function') ? resonanceGauge01() : 0;
      const pulse = 0.60 + 0.40*Math.sin(t*2.6 + g01*1.4);
      a = (0.06 + 0.22*g01) * pulse;
      rgb = [253,186,116];
    } else if (id === "overload") {
      const hpFrac = (state.core.hpMax>0) ? (state.core.hp/state.core.hpMax) : 1;
      const trig = (typeof OVERLOAD_CFG === 'object' && OVERLOAD_CFG) ? OVERLOAD_CFG.triggerHp : 0.30;
      const danger = clamp((trig + 0.20 - hpFrac)/0.20, 0, 1);
      const burst = (typeof overloadBurstActive === 'function' && overloadBurstActive()) ? 1 : 0;
      const pulse = 0.55 + 0.45*Math.sin(t*(5.0 + 5.0*burst));
      a = (0.08 + 0.24*danger + 0.16*burst) * pulse;
      rgb = [251,113,133];
    } else if (id === "overdrive") {
      const hpFrac = (state.core.hpMax>0) ? (state.core.hp/state.core.hpMax) : 1;
      const m = clamp(1 - hpFrac, 0, 1);
      const pulse = 0.60 + 0.40*Math.sin(t*2.2 + m*2.0);
      a = (0.07 + 0.22*m) * pulse;
      rgb = [216,180,254];
    }

    if (!rgb || a <= 0.001) return;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const cx = W*0.5, cy = H*0.5;
    const r0 = 120;
    const r1 = Math.max(W,H)*0.85;

    const edgeA = Math.min(0.24, 0.18*a);
    const edgeB = Math.min(0.18, 0.12*a);

    const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
    g.addColorStop(0.0, 'rgba(0,0,0,0)');
    g.addColorStop(0.60, 'rgba(0,0,0,0)');
    g.addColorStop(0.90, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${edgeA})`);
    g.addColorStop(1.0,  `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);

    ctx.fillStyle = g;
    ctx.fillRect(0,0,W,H);

    // overdrive: subtle speed streaks at the edges
    if (id === 'overdrive') {
      ctx.globalAlpha = Math.min(0.35, 0.22*a);
      ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${edgeB})`;
      ctx.lineWidth = 2;
      const n = 10;
      for (let i=0;i<n;i++){
        const yy = (i+0.5) * (H/n) + 10*Math.sin(t*1.7 + i);
        const x0 = -40;
        const x1 = 120 + 80*Math.sin(t*1.3 + i*0.9);
        ctx.beginPath();
        ctx.moveTo(x0, yy);
        ctx.lineTo(x1, yy - 20);
        ctx.stroke();

        const x2 = W + 40;
        const x3 = W - 120 - 80*Math.sin(t*1.5 + i*0.8);
        ctx.beginPath();
        ctx.moveTo(x2, yy);
        ctx.lineTo(x3, yy + 20);
        ctx.stroke();
      }
    }

    ctx.restore();
  }


  function clearWave(){
  if (state.phase === "fail") return;

  // FINAL WAVE clear -> Victory ending
  if (state.wave >= FINAL_WAVE) { triggerWin(); return; }

  SFX.play("clear");
  state.phase = "clear";
  // BGM: 전투 종료 -> 기본 모드
  try { SFX.setBgmMode("build"); } catch {}
  if (state.ui.autoStartEnabled) state.autoStartAt = gameSec() + state.autoStartDelay;
  else state.autoStartAt = 0;
  state.wave += 1;
  state.crystals += Math.floor(25 + state.wave*3);
  fxText("웨이브 클리어!", CORE_POS.x, CORE_POS.y - 72, "#a7f3d0");

  // 연출: 웨이브 종료 카드
  try {
    const next = state.wave;
    const gain = Math.floor(25 + next*3);
    cineCard("WAVE CLEAR", `다음: WAVE ${next} · +${gain} 크리스탈`, "#a7f3d0", 1.25);
  } catch {}

  // 웨이브 29 클리어 후 -> 최종전 준비(웨이브 30 전용)
  if (state.wave === FINAL_WAVE) {
    state.phase = "finalprep";
    resetFinalCharge();
    fxShieldWave(CORE_POS.x, CORE_POS.y, 110, 0.55);

    state.autoStartAt = 0;

    // 준비 시간/보상/정비
    const PREP_SEC = 15.0;
    state.finalPrepEndsAt = gameSec() + PREP_SEC;
    state.finalChoice = null;
    state.final = null;
    state._finalBossJustDied = false;
    state.win = null;
    resetFinalCharge();


    // 보너스 자원 + 정비
    state.crystals += 90;
    state.core.hp = clamp(state.core.hp + state.core.hpMax*0.18, 0, state.core.hpMax);
    state.core.shield = clamp(state.core.shield + state.core.shieldMax*0.22, 0, state.core.shieldMax);
    state.core.repairCd = 0; // 수리 쿨 초기화
    fxText("최종전 준비!", CORE_POS.x, CORE_POS.y - 92, "#93c5fd");
  }
}


  function triggerWin(){
  if (state.phase === "fail") return;
  state.phase = "win";

  // BGM: 승리 모드(조금 밝게)
  try { SFX.setBgmMode("win"); } catch {}
  state.win = {
    t: 0,
    stage: 0,
    beam: 0,
    rings: [
      {t:0, delay:0.0},
      {t:0, delay:0.45},
      {t:0, delay:0.90},
    ],
    flash: 0,
  };

  // freeze spawns / enemies: keep them for dissolve
  if (state.spawn) state.spawn = null;
  for (const e of state.enemies) {
    e.vx = 0; e.vy = 0;
    e.dissolve = 0;
    e.hitByCleanse = false;
  }

  // stats snapshot
  state.stats.finalWave = FINAL_WAVE;
  state.stats.runEnd = nowSec();
  try { updateRecordsWithRun(buildRunSummary(true)); renderRecords(true); } catch(e) {}

  // SFX: 승리 전용 징글(수정탑 붕괴 사운드와 분리)
  try { ensureAudio(); } catch {}
  SFX.play("victory");
  setTimeout(()=>{ try { ensureAudio(); SFX.play("clear"); } catch {} }, 720);

  // UI message
  state.uiMsg = "정화 완료 시퀀스 시작...";
  state.uiMsgUntil = nowSec() + 3.0;
}



function updateWin(dt){
  if (!state.win) return;
  const w = state.win;
  w.t += dt;

  // stage timings
  // 0: pre-pulse (0~1.2), 1: beam (1.2~2.7), 2: rings+dissolve (2.7~5.2), 3: end screen (5.2+)
  if (w.t < 1.2) w.stage = 0;
  else if (w.t < 2.7) w.stage = 1;
  else if (w.t < 5.2) w.stage = 2;
  else w.stage = 3;

  // flash for first second
  w.flash = Math.max(0, 1 - w.t*1.6);

  // beam grow
  if (w.stage >= 1) {
    const t = clamp((w.t - 1.2) / 1.3, 0, 1);
    w.beam = t;
  }

  // rings
  if (w.stage >= 2) {
    for (const r of w.rings) {
      r.t += dt;
    }
    // dissolve enemies as rings pass
    const maxR = Math.max(...w.rings.map(r=> ringRadius(r)));
    for (const e of state.enemies) {
      if (!e.hitByCleanse) {
        const d = dist(e.x,e.y, CORE_POS.x, CORE_POS.y);
        if (d <= maxR + 4) {
          e.hitByCleanse = true;
        }
      }
      if (e.hitByCleanse) {
        e.dissolve = clamp((e.dissolve || 0) + dt*1.25, 0, 1);
      }
    }
    // remove fully dissolved
    for (let i=state.enemies.length-1;i>=0;i--){
      const e = state.enemies[i];
      if ((e.dissolve||0) >= 0.999) state.enemies.splice(i,1);
    }
  }

  // keep shield stable and full-ish during ending (looks "resolved")
  state.core.shield = clamp(state.core.shield + state.core.shieldRegen*0.6*dt, 0, state.core.shieldMax);

  // fx update so particles keep running
  for (let i = state.fx.length - 1; i >= 0; i--) {
    const f = state.fx[i];
    f.t += dt;
    if (f.t >= f.dur) state.fx.splice(i,1);
  }
  state.eventTextTimer = Math.max(0, state.eventTextTimer - dt);
}

function ringRadius(r){
  const t = Math.max(0, r.t - r.delay);
  // fast expansion with fade later
  return 30 + t*240;
}

function drawWinOverlay(){
  if (!state.win) return;
  const w = state.win;

  // vignette
  ctx.save();
  ctx.globalAlpha = 0.28 + 0.22*Math.sin(w.t*2.1);
  const g = ctx.createRadialGradient(CORE_POS.x, CORE_POS.y, 60, CORE_POS.x, CORE_POS.y, 360);
  g.addColorStop(0, "rgba(96,165,250,0.0)");
  g.addColorStop(1, "rgba(96,165,250,0.85)");
  ctx.fillStyle = g;
  ctx.fillRect(0,0,W,H);
  ctx.restore();

  // beam
  if (w.stage >= 1) {
    const a = 0.25 + 0.55*w.beam;
    ctx.save();
    ctx.globalAlpha = a;
    const beamW = 34 + 40*w.beam;
    const bx = CORE_POS.x - beamW/2;
    const by = 0;
    const bh = CORE_POS.y;
    const bg = ctx.createLinearGradient(0, by, 0, bh);
    bg.addColorStop(0, "rgba(96,165,250,0.0)");
    bg.addColorStop(0.55, "rgba(96,165,250,0.65)");
    bg.addColorStop(1, "rgba(96,165,250,0.95)");
    ctx.fillStyle = bg;
    ctx.fillRect(bx, by, beamW, bh);
    // core glow
    ctx.globalAlpha = a*0.8;
    ctx.beginPath();
    ctx.arc(CORE_POS.x, CORE_POS.y, CORE_RADIUS+26, 0, Math.PI*2);
    ctx.fillStyle = "rgba(96,165,250,0.22)";
    ctx.fill();
    ctx.restore();
  }

  // cleanse rings
  if (w.stage >= 2) {
    ctx.save();
    for (const rr of w.rings) {
      const rad = ringRadius(rr);
      const t = Math.max(0, rr.t - rr.delay);
      const alpha = clamp(0.55 - t*0.18, 0, 0.55);
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = "#60a5fa";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(CORE_POS.x, CORE_POS.y, rad, 0, Math.PI*2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // flash (impact)
  if (w.flash > 0.01) {
    ctx.save();
    ctx.globalAlpha = w.flash*0.35;
    ctx.fillStyle = "#93c5fd";
    ctx.fillRect(0,0,W,H);
    ctx.restore();
  }

  // end screen text
  if (w.stage >= 3) {
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = "rgba(15,23,42,0.72)";
    ctx.fillRect(0,0,W,H);

    ctx.fillStyle = "#e5e7eb";
    ctx.font = "700 44px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("정화 완료", W/2, 150);

    ctx.font = "500 16px system-ui, sans-serif";
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText("침식 주파수가 뒤집혔습니다. 지역은 안전해졌습니다.", W/2, 182);

    const tPlay = Math.max(0, (state.stats.runEnd || nowSec()) - (state.stats.runStart || nowSec()));
    const lines = [
      `도달 웨이브: ${FINAL_WAVE}`,
      `총 처치: ${state.stats.kills|0}`,
      `받은 피해: ${Math.round(state.stats.damageTaken)|0}`,
      `수리 횟수: ${state.stats.repairs|0}`,
      `플레이 시간: ${formatTime(tPlay)}`
    ];

    ctx.font = "600 18px system-ui, sans-serif";
    ctx.fillStyle = "#e2e8f0";
    let y = 240;
    for (const ln of lines){
      ctx.fillText(ln, W/2, y);
      y += 26;
    }

    ctx.font = "600 16px system-ui, sans-serif";
    ctx.fillStyle = "#93c5fd";
    ctx.fillText("R: 재시작", W/2, H - 90);

    ctx.restore();
  }
}

function formatTime(sec){
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec/60) % 60);
  const h = Math.floor(sec/3600);
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return `${m}:${String(s).padStart(2,"0")}`;
}

function restart(){
    state.gtime = 0;
    state.lastTime = nowSec();
    state.wave = 1;
    state.phase = "build";
    state.crystals = 80;
    state.selected = "basic";

    // 런 스탯 리셋(기록 저장용)
    state.stats = { runStart: nowSec(), runEnd: 0, finalWave: 0, kills: 0, damageTaken: 0, repairs: 0, turretBuilt: { basic:0, slow:0, splash:0, shred:0, breaker:0 } };

    state.enemies.length = 0;
    state.turrets.length = 0;
    state.projectiles.length = 0;
    state.fx.length = 0;

    state.flames.length = 0;
    state.flameSpawnAcc = 0;

    state.debris.length = 0;
    state.collapse = null;

    // 카메라 흔들림(스킬/붕괴) 리셋
    state.camShakeUntil = 0;
    state.camShakeDur = 0;
    state.camShakeMag = 0;

    state.event = null;
    state.eventTextTimer = 0;
    resetMods();

    // core base values -> upgrades 반영
    state.core.hpMax = CORE_BASE.hpMax; state.core.hp = CORE_BASE.hpMax;
    state.core.shieldMax = CORE_BASE.shieldMax; state.core.shield = CORE_BASE.shieldMax;
    state.core.shieldRegen = CORE_BASE.shieldRegen;
    state.core.hpArmor = CORE_BASE.hpArmor;
    state.core.shieldArmor = CORE_BASE.shieldArmor;
    state.core.repairCost = CORE_BASE.repairCost;
    state.core.repairAmount = CORE_BASE.repairAmount;
    state.core.repairCd = CORE_BASE.repairCd;
    state.core.repairReadyAt = 0; // 재시작 시 수리 쿨타임 리셋
    state.core.energyReadyAt = 0; // 재시작 시 에너지포 쿨 리셋
    state.core.energyCharging = false;
    state.core.energyLock = null;
    state.core.energyChargeStartAt = 0;
    state.core.energyChargeUntil = 0;
    state.core.energyChargeFxAt = 0;
    // ✅ 에너지포 잔상/충전 잔류 데이터 리셋(재시작 후 플래시/잔상 남는 버그 방지)
    state.core.energyFlashUntil = 0;
    state.core.energyChargeOrbs = [];
    state.core.energyChargeLastT = 0;
    state.core.energyChargeOrbAt = 0;
    state.core.energyChargeReadySfx = false;

    // ✅ 공명 반격 화면 플래시 잔상 리셋(재시작 후 오래 남는 버그 방지)
    state.resFlashUntil = 0;
    state.resFlashDur = 0;
    state.resFlashX = 0;
    state.resFlashY = 0;
    state.upg = { coreHp:0, coreShield:0, hpArmor:0, shieldArmor:0, shieldRegen:0, energyCannon:0, repair:0, turretDmg:0, turretFire:0, turretRange:0, slowPower:0, splashRadius:0, projSpeed:0, turretCrit:0, slowDuration:0, aegisTune:0, waveShield:0, shredFocus:0, breakerMark:0 };
    applyUpgrades();
    state.core.aegisReadyAt = 0;
    state.core.aegisActiveUntil = 0;

    state.spawn = null;
    state.autoStartAt = 0;
    state.finalPrepEndsAt = 0;
    state.finalChoice = null;
    state.final = null;
    state.core.shieldRegenBlockedUntil = 0;

    state.core.repairBlockedUntil = 0;
    state.core.empUntil = 0;
    state.core._empFxAt = -999;
        // 코어 패시브: 재시작 시 다시 선택
    state.core.passiveId = null;
    state.core.passiveLocked = false;
    state.core.passivePreviewId = null;
    state.core.passiveStacks = 0;
    state.core.passiveLastHitAt = gameSec();
    state.core.passiveStackDecayAcc = 0;
    state.core.overdriveShotAcc = 0;
    state.core.passiveSalvageThisWave = 0;

    resonanceReset();
    state.core.rebuildEmergencyUntil = 0;
    state.core.rebuildEmergencyReadyAt = 0;

    // 임계 과부하 누적 상태 리셋
    state.core.overloadBurstUntil = 0;
    state.core.overloadBurstReadyAt = 0;
    state.core.overloadWasAbove30 = true;
    state.core.overloadExtendReadyAt = 0;
    state.core.overloadKickReadyAt = 0;
    refreshCorePassiveUI();

    // BGM: 기본(build) 모드로
    try { SFX.setBgmMode("build"); } catch {}

// ✅ 와이어 리셋: 세그먼트까지 리셋(재시작 검정선 버그 방지)
    wireReset();
    wireTick(1); // full green
  }

  // ---------- Update ----------
  // ---------- Final Charge (Wave 30 core energy) ----------
  function isFinalChargeActive(){
    return (state.phase === "finalprep" || (state.phase === "wave" && state.wave === FINAL_WAVE));
  }

  function resetFinalCharge(){
    state.core.finalCharge = 0;
    state.core.finalChargeAcc = 0;
    if (state.core.finalChargeOrbs) state.core.finalChargeOrbs.length = 0;
  }

  function updateFinalCharge(dt){
    const active = isFinalChargeActive();
    if (!active) {
      // 자연스럽게 꺼지도록 약하게 감쇠
      state.core.finalCharge = Math.max(0, (state.core.finalCharge || 0) - dt*0.35);
      state.core.finalChargeAcc = 0;
      if (state.core.finalChargeOrbs) state.core.finalChargeOrbs.length = 0;
      return;
    }

    // 준비 단계(finalprep): 55%까지만 천천히 채움(“이제부터 모인다” 느낌)
    if (state.phase === "finalprep") {
      const cap = 0.55;
      const rate = 0.14;
      state.core.finalCharge = clamp((state.core.finalCharge || 0) + dt*rate, 0, cap);
    } else {
      // 웨이브30: '최종 보스 체력'이 줄수록 집속이 강해짐
      let boss = null;
      for (let i=0;i<state.enemies.length;i++){
        const e = state.enemies[i];
        if (e && e.kind === "boss" && e.hp > 0) { boss = e; break; }
      }
      const hpRatio = boss ? clamp(boss.hp / (boss.hpMax || 1), 0, 1) : 1;
      const severity = clamp(1 - hpRatio, 0, 1);
      // 55%를 바닥으로 깔고, 보스 체력이 깎일수록 100%까지 상승 (살짝 곡선)
      const target = 0.55 + Math.pow(severity, 0.85) * 0.45;
      state.core.finalCharge = clamp(Math.max(state.core.finalCharge || 0, target), 0, 1.0);
    }

    const c = clamp(state.core.finalCharge || 0, 0, 1);

    // 입자 생성(집속 강도에 따라 더 촘촘/빠르게)
    const baseSpawn = (state.phase === "finalprep") ? 0.06 : 0.095;
    const spawnInt = (state.phase === "finalprep") ? baseSpawn : lerp(baseSpawn, 0.040, c);
    state.core.finalChargeAcc = (state.core.finalChargeAcc || 0) + dt;
    if (!state.core.finalChargeOrbs) state.core.finalChargeOrbs = [];

    while (state.core.finalChargeAcc >= spawnInt) {
      state.core.finalChargeAcc -= spawnInt;
      const a = rand(0, Math.PI*2);
      const r = rand(240, 330);
      const v = rand(190, 280) * (state.phase === "finalprep" ? 1.0 : lerp(1.0, 1.55, c));
      const spin = rand(-2.6, 2.6) * (state.phase === "finalprep" ? 1.0 : lerp(1.0, 1.25, c));
      const life = rand(0.7, 1.15);
      state.core.finalChargeOrbs.push({ a, r, v, spin, t:0, life });
    }

    // 입자 이동/소멸
    for (let i = state.core.finalChargeOrbs.length - 1; i >= 0; i--) {
      const o = state.core.finalChargeOrbs[i];
      o.t += dt;
      o.a += o.spin * dt;
      o.r -= o.v * dt;
      if (o.r < 34 || o.t > o.life) {
        // 아주 약한 링(과도한 번쩍임 방지) - 집속이 강해질수록 조금 더 선명
        fxRing(CORE_POS.x, CORE_POS.y, 52, 78, `rgba(96,165,250,${(0.22 + 0.22*c).toFixed(3)})`);
        state.core.finalChargeOrbs.splice(i,1);
      }
    }
  }


  function update(dt){
    state.time += dt;


    // 에너지포 충전/자동발사 처리
    updateEnergyCharge();

    // 붕괴 상태
    if (state.phase === "fail" && state.collapse) {
      state.collapse.t += dt;
      state.collapse.boomT += dt;
      state.collapse.shake = Math.max(0, 1 - state.collapse.t*0.9);
      state.collapse.fade  = clamp((state.collapse.t - 0.65) / 1.2, 0, 1);

      // ✅ 붕괴 중: 보호막/불꽃 완전 제거 고정
      state.core.shield = 0;
      state.flames.length = 0;
      state.flameSpawnAcc = 0;

      updateDebris(dt);

      for (let i = state.fx.length - 1; i >= 0; i--) {
        const f = state.fx[i];
        f.t += dt;
        if (f.t >= f.dur) state.fx.splice(i,1);
      }
      state.eventTextTimer = Math.max(0, state.eventTextTimer - dt);

      wireTick(0);
      return;
    }

    // 정상 상태
    // 승리 엔딩 상태
    if (state.phase === "win" && state.win) {
      updateWin(dt);
      wireTick(state.core.hp / state.core.hpMax);
      return;
    }

    updateBlueFlames(dt);
    // shield regen
    // 기본: 웨이브 중에만 보호막이 자동 재생됩니다.
    // (원하시면 state.core.shieldRegenOutOfWave 를 true로 바꾸면, 웨이브 밖에서도 재생됩니다.)
    if (state.phase === "wave" || state.core.shieldRegenOutOfWave) {
      const t = nowSec();
      const regenBoost = (t < state.core.aegisActiveUntil) ? 3.2 : 1.0;
      let passiveShieldRegenMul = 1.0;
      // 재건 코어: 보호막 재생 +15% (최종전 추가 +10%)
      if (state.core.passiveId === "rebuild") {
        passiveShieldRegenMul *= 1.15;
        if (state.wave === FINAL_WAVE) passiveShieldRegenMul *= 1.10;
      }
      // 임계 과부하: 최대 +110%
      if (state.core.passiveId === "overload") {
        const hpFrac = state.core.hpMax>0 ? (state.core.hp/state.core.hpMax) : 1;
        const tO = clamp((0.40 - hpFrac) / 0.30, 0, 1);
        passiveShieldRegenMul *= (1 + 1.10*tO);
      }
      // 코어 오버드라이브: 최대 +60%
      if (state.core.passiveId === "overdrive") {
        const hpFrac = state.core.hpMax>0 ? (state.core.hp/state.core.hpMax) : 1;
        const tO = clamp((0.40 - hpFrac) / 0.30, 0, 1);
        passiveShieldRegenMul *= (1 + 0.60*tO);
      }
if (gameSec() >= state.core.shieldRegenBlockedUntil) {
        const regen = state.core.shieldRegen * state.mods.shieldRegenMul * regenBoost * passiveShieldRegenMul;
        state.core.shield = clamp(state.core.shield + regen*dt, 0, state.core.shieldMax);
      }
    }
    // 웨이브 30: 수정탑 에너지 집속 업데이트
    updateFinalCharge(dt);

    // HP 자동 수리(옵션)
    // - 기본은 OFF 입니다. (웨이브 끝나고 가만히 있어도 HP가 차는 걸 막기 위해)
    // - 켜고 싶으면 state.core.passiveHpRegenEnabled = true 로 바꾸세요.
    // 코어 패시브 기반 HP 자동 수리
    // ✅ 재건 코어: 저체력일수록 회복량↑, 최종전에서는 딜레이↓
    const hpRegenWanted = (state.core.passiveId === "rebuild");
    const hpRegenAllowPhase = (state.phase === "wave");

    if (hpRegenWanted && hpRegenAllowPhase && state.core.hp < state.core.hpMax) {
      const since = gameSec() - state.core.lastHpDamageAt;
      const isFinal = (state.wave === FINAL_WAVE);
      const delay = state.core.hpRegenDelay * (isFinal ? 0.65 : 1.0);
      if (since >= delay) {
        const hpFrac = state.core.hpMax>0 ? (state.core.hp/state.core.hpMax) : 1;
        const missing = clamp(1 - hpFrac, 0, 1);
        const regen = state.core.hpRegenPerSec * (1 + 0.90*missing);
        state.core.hp = clamp(state.core.hp + regen*dt, 0, state.core.hpMax);
        if (state.core.hp >= state.core.hpMax - 0.001) state.core.hpDirectDamaged = false;
      }
    }

    // 공명 반격: 게이지 감쇠/방출 처리
    updateResonance(dt);

    // 임계 과부하: HP 30%↓ 진입 트리거/버스트 관리
    updateOverload(dt);

    
    // auto-start next wave (clear phase)
    if (state.phase === "clear" && state.autoStartAt > 0) {
      if (gameSec() >= state.autoStartAt) {
        state.autoStartAt = 0;
        startWave();
      }
    }
// final prep (wave 30 before)
if (state.phase === "finalprep") {
  const left = state.finalPrepEndsAt - gameSec();
  if (left <= 0) {
    state.finalPrepEndsAt = 0;
    // 최종전 자동 시작 제거: 준비만 끝내고 대기(Build)로 전환
    state.phase = "build";
    setMsg("준비 완료! [웨이브 시작]으로 진행하세요.", 2.2);
  }
}

// wave spawn

    if (state.phase === "wave" && state.spawn) {
      const sp = state.spawn;
      const spec = sp.spec;
      sp.nextSpawnIn -= dt;

      const diff = state.diff || DIFF_PRESETS.normal;
      const rate = spec.spawnRate * (diff.spawnMul||1);
      while (sp.spawned < spec.count && sp.nextSpawnIn <= 0) {
        spawnEnemy(spec, sp.spawned);
        sp.spawned++;
        sp.nextSpawnIn += 1 / rate;
      }
      if (sp.spawned >= spec.count && state.enemies.length === 0) clearWave();
    }
// final boss patterns
if (state.phase === "wave" && state.wave === FINAL_WAVE) {
  updateFinalBoss(dt);
}



    // turrets
    for (const tr of state.turrets) {
      const s = turretBase(tr);
      const empMulFinal = (state.final && (gameSec() < state.final.empUntil)) ? state.final.empMul : 1.0;
      const empMulCore  = (gameSec() < (state.core.empUntil||0)) ? (state.core.empMul||0.75) : 1.0;
      const empMul = empMulFinal * empMulCore;
      const fireRate = s.fireRate * state.mods.turretFireMul * empMul;
      tr.cd -= dt;

      let best = null, bestScore = Infinity;
      for (const e of state.enemies) {
        const d = dist(tr.x,tr.y, e.x,e.y);
        if (d > s.range) continue;
        const dCore = dist(e.x,e.y, CORE_POS.x, CORE_POS.y);
        const score = dCore*0.9 + d*0.25;
        if (score < bestScore) { bestScore = score; best = e; }
      }
      if (best && tr.cd <= 0) {
        fireTurret(tr, best);
        tr.cd = 1 / fireRate;
      }
    }

    // 코어 패시브: 코어 오버드라이브(수정탑 직접 공격)
    if (state.phase === "wave" && state.core.passiveId === "overdrive") {
      const hpFrac = state.core.hpMax>0 ? (state.core.hp/state.core.hpMax) : 1;
      let m = clamp(1 - hpFrac, 0, 1); // missing HP (0~1)
      // 치트: 일정 시간 동안 HP와 무관하게 최대 출력
      if (gameSec() < (state.core.overdriveCheatUntil||0)) m = 1;
      // 체감 강화: 평상시에도 강하고, 저체력일수록 더 강해짐
      const dmgMul = clamp(1.25 + 1.85*Math.pow(m, 1.35), 1.25, 3.10);
      const asMul  = clamp(1.35 + 2.85*Math.pow(m, 1.10), 1.35, 4.20);

      const baseInterval = 0.55;
      state.core.overdriveShotAcc = (state.core.overdriveShotAcc||0) + dt;
      const interval = clamp(baseInterval / asMul, 0.12, 0.75);

      // 웨이브가 오를수록 기본 피해가 완만히 증가
      const baseDmg = 10 + state.wave * 0.65;
      let shotDmg = baseDmg * dmgMul;

      // 적이 없으면 누적만 막고 종료
      if (state.enemies.length === 0) {
        state.core.overdriveShotAcc = Math.min(state.core.overdriveShotAcc, interval);
      } else {
        // 최대 3연사까지만(프레임 드랍 시 폭주 방지)
        let shots = 0;
        while (state.core.overdriveShotAcc >= interval && shots < 3) {
          shots++;
          state.core.overdriveShotAcc -= interval;

          
          // 오버드라이브 사격 SFX (과도한 중첩 방지)
          const sNow = nowSec();
          if (!state.core.overdriveSfxAt || (sNow - state.core.overdriveSfxAt) > 0.08) {
            state.core.overdriveSfxAt = sNow;
            try { SFX.play("core_shoot"); } catch {}
          }
// 타겟: 최종보스/보스 우선, 그 외에는 코어에 가까운 적
          let tgt = null, bestScore = 1e9;
          for (const e of state.enemies) {
            let score = dist(e.x, e.y, CORE_POS.x, CORE_POS.y);
            if (e.isFinalBoss) score -= 9999;
            else if (e.kind === "boss") score -= 4000;
            if (score < bestScore) { bestScore = score; tgt = e; }
          }
          if (!tgt) break;

          // 최종보스는 기존 순삭방지 내성과 동일한 계열로 감쇄
          let dmg = shotDmg;
          if (tgt.isFinalBoss) dmg *= finalBossIncomingMul();

          applyProjectileHit({ kind:"core", dmg }, tgt);
          fxLine(CORE_POS.x, CORE_POS.y, tgt.x, tgt.y, "#93c5fd", 0.18, 3);
          fxRing(tgt.x, tgt.y, 6, 24, "#93c5fd");
        }
      }
    }


    // projectiles
    for (let i = state.projectiles.length - 1; i >= 0; i--) {
      const p = state.projectiles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;

      // enemy projectile -> hit core
      if (p.kind === "enemy") {
        const dCore = dist(p.x,p.y, CORE_POS.x, CORE_POS.y);
        if (dCore <= CORE_RADIUS + p.r) {
          damageCore(p.dmg, p.coreOpts || null);
          fxRing(CORE_POS.x, CORE_POS.y, CORE_RADIUS+8, CORE_RADIUS+68, "#fbbf24");
          state.projectiles.splice(i,1);
          continue;
        }
      }

      let hit = null;
      if (p.kind !== "enemy") {
        for (const e of state.enemies) {
        if (dist(p.x,p.y, e.x,e.y) <= e.r + p.r) { hit = e; break; }
        }
      }

      if (hit) {
        applyProjectileHit(p, hit);

        // 관통(pierce): 남아있으면 제거하지 않고 계속 진행
        if ((p.pierce||0) > 0) {
          p.pierce--;
          if (!p.hitSet) p.hitSet = new Set();
          p.hitSet.add(hit);
          // 살짝 앞으로 밀어서 같은 적을 바로 재타격하는 현상 완화
          p.x += p.vx * 0.01;
          p.y += p.vy * 0.01;
        } else {
          state.projectiles.splice(i,1);
        }
        continue;
      }

      if (p.life <= 0 || p.x < -50 || p.x > W+50 || p.y < -50 || p.y > H+50) {
        state.projectiles.splice(i,1);
      }
    }

    // enemies
    const diff = state.diff || DIFF_PRESETS.normal;
    for (let i = state.enemies.length - 1; i >= 0; i--) {
      const e = state.enemies[i];
      // 방어적: 배열에 빈 요소/깨진 엔트리가 섞이면 slowUntil 접근에서 크래시가 나므로 제거합니다.
      if (!e || !Number.isFinite(e.x) || !Number.isFinite(e.y)) { state.enemies.splice(i,1); continue; }
      const tt = nowSec();
      if (tt > (e.slowUntil || 0)) e.slowMul = 1.0;
      else if (typeof e.slowMul !== 'number') e.slowMul = 1.0;
      if (typeof e.seedAng === 'number') e.seedAng += dt*0.35;

      // core vector
      let dx = CORE_POS.x - e.x;
      let dy = CORE_POS.y - e.y;
      let d = Math.hypot(dx,dy);
      if (d < 0.0001) d = 0.0001;

      // ✅ dx/dy가 0에 가까우면(코어 중심에 겹침) 방향이 사라져서 멈출 수 있습니다.
      // 이 경우, 스폰 때 저장해둔 각도(seedAng)로 임의 방향을 부여합니다.
      if (Math.abs(dx) + Math.abs(dy) < 1e-6) {
        const ang = (typeof e.seedAng === 'number') ? e.seedAng : (Math.random()*Math.PI*2);
        dx = Math.cos(ang);
        dy = Math.sin(ang);
        d = 1.0;
      }

      const spd = e.spd * e.slowMul;

      // movement: melee -> rush, ranged -> hold distance + orbit
      let vx = dx/d, vy = dy/d;

      // ✅ 버그 수정: 적이 코어 중심에 겹쳐서 '멈춰 보이는' 현상 방지
      // 코어 표면 근처에 도달하면 바깥으로 살짝 밀어내고, 표면을 따라 미끄러지듯 움직입니다.
      const minDist = CORE_RADIUS + e.r + 6;
      if (d < minDist) {
        const nx = dx/d, ny = dy/d;
        e.x = CORE_POS.x - nx * minDist;
        e.y = CORE_POS.y - ny * minDist;

        // 표면을 따라 이동(탱젠트)
        const tx = -ny, ty = nx;
        const dir = (typeof e.orbitDir === 'number') ? e.orbitDir : 1;
        vx = tx * dir;
        vy = ty * dir;

        // 업데이트된 거리
        dx = CORE_POS.x - e.x;
        dy = CORE_POS.y - e.y;
        d = Math.hypot(dx,dy) || minDist;
      } else if (e.ranged && e.holdDist > 0 && d < e.holdDist) {
        const tx = -vy, ty = vx; // tangent
        const dir = (typeof e.orbitDir === 'number') ? e.orbitDir : 1;
        vx = tx * dir;
        vy = ty * dir;
      }

      e.x += vx * spd * dt;
      e.y += vy * spd * dt;

      // ranged shooting
      if (e.ranged && d < e.shootRange) {
        e.shotTimer -= dt;
        if (e.shotTimer <= 0) {
          enemyShoot(e);
          e.shotTimer = e.shotCd * (0.85 + 0.30*Math.random());
        }
      }

      const dCore = dist(e.x,e.y, CORE_POS.x, CORE_POS.y);

      // bomber: explode on contact
      if (e.bomber && dCore <= CORE_RADIUS + e.r + 6) {
        bombExplode(e);
        state.enemies.splice(i,1);
        continue;
      }

      // melee touch damage
      if (!e.ranged && dCore <= CORE_RADIUS + e.r + 8) {
        e.touchCd -= dt;
        if (e.touchCd <= 0) {
          const diff = state.diff || DIFF_PRESETS.normal;
          const base = (e.touchBase || 9) * (0.95 + 0.10*Math.random()) * (diff.dmgMul||1);
          damageCore(base, e.coreOpts || null);
          if (state.phase === "fail") break;
          e.touchCd = (e.touchInterval || 0.70) * (e.elite ? 0.82 : 1.0);
        }
      }

      // FINAL BOSS: phase/awakening sync (post-damage, this frame)
      if (state.phase === "wave" && state.wave === FINAL_WAVE && e.kind === "boss" && e.isFinalBoss && state.final) {
        const hpFracNow = clamp(e.hp / e.hpMax, 0, 1);
        let ph = 1;
        if (hpFracNow <= 0.70) ph = 2;
        if (hpFracNow <= 0.35) ph = 3;
        if (ph !== (state.final.phase || 1)) {
          state.final.phase = ph;
          e.awakeFlash = 1.0;
          fxText(`페이즈 ${ph}`, CORE_POS.x, CORE_POS.y - 120, "#f472b6");
          fxRing(CORE_POS.x, CORE_POS.y, CORE_RADIUS+10, CORE_RADIUS+150, "#f472b6");
        }
      }


      if (e.hp <= 0) {
        const diedIsFinalBoss = (state.wave === FINAL_WAVE && e.kind === "boss" && e.isFinalBoss);
        if (diedIsFinalBoss) state._finalBossJustDied = true;
        const reward = Math.floor((e.reward || (e.elite ? 16 : 10)) * state.mods.rewardMul * (diff.rewardMul||1));
        state.crystals += reward;
        state.stats.kills = (state.stats.kills|0) + 1;
        fxText(`+${reward}`, e.x, e.y - 6, "#a7f3d0");
        fxRing(e.x,e.y, 8, 55, "#a7f3d0");
        fxEnemyDeathBurst(e);
        state.enemies.splice(i,1);
      }
    }

    // FINAL BOSS defeated: wipe remaining mobs & enemy projectiles (no extra reward)
    if (state._finalBossJustDied) {
      for (const o of state.enemies) {
        fxRing(o.x, o.y, 6, 60, "#93c5fd");
      }
      state.enemies.length = 0;
      state.projectiles = state.projectiles.filter(p => p.kind !== "enemy");
      state._finalBossJustDied = false;
      state.final = null;
    }



    // fx
    for (let i = state.fx.length - 1; i >= 0; i--) {
      const f = state.fx[i];
      f.t += dt;
      if (f.t >= f.dur) state.fx.splice(i,1);
    }

    state.eventTextTimer = Math.max(0, state.eventTextTimer - dt);

    wireTick(state.core.hp / state.core.hpMax);
  }

  // ---------- Draw ----------
  function draw(){
    let shakeX = 0, shakeY = 0;
    if (state.phase === "fail" && state.collapse) {
      const s = state.collapse.shake * 10;
      shakeX = rand(-s, s);
      shakeY = rand(-s, s);
    }

    // 에너지포 발사 미세 흔들림(짧게)
    const tNow = gameSec();
    if (state.camShakeUntil && tNow < state.camShakeUntil) {
      const dur = state.camShakeDur || 0.12;
      const p = clamp((state.camShakeUntil - tNow) / dur, 0, 1);
      const mag = (state.camShakeMag || 6) * p;
      shakeX += rand(-mag, mag);
      shakeY += rand(-mag, mag);
    }

    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,W,H);

    ctx.save();
    ctx.translate(shakeX, shakeY);

    // background (battlefield only) — cached (perf)
    const bgMode = (state.ui && typeof state.ui.bgMode === 'number') ? state.ui.bgMode : 1;
    ensureBattleBgCache(bgMode);
    if (BG_CACHE.canvas) ctx.drawImage(BG_CACHE.canvas, -shakeX, -shakeY);
    else {
      ctx.fillStyle = "#0b0f14";
      ctx.fillRect(-shakeX,-shakeY,W,H);
    }

    if (state.debris.length) drawDebris();

    drawCore();

    for (const t of state.turrets) drawTurret(t);
    for (const e of state.enemies) drawEnemy(e);
    for (const p of state.projectiles) drawProjectile(p);
    for (const f of state.fx) drawFx(f);

    // build/clear helper overlays
    if (state.phase === "build" || state.phase === "clear" || state.phase === "finalprep") { drawHoverTurret(); drawGhost(); }

    ctx.restore();

    // passive screen vignette
    drawPassiveScreenVignette();

    // explosion flash on top
    drawBlueExplosionFlash();
    drawResonanceScreenFlash();
if (state.phase !== "win") drawBossHUD();

    // 웨이브/보스/패시브 연출 카드
    if (state.phase !== "win") drawCineCards();

    if (state.phase === "win") drawWinOverlay();

    if (state.hardError) banner(`오류: ${state.hardError}`, "#fca5a5");

    if (state.phase !== "win" && state.phase === "build") banner("설치 단계: 포탑 배치 후 [웨이브 시작]을 누르십시오.", "#93c5fd");
    if (state.phase !== "win" && state.phase === "clear") {
      if (state.ui.autoStartEnabled && state.autoStartAt > 0) {
        const left = Math.max(0, state.autoStartAt - gameSec());
        banner(`웨이브 클리어! ${left.toFixed(1)}s 후 자동 시작`, "#a7f3d0");
      } else {
        banner("웨이브 클리어! 배치 후 [웨이브 시작]으로 진행하십시오.", "#a7f3d0");
      }
    }
    if (state.phase !== "win" && state.phase === "fail")  banner("수정탑 붕괴! R 또는 [재시작]으로 다시 시작하십시오.", "#93c5fd");
    if (state.phase === "win" && state.win && state.win.stage < 3) banner("정화 시퀀스 진행 중...", "#93c5fd");
    if (state.phase !== "win" && state.event && state.eventTextTimer > 0) banner(`이벤트: ${state.event.name} — ${state.event.desc}`, "#fbbf24");

    if (state.phase !== "win") drawWireStatusPanel(state.core.hp / state.core.hpMax, state.core.shield / state.core.shieldMax);
  }

  function drawCore(){
    // 붕괴 중: 코어 페이드아웃
    let alpha = 1.0;
    if (state.phase === "fail" && state.collapse) {
      alpha = 1.0 - clamp(state.collapse.t / 0.22, 0, 1);
    }

    // shadow
    ctx.save();
    ctx.globalAlpha = 0.22 * alpha;
    ctx.beginPath();
    ctx.ellipse(CORE_POS.x, CORE_POS.y + CORE_RADIUS + 18, 64, 18, 0, 0, Math.PI*2);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.restore();


    // 패시브별 코어 모션(선택한 패시브에 따라 코어 주변 오라/룬이 변합니다)
    if (alpha > 0.01 && state.core.passiveId && state.phase !== "fail") {
      drawCorePassiveAura(alpha);
    }


    // 웨이브 30(최종전): 수정탑 에너지 집속 연출(코어 주변 이펙트)
    if (alpha > 0.01 && !false && (state.phase === "finalprep" || (state.phase === "wave" && state.wave === FINAL_WAVE))) {
      const c = clamp(state.core.finalCharge || 0, 0, 1);
      const pulse = 0.5 + 0.5*Math.sin(state.time*3.0 + c*1.7);

      ctx.save();
      // outer glow ring
      ctx.globalAlpha = alpha * (0.10 + 0.16*c + 0.05*pulse);
      ctx.strokeStyle = "rgba(96,165,250,0.85)";
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(CORE_POS.x, CORE_POS.y, 96 + 7*pulse, 0, Math.PI*2);
      ctx.stroke();

      // rotating arcs
      ctx.globalAlpha = alpha * (0.16 + 0.22*c);
      ctx.strokeStyle = "rgba(147,197,253,0.9)";
      ctx.lineWidth = 5;
      const baseR = 86;
      const rot = state.time*1.9 + c*0.8;
      for (let k=0;k<3;k++){
        const a0 = rot + k*(Math.PI*2/3);
        ctx.beginPath();
        ctx.arc(CORE_POS.x, CORE_POS.y, baseR, a0, a0 + 1.05 + 0.2*pulse);
        ctx.stroke();
      }

      // particles converging to core
      const orbs = state.core.finalChargeOrbs || [];
      for (const o of orbs){
        const ox = CORE_POS.x + Math.cos(o.a) * o.r;
        const oy = CORE_POS.y + Math.sin(o.a) * o.r * 0.72; // 살짝 납작한 타원
        const t = clamp(o.t / (o.life || 1), 0, 1);
        const a = alpha * (0.28 * (1 - t));
        if (a <= 0) continue;

        ctx.globalAlpha = a * (0.8 + 0.2*pulse);
        ctx.fillStyle = "#60a5fa";
        ctx.beginPath();
        ctx.arc(ox, oy, 3.1, 0, Math.PI*2);
        ctx.fill();

        // thin trail
        ctx.globalAlpha = a * 0.45;
        ctx.strokeStyle = "rgba(96,165,250,0.6)";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(CORE_POS.x, CORE_POS.y);
        ctx.stroke();
      }

      // subtle inner glow
      ctx.globalAlpha = alpha * (0.06 + 0.10*c);
      const g = ctx.createRadialGradient(CORE_POS.x, CORE_POS.y, 10, CORE_POS.x, CORE_POS.y, 80);
      g.addColorStop(0, "rgba(96,165,250,0.55)");
      g.addColorStop(1, "rgba(96,165,250,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(CORE_POS.x, CORE_POS.y, 82, 0, Math.PI*2);      ctx.fill();

      ctx.restore();
    }



    // 에너지포 충전: 수정탑 집속 연출(빛을 모아 가장 밝아질 때 발사)
    if (alpha > 0.01 && state.core.energyCharging) {
      const tt = gameSec();
      const dur = state.core.energyChargeDur || 3.0;
      const rem = state.core.energyChargeUntil - tt;
      const c = clamp(1 - (rem / dur), 0, 1);
      const pulse = 0.5 + 0.5*Math.sin(tt*7.2 + c*2.2);

      ctx.save();
      ctx.globalCompositeOperation = "lighter";

      // 강한 글로우(수정탑 자체가 빛나게)
      ctx.globalAlpha = alpha * (0.10 + 0.36*c);
      const gg = ctx.createRadialGradient(CORE_POS.x, CORE_POS.y, 8, CORE_POS.x, CORE_POS.y, 110 + 40*c);
      gg.addColorStop(0, "rgba(203,230,255,0.85)");
      gg.addColorStop(0.35, "rgba(96,165,250,0.55)");
      gg.addColorStop(1, "rgba(96,165,250,0)");
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.arc(CORE_POS.x, CORE_POS.y, 120 + 30*c, 0, Math.PI*2);
      ctx.fill();

      // 외곽 링(회전 아크)
      ctx.globalAlpha = alpha * (0.12 + 0.26*c);
      ctx.strokeStyle = "rgba(147,197,253,0.95)";
      ctx.lineWidth = 4.2;
      const baseR = 88 + 8*pulse;
      const rot = tt*2.4 + c*1.1;
      for (let k=0;k<3;k++){
        const a0 = rot + k*(Math.PI*2/3);
        ctx.beginPath();
        ctx.arc(CORE_POS.x, CORE_POS.y, baseR, a0, a0 + 0.95 + 0.25*pulse);
        ctx.stroke();
      }

      // 코어로 모이는 오브/트레일
      const orbs = state.core.energyChargeOrbs || [];
      for (const o of orbs){
        const ox = CORE_POS.x + Math.cos(o.a) * o.r;
        const oy = CORE_POS.y + Math.sin(o.a) * o.r * 0.72;
        const t01 = clamp(o.t / (o.life || 1), 0, 1);
        const a = alpha * (0.30 * (1 - t01)) * (0.7 + 0.3*pulse);
        if (a <= 0) continue;

        ctx.globalAlpha = a;
        ctx.fillStyle = "rgba(203,230,255,0.95)";
        ctx.beginPath();
        ctx.arc(ox, oy, 3.0, 0, Math.PI*2);
        ctx.fill();

        ctx.globalAlpha = a * 0.55;
        ctx.strokeStyle = "rgba(96,165,250,0.75)";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(CORE_POS.x, CORE_POS.y);
        ctx.stroke();
      }

      ctx.restore();
    }

    // core image (+ 에너지포 충전 시 더 밝게/살짝 확대)
    if (alpha > 0.01) {
      const tt = gameSec();
      const dur = state.core.energyChargeDur || 3.0;
      const rem = (state.core.energyCharging ? (state.core.energyChargeUntil - tt) : 0);
      const eng = state.core.energyCharging ? clamp(1 - (rem / dur), 0, 1) : 0;

      const flashRem = Math.max(0, (state.core.energyFlashUntil || 0) - tt);
      const flash = flashRem > 0 ? clamp(flashRem / 0.16, 0, 1) : 0;

      let size = 140;
      // NOTE: Do NOT scale the core while charging. Charging is shown via glow/orbs only.

      // 아이콘 자체 글로우(빛나는 느낌)
      if (eng > 0.001 || flash > 0.001) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = alpha * (0.10 + 0.22*eng + 0.28*flash);
        const gg = ctx.createRadialGradient(CORE_POS.x, CORE_POS.y, 12, CORE_POS.x, CORE_POS.y, 64 + 80*eng + 90*flash);
        gg.addColorStop(0, "rgba(255,255,255,0.70)");
        gg.addColorStop(0.35, "rgba(147,197,253,0.55)");
        gg.addColorStop(1, "rgba(147,197,253,0)");
        ctx.fillStyle = gg;
        ctx.beginPath();
        ctx.arc(CORE_POS.x, CORE_POS.y, 90 + 60*eng + 70*flash, 0, Math.PI*2);
        ctx.fill();
        ctx.restore();
      }

      if (coreIconReady) {
        const iconSize =  150; // 2.5x
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = alpha;
        ctx.drawImage(coreIcon, CORE_POS.x - iconSize/2, CORE_POS.y - iconSize/2, iconSize, iconSize);
        ctx.restore();
      } else {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "#60a5fa";
        ctx.beginPath();
        ctx.arc(CORE_POS.x, CORE_POS.y, 20, 0, Math.PI*2);
        ctx.fill();
        ctx.restore();
      }

      // 발사 플래시(짧고 강하게)
      if (flash > 0.001) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = alpha * (0.30 * flash);
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.beginPath();
        ctx.arc(CORE_POS.x, CORE_POS.y, 28 + 42*(1-flash), 0, Math.PI*2);
        ctx.fill();
        ctx.restore();
      }
    }

    // passive emblem on the core (small, on-top)
    if (alpha > 0.01 && state.core.passiveId && state.phase !== "fail") {
      drawCorePassiveEmblem(alpha);
    }

    // faint shield glow only when alive + shield>0
    const shR = clamp(state.core.shield / state.core.shieldMax, 0, 1);
    if (state.phase !== "fail" && shR > 0.001) {
      ctx.save();
      ctx.globalAlpha = 0.06 + 0.10*shR;
      ctx.strokeStyle = "rgba(96,165,250,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(CORE_POS.x, CORE_POS.y, 70, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }

    // ✅ 불꽃은 살아있을 때만
    if (state.phase !== "fail") drawBlueFlames();
  }

  function drawCorePassiveAura(alpha){
    const id = state.core.passiveId;
    if (!id) return;

    const t = state.time || 0;
    const x = CORE_POS.x, y = CORE_POS.y;

    ctx.save();
    ctx.translate(x,y);
    ctx.globalCompositeOperation = "lighter";

    if (id === "rebuild") {
      const sh = clamp(state.core.shield / state.core.shieldMax, 0, 1);
      const hp = clamp(state.core.hp / state.core.hpMax, 0, 1);
      const need = 1 - Math.min(sh, hp);
      const pulse = 0.5 + 0.5*Math.sin(t*2.2);

      // rotating hex rune
      ctx.globalAlpha = alpha * (0.10 + 0.10*pulse + 0.18*need);
      ctx.strokeStyle = "rgba(96,165,250,0.85)";
      ctx.lineWidth = 3.0;
      polyPath(6, 92 + 4*Math.sin(t*1.4), t*0.55);
      ctx.stroke();

      // inner tick marks
      ctx.globalAlpha = alpha * (0.06 + 0.10*need);
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 2.0;
      for (let i=0;i<12;i++){
        const a = t*0.9 + i*(Math.PI*2/12);
        const r0 = 66;
        const r1 = 74 + 6*Math.sin(t*2.0 + i);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a)*r0, Math.sin(a)*r0);
        ctx.lineTo(Math.cos(a)*r1, Math.sin(a)*r1);
        ctx.stroke();
      }

      // orbiting repair motes
      const n = 6;
      for (let i=0;i<n;i++){
        const a = t*1.1 + i*(Math.PI*2/n);
        const rr = 78 + 6*Math.sin(t*1.6 + i);
        const ox = Math.cos(a)*rr;
        const oy = Math.sin(a)*rr*0.72;
        ctx.globalAlpha = alpha * (0.10 + 0.16*need) * (0.6 + 0.4*pulse);
        ctx.fillStyle = "rgba(147,197,253,0.95)";
        ctx.beginPath();
        ctx.arc(ox, oy, 2.4, 0, Math.PI*2);
        ctx.fill();
      }

    } else if (id === "resonance") {
      const g01 = (typeof resonanceGauge01 === 'function') ? resonanceGauge01() : 0;
      const pulse = 0.5 + 0.5*Math.sin(t*3.0);

      // base ring
      ctx.globalAlpha = alpha * (0.09 + 0.12*pulse + 0.06*g01);
      ctx.strokeStyle = "rgba(253,186,116,0.55)";
      ctx.lineWidth = 3.0;
      ctx.beginPath();
      ctx.arc(0,0, 90, 0, Math.PI*2);
      ctx.stroke();

      // gauge arc
      ctx.globalAlpha = alpha * (0.10 + 0.26*g01);
      ctx.strokeStyle = "rgba(251,146,60,0.95)";
      ctx.lineWidth = 6.0;
      const start = -Math.PI/2;
      ctx.beginPath();
      ctx.arc(0,0, 90, start, start + Math.PI*2*g01);
      ctx.stroke();

      // rotating chevrons
      ctx.globalAlpha = alpha * (0.06 + 0.16*g01);
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 2.0;
      const rot = t*1.6;
      for (let i=0;i<8;i++){
        const a = rot + i*(Math.PI*2/8);
        const r0 = 64;
        const r1 = 74;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a)*r0, Math.sin(a)*r0);
        ctx.lineTo(Math.cos(a+0.18)*r1, Math.sin(a+0.18)*r1);
        ctx.stroke();
      }



      // traveling current (always moving, stronger when gauge is high)
      const curA = -Math.PI/2 + t*2.6 + g01*1.1;
      const cx2 = Math.cos(curA)*90;
      const cy2 = Math.sin(curA)*90;
      ctx.globalAlpha = alpha * (0.06 + 0.18*g01) * (0.7 + 0.3*pulse);
      ctx.fillStyle = "rgba(255,255,255,0.30)";
      ctx.beginPath();
      ctx.arc(cx2, cy2, 2.7 + 1.6*g01, 0, Math.PI*2);
      ctx.fill();

      // waveform ring (subtle) to make it feel "alive"
      ctx.globalAlpha = alpha * (0.03 + 0.10*g01);
      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      const seg = 42;
      for (let i=0;i<=seg;i++){
        const a = -Math.PI/2 + i*(Math.PI*2/seg);
        const wv = 2.6*Math.sin(t*4.0 + i*0.45) + 1.2*Math.sin(t*7.2 + i*0.22);
        const rr = 76 + wv*(0.35 + 0.65*g01);
        const px = Math.cos(a)*rr;
        const py = Math.sin(a)*rr;
        if (i==0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
      }
      ctx.closePath();
      ctx.stroke();
      // spark on arc end
      if (g01 > 0.02){
        const a = start + Math.PI*2*g01;
        const ex = Math.cos(a)*90;
        const ey = Math.sin(a)*90;
        ctx.globalAlpha = alpha * (0.12 + 0.24*g01) * (0.6 + 0.4*pulse);
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.beginPath();
        ctx.arc(ex, ey, 3.0, 0, Math.PI*2);
        ctx.fill();
      }

    } else if (id === "overload") {
      const hpFrac = (state.core.hpMax>0) ? (state.core.hp/state.core.hpMax) : 1;
      const trig = (typeof OVERLOAD_CFG === 'object' && OVERLOAD_CFG) ? OVERLOAD_CFG.triggerHp : 0.30;
      const danger = clamp((trig + 0.18 - hpFrac)/0.18, 0, 1);
      const burst = (typeof overloadBurstActive === 'function' && overloadBurstActive()) ? 1 : 0;
      const pulse = 0.5 + 0.5*Math.sin(t*(6 + 4*burst));

      // unstable jagged ring
      ctx.globalAlpha = alpha * (0.05 + 0.18*danger + 0.12*burst);
      ctx.strokeStyle = "rgba(251,113,133,0.85)";
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      const base = 92;
      for (let i=0;i<=36;i++){
        const a = i*(Math.PI*2/36);
        const j = (Math.sin(t*7.0 + i*1.7) + Math.sin(t*3.1 + i*0.9))*0.5;
        const rr = base + (danger*6 + burst*10) * (0.3 + 0.7*Math.abs(j));
        const px = Math.cos(a)*rr;
        const py = Math.sin(a)*rr;
        if (i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
      }
      ctx.closePath();
      ctx.stroke();

      // crack spokes
      ctx.globalAlpha = alpha * (0.06 + 0.22*danger + 0.16*burst) * (0.4 + 0.6*pulse);
      ctx.strokeStyle = "rgba(253,164,175,0.65)";
      ctx.lineWidth = 2.2;
      const n = 7;
      for (let k=0;k<n;k++){
        const a = t*1.1 + k*(Math.PI*2/n);
        const r0 = 62;
        const r1 = 84 + 18*danger + 24*burst;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a)*r0, Math.sin(a)*r0);
        ctx.lineTo(Math.cos(a)*r1, Math.sin(a)*r1);
        ctx.stroke();
      }

      // sparks
      const sn = 8;
      for (let i=0;i<sn;i++){
        const a = t*2.6 + i*1.7;
        const rr = 74 + 18*Math.abs(Math.sin(t*3.3 + i));
        const ox = Math.cos(a)*rr;
        const oy = Math.sin(a)*rr*0.72;
        ctx.globalAlpha = alpha * (0.06 + 0.20*danger + 0.16*burst) * (0.4 + 0.6*pulse);
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.beginPath();
        ctx.arc(ox, oy, 1.8 + 1.0*burst, 0, Math.PI*2);
        ctx.fill();
      }

    } else if (id === "overdrive") {
      const hpFrac = (state.core.hpMax>0) ? (state.core.hp/state.core.hpMax) : 1;
      const m = clamp(1 - hpFrac, 0, 1);
      const sp = 1.2 + 2.0*Math.pow(m, 0.9);
      const pulse = 0.5 + 0.5*Math.sin(t*3.2);

      // rotating arc ring
      ctx.globalAlpha = alpha * (0.06 + 0.16*pulse + 0.22*m);
      ctx.strokeStyle = "rgba(168,85,247,0.75)";
      ctx.lineWidth = 4.0;
      const r = 92;
      const rot = t*1.8*sp;
      for (let k=0;k<3;k++){
        const a0 = rot + k*(Math.PI*2/3);
        ctx.beginPath();
        ctx.arc(0,0, r, a0, a0 + 0.95);
        ctx.stroke();
      }

      // speed streaks
      ctx.globalAlpha = alpha * (0.05 + 0.14*m);
      ctx.strokeStyle = "rgba(216,180,254,0.35)";
      ctx.lineWidth = 2.0;
      for (let i=0;i<10;i++){
        const a = rot*1.4 + i*(Math.PI*2/10);
        const rr = 64 + 10*Math.sin(t*2.6 + i);
        const x0 = Math.cos(a)*rr;
        const y0 = Math.sin(a)*rr*0.72;
        const tx = -Math.sin(a);
        const ty =  Math.cos(a)*0.72;
        const len = 10 + 22*m*(0.4 + 0.6*Math.sin(t*3.5 + i));
        ctx.beginPath();
        ctx.moveTo(x0 - tx*len*0.5, y0 - ty*len*0.5);
        ctx.lineTo(x0 + tx*len*0.5, y0 + ty*len*0.5);
        ctx.stroke();
      }

      // orbiting motes
      ctx.globalAlpha = alpha * (0.06 + 0.16*m) * (0.6 + 0.4*pulse);
      ctx.fillStyle = "rgba(216,180,254,0.65)";
      const n = 5;
      for (let i=0;i<n;i++){
        const a = rot*0.9 + i*(Math.PI*2/n);
        const rr2 = 78;
        ctx.beginPath();
        ctx.arc(Math.cos(a)*rr2, Math.sin(a)*rr2*0.72, 2.2, 0, Math.PI*2);
        ctx.fill();
      }
    }

    ctx.restore();
  }



  function drawCorePassiveEmblem(alpha){
    const id = state.core && state.core.passiveId;
    if (!id) return;

    const t = state.time || 0;
    const x = CORE_POS.x, y = CORE_POS.y;

    ctx.save();
    ctx.translate(x,y);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha * 0.22;
    ctx.lineWidth = 2.2;

    if (id === 'rebuild') {
      ctx.strokeStyle = 'rgba(147,197,253,0.9)';
      polyPath(6, 22, t*0.5);
      ctx.stroke();
      ctx.globalAlpha = alpha * 0.16;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.moveTo(-10,0); ctx.lineTo(10,0);
      ctx.moveTo(0,-10); ctx.lineTo(0,10);
      ctx.stroke();

    } else if (id === 'resonance') {
      ctx.strokeStyle = 'rgba(253,186,116,0.95)';
      ctx.beginPath();
      ctx.arc(0,0, 20, 0, Math.PI*2);
      ctx.stroke();
      ctx.globalAlpha = alpha * 0.18;
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.beginPath();
      for (let i=-18;i<=18;i+=3){
        const yy = i;
        const xx = 12*Math.sin(t*3.0 + i*0.20);
        if (i==-18) ctx.moveTo(xx,yy); else ctx.lineTo(xx,yy);
      }
      ctx.stroke();

    } else if (id === 'overload') {
      ctx.strokeStyle = 'rgba(251,113,133,0.95)';
      ctx.beginPath();
      ctx.moveTo(0,-22); ctx.lineTo(19,14); ctx.lineTo(-19,14);
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = alpha * 0.20;
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.moveTo(0,-10); ctx.lineTo(0,6);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0,12, 1.6, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(255,255,255,0.30)';
      ctx.fill();

    } else if (id === 'overdrive') {
      ctx.strokeStyle = 'rgba(216,180,254,0.95)';
      const a = t*2.0;
      for (let k=0;k<2;k++){
        const off = (k*6) - 3;
        ctx.beginPath();
        ctx.moveTo(-10+off,-10);
        ctx.lineTo(10+off,0);
        ctx.lineTo(-10+off,10);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  // ---------- Shape helpers (simple vector sprites) ----------
  function withTransform(x,y,rot,fn){
    ctx.save();
    ctx.translate(x,y);
    if (rot) ctx.rotate(rot);
    fn();
    ctx.restore();
  }

  function polyPath(n, r, rot){
    const a0 = rot || 0;
    ctx.beginPath();
    for (let i=0;i<n;i++) {
      const a = a0 + (i/n)*Math.PI*2;
      const px = Math.cos(a)*r;
      const py = Math.sin(a)*r;
      if (i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
    }
    ctx.closePath();
  }

  function starPath(points, rOuter, rInner, rot){
    const n = Math.max(3, points|0);
    const a0 = rot || 0;
    ctx.beginPath();
    for (let i=0;i<n*2;i++) {
      const r = (i%2===0) ? rOuter : rInner;
      const a = a0 + (i/(n*2))*Math.PI*2;
      const px = Math.cos(a)*r;
      const py = Math.sin(a)*r;
      if (i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
    }
    ctx.closePath();
  }

  function roundRectPath(x,y,w,h,r){
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr, y);
    ctx.lineTo(x+w-rr, y);
    ctx.quadraticCurveTo(x+w, y, x+w, y+rr);
    ctx.lineTo(x+w, y+h-rr);
    ctx.quadraticCurveTo(x+w, y+h, x+w-rr, y+h);
    ctx.lineTo(x+rr, y+h);
    ctx.quadraticCurveTo(x, y+h, x, y+h-rr);
    ctx.lineTo(x, y+rr);
    ctx.quadraticCurveTo(x, y, x+rr, y);
    ctx.closePath();
  }

  function drawTurret(t){
    const s = turretBase(t);

    // New visual palette (visual only)
    const col = (t.type==="basic")  ? "#60a5fa" :
                (t.type==="slow")   ? "#34d399" :
                (t.type==="splash") ? "#f472b6" :
                (t.type==="shred")  ? "#22d3ee" :
                (t.type==="breaker")? "#f59e0b" : "#60a5fa";

    // aim (same heuristic as update)
    let best = null, bestScore = Infinity;
    for (const e of state.enemies) {
      const d = dist(t.x,t.y, e.x,e.y);
      if (d > s.range) continue;
      const dCore = dist(e.x,e.y, CORE_POS.x, CORE_POS.y);
      const score = dCore*0.9 + d*0.25;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    const time = (typeof nowSec==="function") ? nowSec() : (performance.now()/1000);
    const aim = best ? Math.atan2(best.y - t.y, best.x - t.x) : (time*0.65 + (t.x+t.y)*0.004);

    // muzzle flash hint (very short after a shot)
    const fireRate = (s.fireRate * state.mods.turretFireMul);
    const cdMax = fireRate > 0 ? (1 / fireRate) : 0.3;
    const flashWindow = 0.025;
    const flash = (t.cd > cdMax - flashWindow) ? 1 : 0;

    // shadow
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.ellipse(t.x, t.y + 15, 20, 7, 0, 0, Math.PI*2);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.restore();

    // body
    withTransform(t.x, t.y, 0, () => {
      // base plate (layered)
      ctx.save();
      const baseG = ctx.createLinearGradient(-18, -14, 18, 16);
      baseG.addColorStop(0, "#0b1220");
      baseG.addColorStop(1, "#121a2a");
      ctx.fillStyle = baseG;
      ctx.strokeStyle = "#334155";
      ctx.lineWidth = 2;

      if (t.type === "slow") {
        // snowflake-ish base (hex + notches)
        polyPath(6, 17, Math.PI/6);
        ctx.fill(); ctx.stroke();
        ctx.globalAlpha = 0.40;
        ctx.strokeStyle = "rgba(52,211,153,0.9)";
        ctx.lineWidth = 2;
        for (let i=0;i<6;i++){
          const a = i*Math.PI/3;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a)*6, Math.sin(a)*6);
          ctx.lineTo(Math.cos(a)*15, Math.sin(a)*15);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      } else if (t.type === "splash") {
        // heavy rounded base + brace
        roundRectPath(-17, -15, 34, 30, 7);
        ctx.fill(); ctx.stroke();
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = "#475569";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 2, 13, 0, Math.PI*2); ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (t.type === "shred") {
        // shred: gear / saw base
        starPath(10, 17, 13.2, Math.PI/10);
        ctx.fill(); ctx.stroke();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0,0, 11.5, 0, Math.PI*2); ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (t.type === "breaker") {
        // breaker: diamond base + mark
        polyPath(4, 18, Math.PI/4);
        ctx.fill(); ctx.stroke();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-10, -10); ctx.lineTo(10, 10);
        ctx.moveTo(-10, 10); ctx.lineTo(10, -10);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        // basic: beveled octagon
        polyPath(8, 17, Math.PI/8);
        ctx.fill(); ctx.stroke();
      }

      // core crystal (prism)
      const pulse = 0.55 + 0.45*Math.sin(time*2.4 + (t.x+t.y)*0.01);
      ctx.save();
      ctx.translate(0, -3);
      const cg = ctx.createRadialGradient(0,0, 2, 0,0, 12);
      cg.addColorStop(0, col);
      cg.addColorStop(1, "rgba(11,18,32,0.95)");
      ctx.fillStyle = cg;
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -11);
      ctx.lineTo(9, -2);
      ctx.lineTo(0, 10);
      ctx.lineTo(-9, -2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // inner spark
      ctx.globalAlpha = 0.18 + 0.16*pulse;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-5, 0); ctx.lineTo(5, 0);
      ctx.moveTo(0, -5); ctx.lineTo(0, 5);
      ctx.stroke();
      ctx.restore();

      // rotating ring (subtle, no blink)
      ctx.save();
      ctx.globalAlpha = 0.10 + 0.06*pulse;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -3, 16, time*0.9, time*0.9 + Math.PI*1.35);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -3, 16, time*0.9 + Math.PI*1.7, time*0.9 + Math.PI*2.35);
      ctx.stroke();
      ctx.restore();

      // barrel / head (more angular)
      withTransform(0, -3, aim, () => {
        ctx.save();

        // housing
        ctx.fillStyle = "#162033";
        ctx.strokeStyle = "#475569";
        ctx.lineWidth = 2;
        roundRectPath(-2, -9, 24, 18, 4);
        ctx.fill(); ctx.stroke();

        // energy rail
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(6, -6); ctx.lineTo(18, -6);
        ctx.moveTo(6,  6); ctx.lineTo(18,  6);
        ctx.stroke();

        // muzzle
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#0b1220";
        ctx.strokeStyle = "rgba(255,255,255,0.10)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(22, 0, 5.2, 0, Math.PI*2);
        ctx.fill(); ctx.stroke();

        // type accents
        if (t.type === "slow") {
          ctx.globalAlpha = 0.28;
          ctx.strokeStyle = col;
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(10, 0, 7, 0, Math.PI*2); ctx.stroke();
        } else if (t.type === "splash") {
          ctx.globalAlpha = 0.22;
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.moveTo(3, -10); ctx.lineTo(8, -10); ctx.lineTo(6, -15);
          ctx.closePath();
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(3, 10); ctx.lineTo(8, 10); ctx.lineTo(6, 15);
          ctx.closePath();
          ctx.fill();
        } else if (t.type === "shred") {
          // shred: saw ring around muzzle
          ctx.globalAlpha = 0.26;
          ctx.strokeStyle = col;
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(22, 0, 9.2, 0, Math.PI*2); ctx.stroke();
          ctx.globalAlpha = 0.20;
          ctx.fillStyle = col;
          for (let i=0;i<6;i++){
            const a = i*Math.PI/3;
            ctx.save();
            ctx.translate(22 + Math.cos(a)*9.2, Math.sin(a)*9.2);
            ctx.rotate(a);
            ctx.beginPath();
            ctx.moveTo(-2, -1.5); ctx.lineTo(2, -1.5); ctx.lineTo(0, 5);
            ctx.closePath(); ctx.fill();
            ctx.restore();
          }
          ctx.globalAlpha = 1;
        } else if (t.type === "breaker") {
          // breaker: target reticle + fins
          ctx.globalAlpha = 0.28;
          ctx.strokeStyle = col;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(10, 0, 7, 0, Math.PI*2);
          ctx.moveTo(3,0); ctx.lineTo(17,0);
          ctx.moveTo(10,-7); ctx.lineTo(10,7);
          ctx.stroke();
          ctx.globalAlpha = 0.22;
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.moveTo(8, -10); ctx.lineTo(14, -10); ctx.lineTo(11, -16);
          ctx.closePath(); ctx.fill();
          ctx.beginPath();
          ctx.moveTo(8, 10); ctx.lineTo(14, 10); ctx.lineTo(11, 16);
          ctx.closePath(); ctx.fill();
          ctx.globalAlpha = 1;
        }

        // muzzle flash (subtle glint)
        if (flash) {
          ctx.globalAlpha = 0.16;
          ctx.fillStyle = col;
          ctx.translate(24, 0);
          starPath(6, 5.2, 2.2, 0);
          ctx.fill();
        }

        ctx.restore();
      });

      // outer glow
      ctx.save();
      ctx.globalAlpha = 0.10;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -3, 19, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();

      ctx.restore();
    });
  }


  
    function drawFinalBossGlyph(e, hpR, time){
      const dr = (e.drawR || e.r);
      const c = clamp(state.core.finalCharge || 0, 0, 1);

      // phase from HP (same logic)
      let phase = 1;
      if (hpR <= 0.70) phase = 2;
      if (hpR <= 0.35) phase = 3;

      const p2 = phase >= 2 ? 1 : 0;
      const p3 = phase >= 3 ? 1 : 0;
      const rage = clamp(1 - hpR, 0, 1);
      const flash = clamp(e.awakeFlash || 0, 0, 1);
      const spin = time*0.85*e.orbitDir;

      // ---- Eclipse Engine: concentric rings + blades ----
      // outer halo
      ctx.save();
      ctx.globalAlpha = 0.12 + 0.22*c + 0.10*p2 + 0.12*p3;
      ctx.strokeStyle = "rgba(147,197,253,0.92)";
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(0,0, dr+20 + Math.sin(time*2.2+e.seedAng)*2.2, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();

      // rotating arc segments
      ctx.save();
      ctx.globalAlpha = 0.20 + 0.10*c;
      ctx.strokeStyle = "rgba(96,165,250,0.95)";
      ctx.lineWidth = 6;
      for (let i=0;i<3+p2+p3;i++){
        const a0 = spin + i*(Math.PI*2/(3+p2+p3));
        ctx.beginPath();
        ctx.arc(0,0, dr+10, a0, a0 + Math.PI*0.55);
        ctx.stroke();
      }
      ctx.restore();

      // body (armored disc)
      ctx.save();
      const bodyG = ctx.createRadialGradient(0,0, 4, 0,0, dr+10);
      bodyG.addColorStop(0, "rgba(255,255,255,0.10)");
      bodyG.addColorStop(1, "rgba(11,18,32,0.95)");
      ctx.fillStyle = bodyG;
      ctx.strokeStyle = "#0b1220";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0,0, dr+4, 0, Math.PI*2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // blades (increase with phase)
      ctx.save();
      ctx.globalAlpha = 0.65;
      ctx.fillStyle = "rgba(148,163,184,0.22)";
      const blades = 6 + (p2?2:0) + (p3?2:0);
      for (let i=0;i<blades;i++){
        const a = spin + i*(Math.PI*2/blades);
        withTransform(Math.cos(a)*(dr*0.35), Math.sin(a)*(dr*0.35), a, () => {
          ctx.beginPath();
          ctx.moveTo(6, 0);
          ctx.lineTo(dr*0.95, -6);
          ctx.lineTo(dr*0.95,  6);
          ctx.closePath();
          ctx.fill();
        });
      }
      ctx.restore();

      // core eye
      const pulse = 0.55 + 0.45*Math.sin(time*2.8 + e.seedAng);
      ctx.save();
      const coreG = ctx.createRadialGradient(0,0, 2, 0,0, 18);
      coreG.addColorStop(0, "rgba(251,113,133,0.95)");
      coreG.addColorStop(1, "rgba(11,18,32,0.95)");
      ctx.fillStyle = coreG;
      ctx.beginPath(); ctx.arc(0,0, 16, 0, Math.PI*2); ctx.fill();

      ctx.globalAlpha = 0.18 + 0.18*pulse + 0.12*c;
      ctx.strokeStyle = "rgba(251,113,133,0.95)";
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0,0, 24, 0, Math.PI*2); ctx.stroke();
      ctx.restore();

      // phase flash (on transition)
      if (flash > 0.01) {
        ctx.save();
        ctx.globalAlpha = 0.25 * flash;
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 12;
        ctx.beginPath();
        ctx.arc(0,0, dr+26, 0, Math.PI*2);
        ctx.stroke();
        ctx.restore();
      }

      // small crown spikes in phase 2/3
      if (p2) {
        ctx.save();
        ctx.globalAlpha = 0.28 + 0.10*p3;
        ctx.fillStyle = "rgba(96,165,250,0.85)";
        const spikes = 8 + (p3?4:0);
        for (let i=0;i<spikes;i++){
          const a = -Math.PI/2 + i*(Math.PI*2/spikes) + spin*0.35;
          withTransform(Math.cos(a)*(dr+8), Math.sin(a)*(dr+8), a, () => {
            ctx.beginPath();
            ctx.moveTo(-4, 0);
            ctx.lineTo( 4, 0);
            ctx.lineTo( 0, 10 + rage*8);
            ctx.closePath();
            ctx.fill();
          });
        }
        ctx.restore();
      }
    }


function drawEnemy(e){
    const hpR = clamp(e.hp / e.hpMax, 0, 1);
    const base = (e.color || "#94a3b8");
    const time = (typeof nowSec==="function") ? nowSec() : (performance.now()/1000);
    const toCore = Math.atan2(CORE_POS.y - e.y, CORE_POS.x - e.x);
    const wob = Math.sin(time*3 + e.seedAng) * 1.1;
    const rot = (e.kind === "shooter" || e.kind === "boss") ? (e.seedAng + time*0.9*e.orbitDir) : toCore;

    // elite aura (keep, but sharpen)
    if (e.elite) {
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 8, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }

    withTransform(e.x, e.y + wob, rot, () => {
      ctx.save();

      // gradient fill for "new look"
      const g = ctx.createRadialGradient(0,0, 2, 0,0, e.r+14);
      g.addColorStop(0, e.elite ? "#fde68a" : base);
      g.addColorStop(1, "rgba(11,18,32,0.92)");
      ctx.fillStyle = g;
      ctx.strokeStyle = "#0b1220";
      ctx.lineWidth = 2;

      // FINAL BOSS (Wave 30): delegate
      if (e.kind === "boss" && e.isFinalBoss) {
        drawFinalBossGlyph(e, hpR, time);
        ctx.restore();
        return;
      }

      // silhouettes per type (redesigned)
      if (e.kind === "grunt") {
        // winged drone: center diamond + two wings
        ctx.beginPath();
        ctx.moveTo(e.r+6, 0);
        ctx.lineTo(4, -e.r*0.55);
        ctx.lineTo(-e.r*0.85, -e.r*0.30);
        ctx.lineTo(-4, 0);
        ctx.lineTo(-e.r*0.85, e.r*0.30);
        ctx.lineTo(4, e.r*0.55);
        ctx.closePath();
      } else if (e.kind === "shooter") {
        // sentry: squared body
        roundRectPath(-(e.r+2), -(e.r+2), (e.r+2)*2, (e.r+2)*2, 6);
      } else if (e.kind === "shieldbreaker") {
        // saw gear (teeth)
        starPath(10, e.r+6, e.r*0.72, 0);
      } else if (e.kind === "piercer") {
        // needle spear (long)
        ctx.beginPath();
        ctx.moveTo(e.r+10, 0);
        ctx.lineTo(-e.r, -e.r*0.40);
        ctx.lineTo(-e.r*0.55, 0);
        ctx.lineTo(-e.r, e.r*0.40);
        ctx.closePath();
      } else if (e.kind === "bomber") {
        // mine: octagon + spikes
        polyPath(8, e.r+3, Math.PI/8);
      } else if (e.kind === "disruptor") {
        // EMP orb: circle with notches
        ctx.beginPath();
        ctx.arc(0,0, e.r+2, 0, Math.PI*2);
      } else if (e.kind === "boss") {
        // armored corebreaker: layered hex
        polyPath(6, e.r+6, Math.PI/6);
      } else {
        polyPath(6, e.r, 0);
      }

      ctx.fill();
      ctx.stroke();

      // inner details / markings (new)
      ctx.globalAlpha = 0.92;
      ctx.lineWidth = 2;

      if (e.kind === "grunt") {
        // eye
        ctx.fillStyle = "rgba(255,255,255,0.10)";
        ctx.beginPath(); ctx.arc(6, 0, 6, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.beginPath(); ctx.arc(6, 0, 6, 0, Math.PI*2); ctx.stroke();
        ctx.strokeStyle = "rgba(11,18,32,0.7)";
        ctx.beginPath(); ctx.arc(6, 0, 2.2, 0, Math.PI*2); ctx.stroke();
      }

      if (e.kind === "shooter") {
        // lens + side gun
        ctx.strokeStyle = "rgba(255,255,255,0.28)";
        ctx.beginPath(); ctx.arc(0,0, 8, 0, Math.PI*2); ctx.stroke();
        ctx.strokeStyle = "rgba(11,18,32,0.55)";
        ctx.beginPath(); ctx.moveTo(-12,0); ctx.lineTo(12,0); ctx.stroke();
        ctx.save();
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        roundRectPath(9, -3, 10, 6, 2);
        ctx.fill();
        ctx.restore();
      }

      if (e.kind === "shieldbreaker") {
        // inner ring
        ctx.strokeStyle = "#dbeafe";
        ctx.beginPath(); ctx.arc(0,0, e.r*0.55, 0, Math.PI*2); ctx.stroke();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.beginPath(); ctx.arc(0,0, e.r*0.90, time*1.2, time*1.2 + Math.PI*1.4); ctx.stroke();
        ctx.globalAlpha = 0.92;
      }

      if (e.kind === "piercer") {
        // spine line
        ctx.strokeStyle = "#ede9fe";
        ctx.beginPath(); ctx.moveTo(-10,0); ctx.lineTo(10,0); ctx.stroke();
        ctx.globalAlpha = 0.30;
        ctx.strokeStyle = "rgba(255,255,255,0.24)";
        ctx.beginPath(); ctx.moveTo(0,-6); ctx.lineTo(14,0); ctx.lineTo(0,6); ctx.stroke();
        ctx.globalAlpha = 0.92;
      }

      if (e.kind === "bomber") {
        // hazard + spikes
        ctx.save();
        ctx.globalAlpha = 0.28;
        ctx.strokeStyle = "#0b1220";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-9,-7); ctx.lineTo(9,7);
        ctx.moveTo(-9, 7); ctx.lineTo(9,-7);
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = 0.38;
        ctx.fillStyle = "#111826";
        for (let i=0;i<4;i++){
          const a = i*Math.PI/2 + Math.PI/4;
          withTransform(Math.cos(a)*(e.r+6), Math.sin(a)*(e.r+6), a, () => {
            ctx.beginPath();
            ctx.moveTo(-3,0); ctx.lineTo(3,0); ctx.lineTo(0,7);
            ctx.closePath(); ctx.fill();
          });
        }
        ctx.restore();
      }

      if (e.kind === "disruptor") {
        // broken ring arcs + spark
        ctx.save();
        ctx.globalAlpha = 0.30 + 0.10*Math.sin(time*7 + e.seedAng);
        ctx.strokeStyle = "rgba(34,197,94,0.92)";
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0,0, e.r+8, time*0.9, time*0.9 + Math.PI*1.1); ctx.stroke();
        ctx.beginPath(); ctx.arc(0,0, e.r+8, time*0.9 + Math.PI*1.6, time*0.9 + Math.PI*2.2); ctx.stroke();
        ctx.restore();

        ctx.strokeStyle = "rgba(236,253,245,0.75)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-8, -2); ctx.lineTo(-1, -9); ctx.lineTo(6, -1);
        ctx.moveTo(-6,  3); ctx.lineTo(1, -4); ctx.lineTo(8,  4);
        ctx.stroke();
      }

      if (e.kind === "boss") {
        // inner core + rotating brace
        const gg = ctx.createRadialGradient(0,0, 2, 0,0, 16);
        gg.addColorStop(0, "#fff7ed");
        gg.addColorStop(1, "rgba(11,18,32,0.9)");
        ctx.fillStyle = gg;
        ctx.beginPath(); ctx.arc(0,0, 12, 0, Math.PI*2); ctx.fill();

        ctx.save();
        ctx.globalAlpha = 0.28;
        ctx.strokeStyle = "rgba(96,165,250,0.75)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0,0, e.r+12, time*0.8, time*0.8 + Math.PI*1.35);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
    });

    // HP bar (unchanged)
    const br = (e.isFinalBoss ? (e.drawR || e.r) : e.r);
    const w = (e.isFinalBoss ? br*1.45 : e.r*2.4), h = (e.isFinalBoss ? 6 : 4);
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(e.x - w/2, (e.y + wob) - br - (e.isFinalBoss ? 20 : 14), w, h);
    ctx.fillStyle = e.elite ? "#fbbf24" : base;
    ctx.fillRect(e.x - w/2, (e.y + wob) - br - (e.isFinalBoss ? 20 : 14), w*hpR, h);
    ctx.restore();

    // shield bar (적 실드) (unchanged)
    if ((e.shieldMax||0) > 0.01) {
      const shR = clamp((e.shield||0) / (e.shieldMax||1), 0, 1);
      const sy = (e.y + wob) - br - (e.isFinalBoss ? 20 : 14) - 6;
      ctx.save();
      ctx.globalAlpha = 0.88;
      ctx.fillStyle = "#0b1220";
      ctx.fillRect(e.x - w/2, sy, w, 3);
      ctx.fillStyle = "#60a5fa";
      ctx.fillRect(e.x - w/2, sy, w*shR, 3);
      ctx.restore();
    }
  }




function drawProjectile(p){
  const ang = Math.atan2(p.vy||0, p.vx||0);

  // enemy shots: sharp diamond
  if (p.kind !== "turret") {
    const col = (p.projCol||"#fbbf24");
    withTransform(p.x, p.y, ang, () => {
      ctx.save();
      ctx.fillStyle = col;
      polyPath(4, p.r*1.25, Math.PI/4);
      ctx.fill();
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      polyPath(4, p.r*1.25, Math.PI/4);
      ctx.stroke();
      ctx.restore();
    });
    return;
  }

  // turret type (visual-only). Fallback by payload.
  const tType = p.tType || ((p.vulnBonus||0) > 0 ? "breaker" : ((p.shieldMul||1) > 1.05 ? "shred" : ((p.splash||0) > 0 ? "splash" : ((p.slow||0) > 0 ? "slow" : "basic"))));

  // base color per turret type
  let col = (tType === "basic")   ? "#93c5fd" :
            (tType === "slow")    ? "#a7f3d0" :
            (tType === "shred")   ? "#22d3ee" :
            (tType === "breaker") ? "#fbbf24" :
            (tType === "splash")  ? "#f472b6" : "#93c5fd";

  // Overload burst: red tone + stronger trail
  if (p.ovBurst) col = "#fb7185";

  // trail (visual only)
  const trail = (tType === "shred") ? 0.060 :
                (tType === "breaker") ? 0.052 :
                (tType === "splash") ? 0.046 :
                (tType === "slow") ? 0.050 : 0.045;

  const tx = p.x - (p.vx||0) * (p.ovBurst ? 0.030 : trail);
  const ty = p.y - (p.vy||0) * (p.ovBurst ? 0.030 : trail);
  ctx.save();
  ctx.globalAlpha = p.ovBurst ? 0.62 : 0.30;
  ctx.strokeStyle = p.ovBurst ? "rgba(251,113,133,0.85)" : col;
  ctx.lineWidth = p.ovBurst ? 3.6 : (tType === "breaker" ? 2.3 : 2.0);
  ctx.beginPath();
  ctx.moveTo(tx,ty);
  ctx.lineTo(p.x,p.y);
  ctx.stroke();
  ctx.restore();

  // draw per-type shape
  withTransform(p.x, p.y, ang, () => {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = col;

    if (tType === "shred") {
      // rotating gear (using starPath)
      const spin = (state.time * 8.0) % (Math.PI*2);
      ctx.rotate(spin);
      starPath(12, p.r*1.65, p.r*1.05, Math.PI/12);
      ctx.fill();
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.6;
      starPath(12, p.r*1.65, p.r*1.05, Math.PI/12);
      ctx.stroke();
      ctx.globalAlpha = 0.20;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(0,0, p.r*0.55, 0, Math.PI*2);
      ctx.fill();

    } else if (tType === "breaker") {
      // piercing diamond + X mark
      polyPath(4, p.r*1.45, Math.PI/4);
      ctx.fill();
      ctx.globalAlpha = 0.34;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.4;
      polyPath(4, p.r*1.45, Math.PI/4);
      ctx.stroke();
      ctx.globalAlpha = 0.65;
      ctx.strokeStyle = "rgba(11,15,20,0.55)";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-p.r*0.70, -p.r*0.70);
      ctx.lineTo( p.r*0.70,  p.r*0.70);
      ctx.moveTo(-p.r*0.70,  p.r*0.70);
      ctx.lineTo( p.r*0.70, -p.r*0.70);
      ctx.stroke();

    } else if (tType === "splash") {
      // star core
      starPath(5, p.r*1.55, p.r*0.85, state.time*2.5);
      ctx.fill();
      ctx.globalAlpha = 0.30;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.4;
      starPath(5, p.r*1.55, p.r*0.85, state.time*2.5);
      ctx.stroke();
      ctx.globalAlpha = 0.22;
      ctx.beginPath();
      ctx.arc(0,0, p.r*1.75, 0, Math.PI*2);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.0;
      ctx.stroke();

    } else {
      // basic/slow: bolt
      roundRectPath(-p.r*1.2, -p.r*0.55, p.r*2.6, p.r*1.1, p.r*0.55);
      ctx.fill();
      if (tType === "slow") {
        ctx.globalAlpha = 0.18;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.arc(0,0, p.r*1.65, 0, Math.PI*2);
        ctx.stroke();
      }
    }

    // crit outline
    if (p.crit) {
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      if (tType === "shred") {
        starPath(12, p.r*1.82, p.r*1.15, Math.PI/12);
        ctx.stroke();
      } else if (tType === "breaker") {
        polyPath(4, p.r*1.65, Math.PI/4);
        ctx.stroke();
      } else if (tType === "splash") {
        starPath(5, p.r*1.75, p.r*0.95, state.time*2.5);
        ctx.stroke();
      } else {
        roundRectPath(-p.r*1.35, -p.r*0.65, p.r*2.95, p.r*1.30, p.r*0.65);
        ctx.stroke();
      }
    }

    // highlight slit
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#ffffff";
    roundRectPath(-p.r*1.0, -p.r*0.30, p.r*1.2, p.r*0.60, p.r*0.30);
    ctx.fill();
    ctx.restore();
  });
}


  function drawFx(f){
    const t = clamp(f.t / f.dur, 0, 1);

    if (f.kind === "spark") {
      const u = t;
      const ease = 1 - Math.pow(1 - u, 2);
      const dx = (f.dx || 0), dy = (f.dy || 0);
      const px = f.x + dx * ease;
      const py = f.y + dy * ease;
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx / len, ny = dy / len;
      const tail = (f.tail || 14) * (1 - u);
      const sx = px - nx * tail;
      const sy = py - ny * tail;

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = (1 - u) * 0.9;
      ctx.strokeStyle = f.color || "#ffffff";
      ctx.lineWidth = (f.width || 2);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(px, py);
      ctx.stroke();

      // glow pass
      ctx.globalAlpha *= 0.35;
      ctx.lineWidth = (f.width || 2) * 2.4;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (f.kind === "shard") {
      const u = t;
      const ease = 1 - Math.pow(1 - u, 2);
      const dx = (f.dx || 0), dy = (f.dy || 0);
      const px = f.x + dx * ease;
      const py = f.y + dy * ease;
      const size = (f.size || 8) * (1 - u * 0.25);
      const rot = (f.rot || 0) + (f.spin || 0) * u;

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.translate(px, py);
      ctx.rotate(rot);
      ctx.globalAlpha = (1 - u) * 0.75;
      ctx.fillStyle = f.color || "#cbe6ff";

      ctx.beginPath();
      ctx.moveTo(-size * 0.70, -size * 0.18);
      ctx.lineTo(size * 0.72, 0);
      ctx.lineTo(-size * 0.35, size * 0.42);
      ctx.closePath();
      ctx.fill();

      ctx.globalAlpha *= 0.55;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      return;
    }


    if (f.kind === "flash") {
      const r = f.r || 520;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = (1 - t) * 0.55;
      const rr = lerp(0, r, t);
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, rr);
      g.addColorStop(0, f.color || "rgba(255,255,255,1)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, rr, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
      return;
    }

    if (f.kind === "ring") {
      const r = lerp(f.r0, f.r1, t);
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.8;
      ctx.beginPath();
      ctx.arc(f.x,f.y, r, 0, Math.PI*2);
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (f.kind === "text") {
      ctx.save();
      ctx.globalAlpha = (1 - t);
      ctx.fillStyle = f.color;
      ctx.font = "900 14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(f.text, f.x, f.y - 22*t);
      ctx.restore();
      return;
    }

    if (f.kind === "shieldWave") {
      const r = f.r0;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = (1 - t) * 0.6;
      ctx.shadowColor = "#7dd3fc";
      ctx.shadowBlur = 14;
      ctx.globalAlpha = (1 - t) * 0.5;
      ctx.shadowColor = "#7dd3fc";
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.ellipse(f.x, f.y, r*0.88, r*0.80, 0, 0, Math.PI*2);
      ctx.fillStyle = "rgba(125,211,252,0.16)";
      ctx.fill();

      ctx.globalAlpha = (1 - t) * 0.55;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r*0.9, 0, Math.PI*2);
      ctx.fillStyle = "rgba(125,211,252,0.22)";
      ctx.fill();

      ctx.globalAlpha = (1 - t) * 0.35;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r*0.6, 0, Math.PI*2);
      ctx.fillStyle = "rgba(224,242,254,0.25)";
      ctx.fill();
      ctx.shadowBlur = 6;
      ctx.globalAlpha *= 0.85;
      ctx.beginPath();
      ctx.ellipse(f.x, f.y, r*0.78, r*0.68, 0, 0, Math.PI*2);
      ctx.strokeStyle = "#93c5fd";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.globalAlpha = (1 - t) * 0.35;
      ctx.beginPath();
      ctx.ellipse(f.x, f.y, r*0.55, r*0.48, 0, 0, Math.PI*2);
      ctx.strokeStyle = "#e0f2fe";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
      return;
    }
if (f.kind === "line") {
  ctx.save();
  ctx.globalAlpha = (1 - t) * 0.85;
  ctx.strokeStyle = f.color;
  ctx.lineWidth = (f.width || 4);
  ctx.beginPath();
  ctx.moveTo(f.x1, f.y1);
  ctx.lineTo(f.x2, f.y2);
  ctx.stroke();

  // glow
  ctx.globalAlpha *= 0.45;
  ctx.lineWidth = (f.width || 4) * 2.2;
  ctx.beginPath();
  ctx.moveTo(f.x1, f.y1);
  ctx.lineTo(f.x2, f.y2);
  ctx.stroke();
  ctx.restore();
  return;
}

if (f.kind === "warn") {
  const r = lerp(f.r0, f.r1, t);
  ctx.save();
  ctx.globalAlpha = (1 - t) * 0.28;
  ctx.beginPath();
  ctx.arc(f.x,f.y, r, 0, Math.PI*2);
  ctx.fillStyle = f.color;
  ctx.fill();
  ctx.globalAlpha = (1 - t) * 0.85;
  ctx.beginPath();
  ctx.arc(f.x,f.y, r, 0, Math.PI*2);
  ctx.strokeStyle = f.color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  return;
}

  }

  function drawTopHUD(){
  // legacy canvas HUD removed (use the new HTML HUD)
  return;
}

function drawBossHUD(){
    if (!(state.phase==="wave" && state.wave===FINAL_WAVE)) return;
    const boss = state.enemies.find(e=>e.kind==="boss");
    if (!boss) return;

    const ratio = (boss.hpMax>0) ? (boss.hp / boss.hpMax) : 0;
    const phase = (state.final && state.final.phase) ? state.final.phase : 1;

    // 최종전 보스 HUD: 상단으로 올려서(겹침 최소화) 더 눈에 띄게 표시
    const x = 12, y = 18, w = 936, h = 28;

    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = "#0e1624";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#243040";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);

    const pad = 10;
    const bx = x + pad;
    const by = y + 12;
    const bw = w - pad*2;
    const bh = 10;

    ctx.fillStyle = "#111827";
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = "#f472b6";
    ctx.fillRect(bx, by, bw*clamp(ratio,0,1), bh);

    ctx.fillStyle = "#e6edf3";
    ctx.font = "900 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`최종 보스 — 페이즈 ${phase}`, x + 14, y + 18);

    ctx.fillStyle = "#cbd5e1";
    ctx.font = "800 11px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`${Math.ceil(boss.hp)}/${Math.ceil(boss.hpMax)}`, x + w - 14, y + 18);

    ctx.restore();
  }


  // ---------- Cinematic Cards (웨이브/보스/패시브 연출) ----------
  function drawCineCards(){
    const cine = state.cine;
    if (!cine || !Array.isArray(cine.cards) || cine.cards.length === 0) return;
    const now = gameSec();
    // 만료 카드 정리
    cine.cards = cine.cards.filter(c => (now - (c.t0||0)) < (c.dur||0));
    if (cine.cards.length === 0) return;

    const c = cine.cards[cine.cards.length - 1];
    const dur = Math.max(0.01, c.dur || 1.2);
    const t = clamp((now - (c.t0||0)) / dur, 0, 1);

    const easeOut = (x)=>1 - Math.pow(1-x, 3);
    const easeIn  = (x)=>x*x*x;
    const fadeIn  = easeOut(clamp(t/0.14, 0, 1));
    const fadeOut = easeIn(clamp((1-t)/0.22, 0, 1));
    const a = Math.min(fadeIn, fadeOut);
    if (a <= 0.01) return;

    const isFinalBossHud = (state.phase==="wave" && state.wave===FINAL_WAVE);
    const slide = (1 - easeOut(clamp(t/0.22,0,1)));

    // 작은 이벤트(공명/버스트/긴급보강 등): 화면을 덜 가리는 토스트
    if ((c.kind||"") === "toast") {
      const w = Math.min(420, W - 24);
      const h = 56;
      const x = 16;
      const baseY = isFinalBossHud ? 88 : 16;
      const y = baseY + slide * -10;

      ctx.save();
      ctx.globalAlpha = 0.95 * a;
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = 14;
      ctx.fillStyle = "rgba(8,12,20,0.82)";
      roundRectPath(x, y, w, h, 14);
      ctx.fill();
      ctx.shadowBlur = 0;

      // accent
      ctx.globalAlpha = 0.98 * a;
      ctx.fillStyle = c.color || "#93c5fd";
      roundRectPath(x + 10, y + 10, 5, h - 20, 5);
      ctx.fill();

      // border
      ctx.globalAlpha = 0.65 * a;
      ctx.strokeStyle = "#243040";
      ctx.lineWidth = 1;
      roundRectPath(x, y, w, h, 14);
      ctx.stroke();

      const title = String(c.title||"");
      const sub   = String(c.sub||"");

      // title
      ctx.globalAlpha = 1.0 * a;
      ctx.textAlign = "left";
      ctx.font = "900 18px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.strokeText(title, x + 24, y + 26);
      ctx.fillStyle = "#e6edf3";
      ctx.fillText(title, x + 24, y + 26);

      if (sub) {
        ctx.font = "800 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,0.50)";
        ctx.strokeText(sub, x + 24, y + 44);
        ctx.fillStyle = "#cbd5e1";
        ctx.fillText(sub, x + 24, y + 44);
      }

      // progress line
      ctx.globalAlpha = 0.42 * a;
      ctx.fillStyle = "#0b1220";
      ctx.fillRect(x + 24, y + h - 10, w - 42, 3);
      ctx.fillStyle = c.color || "#93c5fd";
      ctx.fillRect(x + 24, y + h - 10, (w - 42) * clamp(1 - t, 0, 1), 3);

      ctx.restore();
      return;
    }

    const baseY = isFinalBossHud ? 58 : 22;
    const y = baseY + slide * -16;

    const w = Math.min(560, W - 28);
    const h = 92;
    const x = (W - w) * 0.5;

    ctx.save();
    ctx.globalAlpha = 0.92 * a;
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "rgba(8,12,20,0.75)";
    roundRectPath(x, y, w, h, 18);
    ctx.fill();
    ctx.shadowBlur = 0;

    // accent bar
    ctx.globalAlpha = 0.95 * a;
    ctx.fillStyle = c.color || "#93c5fd";
    roundRectPath(x + 10, y + 10, 6, h - 20, 6);
    ctx.fill();

    // border
    ctx.globalAlpha = 0.55 * a;
    ctx.strokeStyle = "#243040";
    ctx.lineWidth = 1;
    roundRectPath(x, y, w, h, 18);
    ctx.stroke();

    // text
    ctx.globalAlpha = 1.0 * a;
    ctx.fillStyle = "#e6edf3";
    ctx.textAlign = "left";
    ctx.font = "900 24px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillText(String(c.title||""), x + 26, y + 40);

    const sub = String(c.sub||"");
    if (sub) {
      ctx.fillStyle = "#cbd5e1";
      ctx.font = "800 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillText(sub, x + 26, y + 66);
    }

    // tiny progress line
    ctx.globalAlpha = 0.35 * a;
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(x + 26, y + h - 14, w - 52, 4);
    ctx.fillStyle = c.color || "#93c5fd";
    ctx.fillRect(x + 26, y + h - 14, (w - 52) * clamp(1 - t, 0, 1), 4);

    ctx.restore();
  }



  function drawBar(x,y,w,h, ratio, color, label){
    ratio = clamp(ratio,0,1);
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(x,y,w,h);
    ctx.fillStyle = color;
    ctx.fillRect(x,y,w*ratio,h);
    ctx.strokeStyle = "#243040";
    ctx.strokeRect(x,y,w,h);
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "900 10px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(label, x+4, y+h-2);
    ctx.restore();
  }

  function banner(text, color){
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = "#0e1624";
    ctx.fillRect(12, H-54, 936, 42);
    ctx.strokeStyle = "#243040";
    ctx.strokeRect(12, H-54, 936, 42);
    ctx.fillStyle = color;
    ctx.font = "900 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(text, W/2, H-28);
    ctx.restore();
  }

  function drawHoverTurret(){
    if (!mouse.inside) return;
    const idx = findTurretIndexAt(mouse.x, mouse.y, 18);
    if (idx < 0) return;

    const tr = state.turrets[idx];
    const base = turretBase(tr);
    const cost = (TURRET_TYPES[tr.type] ? TURRET_TYPES[tr.type].cost : 0);
    const refund = Math.max(0, Math.floor(cost * sellRefundRate()));

    ctx.save();

    // range highlight
    ctx.globalAlpha = 0.08;
    ctx.beginPath();
    ctx.arc(tr.x, tr.y, base.range, 0, Math.PI*2);
    ctx.fillStyle = "#fcd34d";
    ctx.fill();

    // turret ring
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fcd34d";
    ctx.beginPath();
    ctx.arc(tr.x, tr.y, 16, 0, Math.PI*2);
    ctx.stroke();

    // hint text
    ctx.globalAlpha = 0.95;
    ctx.font = "700 12px system-ui, sans-serif";
    ctx.fillStyle = "#fde68a";
    ctx.textAlign = "center";
    ctx.fillText(`판매: 우클릭/X (+${refund})`, tr.x, tr.y - 22);

    ctx.restore();
  }

  function drawGhost(){
    if (!mouse.inside) return;
    const mx = mouse.x, my = mouse.y;
    const tt = TURRET_TYPES[state.selected];
    const dCore = dist(mx,my, CORE_POS.x, CORE_POS.y);

    const ok = (
      dCore <= BUILD_RADIUS &&
      dCore >= CORE_RADIUS+30 &&
      state.crystals >= tt.cost &&
      !overlapsTurret(mx,my)
    );

    ctx.save();
    const col = ok ? "#93c5fd" : "#ff9fb2";
    ctx.globalAlpha = 0.22;
    withTransform(mx, my, 0, () => {
      ctx.fillStyle = "#0f172a";
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      if (state.selected === "slow") {
        polyPath(6, 16, Math.PI/6);
      } else if (state.selected === "splash") {
        roundRectPath(-16, -14, 32, 28, 6);
      } else {
        polyPath(8, 16, Math.PI/8);
      }
      ctx.fill();
      ctx.stroke();

      // tiny barrel pointing to core (placement feedback)
      const a = Math.atan2(CORE_POS.y - my, CORE_POS.x - mx);
      withTransform(0, -2, a, () => {
        ctx.fillStyle = col;
        roundRectPath(2, -2.5, 16, 5, 2.5);
        ctx.fill();
      });
    });

    ctx.globalAlpha = 0.10;
    ctx.beginPath();
    ctx.arc(mx,my, tt.range, 0, Math.PI*2);
    ctx.fillStyle = ok ? "#93c5fd" : "#ff9fb2";
    ctx.fill();
    ctx.restore();
  }

  
  function syncBackground(){
    // NOTE: Page-wide background is disabled. The [배경] button controls the battlefield (canvas) only.
    // Keep the state flag only; no DOM class toggles.
    return;
  }

function refreshUI(){
    const tt = TURRET_TYPES[state.selected];
    const t = gameSec();
    const cdLeft = Math.max(0, state.core.aegisReadyAt - t);
    const repCdLeft = Math.max(0, state.core.repairReadyAt - t);
    const engCdLeft = Math.max(0, state.core.energyReadyAt - t);
    syncBackground();

    // (Fix) 저장/새로고침 등으로 passiveId가 이미 존재해도 글로우/색상이 항상 동기화되게
    try { refreshCorePassiveUI(); } catch {}

    // 패시브 표시
    let passiveBadge = "";
    if (state.core.passiveId) {
      const d = CORE_PASSIVES[state.core.passiveId];
      if (state.core.passiveId === "rebuild") {
        const hpFrac = state.core.hpMax>0 ? (state.core.hp/state.core.hpMax) : 1;
        const tB = clamp((0.70 - hpFrac) / 0.60, 0, 1);
        const dr = (12*tB);
        const tNow = gameSec();
        const emOn = (tNow < (state.core.rebuildEmergencyUntil||0));
        const emLeft = Math.max(0, (state.core.rebuildEmergencyUntil||0) - tNow);
        passiveBadge = `<span class="badge ${d.colorClass}">패시브: ${d.name} (피해감소 ${dr.toFixed(0)}%${emOn ? ` +긴급(-38%, ${emLeft.toFixed(1)}s)` : ''})<\/span> `;
      } else if (state.core.passiveId === "resonance") {
        const g = resonanceGauge01();
        const pct = Math.round(g*100);
        const dMul = Math.round(30*g);
        const fMul = Math.round(18*g);
        passiveBadge = `<span class="badge ${d.colorClass}">패시브: ${d.name} (게이지 ${pct}% | 피해 +${dMul}% 공속 +${fMul}%)<\/span> `;
      
      } else if (state.core.passiveId === "overload") {
        const tNow = gameSec();
        const hpFrac = state.core.hpMax>0 ? (state.core.hp/state.core.hpMax) : 1;
        const tO = clamp((0.40 - hpFrac) / 0.30, 0, 1);

        // 버스트/쇼크 상태
        overloadEnsure();
        const burstOn = (tNow < (state.core.overloadBurstUntil||0));
        const burstLeft = Math.max(0, (state.core.overloadBurstUntil||0) - tNow);
        const cdLeft = Math.max(0, (state.core.overloadBurstReadyAt||0) - tNow);
        const burstInfo = burstOn ? `버스트 ${burstLeft.toFixed(1)}s` : (cdLeft>0.05 ? `쿨 ${cdLeft.toFixed(1)}s` : `READY`);

        // 현재 필드 표식 최대 중첩(만료된 표식 제외)
        let maxSt = 0;
        for (const e of state.enemies) {
          if (!e) continue;
          if (tNow < (e.ovMarkUntil||0)) maxSt = Math.max(maxSt, (e.ovMarkStacks||0));
        }
        const markInfo = `표식 ${maxSt}/${OVERLOAD_CFG.markMax}`;

        passiveBadge = `<span class="badge ${d.colorClass}">패시브: ${d.name} (과부하 ${(tO*100)|0}% | ${burstInfo} | ${markInfo})<\/span> `;
      } else if (state.core.passiveId === "overdrive") {
        const hpFrac = state.core.hpMax>0 ? (state.core.hp/state.core.hpMax) : 1;
        const tO = clamp((0.40 - hpFrac) / 0.30, 0, 1);
        passiveBadge = `<span class="badge ${d.colorClass}">패시브: ${d.name} (오버드라이브 ${(tO*100)|0}%)<\/span> `;
      }
    } else {
      passiveBadge = `<span class="badge">패시브: 미선택<\/span> `;
    }

    if (uiCrystals) uiCrystals.textContent = String(state.crystals|0);


    // 방어 수치 표시 (패시브 보정 포함)
    let dispHpArmor = state.core.hpArmor;
    let dispShArmor = state.core.shieldArmor;
    if (state.core.passiveId === "rebuild") {
      const hpFrac = state.core.hpMax>0 ? (state.core.hp/state.core.hpMax) : 1;
      const tB = clamp((0.70 - hpFrac) / 0.60, 0, 1);
      dispHpArmor += 15 * tB;
      dispShArmor += 6.5 * tB;
    }
    const fmtArmor = (x)=>{
      const r = Math.round(x);
      if (Math.abs(x - r) < 1e-6) return String(r);
      return x.toFixed(1);
    };
    const hpArmorText = fmtArmor(dispHpArmor);
    const shArmorText = fmtArmor(dispShArmor);

    // ===== 상단 HUD 업데이트 =====
    const hp01 = state.core.hpMax>0 ? clamp(state.core.hp/state.core.hpMax, 0, 1) : 0;
    const sh01 = state.core.shieldMax>0 ? clamp(state.core.shield/state.core.shieldMax, 0, 1) : 0;
    if (hudHpFill) hudHpFill.style.width = `${(hp01*100).toFixed(1)}%`;
    if (hudShFill) hudShFill.style.width = `${(sh01*100).toFixed(1)}%`;
    if (hudHpText) hudHpText.textContent = `${Math.ceil(state.core.hp)}/${state.core.hpMax}`;
    if (hudShText) hudShText.textContent = `${Math.ceil(state.core.shield)}/${state.core.shieldMax}`;

    // ===== HP 저체력 HUD 경고 (visual only; does NOT change mechanics) =====
    try {
      const hpFrac = hp01;
      const BLUE_T = 0.70;   // matches blue flame threshold
      const CRIT_T = 0.25;   // critical warning threshold
      const isCrit = (hpFrac <= CRIT_T);
      const isBlue = (hpFrac <= BLUE_T) && !isCrit;
      if (hudHpRow && hudHpRow.classList) {
        hudHpRow.classList.toggle("hpBlue", isBlue);
        hudHpRow.classList.toggle("hpCrit", isCrit);
      }
      if (hudHpText && hudHpText.classList) {
        hudHpText.classList.toggle("hpBlue", isBlue);
        hudHpText.classList.toggle("hpCrit", isCrit);
      }
    } catch(e) {}


    if (hudWave) {
      const ph = (state.phase === 'wave') ? '전투' : (state.phase==='build'?'준비':(state.phase==='fail'?'실패':(state.phase==='end'?'클리어':'')));
      const thName = (state.spawn && state.spawn.spec && state.spawn.spec.themeName) ? state.spawn.spec.themeName : (waveSpec ? (waveSpec(state.wave).themeName||"") : "");
      hudWave.textContent = `Wave ${state.wave}${ph ? ` · ${ph}` : ``}${thName ? ` · ${thName}` : ``}`;
    }
    if (hudArmor) hudArmor.textContent = hpArmorText;
    if (hudShArmor) hudShArmor.textContent = shArmorText;
    if (hudMeta) hudMeta.textContent = `${state.speed.toFixed(1)}x${state.cheat ? ' · 치트' : ''}`;


    // ===== 상태이상(디버프/특수상태) HUD 표시 =====
    if (typeof hudStatusRow !== 'undefined' && hudStatusRow) {
      const tNow = gameSec();
      const chips = [];
      const addUntil = (label, until, color, pr=0) => {
        const left = Math.max(0, (until||0) - tNow);
        if (left > 0.05) chips.push({ label, left, color, pr });
      };

      // shield regen display (visual only; does NOT change mechanics)
      let __regenChip = null;
      let __regenVisualOn = false;
      try {
        const phaseAllows = (state.phase === "wave" || state.core.shieldRegenOutOfWave);
        const blocked = (tNow < (state.core.shieldRegenBlockedUntil || 0));
        if (phaseAllows && !blocked && state.phase !== "collapse" && !(state.phase==="win" && state.win)) {
          const tReal = nowSec();
          const regenBoost = (tReal < (state.core.aegisActiveUntil||0)) ? 3.2 : 1.0;

          let passiveShieldRegenMul = 1.0;
          if (state.core.passiveId === "rebuild") {
            passiveShieldRegenMul *= 1.15;
            if (state.wave === FINAL_WAVE) passiveShieldRegenMul *= 1.10;
          }
          if (state.core.passiveId === "overload") {
            const hpFrac = state.core.hpMax>0 ? (state.core.hp/state.core.hpMax) : 1;
            const tO = clamp((0.40 - hpFrac) / 0.30, 0, 1);
            passiveShieldRegenMul *= (1 + 1.10*tO);
          }
          if (state.core.passiveId === "overdrive") {
            const hpFrac = state.core.hpMax>0 ? (state.core.hp/state.core.hpMax) : 1;
            const tO = clamp((0.40 - hpFrac) / 0.30, 0, 1);
            passiveShieldRegenMul *= (1 + 0.60*tO);
          }

          const regen = (state.core.shieldRegen||0) * (state.mods.shieldRegenMul||1) * regenBoost * passiveShieldRegenMul;
          if (isFinite(regen) && regen > 0.0001) {
            __regenChip = { label: `재생 +${regen.toFixed(1)}/s`, left: 0, color: '#93c5fd', pr: 0, kind:'regen' };
            __regenVisualOn = (state.core.shield < state.core.shieldMax - 0.05);
          }
        }
      } catch(e) {}

      // apply shimmer to shield bar only when regen is actively filling
      try {
        if (typeof hudShFill !== 'undefined' && hudShFill && hudShFill.classList) {
          hudShFill.classList.toggle('shimmer', !!__regenVisualOn);
        }
      } catch(e) {}


      // timed debuffs
      addUntil('재생차단', state.core.shieldRegenBlockedUntil, '#60a5fa', 4);
      addUntil('수리차단', state.core.repairBlockedUntil,      '#f472b6', 4);
      addUntil('EMP',      state.core.empUntil,               '#fbbf24', 3);

      // passive/skill states
      addUntil('긴급보호막', state.core.aegisActiveUntil,        '#93c5fd', 2);
      addUntil('긴급보강',   state.core.rebuildEmergencyUntil,   '#93c5fd', 2);
      addUntil('버스트',     state.core.overloadBurstUntil,      '#fb7185', 2);

      // energy cannon charging
      if (state.core.energyCharging) {
        const left = Math.max(0, (state.core.energyChargeUntil||0) - tNow);
        if (left > 0.05) chips.push({ label:'충전', left, color:'#c4b5fd', pr:1 });
      }

      // event-like global modifiers
      const absMul = (state.mods && state.mods.shieldAbsorbMul !== undefined) ? state.mods.shieldAbsorbMul : 1;
      if (absMul <= 0.001) chips.push({ label:'보호막무시', left:0, color:'#a78bfa', pr:5 });
      else if (absMul < 0.999) chips.push({ label:'흡수약화', left:0, color:'#93c5fd', pr:5 });

      // render (max 6 to avoid clutter)
      chips.sort((a,b)=> (b.pr-a.pr) || (b.left-a.left));
      const maxOther = __regenChip ? 5 : 6;
      const show = chips.slice(0, maxOther);
      if (__regenChip) show.push(__regenChip);
      if (!show.length) {
        hudStatusRow.style.display = 'none';
        hudStatusRow.innerHTML = '';
      } else {
        hudStatusRow.style.display = 'flex';
        hudStatusRow.innerHTML = show.map(s=>{
          const timeTxt = (s.left>0) ? ` <b>${s.left.toFixed(1)}s</b>` : '';
          return `<span class="hudStatus" style="border-color:${s.color};color:${s.color};">${s.label}${timeTxt}</span>`;
        }).join('');
      }
    }

    // 패시브 텍스트/게이지
    const passivePlain = (passiveBadge || '').replace(/<[^>]*>/g,'').trim();
    if (hudPassiveText) hudPassiveText.textContent = passivePlain || '패시브: 미선택';

    let pGauge = 0;
    if (state.core.passiveId === "rebuild") {
      const hpFrac = state.core.hpMax>0 ? (state.core.hp/state.core.hpMax) : 1;
      pGauge = clamp((0.70 - hpFrac) / 0.60, 0, 1);
    } else if (state.core.passiveId === "resonance") {
      pGauge = resonanceGauge01();
    } else if (state.core.passiveId === "overload" || state.core.passiveId === "overdrive") {
      const hpFrac = state.core.hpMax>0 ? (state.core.hp/state.core.hpMax) : 1;
      pGauge = clamp((0.40 - hpFrac) / 0.30, 0, 1);
    } else {
      pGauge = 0;
    }
    if (hudPassiveFill) hudPassiveFill.style.width = `${(clamp(pGauge,0,1)*100).toFixed(1)}%`;

    // 기존 우측 패널의 텍스트 뱃지는 숨김(대폭 UI 개편)
    if (uiStats) uiStats.innerHTML = '';

    // UI message (업그레이드/안내) — 이벤트 정보에 덮어쓰이지 않게 분리
    if (uiMsg) {
      const tNow = nowSec();
      if (state.uiMsg && tNow < state.uiMsgUntil) uiMsg.textContent = state.uiMsg;
      else { state.uiMsg = ""; uiMsg.textContent = ""; }
    }

    // Repair 버튼 UI
    if (typeof btnRepair !== 'undefined' && btnRepair) {
      const affordable = state.crystals >= state.core.repairCost;
      const canUse = (repCdLeft <= 0) && (state.phase !== 'fail') && (state.core.hp < state.core.hpMax - 0.01) && affordable;
      btnRepair.disabled = !canUse;
      btnRepair.textContent = repCdLeft>0 ? `수리 (${repCdLeft.toFixed(1)}s)` : `수리 (-${state.core.repairCost})`;
      if (btnEnergy) {
        const charging = !!state.core.energyCharging;
        const chargeLeft = charging ? Math.max(0, state.core.energyChargeUntil - t) : 0;
        const hasTargetNow = !!(state.enemies && state.enemies.some(e=>e && e.hp > 0));
        btnEnergy.disabled = (state.phase !== 'wave') || charging || (engCdLeft>0) || !hasTargetNow;
        btnEnergy.textContent = charging
          ? `에너지포 충전 (${chargeLeft.toFixed(1)}s)`
          : (engCdLeft>0 ? `에너지포 (${engCdLeft.toFixed(1)}s)` : `에너지포 (${Math.round((state.core.energyDmg||800) * (1 + Math.max(0, state.wave-1)*0.018))})`);
      }

      if (mbEnergy){
        const inWave = (state.phase === 'wave');
        const charging = !!state.core.energyCharging;
        const chargeLeft = charging ? Math.max(0, state.core.energyChargeUntil - t) : 0;
        const hasTarget = !!(state.enemies && state.enemies.some(e=>e && e.hp > 0));
        const canUseEnergy = inWave && !charging && (engCdLeft <= 0) && hasTarget;
        mbEnergy.disabled = !canUseEnergy;
        const sp = mbEnergy.querySelector('span');
        if (sp) sp.textContent = '에너지포';
        const sm = mbEnergy.querySelector('small');
        if (sm){
          if (!inWave) sm.textContent = '웨이브';
          else if (charging) sm.textContent = `충전 ${Math.ceil(chargeLeft)}s`;
          else if (!hasTarget) sm.textContent = '대상없음';
          else if (engCdLeft > 0) sm.textContent = `${Math.ceil(engCdLeft)}s`;
          else sm.textContent = String(Math.round((state.core.energyDmg||800) * (1 + Math.max(0, state.wave-1)*0.018)));
        }
      }

      if (btnBg) {
        btnBg.textContent = (state.ui.bgMode===0) ? '배경 끔' : (state.ui.bgMode===2 ? '배경 강함' : '배경 약함');
      }

    }

    if (uiEvent) {
  if (state.wave === FINAL_WAVE && (state.phase === "finalprep" || state.phase === "wave")) {
    const c = state.finalChoice || "미선택";
    uiEvent.textContent = `최종전: 최종 지원 ${c==="offense" ? "화력" : (c==="defense" ? "방호" : c)}`;
  } else {
    uiEvent.textContent = state.event
      ? `현재 이벤트: ${state.event.name} — ${state.event.desc}`
      : `현재 이벤트: 없음 (3웨이브마다 1회)`;
  }
}

// Wave button label + state
    if (btnWave) {
      if (state.phase === "wave") {
        btnWave.disabled = true;
        btnWave.textContent = "웨이브 진행 중...";
      } else if (state.phase === "fail") {
        btnWave.disabled = true;
        btnWave.textContent = "붕괴됨";
      } else if (state.phase === "win") {
        btnWave.disabled = true;
        btnWave.textContent = "클리어!";
      } else if (state.phase === "clear") {
        const left = Math.max(0, state.autoStartAt - gameSec());
        btnWave.disabled = false;
        btnWave.textContent = left > 0.05 ? `다음 웨이브 (${left.toFixed(1)}s)` : "다음 웨이브 시작";
} else if (state.phase === "finalprep") {
  const left = Math.max(0, state.finalPrepEndsAt - gameSec());
  btnWave.disabled = false;
  btnWave.textContent = left > 0.05 ? `최종전 준비 (${left.toFixed(1)}s)` : "최종전 시작";
} else {
        btnWave.disabled = false;
        btnWave.textContent = "웨이브 시작";
      }
    }

    
    // Restart button label
    if (btnRestart) {
      btnRestart.textContent = "재시작";
    }

    // Speed/Cheat buttons + hint
    if (btnSpeed) btnSpeed.textContent = `배속 ${state.speed.toFixed(2).replace(/\.00$/,".0")}x`;
    if (btnCheat) btnCheat.textContent = state.cheat ? "치트 ON" : "치트 OFF";
    syncCheatButtons();
    if (uiCheat) {
      uiCheat.textContent = state.cheat
        ? "치트키: T=토글, K=크리스탈+500, H=HP풀, J=보호막풀, B=적삭제, N=웨이브스킵, U=업글MAX, G=무적, P=패시브100"
        : "";
    }


    if (uiPreview) {
      const w = state.wave;
      const spec = waveSpec(w);
      const label = (state.phase === "wave") ? "현재 웨이브" : "다음 웨이브";
      const list = [];
      list.push(ENEMY_ARCH.grunt.name);
      if (w >= 2) list.push(ENEMY_ARCH.runner.name);
      if (w >= 2) list.push(ENEMY_ARCH.shooter.name);
      if (w >= 3) list.push(ENEMY_ARCH.shieldbreaker.name);
      if (w >= 4) list.push(ENEMY_ARCH.piercer.name);
      if (w >= 6) list.push(ENEMY_ARCH.bruiser.name);
      if (w >= 6) list.push(ENEMY_ARCH.bomber.name);
      if (w >= 8) list.push(ENEMY_ARCH.disruptor.name);

      const bossLine = spec.isBoss ? `보스: ${ENEMY_ARCH.boss.name} 포함` : "보스: 없음";
      uiPreview.innerHTML =
        `<b>${label} ${w}${spec.isBoss ? " (보스 웨이브)" : ""}</b><br>` +
        `적 수: ${spec.count} / 스폰: ${spec.spawnRate.toFixed(2)}/s<br>` +
        `${bossLine}<br>` +
        `등장: ${list.join(", ")}`;
    }

// 업그레이드 DOM을 매 프레임 갈아끼우면(60fps) 클릭이 씹힐 수 있어서, 0.25초마다만 갱신합니다.
    if (!window.__upgLastRenderAt) window.__upgLastRenderAt = 0;
    const _tNow = nowSec();
    if (_tNow - window.__upgLastRenderAt > 0.25) {
      window.__upgLastRenderAt = _tNow;
      renderUpgrades();
    }

// Final support UI (wave 30 prep)
if (finalSupportPanel) {
  const show = (state.phase === "finalprep");
  finalSupportPanel.classList.toggle("hidden", !show);
  if (show) {
    const c = state.finalChoice;
    if (btnFinalOffense) btnFinalOffense.classList.toggle("active", c==="offense");
    if (btnFinalDefense) btnFinalDefense.classList.toggle("active", c==="defense");
    if (uiFinalSupportDesc) {
      const left = Math.max(0, state.finalPrepEndsAt - gameSec());
      uiFinalSupportDesc.innerHTML = `웨이브 30 시작까지 <b>${left.toFixed(1)}s</b> — ` +
        (c ? (`현재 선택: <b>${c==="offense" ? "화력 지원" : "방호 강화"}</b>`) : "아직 선택하지 않았습니다.");
    }
  }
}

// Mobile: final support row
if (mbFinalRow) {
  const show = (state.phase === "finalprep");
  mbFinalRow.classList.toggle("hidden", !show);
  if (show) {
    const c = state.finalChoice;
    if (mbFinalOffense) mbFinalOffense.classList.toggle("active", c==="offense");
    if (mbFinalDefense) mbFinalDefense.classList.toggle("active", c==="defense");
  }
}

    try { renderRecords(); } catch(e) {}
  }

  // ---------- Wire Panel (손상 고정 + 재시작 검정선 버그 수정) ----------
  const WG = "rgb(60,255,90)";
  const WY = "rgb(255,230,90)";
  const WR = "rgb(255,80,80)";
  const SB = "rgb(60,200,255)";

  const wire = {
    segs: null,
    outlinePolys: null,
    cachedColors: [],
    thY: [],
    thR: [],
    seed: 1337,
    oneYellowIdx: -1,
  };

  function wireReset(){
    wire.segs = null;
    wire.outlinePolys = null;
    wire.shieldPoly = null;
    wire.cachedColors = [];
    wire.thY = [];
    wire.thR = [];
    wire.oneYellowIdx = -1;
  }

      function buildWireSegments(cx, cy, s){
    const P = (nx,ny)=>({x: cx + nx*s, y: cy + ny*s});

    // (신규 수정타워 실루엣) 중앙 크리스탈 + 좌/우 가드 + 큰 받침대 + 오브(원형)
    const crystal = [
      P(0,-1.22), P(0.50,-0.62), P(0.42,0.10), P(0.22,0.62),
      P(0,0.82),  P(-0.22,0.62), P(-0.42,0.10), P(-0.50,-0.62)
    ];

    const leftG  = [P(-1.10,0.34),P(-0.76,0.12),P(-0.58,0.34),P(-0.62,0.96),P(-0.86,1.12),P(-1.16,0.78),P(-1.18,0.52)];
    const rightG = [P(1.10,0.34),P(0.76,0.12),P(0.58,0.34),P(0.62,0.96),P(0.86,1.12),P(1.16,0.78),P(1.18,0.52)];

    const base = [P(-1.10,0.78),P(1.10,0.78),P(0.88,1.32),P(0.30,1.40),P(-0.30,1.40),P(-0.88,1.32)];

    const plate = [P(-0.32,0.78),P(0.32,0.78),P(0.42,1.10),P(-0.42,1.10)];

    function ngon(cx0, cy0, r, n=8, rot=-Math.PI/8){
      const out = [];
      for (let i=0;i<n;i++){
        const a = rot + i*(Math.PI*2/n);
        out.push(P(cx0 + Math.cos(a)*r, cy0 + Math.sin(a)*r));
      }
      return out;
    }
    const orbL = ngon(-0.88, 0.56, 0.13, 8);
    const orbR = ngon(0.88, 0.56, 0.13, 8);

    // 크리스탈 패싯(내부선)
    const facets = [
      [P(0,-1.00), P(0,0.74)],
      [P(-0.26,-0.48), P(0.18,-0.10)],
      [P(0.26,-0.48), P(-0.18,-0.10)],
      [P(-0.18,0.22), P(0,0.58)],
      [P(0.18,0.22), P(0,0.58)],
      [P(-0.34,0.06), P(0.34,0.06)]
    ];

    // 받침대 디테일(에너지 라인)
    const baseLines = [
      [P(-0.86,0.92),P(0.86,0.92)],
      [P(-0.72,1.06),P(0.72,1.06)],
      [P(-0.58,1.20),P(0.58,1.20)],
      [P(-0.96,0.78),P(-0.88,1.32)],
      [P(0.96,0.78),P(0.88,1.32)],
    ];

    function polySeg(poly){
      const out = [];
      for (let i=0;i<poly.length;i++){
        const a = poly[i], b = poly[(i+1)%poly.length];
        out.push([a,b]);
      }
      return out;
    }

    // 보호막 테두리는 전체 실루엣 1개만 (너무 번쩍임 방지)
    const outline = [P(0,-1.22),P(0.62,-0.50),P(1.18,0.52),P(1.10,0.78),P(0.88,1.32),P(0.30,1.40),P(-0.30,1.40),P(-0.88,1.32),P(-1.10,0.78),P(-1.18,0.52),P(-0.62,-0.50)];

    return {
      shieldPoly: outline,
      outlinePolys: [outline],
      segs: [
        ...polySeg(crystal),
        ...polySeg(leftG),
        ...polySeg(rightG),
        ...polySeg(base),
        ...polySeg(plate),
        ...polySeg(orbL),
        ...polySeg(orbR),
        ...facets,
        ...baseLines,
      ]
    };
  }


  function wireEnsureGeometry(){
    // ✅ 세그먼트가 있으나 캐시 길이가 안 맞으면 재초기화(검정선 방지)
    if (wire.segs && wire.cachedColors.length === wire.segs.length && wire.thY.length === wire.segs.length) return;

    const ww = wireCanvas.width, wh = wireCanvas.height;
    const cx = ww*0.5, cy = wh*(detectMobile() ? 0.55 : 0.52);
    const s  = Math.min(ww,wh) * (detectMobile() ? 0.32 : 0.36);

    const shape = buildWireSegments(cx,cy,s);
    wire.segs = shape.segs;
    wire.outlinePolys = shape.outlinePolys;

    wire.shieldPoly = shape.shieldPoly || null;
    wire.cachedColors = new Array(wire.segs.length).fill(WG);

    const prng = mulberry32(wire.seed);
    wire.thY = new Array(wire.segs.length);
    wire.thR = new Array(wire.segs.length);
    for (let i=0;i<wire.segs.length;i++){
      const y = 0.06 + prng()*0.60;
      let r = y + (0.14 + prng()*0.30);
      r = Math.min(r, 0.98);
      wire.thY[i] = y;
      wire.thR[i] = r;
    }
  }

  function shieldLW(ratio){
    const maxW = 14, minW = 2;
    return minW + (maxW-minW)*clamp(ratio,0,1);
  }

  function wireTick(hpRatio){
    wireEnsureGeometry();

    const sev = clamp(1 - hpRatio, 0, 1);

    if (hpRatio <= 0) {
      for (let i=0;i<wire.cachedColors.length;i++) wire.cachedColors[i] = WR;
      return;
    }

    if (hpRatio >= 0.999999) {
      for (let i=0;i<wire.cachedColors.length;i++) wire.cachedColors[i] = WG;
      wire.oneYellowIdx = -1;
      return;
    }

    if (hpRatio >= 0.99) {
      if (wire.oneYellowIdx < 0) {
        wire.oneYellowIdx = (Math.random() * wire.cachedColors.length) | 0;
      }
      for (let i=0;i<wire.cachedColors.length;i++) wire.cachedColors[i] = WG;
      wire.cachedColors[wire.oneYellowIdx] = WY;
      return;
    }

    for (let i=0;i<wire.cachedColors.length;i++){
      let col =
        (sev >= wire.thR[i]) ? WR :
        (sev >= wire.thY[i]) ? WY :
        WG;

      if (i === wire.oneYellowIdx && col === WG) col = WY;
      wire.cachedColors[i] = col;
    }
  }

  function wStroke(a,b,color,lw,alpha=1){
    wctx.save();
    wctx.globalAlpha = alpha;
    wctx.beginPath();
    wctx.moveTo(a.x,a.y);
    wctx.lineTo(b.x,b.y);
    wctx.strokeStyle = color || WG; // ✅ safety
    wctx.lineWidth = lw;
    wctx.lineCap="round";
    wctx.lineJoin="round";
    wctx.stroke();
    wctx.restore();
  }

  function wStrokePoly(poly,color,lw,alpha=1){
    wctx.save();
    wctx.globalAlpha = alpha;
    wctx.beginPath();
    wctx.moveTo(poly[0].x, poly[0].y);
    for(let i=1;i<poly.length;i++) wctx.lineTo(poly[i].x, poly[i].y);
    wctx.closePath();
    wctx.strokeStyle = color;
    wctx.lineWidth = lw;
    wctx.lineCap="round";
    wctx.lineJoin="round";
    wctx.stroke();
    wctx.restore();
  }

  function drawWireStatusPanel(hpRatio, shieldRatio){
    wireEnsureGeometry();

    const ww = wireCanvas.width, wh = wireCanvas.height;
    wctx.clearRect(0,0,ww,wh);
    wctx.fillStyle = "#000";
    wctx.fillRect(0,0,ww,wh);

    // 보호막(파란 테두리) — 닳을수록 얇아짐
    // ✅ 프레임이 '따로 노는' 느낌 방지: 최외곽 실루엣(shieldPoly) 1개만 그림 + 블러/두께 제한
    if (shieldRatio > 0.001) {
      const lw = clamp(shieldLW(shieldRatio), 2, 8);
      wctx.save();
      wctx.globalAlpha = 0.22 + 0.52*shieldRatio;
      wctx.shadowColor = "rgba(80,220,255,0.55)";
      wctx.shadowBlur  = 6 + 10*shieldRatio;
      const poly = wire.shieldPoly || (wire.outlinePolys ? wire.outlinePolys[0] : null);
      if (poly) wStrokePoly(poly, SB, lw, 1);
      wctx.restore();
    }

    // HP 와이어
    const lwWire = 4.2;
    for (let i=0;i<wire.segs.length;i++){
      const [a,b] = wire.segs[i];
      wStroke(a,b, wire.cachedColors[i], lwWire, 0.92);
    }

    const hpPct = Math.round(hpRatio*100);
    const shPct = Math.round(shieldRatio*100);
    wireText.textContent = `HP ${hpPct}% / 보호막 ${shPct}%`;
  }

  // ---------- Game Loop ----------
  function tick(){
    const t = nowSec();
    const dtReal = clamp(t - state.lastTime, 0, 0.05);
    state.lastTime = t;

    // game time advances with speed multiplier
    const dt = clamp(dtReal * (state.speed || 1), 0, 0.08);
    state.gtime += dt;

    // 대기(웨이브 외)에는 스킬/패시브 쿨타임이 흐르지 않도록 고정
    if (state.phase !== "wave") {
      const c = state.core;
      const pauseKeys = ["aegisReadyAt","repairReadyAt","energyReadyAt","resDischargeReadyAt","rebuildEmergencyReadyAt","overloadBurstReadyAt","overloadExtendReadyAt","overloadKickReadyAt"];
      for (let i = 0; i < pauseKeys.length; i++) {
        const k = pauseKeys[i];
        if (c[k] != null) c[k] += dt;
      }
    }
    try {
      update(dt);
      draw();
      refreshUI();
    } catch (err) {
      console.error(err);
      const msg = (err && err.message) ? err.message : String(err);
      state.hardError = msg.slice(0, 140);
      // 최소한 UI는 갱신되도록 시도
      try { draw(); refreshUI(); } catch {}
    }

    requestAnimationFrame(tick);
  }

  // ---------- Init ----------
  restart();
  syncCheatButtons();
  setSpeed(1.0);
  tick();
  } catch (err) {
    console.error(err);
    const msg = (err && err.message) ? err.message : String(err);
    const uiMsgEl = document.getElementById("uiMsg");
    if (uiMsgEl) uiMsgEl.textContent = "초기화 오류: " + msg;

    // 캔버스에라도 오류를 표시(스크립트가 멈춘 것처럼 보이는 문제 방지)
    const c0 = document.getElementById("c");
    try {
      if (c0 && c0.getContext) {
        const cctx = c0.getContext("2d");
        if (cctx) {
          cctx.clearRect(0,0,c0.width,c0.height);
          cctx.fillStyle = "#0b1220";
          cctx.fillRect(0,0,c0.width,c0.height);
          cctx.fillStyle = "#fca5a5";
          cctx.font = "18px system-ui, -apple-system, Segoe UI, Roboto, Arial";
          cctx.fillText("초기화 오류: " + msg, 18, 36);
          cctx.fillStyle = "#93c5fd";
          cctx.font = "14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
          cctx.fillText("F12 콘솔 오류를 확인하거나, 위 문구를 보내주시면 즉시 수정 가능합니다.", 18, 60);
        }
      }
    } catch {}
  }

})();

