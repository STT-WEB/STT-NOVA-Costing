@echo off
cd /d "%~dp0deploy"
echo ============================================
echo   STT NOVA-COSTING - Create Apps Script project (ONE TIME)
echo ============================================
if exist ".clasp.json" (
  echo Project already exists - nothing to do.
  echo Next: double-click the UPDATE bat.
  pause
  exit /b 0
)
copy /y appsscript.json "%TEMP%\costing-manifest.json" >nul
call clasp create --type webapp --title "STT NOVA-Costing" --rootDir .
if errorlevel 1 (
  echo *** Create FAILED. Did you run the CLASP LOGIN bat first?
  pause
  exit /b 1
)
rem clasp create may overwrite the manifest - put ours back
copy /y "%TEMP%\costing-manifest.json" appsscript.json >nul
echo.
echo Project created. Next: double-click the UPDATE bat.
pause
