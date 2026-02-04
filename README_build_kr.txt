수정탑 실드 디펜스 - 코드 파일 분리 버전

- 실행: index.html 더블클릭(기존과 동일)
- 실제 실행 JS: js/game.js
- 편집용 분리 소스: src/game/part01.js ~ part08.js

편집 후 반영 방법(빌드):
1) Python 3 설치
2) 이 폴더에서 다음 실행
   python tools/build_game.py

그러면 src/game/* 를 합쳐서 js/game.js 를 다시 생성합니다.
(파일:// 로 열어도 동작하도록 모듈 시스템 없이 '문자열 연결' 방식입니다.)
