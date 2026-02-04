// AUTO-SPLIT PART 07
      ctx.fill();

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
      ctx.strokeStyle = (e.eliteColor || "#fbbf24");
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 8, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }



    // supporter pulse aura
    if (e.kind === "supporter" && (e.supportFx||0) > 0) {
      ctx.save();
      const p = clamp((e.supportFx||0) / 0.32, 0, 1);
      ctx.globalAlpha = 0.10 + 0.28*p;
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 10 + 6*(1-p), 0, Math.PI*2);
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
      } else if (e.kind === "supporter") {
        // support drone: circle
        ctx.beginPath();
        ctx.arc(0,0, e.r+3, 0, Math.PI*2);
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


      if (e.kind === "supporter") {
        ctx.strokeStyle = "#bae6fd";
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-8,0); ctx.lineTo(8,0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0,-8); ctx.lineTo(0,8); ctx.stroke();
        ctx.globalAlpha = 0.30;
        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.beginPath(); ctx.arc(0,0, e.r*0.90, time*0.8, time*0.8 + Math.PI*1.2); ctx.stroke();
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
    let col = (p.kind==="enemy" ? (p.projCol||"#fbbf24") : (p.slow>0 ? "#a7f3d0" : "#93c5fd"));
    // Overload burst: red tone + short trail
    if (p.kind === "turret" && p.ovBurst) col = "#fb7185";
    const ang = Math.atan2(p.vy||0, p.vx||0);
    if (p.kind === "turret" && p.ovBurst) {
      const tx = p.x - (p.vx||0) * 0.03;
      const ty = p.y - (p.vy||0) * 0.03;
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = "rgba(251,113,133,0.8)";
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(tx,ty);
      ctx.lineTo(p.x,p.y);
      ctx.stroke();
      ctx.restore();
    }
    // turret shots: small bolt; enemy shots: sharp diamond
    if (p.kind === "turret") {
      withTransform(p.x, p.y, ang, () => {
        ctx.save();
        ctx.fillStyle = col;
        roundRectPath(-p.r*1.2, -p.r*0.55, p.r*2.6, p.r*1.1, p.r*0.55);
        ctx.fill();
