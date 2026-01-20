// AUTO-SPLIT PART 04/8 (lines 2311-3080)
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

    const dmg = (state.core.energyDmg || 800);
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
