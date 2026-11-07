@echo off
cd /d "%~dp0deploy"
echo ============================================
echo   STT NOVA-COSTING - Login to clasp (Google)
echo ============================================
echo A browser window will open.
echo Sign in with:  sasipa@suteetankers.com
echo then allow access.
echo.
call clasp login
echo.
pause
