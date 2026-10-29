@echo off
rem Sirve la web en el puerto 8000 para esta PC y para celulares en la misma red Wi-Fi.
cd /d "%~dp0"
echo.
echo  En esta PC:      http://localhost:8000
echo  En el celular:   http://IP-DE-ESTA-PC:8000   (misma red Wi-Fi)
echo.
echo  Direcciones IPv4 de esta PC:
ipconfig | findstr /C:"IPv4"
echo.
echo  Ctrl+C para detener.
python -m http.server 8000 --bind 0.0.0.0
