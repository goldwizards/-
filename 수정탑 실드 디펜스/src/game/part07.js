// AUTO-SPLIT PART 07/8 (lines 4621-5390)
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
