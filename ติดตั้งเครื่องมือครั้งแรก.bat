@echo off
cd /d "%~dp0"
echo ============================================
echo   STT NOVA-COSTING - First time setup
echo ============================================
call node --version
if errorlevel 1 (
  echo *** Node.js NOT found. Install it first: https://nodejs.org
  pause
  exit /b 1
)
call clasp --version >nul 2>&1
if errorlevel 1 call npm install -g @google/clasp
call clasp --version
echo.
echo Done. NEXT: CLASP LOGIN bat - CREATE PROJECT bat - UPDATE bat
pause
