@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
echo ============================================
echo    STT NOVA-COSTING - Update System
echo    (git backup + clasp push + deploy)
echo ============================================
echo.
if not exist "deploy\.clasp.json" (
  echo *** No Apps Script project yet.
  echo *** Double-click the CREATE PROJECT bat first.
  pause
  exit /b 1
)

echo [0/4] Clearing any stuck git locks...
if not exist ".git" git init >nul 2>&1
git config user.email >nul 2>&1
if errorlevel 1 (
  git config user.name "STT NOVA-Costing"
  git config user.email "sasipa@suteetankers.com"
)
if exist ".git\index.lock" del /f /q ".git\index.lock" >nul 2>&1
if exist ".git\HEAD.lock" del /f /q ".git\HEAD.lock" >nul 2>&1
echo.

echo [1/4] Backup (Git local + GitHub if connected)...
git add -A
git commit -m "update %date% %time%" >nul
git remote get-url origin >nul 2>&1
if errorlevel 1 (
  echo    (no GitHub yet - run the CONNECT GITHUB bat once)
) else (
  set GIT_TERMINAL_PROMPT=0
  git -c credential.helper= ls-remote origin >nul 2>&1
  if not errorlevel 1 echo    NOTE: repo is PUBLIC - code only, cost data is never pushed.
  set GIT_TERMINAL_PROMPT=
  git push origin HEAD
  if errorlevel 1 echo    (WARNING: GitHub push failed - local commit is still saved)
)
echo.

echo [2/4] Run safety tests...
call node _tests\guard-v100.js
if errorlevel 1 goto TESTFAIL
echo.

echo [3/4] Upload ALL code files (clasp push)...
cd deploy
call clasp push -f
if errorlevel 1 goto PUSHFAIL
echo.

echo [4/4] Publish new version (clasp deploy)...
set "DEPID="
if exist ".deployid" set /p DEPID=<.deployid
if "!DEPID!"=="" (
  echo    No deployment yet - creating the first one...
  call clasp deploy -d "first release"
  if errorlevel 1 goto DEPLOYFAIL
  for /f "tokens=2" %%A in ('clasp deployments ^| findstr /C:"AKfycb" ^| findstr /V "@HEAD"') do set "DEPID=%%A"
  if "!DEPID!"=="" goto NOID
  > .deployid echo !DEPID!
  echo    Saved deployment id: !DEPID!
) else (
  echo    Using deployment id: !DEPID!
  call clasp deploy -i !DEPID! -d "auto update"
  if errorlevel 1 goto DEPLOYFAIL
)
echo.
echo    Web app link:
echo    https://script.google.com/macros/s/!DEPID!/exec
echo.
echo ============================================
echo    DONE? Only proof = version badge changed:
echo    1. Close ALL app tabs
echo    2. Open the web app link above
echo    3. Press Ctrl+Shift+R
echo    4. Check the version badge at top went UP
echo ============================================
pause
exit /b 0

:TESTFAIL
echo.
echo *** ERROR: safety tests FAILED - nothing was uploaded.
echo *** Send the red lines above to Candy.
pause
exit /b 1

:PUSHFAIL
echo.
echo *** ERROR: clasp push FAILED - code was NOT uploaded.
echo *** Most common cause = clasp login expired.
echo *** Fix: double-click the CLASP LOGIN bat, then run this again.
pause
exit /b 1

:DEPLOYFAIL
echo.
echo *** ERROR: clasp deploy FAILED - live app was NOT updated.
echo *** Manual way: Apps Script editor - Deploy - Manage deployments
echo ***             - Edit - Version: New version - Deploy
pause
exit /b 1

:NOID
echo.
echo *** ERROR: could not read the deployment id.
echo *** Run this in the deploy folder and tell Candy what it prints:
echo ***    clasp deployments
pause
exit /b 1
