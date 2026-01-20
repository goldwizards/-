// AUTO-SPLIT PART 06

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
    state.upg = { coreHp:0, coreShield:0, hpArmor:0, shieldArmor:0, shieldRegen:0, energyCannon:0, repair:0, turretDmg:0, turretFire:0, turretRange:0, slowPower:0, splashRadius:0, projSpeed:0, turretCrit:0, slowDuration:0, sellRefund:0, aegisTune:0, waveShield:0 };
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

    // explosion flash on top
    drawBlueExplosionFlash();
    drawResonanceScreenFlash();

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
