
(() => {
  try {
  // ---------- Canvas ----------
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;

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
    return clamp(SELL_REFUND + 0.05*state.upg.sellRefund, 0, 0.90);
  }
 // 포탑 판매 환불 비율(70%)

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
    { id:"barrier_null",  name:"보호막 무력화", desc:"이번 웨이브 동안 보호막이 피해를 흡수하지 못합니다(HP 직격).",
      apply(s){ s.mods.shieldAbsorbMul = 0; s.mods.shieldRegenMul = 0.25; } },
    { id:"proj_slow",    name:"탄속 감소",  desc:"이번 웨이브 동안 포탑 탄속/연사력이 감소합니다.",
      apply(s){ s.mods.turretProjMul = 0.72; s.mods.turretFireMul = 0.78; } },
    { id:"double_crystal", name:"자원 2배", desc:"이번 웨이브 동안 처치 보상이 2배입니다.",
      apply(s){ s.mods.rewardMul = 2.0; } },
{ id:"turret_boost", name:"포탑 강화", desc:"이번 웨이브 동안 포탑 피해 +20%.",
  apply(s){ s.mods.turretDmgMul = 1.20; } },

{ id:"shield_surge", name:"실드 과충전", desc:"이번 웨이브 동안 보호막 재생 +60%.",
  apply(s){ s.mods.shieldRegenMul = 1.60; } },

{ id:"emp_storm", name:"EMP 폭풍", desc:"이번 웨이브 동안 포탑 연사력 -35%.",
  apply(s){ s.mods.turretFireMul = 0.65; } },

{ id:"resource_tax", name:"보급 차감", desc:"이번 웨이브 동안 크리스탈 보상 -40%.",
  apply(s){ s.mods.rewardMul = 0.60; } },


  ];

  // ---------- State ----------
  const state = {
    difficulty: 1.0,
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
    stats: { runStart: nowSec(), kills: 0, damageTaken: 0, repairs: 0 },

    hardError: "",
    uiMsg: "",
    uiMsgUntil: 0,

ui: {
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
      repair: 0,
      turretDmg: 0,
      turretFire: 0,
      turretRange: 0,
      slowPower: 0,
      splashRadius: 0,
      projSpeed: 0,
      turretCrit: 0,
      slowDuration: 0,
      sellRefund: 0,
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
      shieldMax: 240, shield: 240,
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

      aegisCd: 18.0,
      aegisReadyAt: 0,
      aegisActiveUntil: 0,
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
    { id:"sellRefund", cat:"util", name:"회수 효율", max:4, base:60, grow:1.55, desc:(lv)=>`판매 환불 +${5*lv}% (최대 90%)`, apply(){} },
    { id:"waveShield", cat:"core", name:"개전 과충전", max:5, base:70, grow:1.60, desc:(lv)=>`웨이브 시작 시 보호막 +${20*lv}`, apply(){} },
    { id:"slowDuration", cat:"turret", name:"둔화 지속", max:5, base:60, grow:1.55, desc:(lv)=>`둔화 지속 +${(0.25*lv).toFixed(2)}s`, apply(){} },
    { id:"aegisTune", cat:"core", name:"아이기스 튜닝", max:6, base:85, grow:1.62,
      desc:(lv)=>`긴급 보호막 쿨 -${(1.5*lv).toFixed(1)}s`,
      apply(){
        const lv = state.upg.aegisTune;
        state.core.aegisCd = Math.max(6, CORE_BASE.aegisCd - 1.5*lv);
      } },

    { id:"slowPower", cat:"turret", name:"슬로우 강화", max:5, base:65, grow:1.58, desc:(lv)=>`둔화 +${Math.round(6*lv)}%`, apply(){} },
    { id:"splashRadius", cat:"turret", name:"스플래시 반경", max:5, base:65, grow:1.58, desc:(lv)=>`반경 +${8*lv}`, apply(){} },
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
    state.ui = { upgTab:"all", upgSearch:"", upgOnlyCanBuy:false, upgSortMode:0, upgCollapse:{core:false,turret:false,util:false} };
  }
  if (!state.ui.upgCollapse) state.ui.upgCollapse = { core:false, turret:false, util:false };
  if (!("upgOnlyCanBuy" in state.ui)) state.ui.upgOnlyCanBuy = false;
  if (!("upgSortMode" in state.ui)) state.ui.upgSortMode = 0;
  if (!state.ui.upgTab) state.ui.upgTab = "all";
  if (state.ui.upgSearch == null) state.ui.upgSearch = "";
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

      const rowClass = canBuy ? "upgRow" : "upgRow disabled";
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
          <div class="upgDesc">${def.desc(lv+1)}</div>
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
const uiMsg   = document.getElementById("uiMsg");
const uiCheat = document.getElementById("uiCheat");
const uiUpgradesWrap = document.getElementById("uiUpgrades");
const uiUpgradesPCWrap = document.getElementById("uiUpgradesPC");
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

  const uiEvent = document.getElementById("uiEvent");

  const uiPreview = document.getElementById("uiPreview");

  const btnCoreRebuild   = document.getElementById("btnCoreRebuild");
  const btnCoreResonance = document.getElementById("btnCoreResonance");
  const btnCoreOverload  = document.getElementById("btnCoreOverload");
  const btnCoreOverdrive = document.getElementById("btnCoreOverdrive");
  const uiCorePassiveDesc = document.getElementById("uiCorePassiveDesc");
const finalSupportPanel = document.getElementById("finalSupportPanel");
const btnFinalOffense   = document.getElementById("btnFinalOffense");
const btnFinalDefense   = document.getElementById("btnFinalDefense");
const uiFinalSupportDesc = document.getElementById("uiFinalSupportDesc");


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
        "HP 직접 피해/실드 파괴 시 게이지가 크게 감소합니다."
      ]
    },
    overload: {
      id:"overload", name:"임계 과부하", colorClass:"passiveRed",
      desc:[
        "저체력 구간에서 포탑 화력이 급격히 증가합니다.",
        "보호막 재생이 급격히 증가합니다.",
        "저체력일수록 받는 피해가 감소합니다."]
    },
    overdrive: {
      id:"overdrive", name:"코어 오버드라이브", colorClass:"passivePurple",
      desc:[
        "수정탑이 직접 적을 공격합니다.",
        "HP가 낮을수록 공격 속도와 공격력이 증가합니다.",
        "저체력 구간에서 보호막 재생이 증가합니다.",
        "저체력일수록 받는 피해가 소폭 감소합니다."
      ]
    }
  };

  // ---------- Resonance core (공명 반격) ----------
  const RESONANCE_CFG = {
    denomMul: 0.45,      // shieldMax * 0.45 를 100% 기준 흡수량으로
    hitCap: 25,          // 1회 충전 상한(+%)
    secCap: 50,          // 1초 충전 상한(+%)
    decayWait: 2.0,      // 흡수 공백(초)
    decayPerSec: 8.0,    // 공백 이후 초당 감소(%p)
    hpPenalty: 35,       // HP 직접 피해 시 -%
    breakPenalty: 60,    // 실드 파괴 시 -%
    dischargeCd: 2.5,    // 방출 쿨(초)
    dischargeMul: 0.35,  // 최근 흡수량의 35%
    dischargeCapMul: 1.2 // shieldMax * 1.2 상한
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
    // 3.2초 이상 지난 기록 제거(여유)
    let cut = 0;
    while (cut < c.resAbsorbEvents.length && (t - c.resAbsorbEvents[cut].t) > 3.2) cut++;
    if (cut > 0) c.resAbsorbEvents.splice(0, cut);
  }

  function resonanceRecentAbsSum(){
    const c = state.core;
    if (!Array.isArray(c.resAbsorbEvents) || c.resAbsorbEvents.length === 0) return 0;
    const t = gameSec();
    let sum = 0;
    for (let i = c.resAbsorbEvents.length - 1; i >= 0; i--) {
      const a = c.resAbsorbEvents[i];
      if ((t - a.t) > 3.0) break;
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
    add = Math.min(add, RESONANCE_CFG.hitCap);
    const room = RESONANCE_CFG.secCap - (c.resChargeThisSec||0);
    if (room <= 0) return;
    add = Math.min(add, room);
    if (add <= 0.01) return;
    c.resChargeThisSec += add;
    c.resGauge = clamp((c.resGauge||0) + add, 0, 100);
  }

  function resonancePenaltyHp(){
    if (state.core.passiveId !== 'resonance') return;
    resonanceEnsure();
    state.core.resGauge = clamp((state.core.resGauge||0) - RESONANCE_CFG.hpPenalty, 0, 100);
  }

  function resonancePenaltyBreak(){
    if (state.core.passiveId !== 'resonance') return;
    resonanceEnsure();
    state.core.resGauge = clamp((state.core.resGauge||0) - RESONANCE_CFG.breakPenalty, 0, 100);
  }

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
    if (!target) { c.resGauge = 0; c.resDischargeReadyAt = t + RESONANCE_CFG.dischargeCd; return; }

    resonancePrune();
    const recent = resonanceRecentAbsSum();
    let dmg = recent * RESONANCE_CFG.dischargeMul;
    const cap = c.shieldMax * RESONANCE_CFG.dischargeCapMul;
    dmg = Math.min(dmg, cap);
    if (target.isFinalBoss) dmg *= 0.70;

    // 타격
    target.hp -= dmg;

    // 연출
    fxLine(CORE_POS.x, CORE_POS.y, target.x, target.y, '#fdba74', 0.55, 6);
    fxRing(CORE_POS.x, CORE_POS.y, CORE_RADIUS+10, CORE_RADIUS+150, '#fdba74');
    fxRing(target.x, target.y, 10, 92, '#fdba74');
    fxText('공명 방출!', CORE_POS.x, CORE_POS.y - 128, '#fdba74');
    try { sfxShieldHit(); } catch {}

    c.resGauge = 0;
    c.resDischargeReadyAt = t + RESONANCE_CFG.dischargeCd;
  }

  function updateResonance(dt){
    if (state.core.passiveId !== 'resonance') return;
    resonanceEnsure();
    const c = state.core;
    const t = gameSec();
    resonancePrune();

    // 흡수 공백 후 감쇠
    const since = t - (c.resLastAbsorbAt||-999);
    if (since > RESONANCE_CFG.decayWait && (c.resGauge||0) > 0) {
      c.resGauge = clamp((c.resGauge||0) - RESONANCE_CFG.decayPerSec*dt, 0, 100);
    }

    // 100% 도달 시 자동 방출
    if ((c.resGauge||0) >= 100 && t >= (c.resDischargeReadyAt||0)) {
      resonanceDischarge();
    }
  }


