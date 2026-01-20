// AUTO-SPLIT PART 08

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
      const r = f.r0;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = (1 - t) * 0.6;
      ctx.shadowColor = "#7dd3fc";
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r*0.9, 0, Math.PI*2);
      ctx.fillStyle = "rgba(125,211,252,0.22)";
      ctx.fill();

      ctx.globalAlpha = (1 - t) * 0.35;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r*0.6, 0, Math.PI*2);
      ctx.fillStyle = "rgba(224,242,254,0.25)";
      ctx.fill();
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
    // NOTE: Page-wide background is disabled. The [배경] button controls the battlefield (canvas) only.
    // Keep the state flag only; no DOM class toggles.
    return;
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
        const tNow = gameSec();
        const hpFrac = state.core.hpMax>0 ? (state.core.hp/state.core.hpMax) : 1;
        const tO = clamp((0.40 - hpFrac) / 0.30, 0, 1);

        // 버스트/쇼크 상태
        overloadEnsure();
        const burstOn = (tNow < (state.core.overloadBurstUntil||0));
        const burstLeft = Math.max(0, (state.core.overloadBurstUntil||0) - tNow);
        const cdLeft = Math.max(0, (state.core.overloadBurstReadyAt||0) - tNow);
        const burstInfo = burstOn ? `버스트 ${burstLeft.toFixed(1)}s` : (cdLeft>0.05 ? `쿨 ${cdLeft.toFixed(1)}s` : `READY`);

        // 현재 필드 표식 최대 중첩(만료된 표식 제외)
        let maxSt = 0;
        for (const e of state.enemies) {
          if (!e) continue;
          if (tNow < (e.ovMarkUntil||0)) maxSt = Math.max(maxSt, (e.ovMarkStacks||0));
        }
        const markInfo = `표식 ${maxSt}/${OVERLOAD_CFG.markMax}`;

        passiveBadge = `<span class="badge ${d.colorClass}">패시브: ${d.name} (과부하 ${(tO*100)|0}% | ${burstInfo} | ${markInfo})<\/span> `;
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
        const charging = !!state.core.energyCharging;
        const chargeLeft = charging ? Math.max(0, state.core.energyChargeUntil - t) : 0;
        const hasTargetNow = !!(state.enemies && state.enemies.some(e=>e && e.hp > 0));
        btnEnergy.disabled = (state.phase !== 'wave') || charging || (engCdLeft>0) || !hasTargetNow;
        btnEnergy.textContent = charging
          ? `에너지포 충전 (${chargeLeft.toFixed(1)}s)`
          : (engCdLeft>0 ? `에너지포 (${engCdLeft.toFixed(1)}s)` : `에너지포 (${Math.round(state.core.energyDmg||800)})`);
      }

      if (mbEnergy){
        const inWave = (state.phase === 'wave');
        const charging = !!state.core.energyCharging;
        const chargeLeft = charging ? Math.max(0, state.core.energyChargeUntil - t) : 0;
        const hasTarget = !!(state.enemies && state.enemies.some(e=>e && e.hp > 0));
        const canUseEnergy = inWave && !charging && (engCdLeft <= 0) && hasTarget;
        mbEnergy.disabled = !canUseEnergy;
        const sp = mbEnergy.querySelector('span');
        if (sp) sp.textContent = '에너지포';
        const sm = mbEnergy.querySelector('small');
        if (sm){
          if (!inWave) sm.textContent = '웨이브';
          else if (charging) sm.textContent = `충전 ${Math.ceil(chargeLeft)}s`;
          else if (!hasTarget) sm.textContent = '대상없음';
          else if (engCdLeft > 0) sm.textContent = `${Math.ceil(engCdLeft)}s`;
          else sm.textContent = String(Math.round(state.core.energyDmg||800));
        }
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
