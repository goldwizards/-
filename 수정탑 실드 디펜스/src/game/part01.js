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
  };

  // ---------- Build helpers ----------
  const SELL_REFUND = 0.70;
  function sellRefundRate(){