function passiveSelected(){ return !!state.core.passiveId; }

  function refreshCorePassiveUI(){
    const id = state.core.passiveId;
    const locked = !!(id && state.core.passiveLocked);

    const setActive = (btn, on) => { if(!btn) return; btn.classList.toggle("active", !!on); };
    const setDisabled = (btn, v) => { if(!btn) return; btn.disabled = !!v; btn.classList.toggle("isDisabled", !!v); };

    setActive(btnCoreRebuild,   id==="rebuild");
    setActive(btnCoreResonance, id==="resonance");
    setActive(btnCoreOverload,  id==="overload");
    setActive(btnCoreOverdrive, id==="overdrive");

    // ✅ 최초 선택 후 재시작 전까지는 변경 불가
    setDisabled(btnCoreRebuild,   locked);
    setDisabled(btnCoreResonance, locked);
    setDisabled(btnCoreOverload,  locked);
    setDisabled(btnCoreOverdrive, locked);

    // 웨이브 시작은 패시브 선택 후 가능
    if (btnWave) btnWave.disabled = !id;

    if (uiCorePassiveDesc) {
      if (!id) {
        uiCorePassiveDesc.innerHTML = `패시브를 선택하면 <span class="kbd">웨이브 시작</span>이 가능합니다. (재시작 시 다시 선택)`;
      } else {
        const d = CORE_PASSIVES[id];
        uiCorePassiveDesc.innerHTML =
          `<b>${d.name}</b><br>` +
          d.desc.map(s=>`• ${s}`).join("<br>") +
          `<div class="muted" style="margin-top:6px;">재시작 전까지 패시브 변경 불가</div>`;
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

    setMsg(`패시브 선택: ${CORE_PASSIVES[id].name}`, 2.0);
    refreshCorePassiveUI();
    refreshUI();
  }



  if (btnCoreRebuild)   btnCoreRebuild.addEventListener("click", ()=>selectCorePassive("rebuild"));
  if (btnCoreResonance) btnCoreResonance.addEventListener("click", ()=>selectCorePassive("resonance"));
  if (btnCoreOverload)  btnCoreOverload.addEventListener("click", ()=>selectCorePassive("overload"));
  if (btnCoreOverdrive) btnCoreOverdrive.addEventListener("click", ()=>selectCorePassive("overdrive"));

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
  const handleUpg = (ev) => {
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

  for (const el of upgContainers) el.addEventListener("pointerdown", handleUpg, { capture:true });
  }

  const btnWave = document.getElementById("btnWave");
  const btnRestart = document.getElementById("btnRestart");
  const btnRepair  = document.getElementById("btnRepair");
  const btnEnergy = document.getElementById("btnEnergy");
  const btnBg = document.getElementById("btnBg");
  const btnEasy = document.getElementById("btnEasy");
  const btnHard = document.getElementById("btnHard");

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
  const mbWire = document.getElementById("mbWire");

  
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
    if (mbWire){
      mbWire.firstElementChild.textContent = show ? "와이어 숨김" : "와이어 표시";
      const sm = mbWire.querySelector('small');
      if (sm) sm.textContent = show ? "숨기기" : "표시";
    }
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
      // Mobile default: hide wire panel to maximize play area
      setWireVisible(false);
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
  if (mbWire){
    mbWire.addEventListener("click", ()=>{
      const p = document.getElementById("wirePanel");
      const hidden = p ? p.classList.contains("hidden") : false;
      setWireVisible(hidden);
      try{ SFX.play("click"); }catch{}
    });
  }

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
    if (mbBasic)  mbBasic.classList.toggle("active", s==="basic");
    if (mbSlow)   mbSlow.classList.toggle("active", s==="slow");
    if (mbSplash) mbSplash.classList.toggle("active", s==="splash");

    if (mbSell){
      mbSell.classList.toggle("on", !!state.mobileSellMode);
      mbSell.firstElementChild.textContent = state.mobileSellMode ? "판매 ON" : "판매 OFF";
    }

    // 버튼에 현재 비용 표시(난이도/밸런스 바뀌어도 자동 반영)
    if (mbBasic)  mbBasic.querySelector("small").textContent = `설치(${TURRET_TYPES.basic.cost})`;
    if (mbSlow)   mbSlow.querySelector("small").textContent = `설치(${TURRET_TYPES.slow.cost})`;
    if (mbSplash) mbSplash.querySelector("small").textContent = `설치(${TURRET_TYPES.splash.cost})`;
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
    fxRing(mx,my, 14, 64, "#7dd3fc");
    SFX.play("place");
  }

  if (mbBasic)  mbBasic.onclick = ()=> setSelectedTurret("basic");
  if (mbSlow)   mbSlow.onclick = ()=> setSelectedTurret("slow");
  if (mbSplash) mbSplash.onclick = ()=> setSelectedTurret("splash");

  if (mbWave)   mbWave.onclick = ()=> { ensureAudio(); SFX.play("click"); if (state.phase==="win") return; if (state.phase==="build"||state.phase==="clear"||state.phase==="finalprep") startWave(); };
  if (mbRepair) mbRepair.onclick = ()=> { ensureAudio(); tryRepair(); };
  if (mbAegis)  mbAegis.onclick  = ()=> { ensureAudio(); tryAegis(); };
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
  btnRepair.onclick  = () => { ensureAudio(); tryRepair(); };
  if (btnEnergy) btnEnergy.onclick = () => { ensureAudio(); tryEnergyCannon(); };
  if (btnBg) btnBg.onclick = () => {
    ensureAudio(); SFX.play("click");
    state.ui.bgMode = ((state.ui.bgMode||0) + 1) % 3;
    syncBackground();
  };
  btnEasy.onclick = () => { ensureAudio(); SFX.play("click"); state.difficulty = clamp(state.difficulty - 0.1, 0.6, 2.0); };
  btnHard.onclick = () => { ensureAudio(); SFX.play("click"); state.difficulty = clamp(state.difficulty + 0.1, 0.6, 2.0); };

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
    if (["Digit1","Digit2","Digit3","Space","KeyR","KeyF","KeyX","KeyE"].includes(e.code)) e.preventDefault();
    if (["Digit1","Digit2","Digit3","Space","KeyR","KeyF","KeyX","KeyE"].includes(e.code)) ensureAudio();
    if (e.code === "Digit1") { state.selected = "basic"; SFX.play("click"); }
    if (e.code === "Digit2") { state.selected = "slow"; SFX.play("click"); }
    if (e.code === "Digit3") { state.selected = "splash"; SFX.play("click"); }
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
      if (["KeyK","KeyH","KeyJ","KeyB","KeyN","KeyU","KeyG"].includes(e.code)) { e.preventDefault(); ensureAudio(); }
      if (e.code === "KeyK") cheatAddCrystals(500);
      if (e.code === "KeyH") cheatHealHP();
      if (e.code === "KeyJ") cheatRefillShield();
      if (e.code === "KeyB") cheatKillAll();
      if (e.code === "KeyN") cheatSkipWave();
      if (e.code === "KeyU") cheatMaxUpgrades();
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
    fxRing(mx,my, 14, 64, "#7dd3fc");
    SFX.play("place");
  });

  function overlapsTurret(x,y){
    for (const t of state.turrets) if (dist(x,y, t.x,t.y) < 34) return true;
    return false;
  }

  // ---------- Wave Spec ----------
  function waveSpec(w){
  const isBoss = (w % 5 === 0) || (w === FINAL_WAVE);
  const isFinal = (w === FINAL_WAVE);

  // 최종 웨이브(30): 보스 1마리만 기본 스폰. (추가 소환은 보스 패턴에서 처리)
  const baseCount = Math.floor(10 + w*2.2);
  const count = isFinal ? 1 : (isBoss ? Math.max(8, Math.floor(baseCount*0.65)) : baseCount);

  const hp  = (26 + w*6) * (isFinal ? 4.2 : (isBoss ? 2.25 : 1.0));
  const spd = (42 + w*2.3) * (isFinal ? 0.95 : (isBoss ? 0.92 : 1.0));
  const spawnRate = (isFinal ? 0.9 : (isBoss ? 0.9 : 1.25)) + w*0.03;
  return { count, hp, spd, spawnRate, isBoss, isFinal };
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
    if (w >= 6) pool.push(["bomber", 14]);

    // boss wave: 특수 몹 비중 증가
    if (spec.isBoss) {
      for (let i=0;i<pool.length;i++) pool[i][1] *= (pool[i][0]==="grunt" ? 0.55 : 1.25);
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
  }

  
  function tryRepair(){
    if (state.phase === "fail") return;

    const t = gameSec();
    const cdLeft = Math.max(0, state.core.repairReadyAt - t);

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

    const elite = spec.isBoss && (id !== "boss") && Math.random() < 0.22;
    const r = (arch.r || 12) * (elite ? 1.15 : 1.0);
    const hp = spec.hp * arch.hpMul * (elite ? 1.8 : 1.0) * state.difficulty;
    const spd = spec.spd * arch.spdMul * (elite ? 0.90 : 1.0) * (0.92 + 0.16*Math.random()) * state.difficulty;

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
state.enemies.push(eObj);
  }
// ---------- Final boss helpers ----------
function finalBossIncomingMul(){
  // 웨이브30 최종보스 전용: 덕칠/업그레이드 순삭 방지 내성(더 강하게)
  const tc = state.turrets.length;

  // 10개부터 점감 시작 (기존 12)
  const extra = Math.max(0, tc - 10);
  const spamDR = clamp(extra * 0.055, 0, 0.70); // 포탑 많을수록 최대 70%까지 감쇄

  const u = state.upg;
  // 업그레이드 누적 내성 (상한 상향)
  const upgPower =
      (u.turretDmg*0.09) + (u.turretFire*0.07) + (u.turretRange*0.04) +
      (u.projSpeed*0.05) + (u.turretCrit*0.06) + (u.splashRadius*0.06);

  const upgDR = clamp(upgPower, 0, 0.35);
  const mul = 1 - (spamDR + upgDR);

  // 최소 피해 22% 보장 (기존 35%) => 훨씬 안 녹음
  return clamp(mul, 0.22, 1.0);
}

function spawnEnemyForced(id, spec, x, y, elite=false){
  const arch = ENEMY_ARCH[id] || ENEMY_ARCH.grunt;
  const dmgMul = (1 + Math.max(0, state.wave - 1) * 0.06);
  const r = (arch.r || 12) * (elite ? 1.15 : 1.0);
  const hp = spec.hp * (arch.hpMul||1) * (elite ? 1.8 : 1.0) * state.difficulty;
  const spd = spec.spd * (arch.spdMul||1) * (elite ? 0.90 : 1.0) * (0.92 + 0.16*Math.random()) * state.difficulty;

  state.enemies.push({
    x, y,
    hp, hpMax: hp,
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
    boss.awakeFlash = 1.0;
    boss.awakeFlashPhase = phase;
    fxText(`페이즈 ${phase}`, CORE_POS.x, CORE_POS.y - 120, "#f472b6");
    fxRing(CORE_POS.x, CORE_POS.y, CORE_RADIUS+10, CORE_RADIUS+150, "#f472b6");
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

    state.projectiles.push({
      kind: "turret",
      x: t.x, y: t.y,
      vx: dx/d * sp,
      vy: dy/d * sp,
      dmg: dmg,
      crit: isCrit,
      splash: s.splash,
      slow: s.slow,
      life: 1.7,
      r: isCrit ? 4.6 : 3.5,
      pierce: (s.pierce||0),
      chain: (s.chain||0),
      chainRange: (s.chainRange||0),
      chainMul: (s.chainMul||0),
      hitSet: null
    });

    fxRing(t.x,t.y, 6, 26, "#a7f3d0");

    sfxShoot();
  }

  
  function enemyShoot(e){
    const dx = CORE_POS.x - e.x, dy = CORE_POS.y - e.y;
    const d = Math.hypot(dx,dy) || 1;
    const sp = e.projSpd || 320;

    if (state.projectiles.length >= projCap()) return;

    state.projectiles.push({
      kind: "enemy",
      x: e.x, y: e.y,
      vx: dx/d * sp,
      vy: dy/d * sp,
      dmg: (e.projDmg || 8) * (e.elite ? 1.10 : 1.0) * state.difficulty,
      life: 2.2,
      r: 3,
      coreOpts: e.coreOpts || null
    });

    SFX.play("enemy_shoot");
    fxRing(e.x, e.y, 6, 26, "#fbbf24");
  }

  function bombExplode(e){
    SFX.play("blast");
    fxRing(e.x, e.y, 16, e.explodeRad || 120, "#34d399");
    fxText("폭발!", e.x, e.y - 16, "#34d399");

    const dmg = (e.explodeDmg || 32) * (e.elite ? 1.10 : 1.0) * state.difficulty;
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

function applyProjectileHit(p, hit){
    let dmg = p.dmg;
    if (p.kind === "turret" && hit.isFinalBoss) dmg *= finalBossIncomingMul();
    hit.hp -= dmg;

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
          let cdmg = p.dmg * mul;
          if (best.isFinalBoss) cdmg *= finalBossIncomingMul();
          best.hp -= cdmg;
          fxRing(best.x, best.y, 6, 30, "#fdba74");
          fxRing(hit.x, hit.y, 6, 30, "#fdba74");
        }
      }
    }

    if (p.slow > 0 && hit) {


      const t = nowSec();


      hit.slowMul = Math.min(hit.slowMul || 1.0, 1 - p.slow);


      const slowDur = 1.2 + 0.25*state.upg.slowDuration;


      hit.slowUntil = Math.max(hit.slowUntil || 0, t + slowDur);


    }
    if (p.splash > 0) {
      for (const e of state.enemies) {
        if (p.hitSet && p.hitSet.has(e)) continue;
        const d = dist(p.x,p.y, e.x,e.y);
        if (d <= p.splash) {
          const fall = 1 - (d / p.splash);
          const coreLow = (state.core.hp / state.core.hpMax) <= 0.5;
          const splashMul = coreLow ? 0.50 : 0.65;
          let sdmg = p.dmg * splashMul * fall;
          if (e.isFinalBoss) sdmg *= finalBossIncomingMul();
          e.hp -= sdmg;
        }
      }
      fxRing(p.x,p.y, 8, p.splash, "#93c5fd");
    } else {
      fxRing(p.x,p.y, 6, 36, "#93c5fd");
    }
  }

  // ---------- FX ----------
  function fxRing(x,y, r0, r1, color){ state.fx.push({ kind:"ring", x,y, t:0, dur:0.35, r0, r1, color }); }
function fxLine(x1,y1,x2,y2, color, dur=0.9, width=4){
    state.fx.push({ kind:"line", x1,y1,x2,y2, t:0, dur, color, width });
  }
  function fxWarnCircle(x,y, r0, r1, color, dur=0.9){
    state.fx.push({ kind:"warn", x,y, t:0, dur, r0, r1, color });
  }

  function fxText(text,x,y,color){ state.fx.push({ kind:"text", x,y, t:0, dur:0.9, text, color }); }
  function fxShieldWave(x,y, radius){ state.fx.push({ kind:"shieldWave", x,y, t:0, dur:0.42, r0:radius, r1:radius+68, color:"#60a5fa" }); }

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
    for (let i=0;i<90;i++){
      const ang = rand(0, Math.PI*2);
      const spd = rand(90, 520);
      const r = rand(2.2, 7.2);
      const blue = Math.random() < 0.72;

      state.debris.push({
        x: CORE_POS.x + rand(-10,10),
        y: CORE_POS.y + rand(-10,10),
        vx: Math.cos(ang)*spd,
        vy: Math.sin(ang)*spd - rand(60,220),
        r,
        rot: rand(0, Math.PI*2),
        vr: rand(-10, 10),
        life: 0,
        ttl: rand(1.0, 2.4),
        color: blue ? "rgba(147,197,253,1)" : "rgba(230,208,122,1)"
      });
    }
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

      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.moveTo(0, -d.r);
      ctx.lineTo(d.r*0.9, 0);
      ctx.lineTo(0, d.r);
      ctx.lineTo(-d.r*0.9, 0);
      ctx.closePath();
      ctx.fill();

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
      const tB = clamp01((0.70 - hpPct) / 0.60);       // 70%->0, 10%->1
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

      const shieldDmgWanted = Math.max((shieldPortion > 0.01 ? 0.5 : 0), shieldPortion - effShieldArmor); // 최소 0.5 피해
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
          }
        }

        // 공명 반격: 실드 파괴 페널티
        resonancePenaltyBreak();
      }
    }

    // 2) HP 피해 (+ 방어력)
    if (remain > 0.01) {
      const hpDmg = Math.max(0.5, remain - effHpArmor); // 최소 0.5 피해는 들어가게
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
    // 공명 반격: HP 직접 피해 페널티
    if (hpLost > 0.001) resonancePenaltyHp();
    state.stats.damageTaken = (state.stats.damageTaken||0) + shLost + hpLost;

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

  if (!state.core.passiveId) { setMsg("코어 패시브를 먼저 선택하세요 (4개 중 1개).", 2.2); return; }

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
  state.spawn = { spec, spawned: 0, nextSpawnIn: 0 };
  // BGM: 보스 웨이브에서는 더 강하게
  try { SFX.setBgmMode((state.wave === FINAL_WAVE) ? "final" : (spec.isBoss ? "boss" : "wave")); } catch {}
  state.crystals += Math.floor(10 + state.wave*2);
}


  function clearWave(){
  if (state.phase === "fail") return;

  // FINAL WAVE clear -> Victory ending
  if (state.wave >= FINAL_WAVE) { triggerWin(); return; }

  SFX.play("clear");
  state.phase = "clear";
  // BGM: 전투 종료 -> 기본 모드
  try { SFX.setBgmMode("build"); } catch {}

  state.autoStartAt = gameSec() + state.autoStartDelay;
  state.wave += 1;
  state.crystals += Math.floor(25 + state.wave*3);
  fxText("웨이브 클리어!", CORE_POS.x, CORE_POS.y - 72, "#a7f3d0");

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
    state.win = null;    state.stats = { runStart: nowSec(), kills: 0, damageTaken: 0, repairs: 0 };
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

    state.enemies.length = 0;
    state.turrets.length = 0;
    state.projectiles.length = 0;
    state.fx.length = 0;

    state.flames.length = 0;
    state.flameSpawnAcc = 0;

    state.debris.length = 0;
    state.collapse = null;

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
    state.upg = { coreHp:0, coreShield:0, hpArmor:0, shieldArmor:0, shieldRegen:0, repair:0, turretDmg:0, turretFire:0, turretRange:0, slowPower:0, splashRadius:0, projSpeed:0, turretCrit:0, slowDuration:0, sellRefund:0, aegisTune:0, waveShield:0 };
    applyUpgrades();
    state.core.aegisReadyAt = 0;
    state.core.aegisActiveUntil = 0;

    state.spawn = null;
    state.autoStartAt = 0;
    state.finalPrepEndsAt = 0;
    state.finalChoice = null;
    state.final = null;
    state.core.shieldRegenBlockedUntil = 0;

        // 코어 패시브: 재시작 시 다시 선택
    state.core.passiveId = null;
    state.core.passiveLocked = false;
    state.core.passiveStacks = 0;
    state.core.passiveLastHitAt = gameSec();
    state.core.passiveStackDecayAcc = 0;
    state.core.overdriveShotAcc = 0;
    state.core.passiveSalvageThisWave = 0;

    resonanceReset();
    state.core.rebuildEmergencyUntil = 0;
    state.core.rebuildEmergencyReadyAt = 0;
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

      const rate = spec.spawnRate * state.difficulty;
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
      const empMul = (state.final && (gameSec() < state.final.empUntil)) ? state.final.empMul : 1.0;
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
      const m = clamp(1 - hpFrac, 0, 1); // missing HP (0~1)
      const dmgMul = clamp(1 + 1.4*Math.pow(m, 1.6), 1, 2.4);
      const asMul  = clamp(1 + 2.0*Math.pow(m, 1.2), 1, 3.0);

      const baseInterval = 0.65;
      state.core.overdriveShotAcc = (state.core.overdriveShotAcc||0) + dt;
      const interval = clamp(baseInterval / asMul, 0.15, 0.75);

      // 웨이브가 오를수록 기본 피해가 완만히 증가
      const baseDmg = 8 + state.wave * 0.40;
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
            try { SFX.play("shoot"); } catch {}
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
    for (let i = state.enemies.length - 1; i >= 0; i--) {
      const e = state.enemies[i];
      const tt = nowSec();
      if (tt > e.slowUntil) e.slowMul = 1.0;
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
          const base = (e.touchBase || 9) * (0.95 + 0.10*Math.random()) * state.difficulty;
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
        const reward = Math.floor((e.reward || (e.elite ? 16 : 10)) * state.mods.rewardMul);
        state.crystals += reward;
        state.stats.kills = (state.stats.kills|0) + 1;
        fxText(`+${reward}`, e.x, e.y - 6, "#a7f3d0");
        fxRing(e.x,e.y, 8, 55, "#a7f3d0");
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

    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,W,H);

    ctx.save();
    ctx.translate(shakeX, shakeY);

    // background
    ctx.fillStyle = "#0b0f14";
    ctx.fillRect(-shakeX,-shakeY,W,H);

    // grid
    ctx.globalAlpha = 0.15;
    ctx.strokeStyle = "#233047";
    ctx.lineWidth = 1;
    for (let x=0;x<=W;x+=32){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y=0;y<=H;y+=32){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
    ctx.globalAlpha = 1;

    // build radius
    ctx.globalAlpha = 0.16;
    ctx.beginPath();
    ctx.arc(CORE_POS.x, CORE_POS.y, BUILD_RADIUS, 0, Math.PI*2);
    ctx.fillStyle = "#1f2937";
    ctx.fill();
    ctx.globalAlpha = 1;

    if (state.debris.length) drawDebris();

    drawCore();

    for (const t of state.turrets) drawTurret(t);
    for (const e of state.enemies) drawEnemy(e);
    for (const p of state.projectiles) drawProjectile(p);
    for (const f of state.fx) drawFx(f);

    // build/clear helper overlays
    if (state.phase === "build" || state.phase === "clear" || state.phase === "finalprep") { drawHoverTurret(); drawGhost(); }

    ctx.restore();

    // explosion flash on top
    drawBlueExplosionFlash();

    if (state.phase !== "win") drawTopHUD();
    if (state.phase !== "win") drawBossHUD();

    if (state.phase === "win") drawWinOverlay();

    if (state.hardError) banner(`오류: ${state.hardError}`, "#fca5a5");

    if (state.phase !== "win" && state.phase === "build") banner("설치 단계: 포탑 배치 후 [웨이브 시작]을 누르십시오.", "#93c5fd");
    if (state.phase !== "win" && state.phase === "clear") banner("웨이브 클리어! 배치 후 [웨이브 시작]으로 진행하십시오.", "#a7f3d0");
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
      ctx.arc(CORE_POS.x, CORE_POS.y, 82, 0, Math.PI*2);
      ctx.fill();

      ctx.restore();
    }

    // core image
    if (alpha > 0.01) {
      if (coreIconReady) {
        const size = 140;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.drawImage(coreIcon, CORE_POS.x - size/2, CORE_POS.y - size/2, size, size);
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
    const col = (t.type==="basic") ? "#93c5fd" : (t.type==="slow" ? "#a7f3d0" : "#93c5fd");

    // aim (same heuristic as update)
    let best = null, bestScore = Infinity;
    for (const e of state.enemies) {
      const d = dist(t.x,t.y, e.x,e.y);
      if (d > s.range) continue;
      const dCore = dist(e.x,e.y, CORE_POS.x, CORE_POS.y);
      const score = dCore*0.9 + d*0.25;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    const time = nowSec();
    const aim = best ? Math.atan2(best.y - t.y, best.x - t.x) : (time*0.65 + (t.x+t.y)*0.004);

    // muzzle flash hint (very short after a shot)
    const fireRate = (s.fireRate * state.mods.turretFireMul);
    const cdMax = fireRate > 0 ? (1 / fireRate) : 0.3;
    const flashWindow = 0.025;
    const flash = (t.cd > cdMax - flashWindow) ? 1 : 0;

    // shadow
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.ellipse(t.x, t.y + 14, 18, 6, 0, 0, Math.PI*2);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.restore();

    // body
    withTransform(t.x, t.y, 0, () => {
      // base plate
      ctx.save();
      ctx.fillStyle = "#0f172a";
      ctx.strokeStyle = "#2a3b52";
      ctx.lineWidth = 2;
      if (t.type === "slow") {
        polyPath(6, 16, Math.PI/6);
        ctx.fill();
        ctx.stroke();
      } else if (t.type === "splash") {
        roundRectPath(-16, -14, 32, 28, 6);
        ctx.fill();
        ctx.stroke();
      } else {
        // basic: octagon
        polyPath(8, 16, Math.PI/8);
        ctx.fill();
        ctx.stroke();
      }

      // core gem
      const g = ctx.createRadialGradient(0,-2, 2, 0,-2, 11);
      g.addColorStop(0, col);
      g.addColorStop(1, "#0b1220");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, -2, 9, 0, Math.PI*2);
      ctx.fill();

      // legs (three little fins)
      ctx.fillStyle = "#111826";
      for (let i=0;i<3;i++){
        const a = i*2*Math.PI/3 + Math.PI/6;
        withTransform(Math.cos(a)*13, Math.sin(a)*10 + 6, a, () => {
          ctx.beginPath();
          ctx.moveTo(-4, 0); ctx.lineTo(4, 0); ctx.lineTo(0, 6);
          ctx.closePath();
          ctx.fill();
        });
      }
      ctx.restore();

      // barrel / head
      withTransform(0, -2, aim, () => {
        ctx.save();
        ctx.fillStyle = "#1f2a3a";
        ctx.strokeStyle = "#3b4f6b";
        ctx.lineWidth = 2;

        if (t.type === "slow") {
          // twin barrel
          roundRectPath(2, -7, 16, 5, 2);
          ctx.fill(); ctx.stroke();
          roundRectPath(2,  2, 16, 5, 2);
          ctx.fill(); ctx.stroke();
          // snowflake mark
          ctx.globalAlpha = 0.9;
          ctx.strokeStyle = col;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(-6,0); ctx.lineTo(0,0);
          ctx.moveTo(-3,-5); ctx.lineTo(-1,-2);
          ctx.moveTo(-3, 5); ctx.lineTo(-1, 2);
          ctx.stroke();
        } else if (t.type === "splash") {
          // chunky launcher
          roundRectPath(1, -6, 18, 12, 3);
          ctx.fill(); ctx.stroke();
          // lens ring
          ctx.strokeStyle = col;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(19, 0, 5, 0, Math.PI*2); ctx.stroke();
        } else {
          // basic: single barrel
          roundRectPath(2, -4, 18, 8, 3);
          ctx.fill(); ctx.stroke();
          // front stripe
          ctx.globalAlpha = 0.9;
          ctx.strokeStyle = col;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(13, -3); ctx.lineTo(13, 3);
          ctx.stroke();
        }

        // muzzle flash
        if (flash) {
          // subtle muzzle glint (avoid noticeable blinking)
          ctx.globalAlpha = 0.18;
          ctx.fillStyle = (t.type === "slow") ? "#a7f3d0" : "#93c5fd";
          starPath(5, 4.5, 2.0, 0);
          ctx.translate(21, 0);
          ctx.fill();
        }
        ctx.restore();
      });

      // glow
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -2, 15, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();
    });
  }

  
    function drawFinalBossGlyph(e, hpR, time){
      const dr = (e.drawR || e.r);
      const c = clamp(state.core.finalCharge || 0, 0, 1);
      let phase = 1;
      if (hpR <= 0.70) phase = 2;
      if (hpR <= 0.35) phase = 3;
      const p2 = phase >= 2 ? 1 : 0;
      const p3 = phase >= 3 ? 1 : 0;
      const rage = clamp(1 - hpR, 0, 1);          // 0..1 as boss HP drops
      const flash = clamp(e.awakeFlash || 0, 0, 1); // 0..1 on phase change
      const spin = time*0.8*e.orbitDir;

      const wingExt  = (p2?10:0) + (p3?18:0) + rage*6;
      const crownExt = (p2?6:0)  + (p3?12:0) + rage*4;

      // -------- Outer aura (blue) --------
      ctx.save();
      ctx.globalAlpha = 0.14 + 0.24*c + 0.08*p2 + 0.12*p3;
      ctx.strokeStyle = "rgba(96,165,250,0.9)";
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(0,0, dr+18 + Math.sin(time*2.1+e.seedAng)*2.5, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();

      // -------- Awakening flash (phase change) --------
      if (flash > 0) {
        ctx.save();
        ctx.globalAlpha = 0.22*flash;
        ctx.strokeStyle = "rgba(236,72,153,0.95)";
        ctx.lineWidth = 18;
        ctx.beginPath();
        ctx.arc(0,0, dr+70 + (1-flash)*46, 0, Math.PI*2);
        ctx.stroke();
        ctx.globalAlpha = 0.16*flash;
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(0,0, dr+26 + (1-flash)*22, 0, Math.PI*2);
        ctx.stroke();
        ctx.restore();
      }

      // -------- Tech rings --------
      function ring(r, a, lw, col){
        ctx.save();
        ctx.globalAlpha = a;
        ctx.strokeStyle = col;
        ctx.lineWidth = lw;
        ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.stroke();
        ctx.restore();
      }
      ring(dr+10, 0.18 + 0.22*c, 2.5, "rgba(168,85,247,0.85)");
      ring(dr+24, 0.10 + 0.18*c + 0.10*p2, 1.6, "rgba(96,165,250,0.75)");

      // tick marks
      ctx.save();
      ctx.globalAlpha = 0.16 + 0.26*c + 0.12*p3;
      ctx.strokeStyle = p3 ? "rgba(236,72,153,0.8)" : "rgba(168,85,247,0.7)";
      ctx.lineWidth = 2;
      for (let i=0;i<16;i++){
        const a = spin*1.3 + i*(Math.PI*2/16);
        const r0 = dr+6, r1 = dr+18 + (p3?4:0);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a)*r0, Math.sin(a)*r0);
        ctx.lineTo(Math.cos(a)*r1, Math.sin(a)*r1);
        ctx.stroke();
      }
      ctx.restore();

      // extra ring layer in phase 2+
      if (p2) {
        ctx.save();
        ctx.globalAlpha = 0.10 + 0.22*c + 0.10*p3;
        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(0,0, dr+36 + Math.sin(time*2.7+e.seedAng)*1.4, 0, Math.PI*2);
        ctx.stroke();
        ctx.restore();
      }
      // phase 3 spiky ring
      if (p3) {
        ctx.save();
        ctx.globalAlpha = 0.10 + 0.22*c;
        ctx.strokeStyle = "rgba(236,72,153,0.55)";
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        for (let i=0;i<=36;i++){
          const a = spin*1.9 + i*(Math.PI*2/36);
          const rr = dr+42 + (i%2===0?7:1) + 3*Math.sin(time*4.0+i*0.6);
          const x = Math.cos(a)*rr, y = Math.sin(a)*rr;
          if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }

      // -------- Crown spikes --------
      ctx.save();
      ctx.globalAlpha = 0.22 + 0.28*c + 0.10*p3;
      ctx.strokeStyle = p3 ? "rgba(236,72,153,0.85)" : "rgba(168,85,247,0.85)";
      ctx.lineWidth = 3;
      const spikeN = 6;
      for (let i=0;i<spikeN;i++){
        const a = spin + i*(Math.PI*2/spikeN);
        const r0 = dr + 8;
        const r1 = dr + 24 + crownExt;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a)*r0, Math.sin(a)*r0);
        ctx.lineTo(Math.cos(a)*r1, Math.sin(a)*r1);
        ctx.stroke();
      }
      ctx.restore();

      // crown halo (phase 3)
      if (p3) {
        ctx.save();
        ctx.globalAlpha = 0.06 + 0.14*c + 0.08*rage;
        ctx.strokeStyle = "rgba(236,72,153,0.75)";
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.arc(0,0, dr+54 + 3*Math.sin(time*2.0+e.seedAng), 0, Math.PI*2);
        ctx.stroke();
        ctx.restore();
      }

      // -------- Wings (violet armor) --------
      for (const sign of [-1, 1]) {
        ctx.save();
        ctx.rotate(sign*0.04*Math.sin(time*2.2 + e.seedAng));
        ctx.globalAlpha = 0.18 + 0.28*c + 0.08*p2 + 0.10*p3;
        ctx.fillStyle = "rgba(168,85,247,0.35)";
        ctx.strokeStyle = "rgba(96,165,250,0.30)";
        ctx.lineWidth = 2.5;

        const tipX = sign*(dr+26+wingExt);
        const tipY = 0;

        ctx.beginPath();
        ctx.moveTo(sign*(dr*0.70), -dr*0.20);
        ctx.lineTo(sign*(dr+14+wingExt*0.45), -dr*0.55);
        ctx.lineTo(tipX, tipY);
        ctx.lineTo(sign*(dr+14+wingExt*0.45),  dr*0.55);
        ctx.lineTo(sign*(dr*0.70),  dr*0.20);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // wing veins
        ctx.globalAlpha = 0.20 + 0.30*c + 0.10*p3;
        ctx.strokeStyle = p3 ? "rgba(236,72,153,0.55)" : "rgba(168,85,247,0.55)";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(sign*(dr*0.86), 0);
        ctx.lineTo(sign*(dr+18+wingExt*0.60), 0);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sign*(dr*0.78), -dr*0.12);
        ctx.lineTo(sign*(dr+12+wingExt*0.45), -dr*0.34);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sign*(dr*0.78), dr*0.12);
        ctx.lineTo(sign*(dr+12+wingExt*0.45), dr*0.34);
        ctx.stroke();

        // extra feathers (phase 3)
        if (p3) {
          ctx.globalAlpha = 0.12 + 0.18*c;
          ctx.strokeStyle = "rgba(255,255,255,0.22)";
          ctx.lineWidth = 1.2;
          for (let k=0;k<3;k++){
            const t = (k+1)/4;
            ctx.beginPath();
            ctx.moveTo(sign*(dr*0.74), -dr*(0.22-0.12*k));
            ctx.lineTo(sign*lerp(dr*0.90, dr+26+wingExt, t), -dr*(0.62-0.14*k));
            ctx.stroke();
          }
        }

        ctx.restore();
      }

      // -------- Core body (gradient) --------
      ctx.save();
      const coreR = dr - 6;
      const g = ctx.createRadialGradient(-coreR*0.25, -coreR*0.25, 6, 0, 0, coreR);
      // violet -> pink blend in phase3
      const vA = (0.62+0.20*c);
      const vB = (0.55+0.25*c);
      const col0 = p3 ? ("rgba(236,72,153,"+vA+")") : ("rgba(168,85,247,"+vA+")");
      const col1 = p3 ? ("rgba(124,58,237,"+vB+")") : ("rgba(96,165,250,"+vB+")");
      g.addColorStop(0, col0);
      g.addColorStop(0.55, col1);
      g.addColorStop(1, "rgba(11,18,32,0.95)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0,0, coreR, 0, Math.PI*2);
      ctx.fill();

      // inner diamond
      ctx.globalAlpha = 0.55 + 0.25*c + 0.10*p3;
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -10); ctx.lineTo(10,0); ctx.lineTo(0,10); ctx.lineTo(-10,0); ctx.closePath();
      ctx.stroke();

      // cracks/glow (phase 3)
      if (p3) {
        ctx.globalAlpha = 0.10 + 0.22*c + 0.12*rage;
        ctx.strokeStyle = "rgba(96,165,250,0.85)";
        ctx.lineWidth = 1.2;
        for (let i=0;i<4;i++){
          const a = spin*1.6 + i*1.57 + Math.sin(time*1.3+i)*0.25;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a)*coreR*0.15, Math.sin(a)*coreR*0.15);
          ctx.lineTo(Math.cos(a)*coreR*0.95, Math.sin(a)*coreR*0.95);
          ctx.stroke();
        }
      }
      ctx.restore();

      // -------- Orbiting shards --------
      ctx.save();
      const shardN = 6 + (p2?3:0) + (p3?4:0);
      const shardR = dr + 34 + (p3?8:0);
      ctx.globalAlpha = 0.10 + 0.28*c + 0.10*p3;
      ctx.fillStyle = "rgba(96,165,250,0.85)";
      for (let i=0;i<shardN;i++){
        const a = spin*1.2 + i*(Math.PI*2/shardN) + Math.sin(time*1.4+i)*0.05;
        const px = Math.cos(a)*shardR;
        const py = Math.sin(a)*shardR;
        ctx.save();
        ctx.translate(px,py);
        ctx.rotate(a + Math.PI/2);
        ctx.beginPath();
        ctx.moveTo(0,-8);
        ctx.lineTo(6,8);
        ctx.lineTo(-6,8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();

      // -------- Lightning arcs (phase 3) --------
      if (p3) {
        ctx.save();
        ctx.globalAlpha = 0.08 + 0.16*c + 0.08*rage;
        ctx.strokeStyle = "rgba(236,72,153,0.75)";
        ctx.lineWidth = 2.2;
        for (let i=0;i<3;i++){
          const a = spin*1.7 + i*2.1;
          const r0 = dr+14;
          const r1 = dr+62 + 10*Math.sin(time*3+i);
          const x0 = Math.cos(a)*r0, y0 = Math.sin(a)*r0;
          const x1 = Math.cos(a+0.65)*r1, y1 = Math.sin(a+0.65)*r1;

          ctx.beginPath();
          ctx.moveTo(x0,y0);
          const steps = 6;
          for (let s=1;s<steps;s++){
            const tt = s/steps;
            const nx = lerp(x0,x1,tt) + Math.sin(time*12 + i*10 + s*2.2)*6*(1-tt);
            const ny = lerp(y0,y1,tt) + Math.cos(time*10 + i*9  + s*2.0)*6*(1-tt);
            ctx.lineTo(nx,ny);
          }
          ctx.lineTo(x1,y1);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

function drawEnemy(e){
    const hpR = clamp(e.hp / e.hpMax, 0, 1);
    const base = (e.color || "#94a3b8");
    const fill = e.elite ? "#f59e0b" : base;
    const time = nowSec();
    const toCore = Math.atan2(CORE_POS.y - e.y, CORE_POS.x - e.x);
    const wob = Math.sin(time*3 + e.seedAng) * 1.2;
    const rot = (e.kind === "shooter" || e.kind === "boss") ? (e.seedAng + time*0.9*e.orbitDir) : toCore;

    // elite aura
    if (e.elite) {
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 7, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }

    withTransform(e.x, e.y + wob, rot, () => {
      ctx.save();
      ctx.fillStyle = fill;
      ctx.strokeStyle = "#0b1220";
      ctx.lineWidth = 2;

      // FINAL BOSS (Wave 30): unique silhouette + animated aura
      if (e.kind === "boss" && e.isFinalBoss) {
        drawFinalBossGlyph(e, hpR, time);
        ctx.restore();
        return;
      }

      // silhouettes per type
      if (e.kind === "grunt") {
        // arrowhead
        ctx.beginPath();
        ctx.moveTo(e.r+6, 0);
        ctx.lineTo(-e.r, -e.r*0.85);
        ctx.lineTo(-e.r*0.55, 0);
        ctx.lineTo(-e.r, e.r*0.85);
        ctx.closePath();
      } else if (e.kind === "shooter") {
        // diamond + sight
        polyPath(4, e.r+2, Math.PI/4);
      } else if (e.kind === "shieldbreaker") {
        // spiky cutter
        starPath(7, e.r+5, e.r*0.55, 0);
      } else if (e.kind === "piercer") {
        // spear
        ctx.beginPath();
        ctx.moveTo(e.r+8, 0);
        ctx.lineTo(-e.r, -e.r*0.55);
        ctx.lineTo(-e.r*0.65, 0);
        ctx.lineTo(-e.r, e.r*0.55);
        ctx.closePath();
      } else if (e.kind === "bomber") {
        // pentagon (no more circle) + fuse
        polyPath(5, e.r+3, -Math.PI/2);
      } else if (e.kind === "boss") {
        // hex corebreaker
        polyPath(6, e.r+4, Math.PI/6);
      } else {
        polyPath(6, e.r, 0);
      }

      ctx.fill();
      ctx.stroke();

      // inner details (icons / markings)
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = e.elite ? "#fff7ed" : "#0b1220";
      ctx.lineWidth = 2;

      if (e.kind === "shooter") {
        // crosshair
        ctx.beginPath();
        ctx.moveTo(-6,0); ctx.lineTo(6,0);
        ctx.moveTo(0,-6); ctx.lineTo(0,6);
        ctx.stroke();
        ctx.strokeStyle = "rgba(11,18,32,0.65)";
        ctx.beginPath();
        ctx.arc(0,0, 7, 0, Math.PI*2);
        ctx.stroke();
      }

      if (e.kind === "shieldbreaker") {
        // shard mark
        ctx.strokeStyle = "#dbeafe";
        ctx.beginPath();
        ctx.moveTo(-5,-5); ctx.lineTo(0,-9); ctx.lineTo(5,-5);
        ctx.moveTo(-5,5); ctx.lineTo(0,9); ctx.lineTo(5,5);
        ctx.stroke();
      }

      if (e.kind === "piercer") {
        ctx.strokeStyle = "#ede9fe";
        ctx.beginPath();
        ctx.moveTo(-8,0); ctx.lineTo(2,0);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(2,-4); ctx.lineTo(8,0); ctx.lineTo(2,4);
        ctx.stroke();
      }

      if (e.kind === "bomber") {
        // hazard stripe
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = "#0b1220";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-8,-6); ctx.lineTo(8,6);
        ctx.moveTo(-8,6); ctx.lineTo(8,-6);
        ctx.stroke();
        ctx.restore();

        // fuse
        ctx.fillStyle = "#111826";
        roundRectPath(-3, -(e.r+10), 6, 10, 2);
        ctx.fill();
        ctx.fillStyle = "#fbbf24";
        starPath(5, 5, 2.5, time*2);
        ctx.translate(0, -(e.r+14));
        ctx.fill();
      }

      if (e.kind === "boss") {
        // inner gem
        const g = ctx.createRadialGradient(0,0, 2, 0,0, 14);
        g.addColorStop(0, "#fdf2f8");
        g.addColorStop(1, "rgba(11,18,32,0.9)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0,0, 12, 0, Math.PI*2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0,0, 12, 0, Math.PI*2);
        ctx.stroke();
      }

      ctx.restore();
    });

    // HP bar
    const br = (e.isFinalBoss ? (e.drawR || e.r) : e.r);
    const w = (e.isFinalBoss ? br*1.45 : e.r*2.4), h = (e.isFinalBoss ? 6 : 4);
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(e.x - w/2, (e.y + wob) - br - (e.isFinalBoss ? 20 : 14), w, h);
    ctx.fillStyle = e.elite ? "#fbbf24" : base;
    ctx.fillRect(e.x - w/2, (e.y + wob) - br - (e.isFinalBoss ? 20 : 14), w*hpR, h);
    ctx.restore();
  }

  function drawProjectile(p){
    const col = (p.kind==="enemy" ? "#fbbf24" : (p.slow>0 ? "#a7f3d0" : "#93c5fd"));
    const ang = Math.atan2(p.vy||0, p.vx||0);
    // turret shots: small bolt; enemy shots: sharp diamond
    if (p.kind === "turret") {
      withTransform(p.x, p.y, ang, () => {
        ctx.save();
        ctx.fillStyle = col;
        roundRectPath(-p.r*1.2, -p.r*0.55, p.r*2.6, p.r*1.1, p.r*0.55);
        ctx.fill();

        if (p.crit) {
          ctx.globalAlpha = 0.55;
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          roundRectPath(-p.r*1.35, -p.r*0.65, p.r*2.95, p.r*1.30, p.r*0.65);
          ctx.stroke();
        }

        ctx.globalAlpha = 0.35;
        ctx.fillStyle = "#ffffff";
        roundRectPath(-p.r*1.0, -p.r*0.30, p.r*1.2, p.r*0.60, p.r*0.30);
        ctx.fill();
        ctx.restore();
      });
    } else {
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
    }
  }

  function drawFx(f){
    const t = clamp(f.t / f.dur, 0, 1);

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
      const r = lerp(f.r0, f.r1, t);
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.65;
      ctx.beginPath();
      ctx.ellipse(f.x, f.y, r*1.05, r*0.95, 0, 0, Math.PI*2);
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 5;
      ctx.stroke();

      ctx.globalAlpha *= 0.8;
      ctx.beginPath();
      ctx.ellipse(f.x, f.y, r*0.78, r*0.68, 0, 0, Math.PI*2);
      ctx.strokeStyle = "#93c5fd";
      ctx.lineWidth = 2;
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
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = "#0e1624";
    ctx.fillRect(12, 12, 936, 44);
    ctx.strokeStyle = "#243040";
    ctx.lineWidth = 1;
    ctx.strokeRect(12, 12, 936, 44);

    const sx = 26, sy = 26;

    ctx.fillStyle = "#e6edf3";
    ctx.font = "900 14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`WAVE ${state.wave}  |  난이도 x${state.difficulty.toFixed(1)}`, sx, sy+4);

    const tt = TURRET_TYPES[state.selected];
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "800 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillText(`선택: ${tt.name} (비용 ${tt.cost}) — ${tt.desc}`, sx, sy+22);

    const barX = 610, barY = 22, barW = 325;
    drawBar(barX, barY,     barW, 10, state.core.hp/state.core.hpMax, "#93c5fd", "HP");
    drawBar(barX, barY+16,  barW, 10, state.core.shield/state.core.shieldMax, "#60a5fa", "보호막");

    const t = gameSec();
    const cdLeft = Math.max(0, state.core.aegisReadyAt - t);
    const repCdLeft = Math.max(0, state.core.repairReadyAt - t);
    const engCdLeft = Math.max(0, state.core.energyReadyAt - t);
    syncBackground();

    ctx.fillStyle = cdLeft>0 ? "#fbbf24" : "#a7f3d0";
    ctx.font = "900 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(cdLeft>0 ? `긴급 보호막 CD ${cdLeft.toFixed(1)}s` : `긴급 보호막 준비됨 (Space)`, barX+barW, barY+41);

    ctx.restore();
  }

  function drawBossHUD(){
    if (!(state.phase==="wave" && state.wave===FINAL_WAVE)) return;
    const boss = state.enemies.find(e=>e.kind==="boss");
    if (!boss) return;

    const ratio = (boss.hpMax>0) ? (boss.hp / boss.hpMax) : 0;
    const phase = (state.final && state.final.phase) ? state.final.phase : 1;

    const x = 12, y = 62, w = 936, h = 28;

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
    const b = document.body;
    if (!b) return;
    b.classList.remove("bg-off","bg-low","bg-high","bg-final");
    const m = state.ui && typeof state.ui.bgMode === "number" ? state.ui.bgMode : 1;
    b.classList.add(m===0 ? "bg-off" : (m===2 ? "bg-high" : "bg-low"));
    const isFinal = (state.wave >= FINAL_WAVE) || (state.phase === "finalprep");
    if (isFinal) b.classList.add("bg-final");
  }

function refreshUI(){
    const tt = TURRET_TYPES[state.selected];
    const t = gameSec();
    const cdLeft = Math.max(0, state.core.aegisReadyAt - t);
    const repCdLeft = Math.max(0, state.core.repairReadyAt - t);
    const engCdLeft = Math.max(0, state.core.energyReadyAt - t);
    syncBackground();

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
        const hpFrac = state.core.hpMax>0 ? (state.core.hp/state.core.hpMax) : 1;
        const tO = clamp((0.40 - hpFrac) / 0.30, 0, 1);
        passiveBadge = `<span class="badge ${d.colorClass}">패시브: ${d.name} (과부하 ${(tO*100)|0}%)<\/span> `;
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

uiStats.innerHTML =
      `<span class="badge">Wave ${state.wave}</span> ` +      `<span class="badge">HP ${Math.ceil(state.core.hp)}/${state.core.hpMax}</span> ` +
      `<span class="badge">보호막 ${Math.ceil(state.core.shield)}/${state.core.shieldMax}</span> ` +
      `<span class="badge">방어 ${hpArmorText}</span> ` +
      `<span class="badge">보호막방어 ${shArmorText}</span> ` +
      passiveBadge +
      `<span class="badge">배속 ${state.speed.toFixed(1)}x</span> ` +
      `<span class="badge">${state.cheat ? "치트 ON" : "치트 OFF"}</span>`;

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
        btnEnergy.disabled = (state.phase !== 'wave') || (engCdLeft>0) || !(state.enemies && state.enemies.length);
        btnEnergy.textContent = engCdLeft>0 ? `에너지포 (${engCdLeft.toFixed(1)}s)` : `에너지포 (1000)`;
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
        ? "치트키: T=토글, K=크리스탈+500, H=HP풀, J=보호막풀, B=적삭제, N=웨이브스킵, U=업글MAX, G=무적"
        : "";
    }


    if (uiPreview) {
      const w = state.wave;
      const spec = waveSpec(w);
      const label = (state.phase === "wave") ? "현재 웨이브" : "다음 웨이브";
      const list = [];
      list.push(ENEMY_ARCH.grunt.name);
      if (w >= 2) list.push(ENEMY_ARCH.shooter.name);
      if (w >= 3) list.push(ENEMY_ARCH.shieldbreaker.name);
      if (w >= 4) list.push(ENEMY_ARCH.piercer.name);
      if (w >= 6) list.push(ENEMY_ARCH.bomber.name);

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
    wire.cachedColors = [];
    wire.thY = [];
    wire.thR = [];
    wire.oneYellowIdx = -1;
  }

  function buildWireSegments(cx, cy, s){
    const P = (nx,ny)=>({x: cx + nx*s, y: cy + ny*s});

    // (코어 아이콘 기준) 결정 + 양 날개 + 이중 바(가로 프레임)
    const crystal = [P(0,-1.10),P(0.52,-0.42),P(0.48,0.55),P(0,1.14),P(-0.48,0.55),P(-0.52,-0.42)];

    const leftW   = [P(-1.10,-0.75),P(-1.42,-0.08),P(-1.30,0.62),P(-1.00,1.02),P(-0.82,0.72),P(-0.98,0.16),P(-0.86,-0.38)];
    const rightW  = [P(1.10,-0.75),P(1.42,-0.08),P(1.30,0.62),P(1.00,1.02),P(0.82,0.72),P(0.98,0.16),P(0.86,-0.38)];

    // 이중 가로 바(외곽 프레임용) — 두 줄
    const barA = [P(-1.10,-0.08),P(1.10,-0.08),P(1.10,0.02),P(-1.10,0.02)];
    const barB = [P(-1.10,0.10),P(1.10,0.10),P(1.10,0.20),P(-1.10,0.20)];

    const cracks = [
      [P(0,-0.85),P(0.16,-0.50)],
      [P(0.16,-0.50),P(0.02,-0.18)],
      [P(0.02,-0.18),P(0.20,0.20)],
      [P(-0.16,-0.55),P(0,-0.36)],
      [P(0,-0.36),P(-0.10,0.08)],
      [P(-0.10,0.08),P(0.06,0.60)],
    ];

    function polySeg(poly){
      const out = [];
      for (let i=0;i<poly.length;i++){
        const a = poly[i], b = poly[(i+1)%poly.length];
        out.push([a,b]);
      }
      return out;
    }

    return {
      outlinePolys: [crystal, leftW, rightW, barA, barB],
      segs: [
        ...polySeg(crystal),
        ...polySeg(leftW),
        ...polySeg(rightW),
        ...polySeg(barA),
        ...polySeg(barB),
        ...cracks
      ]
    };
  }

  function wireEnsureGeometry(){
    // ✅ 세그먼트가 있으나 캐시 길이가 안 맞으면 재초기화(검정선 방지)
    if (wire.segs && wire.cachedColors.length === wire.segs.length && wire.thY.length === wire.segs.length) return;

    const ww = wireCanvas.width, wh = wireCanvas.height;
    const cx = ww*0.5, cy = wh*0.55;
    const s  = Math.min(ww,wh) * (detectMobile() ? 0.32 : 0.38);

    const shape = buildWireSegments(cx,cy,s);
    wire.segs = shape.segs;
    wire.outlinePolys = shape.outlinePolys;

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
    if (shieldRatio > 0.001) {
      const lw = shieldLW(shieldRatio);
      wctx.save();
      wctx.globalAlpha = 0.25 + 0.55*shieldRatio;
      wctx.shadowColor = "rgba(80,220,255,0.65)";
      wctx.shadowBlur  = 10 + 14*shieldRatio;
      for (const poly of wire.outlinePolys) wStrokePoly(poly, SB, lw, 1);
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
