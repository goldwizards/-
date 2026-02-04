
(function(){
  // If boot flag didn't set, show a visible error for mobile local file restrictions.
  setTimeout(function(){
    if(!window.__CBD_BOOT_OK){
      var d=document.createElement('div');
      d.style.cssText='position:fixed;left:10px;right:10px;top:10px;z-index:99999;background:rgba(140,0,0,0.92);color:#fff;padding:10px 12px;border-radius:10px;font-weight:700;box-shadow:0 10px 30px rgba(0,0,0,0.45);';
      d.textContent='스크립트 로드 실패: 압축을 풀고 폴더째로 열어주세요. (Android에서는 content://로 열면 외부 JS가 막힐 수 있어 인라인 버전을 사용합니다)';
      document.body.appendChild(d);
    }
  }, 1200);
})();
