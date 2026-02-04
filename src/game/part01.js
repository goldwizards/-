// AUTO-SPLIT PART 01


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
  const SELL_REFUND = 0.70;
  function sellRefundRate(){
