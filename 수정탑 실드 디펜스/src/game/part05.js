// AUTO-SPLIT PART 05
    });

    fxRing(t.x,t.y, 6, 26, "#a7f3d0");

    sfxShoot();
  }

  
  function enemyShoot(e){
    const dx = CORE_POS.x - e.x, dy = CORE_POS.y - e.y;
    const d = Math.hypot(dx,dy) || 1;
    const sp = e.projSpd || 320;

    if (state.projectiles.length >= projCap()) return;

    const isOvBurst = (state.core.passiveId === "overload") && overloadBurstActive();

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
    // 임계 과부하: 포탑 적중 시 표식(최대 5중첩/4s)
    if (p.kind === "turret" && state.core.passiveId === "overload") {
      applyOverloadMark(hit, 1);
    }
    let dmg = p.dmg;
    dmg *= enemyExposeMul(hit);
    // 과부하 표식: 받는 피해 증가
    if (state.core.passiveId === "overload") dmg *= (1 + overloadMarkBonus(hit));
    // 최종보스: 포탑 내성 (버스트 중 25% 부분 무시)
    if (p.kind === "turret" && hit.isFinalBoss) {
      let mul = finalBossIncomingMul();
      if (state.core.passiveId === "overload" && p.ovBurst) {
        mul = mul + (1 - mul) * OVERLOAD_CFG.finalBossResistIgnore;
      }
      dmg *= mul;
    }

    const tNow = nowSec();
    if (tNow < (hit.resExposeUntil||0)) {
      const m = (hit.kind === "boss") ? RESONANCE_CFG.dischargeExposeMulBoss : RESONANCE_CFG.dischargeExposeMul;
      dmg *= m;
    }

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
          cdmg *= enemyExposeMul(best);
          if (state.core.passiveId === "overload") cdmg *= (1 + overloadMarkBonus(best));
          if (best.isFinalBoss) {
            let mulB = finalBossIncomingMul();
            if (state.core.passiveId === "overload" && p.ovBurst) mulB = mulB + (1 - mulB) * OVERLOAD_CFG.finalBossResistIgnore;
            cdmg *= mulB;
          }
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
          sdmg *= enemyExposeMul(e);
          if (state.core.passiveId === "overload") sdmg *= (1 + overloadMarkBonus(e));
          if (e.isFinalBoss) {
            let mulF = finalBossIncomingMul();
            if (state.core.passiveId === "overload" && p.ovBurst) mulF = mulF + (1 - mulF) * OVERLOAD_CFG.finalBossResistIgnore;
            sdmg *= mulF;
          }
          e.hp -= sdmg;
        }
      }
      fxRing(p.x,p.y, 8, p.splash, "#93c5fd");
    } else {
      fxRing(p.x,p.y, 6, 36, "#93c5fd");
    }

    // 임계 과부하: 버스트 중(스플래시 없는 포탑) 소형 폭발 90px / 35% 피해
    if (p.ovMiniSplash) {
      const R2 = OVERLOAD_CFG.miniSplashR;
      for (const e2 of state.enemies) {
        if (!e2 || e2===hit) continue;
        if (p.hitSet && p.hitSet.has(e2)) continue;
        const d2 = dist(p.x,p.y, e2.x,e2.y);
        if (d2 > R2) continue;
        let mdmg = p.dmg * OVERLOAD_CFG.miniSplashMul;
        mdmg *= enemyExposeMul(e2);
        if (state.core.passiveId === "overload") mdmg *= (1 + overloadMarkBonus(e2));
        if (e2.isFinalBoss) {
          let mulX = finalBossIncomingMul();
          if (state.core.passiveId === "overload" && p.ovBurst) mulX = mulX + (1 - mulX) * OVERLOAD_CFG.finalBossResistIgnore;
          mdmg *= mulX;
        }
        if (tNow < (e2.resExposeUntil||0)) {
          const m4 = (e2.kind === "boss") ? RESONANCE_CFG.dischargeExposeMulBoss : RESONANCE_CFG.dischargeExposeMul;
          mdmg *= m4;
        }
        e2.hp -= mdmg;
      }
      fxRing(p.x,p.y, 10, R2, "#fb7185");
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
