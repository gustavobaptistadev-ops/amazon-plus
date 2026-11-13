#!/usr/bin/env bash
# Amazon Plus - Script de Inicialização Linux / macOS com Túnel Web 4G
set -e

cd "$(dirname "$0")"

echo "========================================================"
echo "  🌿 AMAZON PLUS - SISTEMA INTEGRADO DE GESTÃO"
echo "  Controle de Estoque André & Sheyla com Repasses"
echo "  (Servidor Local + Túnel Web Seguro para Celulares no 4G)"
echo "========================================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
    echo "❌ Erro: Node.js não foi encontrado no sistema."
    echo "Instale o Node.js em: https://nodejs.org"
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "📦 Instalando dependências..."
    npm install
fi

echo "🚀 Iniciando servidor com túnel web seguro para 4G..."
node server.js --tunnel
