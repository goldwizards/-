// AUTO-SPLIT PART 03
    const denom = Math.max(1, c.shieldMax * RESONANCE_CFG.denomMul);
    let add = (absAmt / denom) * 100;

    // HP 직격/실드 파괴 페널티는 '게이지 감소'가 아니라 '충전 효율 감소'
    let mul = 1.0;
    if (t < (c.resChargePenaltyHpUntil||0)) mul = Math.min(mul, 0.55);
    if (t < (c.resChargePenaltyBreakUntil||0)) mul = Math.min(mul, 0.35);
    add *= mul;

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
    const c = state.core;
    const t = gameSec();
    c.resChargePenaltyHpUntil = Math.max((c.resChargePenaltyHpUntil||0), t + 6.0);
  }

  function resonancePenaltyBreak(){
    if (state.core.passiveId !== 'resonance') return;
    resonanceEnsure();
    const c = state.core;
    const t = gameSec();
    c.resChargePenaltyBreakUntil = Math.max((c.resChargePenaltyBreakUntil||0), t + 3.0);
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
    if (!target) { c.resDischargeReadyAt = t + RESONANCE_CFG.dischargeCd; return; }

    resonancePrune();
    const recent = resonanceRecentAbsSum();

    // 메인 데미지(최근 3초 흡수량 기반)
    let dmg = recent * RESONANCE_CFG.dischargeMul;
    const cap = c.shieldMax * RESONANCE_CFG.dischargeCapMul;
    dmg = Math.min(dmg, cap);

    // 최종보스 내성 로직만 적용(추가 감쇄 없음)
    if (target.isFinalBoss) dmg *= finalBossIncomingMul();

    const mainDmg = dmg;

    // 메인 타격 + 노출
    target.hp -= mainDmg;
    applyResExpose(target, 3.2);

    // 주변 확산 피해(190px)
    const R = 190;
    for (const e of state.enemies) {
      if (!e || e.hp <= 0 || e === target) continue;
      const d = dist(e.x, e.y, target.x, target.y);
      if (d > R) continue;
      const k = clamp(d / R, 0, 1);
      const fall = lerp(1.0, 0.35, k); // edge => 0.35
      let sdmg = mainDmg * 0.35 * fall; // center 0.35, edge 0.1225
      if (e.isFinalBoss) sdmg *= finalBossIncomingMul();
      e.hp -= sdmg;
      applyResExpose(e, 3.2);
    }

    // 연출: 다중 빔(2겹) + 링 2중 + 화면 플래시 + 카메라 흔들림
    fxLine(CORE_POS.x, CORE_POS.y, target.x, target.y, '#fb923c', 0.55, 10);
    fxLine(CORE_POS.x, CORE_POS.y, target.x, target.y, '#fdba74', 0.55, 3);
    fxRing(CORE_POS.x, CORE_POS.y, CORE_RADIUS+12, CORE_RADIUS+170, '#fdba74');
    fxRing(target.x, target.y, 10, 120, '#fdba74');
    fxRing(target.x, target.y, 16, 160, '#fb923c');

    fxText(`공명 방출! -${Math.round(mainDmg)}`, CORE_POS.x, CORE_POS.y - 128, '#fdba74');

    state.resFlashX = target.x;
    state.resFlashY = target.y;
    state.resFlashDur = 0.16;
    state.resFlashUntil = t + state.resFlashDur;

    state.camShakeMag = 10;
    state.camShakeDur = 0.11;
    state.camShakeUntil = t + state.camShakeDur;

    try { SFX.play('blast'); } catch {}
    try { sfxShieldHit(); } catch {}

    // 끊김 완화: 0이 아니라 25% 남김
    c.resGauge = 25;
    c.resDischargeReadyAt = t + RESONANCE_CFG.dischargeCd;
  }

  function updateResonance(dt){
    if (state.core.passiveId !== 'resonance') return;
    resonanceEnsure();
    const c = state.core;
    const t = gameSec();
    resonancePrune();

    // 흡수 공백 후 감쇠 (최종전은 유지시간을 조금 더 늘려 체감 강화)
    const since = t - (c.resLastAbsorbAt||-999);
    const isFinal = (state.wave === FINAL_WAVE);
    const decayWait = isFinal ? (RESONANCE_CFG.decayWait + 1.0) : RESONANCE_CFG.decayWait;
    const decayPerSec = isFinal ? (RESONANCE_CFG.decayPerSec * 0.60) : RESONANCE_CFG.decayPerSec;
    if (since > decayWait && (c.resGauge||0) > 0) {
      c.resGauge = clamp((c.resGauge||0) - decayPerSec*dt, 0, 100);
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

    // 임계 과부하 누적 상태 리셋
    state.core.overloadBurstUntil = 0;
    state.core.overloadBurstReadyAt = 0;
    state.core.overloadWasAbove30 = true;
    state.core.overloadExtendReadyAt = 0;
    state.core.overloadKickReadyAt = 0;

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
  let lastUpgHandledAt = 0;
  const handleUpg = (ev) => {
    const now = performance.now();
    if (ev.type === "click" && (now - lastUpgHandledAt) < 350) return;
    lastUpgHandledAt = now;
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

  for (const el of upgContainers) {
    el.addEventListener("pointerdown", handleUpg, { capture:true });
    el.addEventListener("click", handleUpg, { capture:true });
  }
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
  const mbEnergy = document.getElementById("mbEnergy");

  
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
      // Mobile default: show wire panel
      setWireVisible(true);
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
  if (mbEnergy) mbEnergy.onclick = ()=> { ensureAudio(); tryEnergyCannon(); };
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
    if (e.code === "Digit2") {
      if (state.phase === "wave") {
        tryEnergyCannon();
      } else {
        state.selected = "slow";
        SFX.play("click");
      }
    }
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
