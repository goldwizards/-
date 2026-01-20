// AUTO-SPLIT PART 02
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
  bgMode: 1,
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
      energyCannon: 0,
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
      shieldMax: 300, shield: 300,
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


      energyDmg: 800,
      energyChargeDur: 3.0,
      energyCharging: false,
      energyChargeStartAt: 0,
      energyChargeUntil: 0,
      energyChargeFxAt: 0,
      energyLock: null,
      aegisCd: 18.0,
      aegisReadyAt: 0,
      aegisActiveUntil: 0,

      // ----- Overload (임계 과부하) burst/mark -----
      overloadBurstUntil: 0,
      overloadBurstReadyAt: 0,
      overloadWasAbove30: true,
      overloadExtendReadyAt: 0,
      overloadKickReadyAt: 0,
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
    // 에너지포(스킬) 기본값
    energyDmg: state.core.energyDmg,
    energyChargeDur: state.core.energyChargeDur,
    energyCd: state.core.energyCd,
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

    // 에너지포 업그레이드(선택 A): 피해 +100 → 충전 -0.4s → 쿨 -5s 반복 (총 6레벨)
    { id:"energyCannon", cat:"core", name:"에너지포 개량", max:6, base:95, grow:1.62,
      desc:(lv)=>{
        const steps = [
          `피해 +100 (800→900)`,
          `충전 -0.4s (3.0→2.6)`,
          `쿨 -5s (40→35)`,
          `피해 +100 (900→1000)`,
          `충전 -0.4s (2.6→2.2)`,
          `쿨 -5s (35→30)`
        ];
        const i = clamp((lv|0) - 1, 0, steps.length - 1);
        return steps[i];
      },
      apply(){
        const lv = (state.upg.energyCannon|0);

        // 기본값
        let dmg = CORE_BASE.energyDmg;
        let charge = CORE_BASE.energyChargeDur;
        let cd = CORE_BASE.energyCd;

        if (lv >= 1) dmg = CORE_BASE.energyDmg + 100;
        if (lv >= 4) dmg = CORE_BASE.energyDmg + 200;

        if (lv >= 2) charge = CORE_BASE.energyChargeDur - 0.4;
        if (lv >= 5) charge = CORE_BASE.energyChargeDur - 0.8;

        if (lv >= 3) cd = CORE_BASE.energyCd - 5;
        if (lv >= 6) cd = CORE_BASE.energyCd - 10;

        state.core.energyDmg = dmg;
        state.core.energyChargeDur = Math.max(1.2, charge);
        state.core.energyCd = Math.max(8, cd);
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
    state.ui = { upgTab:"all", upgSearch:"", upgOnlyCanBuy:false, upgSortMode:0, upgCollapse:{core:false,turret:false,util:false}, upgPanelCollapsed:{pc:false, side:false} };
  }
  if (!state.ui.upgCollapse) state.ui.upgCollapse = { core:false, turret:false, util:false };
  if (!state.ui.upgPanelCollapsed) state.ui.upgPanelCollapsed = { pc:false, side:false };
  if (!("upgOnlyCanBuy" in state.ui)) state.ui.upgOnlyCanBuy = false;
  if (!("upgSortMode" in state.ui)) state.ui.upgSortMode = 0;
  if (!state.ui.upgTab) state.ui.upgTab = "all";
  if (state.ui.upgSearch == null) state.ui.upgSearch = "";
  if (!("pc" in state.ui.upgPanelCollapsed)) state.ui.upgPanelCollapsed.pc = false;
  if (!("side" in state.ui.upgPanelCollapsed)) state.ui.upgPanelCollapsed.side = false;
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

  const panels = [
    { key: "pc", el: document.getElementById("upgPanelPC") },
    { key: "side", el: document.getElementById("upgPanelSide") },
  ];
  for (const { key, el } of panels) {
    if (!el) continue;
    const collapsed = !!(ui.upgPanelCollapsed && ui.upgPanelCollapsed[key]);
    el.classList.toggle("collapsed", collapsed);
    const btn = el.querySelector(`[data-upg-panel-toggle="${key}"]`);
    if (btn) {
      btn.textContent = collapsed ? "펼치기" : "접기";
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
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

      const rowClass = canBuy ? "upgRow canBuy" : "upgRow disabled";
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
const upgPanelPC = document.getElementById("upgPanelPC");
const upgPanelSide = document.getElementById("upgPanelSide");
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

      const panelBtn = ev.target.closest("[data-upg-panel-toggle]");
      if (panelBtn) {
        ev.preventDefault(); ev.stopPropagation();
        ensureUpgUI();
        const key = panelBtn.dataset.upgPanelToggle;
        if (key) {
          state.ui.upgPanelCollapsed[key] = !state.ui.upgPanelCollapsed[key];
          window.__upgLastRenderAt = 0;
          refreshUI();
        }
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

document.addEventListener("keydown", (ev)=>{
  if (ev.key !== "/") return;
  if (ev.target && (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA")) return;
  ensureUpgUI();
  const pickSearch = () => {
    if (upgPanelPC && !state.ui.upgPanelCollapsed.pc && upgPanelPC.offsetParent) {
      const input = upgPanelPC.querySelector("[data-upg-search]");
      if (input) return input;
    }
    if (upgPanelSide && !state.ui.upgPanelCollapsed.side && upgPanelSide.offsetParent) {
      const input = upgPanelSide.querySelector("[data-upg-search]");
      if (input) return input;
    }
    return document.querySelector("[data-upg-search]");
  };
  const input = pickSearch();
  if (input) {
    ev.preventDefault();
    input.focus();
  }
});

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
        "방출 시 주변 확산 피해 + ‘노출’(받는 피해↑) 디버프가 걸립니다.",
        "HP 직격/실드 파괴 시 일정 시간 게이지 충전 효율이 감소합니다."
      ]
    },
    overload: {
      id:"overload", name:"임계 과부하", colorClass:"passiveRed",
      desc:[
        "HP 30%↓ 진입 시(내려올 때) 쇼크웨이브(넉백+둔화 0.6s) + 과부하 버스트 6s 발동 (쿨 18s)",
        "포탑 적중 시 표식(최대 5중첩/4s 갱신): 일반/엘리트 +3%p×중첩, 보스/최종보스 +1.5%p×중첩",
        "버스트 6초: 포탑 탄 관통 +1 / (스플래시 없는 포탑은) 90px 소형 폭발(35%) 추가",
        "버스트 6초: 최종보스 ‘포탑 내성’ 25% 부분 무시 + 투사체 붉은 트레일",
        "연계: HP≤40% 수리 시 주변 적(보스 우선) 표식 +2 / 버스트 남은 <2s면 +2s 연장(20s ICD) / 긴급 보호막 사용 시 다음 쿨 -6s(20s ICD)"
]
    },
    overdrive: {
      id:"overdrive", name:"코어 오버드라이브", colorClass:"passivePurple",
      desc:[
        "수정탑이 직접 적을 공격합니다.",
        "HP가 낮을수록 공격 속도와 공격력이 증가합니다.",
        "저체력 구간에서 보호막 재생이 증가합니다.",
        "저체력일수록 받는 피해가 소폭 감소합니다.",
        "에너지포가 광역 피해(30%)를 추가로 입힙니다."
      ]
    }
  };

  // ---------- Resonance core (공명 반격) ----------
  const RESONANCE_CFG = {
    // ✅ 공명 버프: 게이지 유지시간 증가 + 충전 효율 기반 페널티(HP 직격/실드 파괴)
    denomMul: 0.40,        // shieldMax * 0.40 를 100% 기준 흡수량으로(조금 더 잘 참)
    hitCap: 30,            // 1회 충전 상한(+%)
    secCap: 60,            // 1초 충전 상한(+%)
    decayWait: 4.0,        // 흡수 공백(초)
    decayPerSec: 4.0,      // 공백 이후 초당 감소(%p)
    dischargeCd: 2.5,      // 방출 쿨(초)
    dischargeMul: 0.45,    // 최근 흡수량의 45%
    dischargeCapMul: 1.50  // shieldMax * 1.50 상한
  };

  // ---------- Overload core (임계 과부하) ----------
  const OVERLOAD_CFG = {
    triggerHp: 0.30,
    shockR: 240,
    shockKnock: 78,
    shockSlowDur: 0.6,
    shockSlowMul: 0.55,
    burstDur: 6.0,
    burstCd: 18.0,

    markMax: 5,
    markDur: 4.0,
    markBonus: 0.03,       // normal/elite
    markBonusBoss: 0.015,  // boss/final

    burstPierceAdd: 1,
    miniSplashR: 90,
    miniSplashMul: 0.35,

    finalBossResistIgnore: 0.25,

    repairMarkHp: 0.40,
    repairMarkAdd: 2,
    repairMarkTargets: 4,

    extendIfRemainLt: 2.0,
    extendAdd: 2.0,
    extendIcd: 20.0,

    aegisCdReduce: 6.0,
    aegisIcd: 20.0,
  };


  function resonanceEnsure(){
    const c = state.core;
    if (typeof c.resGauge !== 'number') c.resGauge = 0;
    if (typeof c.resLastAbsorbAt !== 'number') c.resLastAbsorbAt = -999;
    if (typeof c.resChargeSecStartAt !== 'number') c.resChargeSecStartAt = gameSec();
    if (typeof c.resChargeThisSec !== 'number') c.resChargeThisSec = 0;
    if (typeof c.resDischargeReadyAt !== 'number') c.resDischargeReadyAt = 0;
    // HP 직격/실드 파괴 페널티: 게이지 감소가 아니라 '충전 효율' 감소
    if (typeof c.resChargePenaltyHpUntil !== 'number') c.resChargePenaltyHpUntil = 0;
    if (typeof c.resChargePenaltyBreakUntil !== 'number') c.resChargePenaltyBreakUntil = 0;
    if (!Array.isArray(c.resAbsorbEvents)) c.resAbsorbEvents = [];
    // 충전 효율 페널티(HP 직격/실드 파괴)
    if (typeof c.resChargeHpUntil !== 'number') c.resChargeHpUntil = 0;
    if (typeof c.resChargeBreakUntil !== 'number') c.resChargeBreakUntil = 0;
  }

  function resonanceReset(){
    const c = state.core;
    c.resGauge = 0;
    c.resLastAbsorbAt = -999;
    c.resChargeSecStartAt = gameSec();
    c.resChargeThisSec = 0;
    c.resDischargeReadyAt = 0;
    c.resAbsorbEvents = [];
    c.resChargePenaltyHpUntil = 0;
    c.resChargePenaltyBreakUntil = 0;
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
