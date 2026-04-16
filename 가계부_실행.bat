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

:: 서버 실행과 동시에 브라우저 열기 (가장 확실한 조합)
start http://127.0.0.1:3000
npx -y serve . -p 3000

pause
