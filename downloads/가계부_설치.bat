@echo off
chcp 65001 > nul
setlocal

echo ===================================================
echo   💰 민성이의 가계부 - 바탕화면 바로가기 앱 설치
echo ===================================================
echo.

set "APP_NAME=민성이의 가계부"
set "APP_URL=http://ledger.minsungvn.com"

:: 바탕화면 경로 탐색 (OneDrive 바탕화면 또는 기본 바탕화면)
set "DESKTOP_DIR=%USERPROFILE%\Desktop"
if exist "%USERPROFILE%\OneDrive\Desktop" (
    set "DESKTOP_DIR=%USERPROFILE%\OneDrive\Desktop"
)

:: 브라우저 탐색 (Chrome 또는 Edge)
set "BROWSER_PATH="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_PATH=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
) else if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_PATH=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
) else if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_PATH=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
)

if "%BROWSER_PATH%"=="" (
    echo [안내] 전용 브라우저 실행기를 찾지 못해 기본 웹 바로가기로 생성합니다.
    powershell -NoProfile -Command "$s=(New-Object -COM WScript.Shell).CreateShortcut('%DESKTOP_DIR%\%APP_NAME%.url');$s.TargetPath='%APP_URL%';$s.Save()"
) else (
    echo [설치 중] 단독 창 모드(PWA) 전용 바탕화면 바로가기를 생성합니다...
    powershell -NoProfile -Command "$s=(New-Object -COM WScript.Shell).CreateShortcut('%DESKTOP_DIR%\%APP_NAME%.lnk');$s.TargetPath='%BROWSER_PATH%';$s.Arguments='--app=%APP_URL%';$s.WindowStyle=1;$s.IconLocation='%BROWSER_PATH%,0';$s.Save()"
)

echo.
echo ===================================================
echo  🎉 설치가 완료되었습니다!
echo  👉 바탕화면의 [민성이의 가계부] 아이콘을 실행하세요.
echo ===================================================
echo.
pause
