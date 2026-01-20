// AUTO-SPLIT PART 01/8 (lines 1-770)


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
    let volume = 0.85;

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
      build:{ bpm:112, mix:0.80, lp:7800,  drive:0.28, spb:16, bars:4, swing:0.00 },
      wave: { bpm:124, mix:0.92, lp:11000, drive:0.38, spb:16, bars:4, swing:0.06 },
      boss: { bpm:144, mix:1.08, lp:15000, drive:0.58, spb:16, bars:4, swing:0.10 },
      // final: 박자는 4/4 유지하되(16스텝), 리듬/스윙/드라이브로 "최종전" 체감 강화
      final:{ bpm:156, mix:1.18, lp:17500, drive:0.78, spb:16, bars:4, swing:0.13 },
      // game over: 4/4 느리게(박자 안정), 슬픈 패드 중심
      fail: { bpm: 76, mix:0.42, lp:2600,  drive:0.08, spb:16, bars:4, swing:0.00 },
      // ending: 4/4 밝은 진행(박자 안정)
      win:  { bpm:116, mix:0.66, lp:12000, drive:0.18, spb:16, bars:4, swing:0.04 },
    };

    // 코드 진행(4마디 루프)
    // build: 익숙한 진행(덜 공격적)
    const CHORDS_BUILD = [
      [57, 60, 64], // Am
      [53, 57, 60], // F
      [48, 52, 55], // C
      [55, 59, 62], // G
    ];
    const ROOTS_BUILD = [45, 41, 36, 43]; // A2, F2, C2, G2

    // wave/boss: harmonic minor 느낌(Am-G-F-E7)로 긴장감 강화
    const CHORDS_WAVE = [
      [57, 60, 64],      // Am
      [55, 59, 62],      // G
      [53, 57, 60],      // F
      [52, 56, 59, 62],  // E7 (E G# B D)
    ];
    const ROOTS_WAVE = [45, 43, 41, 40]; // A2, G2, F2, E2

    // boss: Am-E7-F-E7 (더 불안정하고 반복적인 긴장)
    const CHORDS_BOSS = [
      [57, 60, 64],
      [52, 56, 59, 62],
      [53, 57, 60],
      [52, 56, 59, 62],
    ];
    const ROOTS_BOSS = [45, 40, 41, 40];

    // final: 더 무거운 최종전 진행(Am - Bb - F - E7)
    const CHORDS_FINAL = [
      [57, 60, 64],      // Am
      [58, 62, 65],      // Bb
      [53, 57, 60],      // F
      [52, 56, 59, 62],  // E7
    ];
    const ROOTS_FINAL = [45, 46, 41, 40]; // A2, Bb2, F2, E2

    // fail: 슬픈 진행(Am - F - Dm - Em)
    const CHORDS_FAIL = [
      [57, 60, 64],    // Am
      [53, 57, 60],    // F
      [50, 53, 57],    // Dm
      [52, 55, 59],    // Em
    ];
    const ROOTS_FAIL = [45, 41, 38, 40]; // A2, F2, D2, E2

    // win: 엔딩 진행(C - G - Am - F)
    const CHORDS_WIN = [
      [60, 64, 67],    // C
      [55, 59, 62],    // G
      [57, 60, 64],    // Am
      [53, 57, 60],    // F
    ];
    const ROOTS_WIN = [48, 43, 45, 41]; // C2, G2, A2, F2


    function mtof(m){ return 440 * Math.pow(2, (m - 69) / 12); }

    function kick(t){
      // 저역 펀치(보스에서 더 단단하게 들리도록 약간 짧게)
      toneAt("sine", 140, 52, 0.095, 0.11, t);
    }
    function snare(t){
      // 간단 스네어
      noiseAt({hp:950, lp:6800, dur:0.085, vol:0.070, t});
      toneAt("triangle", 230, 175, 0.06, 0.032, t);
    }
    function hat(t, strong=false){
      noiseAt({hp:7200, lp:15000, dur: strong ? 0.032 : 0.020, vol: strong ? 0.033 : 0.024, t});
    }
    function bass(t, f){
      // 조금 더 공격적인 베이스(사각파 느낌을 얹음)
      toneAt("sine", f, f*0.90, 0.18, 0.052, t);
      toneAt("square", f*2, f*1.85, 0.10, 0.014, t);
    }
    function arp(t, f){
      toneAt("triangle", f, f*1.01, 0.10, 0.040, t);
    }
    function melody(t, f){ toneAt("sine", f, f, 0.12, 0.028, t); }
    function lead(t, f){ toneAt("square", f, f*0.99, 0.10, 0.020, t); }
    function riser(t, f0, f1){ toneAt("sawtooth", f0, f1, 0.14, 0.012, t); }

    // fail용 패드(길게/부드럽게)
    function pad(t, f){
      toneAt("triangle", f, f, 0.95, 0.012, t);
      toneAt("sine", f*2, f*2, 0.80, 0.007, t + 0.01);
    }
    // win용 벨(짧고 밝게)
    function bell(t, f){
      toneAt("sine", f, f*1.002, 0.20, 0.018, t);
      toneAt("triangle", f*2, f*1.98, 0.12, 0.009, t);
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
        if (next === "boss" || next === "final" || sigChanged) {
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

      const chord =
        (bgmMode === "final") ? CHORDS_FINAL[bar] :
        (bgmMode === "boss")  ? CHORDS_BOSS[bar]  :
        (bgmMode === "wave")  ? CHORDS_WAVE[bar]  :
        (bgmMode === "fail")  ? CHORDS_FAIL[bar]  :
        (bgmMode === "win")   ? CHORDS_WIN[bar]   :
                               CHORDS_BUILD[bar];
      const root  =
        (bgmMode === "final") ? ROOTS_FINAL[bar] :
        (bgmMode === "boss")  ? ROOTS_BOSS[bar]  :
        (bgmMode === "wave")  ? ROOTS_WAVE[bar]  :
        (bgmMode === "fail")  ? ROOTS_FAIL[bar]  :
        (bgmMode === "win")   ? ROOTS_WIN[bar]   :
                               ROOTS_BUILD[bar];

      // ----------------- 드럼(모드별 리듬을 확실히 다르게) -----------------
      if (bgmMode === "build") {
        // 안정적인 4/4
        if (pos === 0 || pos === 8) kick(tt);
        if (pos === 4 || pos === 12) snare(tt);
        if (pos === 2 || pos === 6 || pos === 10 || pos === 14) hat(tt, pos === 2);
      } else if (bgmMode === "wave") {
        // 조금 더 공격적인 싱코페이션
        if (pos === 0 || pos === 7 || pos === 8 || pos === 15) kick(tt);
        if (pos === 4 || pos === 12) snare(tt);
        if (pos % 2 === 0) hat(tt, pos === 0);
        if (pos === 14 || pos === 15) hat(tt, true);
      } else if (bgmMode === "boss") {
        // 무거운 드라이브(셔플) + 촘촘한 하이햇
        if (pos === 0 || pos === 3 || pos === 6 || pos === 8 || pos === 10 || pos === 13) kick(tt);
        if (pos === 4 || pos === 12) snare(tt);
        hat(tt, pos === 0 || pos === 8);
        if (pos % 2 === 1) hat(tt, false);
        if (pos === 0) noiseAt({hp:5000, lp:16000, dur:0.12, vol:0.050, t:tt});
        if (pos === 15) noiseAt({hp:1400, lp:9000, dur:0.08, vol:0.070, t:tt});
            } else if (bgmMode === "final") {
        // final(4/4): 강한 킥/스네어 + 오픈햇으로 압박
        if (pos === 0 || pos === 3 || pos === 6 || pos === 8 || pos === 10 || pos === 12 || pos === 15) kick(tt);
        if (pos === 4 || pos === 12) snare(tt);
        if (pos % 2 === 0) hat(tt, pos === 0 || pos === 8);
        if (pos === 14 || pos === 15) hat(tt, true);
        if (pos === 0) noiseAt({hp:5200, lp:18000, dur:0.14, vol:0.060, t:tt});
        if (pos === 8) noiseAt({hp:1600, lp:9000, dur:0.09, vol:0.065, t:tt});
      } else if (bgmMode === "fail") {
        // fail(4/4): 느린 심장박동 + 얇은 먼지
        if (pos === 0 || pos === 9) toneAt("sine", 68, 54, 0.30, 0.012, tt);
        if (pos === 4) noiseAt({hp:950, lp:2600, dur:0.11, vol:0.030, t:tt});
      } else if (bgmMode === "win") {
        // win(4/4): 가벼운 킥/햇(너무 세지 않게)
        if (pos === 0 || pos === 8) kick(tt);
        if (pos === 4) snare(tt);
        if (pos === 12) hat(tt, true);
      }
// ----------------- 베이스(모드별 박자) -----------------
      if (bgmMode === "fail") {
        if (pos === 0 || pos === 8) bass(tt, mtof(root));
      } else if (bgmMode === "win") {
        if (pos === 0 || pos === 4 || pos === 8 || pos === 12) bass(tt, mtof(root));
      } else if (bgmMode === "final") {
        if (pos === 0 || pos === 6 || pos === 8 || pos === 14) bass(tt, mtof(root));
      } else if (bgmMode === "boss") {
        if (pos === 0 || pos === 6 || pos === 8 || pos === 14) bass(tt, mtof(root));
      } else if (bgmMode === "wave") {
        if (pos === 0 || pos === 7 || pos === 8 || pos === 15) bass(tt, mtof(root));
      } else {
        if (pos === 0 || pos === 8) bass(tt, mtof(root));
      }

      // ----------------- 멜로디(모드별 리듬 위치 다르게) -----------------
      const scaleBuild = [69, 71, 72, 74, 76, 77, 79, 81]; // A minor-ish
      const scaleBoss  = [69, 70, 72, 74, 76, 79, 80, 81]; // b2/b6 추가
      const scaleFinal = [69, 70, 72, 74, 76, 77, 80, 81]; // 더 거친(b2/b6)
      const scaleFail  = [69, 72, 74, 76, 77, 79, 81];     // 느린 애가토(부드럽게)
      const scaleWin   = [72, 74, 76, 77, 79, 81, 83, 84]; // C major-ish

      let scale = scaleBuild;
      if (bgmMode === "boss") scale = scaleBoss;
      else if (bgmMode === "final") scale = scaleFinal;
      else if (bgmMode === "fail") scale = scaleFail;
      else if (bgmMode === "win") scale = scaleWin;

      const melodyPos =
        (bgmMode === "final") ? [1,4,7,9,11,15] :
        (bgmMode === "boss")  ? [1,3,7,9,11,13,15] :
        (bgmMode === "wave")  ? [1,6,11,14,15] :
        (bgmMode === "fail")  ? [4,9,12] :
        (bgmMode === "win")   ? [2,6,10,14] :
                               [2,5,9,13];

      if (melodyPos.includes(pos)){
        const idx = (bar * 13 + pos * 3) % scale.length;
        if (bgmMode === "fail"){
          melody(tt, mtof(scale[idx] - 12));
        } else if (bgmMode === "win"){
          bell(tt, mtof(scale[idx]));
        } else {
          melody(tt, mtof(scale[idx]));
          if (bgmMode === "wave" && (pos === 11 || pos === 15)) arp(tt + 0.02, mtof(scale[(idx+4)%scale.length]));
          if (bgmMode === "boss" || bgmMode === "final") lead(tt + 0.02, mtof(scale[(idx+2)%scale.length]));
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
        if (bgmMode === "final") riser(tt, 640, 1320);
        if (bgmMode === "boss")  riser(tt, 520, 980);
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

    // 사운드들(가볍게, 반복돼도 거슬리지 않도록)
    function s_click(){ tone("square", 1800, 1500, 0.045, 0.28); noise({hp:2400, lp:12000, dur:0.04, vol:0.10}); }
    function s_place(){ tone("triangle", 700, 980, 0.08, 0.28); noise({hp:1400, lp:9000, dur:0.05, vol:0.09}); }
    function s_shoot(){ tone("triangle", 520, 360, 0.08, 0.16); noise({hp:1700, lp:9000, dur:0.05, vol:0.07}); }

    // 에너지포(야마토포) 전용 사운드: 충전은 점점 올라가고, 발사는 저역+고역 임팩트
    function s_yamatoCharge1(){
      // 시작: 낮은 허밍 + 얇은 스파크
      tone("sine", 120, 170, 0.18, 0.40);
      tone("triangle", 480, 620, 0.10, 0.18);
      noise({hp:650, lp:3600, dur:0.16, vol:0.14});
    }
    function s_yamatoCharge2(){
      // 중반: 더 높은 집속, 짧게
      tone("triangle", 620, 820, 0.10, 0.22);
      tone("sine", 170, 220, 0.12, 0.28);
      noise({hp:1200, lp:5200, dur:0.12, vol:0.12});
    }
    function s_yamatoCharge3(){
      // 후반: 빠르게 떨리는 느낌
      tone("square", 860, 1020, 0.08, 0.20);
      tone("triangle", 980, 1240, 0.07, 0.18);
      noise({hp:2000, lp:9000, dur:0.10, vol:0.11});
    }
    function s_yamatoChargeReady(){
      // 발사 직전: 짧은 상승 치프(ready)
      tone("triangle", 920, 1760, 0.12, 0.26);
      noise({hp:3200, lp:14000, dur:0.10, vol:0.14});
    }
    function s_yamatoFire(){
      // 발사: 저역 충격 + 고역 에너지 스냅(필살기 체감)
      tone("sine", 120, 46, 0.60, 0.90);
      noise({hp:120, lp:1800, dur:0.40, vol:0.30});
      tone("sawtooth", 860, 190, 0.40, 0.34);
      tone("triangle", 2400, 920, 0.22, 0.38);
      noise({hp:3200, lp:16000, dur:0.18, vol:0.18});
    }

    function s_shieldHit(){ tone("triangle", 1250, 900, 0.12, 0.38); noise({hp:1200, lp:8000, dur:0.10, vol:0.18}); }
    function s_shieldBreak(){ tone("sawtooth", 900, 170, 0.30, 0.38); noise({hp:2200, lp:12000, dur:0.22, vol:0.33}); tone("sine", 120, 60, 0.25, 0.22); }
    function s_coreBreak(){
      // 수정탑 파괴(1초) — 크리스탈 크랙 + 저역 잔향 + 에너지 노이즈
      tone("triangle", 2100, 1200, 0.14, 0.24);       // 쨍(초기)
      tone("sawtooth", 820, 90,   0.92, 0.42);        // 길게 내려가는 크랙
      noise({hp:1600, lp:11000, dur:0.78, vol:0.26}); // 파편/에너지 노이즈
      tone("sine", 150, 60, 0.95, 0.18);              // 저역 잔향(1초)
    }
    function s_enemyShoot(){
      // 적 발사(짧고 날카롭게)
      tone("square", 520, 260, 0.10, 0.16);
      noise({hp:1200, lp:7000, dur:0.08, vol:0.08});
    }
    function s_blast(){
      // 폭파병(짧은 폭발)
      tone("sine", 120, 45, 0.42, 0.40);
      noise({hp:130, lp:1800, dur:0.38, vol:0.14});
    }
    function s_hpHit(){ tone("sine", 170, 95, 0.22, 0.40); noise({hp:250, lp:2200, dur:0.12, vol:0.12}); }
    function s_boom(){ tone("sine", 90, 28, 1.00, 0.55); noise({hp:120, lp:1400, dur:0.85, vol:0.18}); }
    function s_aegis(){ tone("triangle", 520, 1080, 0.20, 0.35); noise({hp:900, lp:7000, dur:0.16, vol:0.10}); }
    function s_repair(){ tone("sine", 320, 540, 0.28, 0.24); tone("triangle", 900, 1320, 0.22, 0.18); noise({hp:1200, lp:9000, dur:0.18, vol:0.08}); }

    function s_clear(){ tone("triangle", 640, 1240, 0.22, 0.30); }
    function s_wave(){ tone("triangle", 420, 820, 0.18, 0.26); noise({hp:900, lp:7000, dur:0.10, vol:0.08}); }

    function s_warning(){
      // 최종전/보스 경고 사이렌(짧게)
      ensure();
      const t0 = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(420, t0);
      o.frequency.exponentialRampToValueAtTime(920, t0+0.42);
      o.frequency.exponentialRampToValueAtTime(620, t0+0.82);
      f.type = "lowpass";
      f.frequency.setValueAtTime(1800, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.22, t0+0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0+0.82);
      o.connect(f);
      f.connect(g);
      g.connect(master);
      o.start(t0);
      o.stop(t0+0.85);
    }

    function s_victory(){
      // 승리/엔딩(부드럽지만 확실히 다른 느낌) — 상승 아르페지오 + 메이저 코드
      ensure();
      const t0 = ctx.currentTime;

      function toneAt(type, f, start, dur, vol){
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(f, start);
        env(g.gain, start, 0.001, 0.03, 0.30, dur, vol);
        o.connect(g).connect(master);
        o.start(start);
        o.stop(start + dur + 0.08);
      }

      // C major 느낌(정화/승리) — C5, E5, G5, C6
      const seq = [
        [0.00, 523.25],
        [0.12, 659.25],
        [0.24, 783.99],
        [0.36, 1046.50],
      ];
      for (const [dt, f] of seq){
        toneAt("triangle", f, t0 + dt, 0.16, 0.20);
      }

      // 작은 반짝임(노이즈) + 마지막 코드(C-E-G)
      // 노이즈는 기존 noise() 사용(현재시각 기준)이라 약간 늦춰서 setTimeout으로 호출
      setTimeout(()=>{ try { noise({hp:2400, lp:14000, dur:0.08, vol:0.10}); } catch {} }, 260);

      const chordT = t0 + 0.52;
      toneAt("sine",     523.25, chordT, 0.40, 0.12);
      toneAt("sine",     659.25, chordT, 0.40, 0.10);
      toneAt("sine",     783.99, chordT, 0.40, 0.10);
      toneAt("triangle", 1046.50, chordT, 0.32, 0.10);
    }

    function play(name){
      if (!enabled) return;
      // 잠금 해제는 각 입력에서 unlock()로 처리 (여기서 강제 resume하지 않음)
      switch(name){
        case "click": return s_click();
        case "place": return s_place();
        case "shoot": return s_shoot();
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
