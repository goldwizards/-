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
      
      // 포탑 진화(집중): 보스 피해 보너스
      if ((p.bossMul||1) !== 1 && (target.kind === "boss" || target.isFinalBoss)) dmg *= (p.bossMul||1);
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
