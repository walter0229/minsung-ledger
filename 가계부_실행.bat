@echo off
setlocal
cd /d "%~dp0"

:: 시스템 PATH 강제 주입
set "PATH=C:\Program Files\nodejs;%PATH%"

echo ==========================================
echo   💰 민성이의 가계부 로컬 서버 가동 중
echo ==========================================
echo.
echo [안내] 이 창은 가계부를 사용하는 동안 닫지 마세요.
echo [안내] 데이터 통신을 위해 보안 차단을 해제하는 중입니다.
echo.

:: 최신 모듈 코드로 통합(앱 빌드)
node build.js

:: 1. 웹 서버 배경 구동
start /b npx -y serve . -p 3000

:: 2. 서버 가동 완료 2초 대기
timeout /t 2 /nobreak > nul

:: 3. 서버 준비 완료 후 브라우저 열기
start http://127.0.0.1:3000/index.html?v=1.420

pause
