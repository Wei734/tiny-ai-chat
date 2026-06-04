@echo off
echo ==========================================
echo    正在启动 AI 聊天软件 (后端 + 前端)
echo ==========================================
echo.
echo [提示] 看到下方出现 "Local:" 字样即为启动成功
echo [提示] 关闭此窗口将停止服务
echo.

call npm run start-all

pause
