@echo off
title Amazon Plus - Servidor de Gestao de Estoques e Repasses
chcp 65001 >nul
color 0A

echo ========================================================
echo   🌿 AMAZON PLUS - SISTEMA INTEGRADO DE GESTAO
echo   Controle de Estoque Andre ^& Sheyla com Repasses
echo   (Servidor Local + Tunel Web Seguro para Celulares no 4G)
echo ========================================================
echo.
echo Verificando instalacao do Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERRO] Node.js nao encontrado!
    echo Por favor, instale o Node.js baixando em: https://nodejs.org
    pause
    exit /b
)

echo Verificando dependencias...
if not exist "node_modules" (
    echo Instalando pacotes necessarios (apenas na primeira vez)...
    call npm install
)

echo.
echo ========================================================
echo   Iniciando o servidor e conectando Tunel Web HTTPS...
echo   Andre e Sheyla poderao acessar no 4G de qualquer lugar!
echo ========================================================
echo.

start "" "http://localhost:3000"
node server.js --tunnel

pause
