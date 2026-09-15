@echo off
REM agate verify 优先调度本脚本，避免全盘误扫 node_modules/release
call npm test
exit /b %ERRORLEVEL%
