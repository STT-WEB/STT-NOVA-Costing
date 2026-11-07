@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
set "REPO=https://github.com/STT-WEB/STT-NOVA-Costing.git"
echo ============================================
echo   STT NOVA-COSTING - Connect to GitHub (ONE TIME)
echo ============================================
echo Repository: %REPO%
echo.
echo [1/5] Safety check - repository MUST be PRIVATE...
set GIT_TERMINAL_PROMPT=0
git -c credential.helper= ls-remote %REPO% >nul 2>&1
if not errorlevel 1 (
  echo    NOTE: repo is PUBLIC. Code only goes up - cost data stays off GitHub.
  echo          Recommended: Settings - Change visibility - Private.
) else (
  echo    OK - private or not created yet
)
set GIT_TERMINAL_PROMPT=
echo.
echo [2/5] Prepare local git...
if not exist ".git" git init >nul
git symbolic-ref HEAD refs/heads/main >nul 2>&1
git config user.email >nul 2>&1
if errorlevel 1 (
  git config user.name "STT NOVA-Costing"
  git config user.email "sasipa@suteetankers.com"
)
if exist ".git\index.lock" del /f /q ".git\index.lock" >nul 2>&1
echo.
echo [3/5] Set remote...
git remote set-url origin %REPO% 2>nul
if errorlevel 1 git remote add origin %REPO%
git remote -v
echo.
echo [4/5] Commit (code only - no cost data, see .gitignore)...
git add -A
git commit -q -m "connect to GitHub %date% %time%"
git branch -M main >nul 2>&1
git rev-parse --verify HEAD >nul 2>&1
if errorlevel 1 (
  echo *** ERROR: commit FAILED - nothing to push. Tell Candy the message above.
  pause
  exit /b 1
)
echo.
echo [5/5] Push (a GitHub sign-in window may appear)...
git push -u origin main
if errorlevel 1 goto PUSHFAIL
echo.
echo ============================================
echo   DONE! Check: https://github.com/STT-WEB/STT-NOVA-Costing
echo   From now on the UPDATE bat pushes to GitHub every time.
echo ============================================
pause
exit /b 0

:PUSHFAIL
echo.
echo *** Push FAILED. Common reasons:
echo ***   1. Repo not created yet - create PRIVATE repo STT-NOVA-Costing in STT-WEB
echo ***   2. Not signed in to GitHub - sign in when the window opens, run again
echo *** Tell Candy the error message above.
pause
exit /b 1
