/**
 * Web Tunnel Manager for Amazon Plus
 * Exposes local server to the public Internet (HTTPS)
 * Allows André and Sheyla to access from their mobile phones (4G / 5G / external Wi-Fi) anywhere.
 */

const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

let activeTunnel = null;
let currentPublicUrl = null;
let currentProvider = null;
const tunnelEvents = new EventEmitter();

// Cloudflare Tunnel
async function startCloudflareTunnel(port = 3000) {
  return new Promise((resolve, reject) => {
    try {
      let cloudflaredBin = null;
      try {
        const { bin } = require('cloudflared');
        if (fs.existsSync(bin)) {
          cloudflaredBin = bin;
        }
      } catch (e) {}

      // Fallback: check PATH or local bin
      if (!cloudflaredBin) {
        cloudflaredBin = 'cloudflared';
      }

      console.log(`[Túnel] Iniciando Cloudflare Tunnel para porta ${port}...`);
      const child = spawn(cloudflaredBin, ['tunnel', '--url', `http://127.0.0.1:${port}`], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let resolved = false;
      let urlFound = null;

      // Cloudflare outputs the URL in stderr (info logs)
      const handleOutput = (data) => {
        const output = data.toString();
        // Regex to match trycloudflare URL
        const match = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match && !resolved) {
          resolved = true;
          urlFound = match[0];
          currentPublicUrl = urlFound;
          currentProvider = 'Cloudflare';
          activeTunnel = {
            process: child,
            stop: () => {
              try { child.kill('SIGTERM'); } catch (e) {}
              activeTunnel = null;
              currentPublicUrl = null;
              currentProvider = null;
              tunnelEvents.emit('status', { active: false, publicUrl: null, provider: null });
            }
          };
          console.log(`[Túnel Cloudflare Ativo] 🌐 Link Público: ${urlFound}`);
          tunnelEvents.emit('status', { active: true, publicUrl: urlFound, provider: 'Cloudflare' });
          resolve(urlFound);
        }
      };

      child.stdout.on('data', handleOutput);
      child.stderr.on('data', handleOutput);

      child.on('error', (err) => {
        if (!resolved) {
          reject(err);
        }
      });

      child.on('exit', (code) => {
        if (!resolved) {
          reject(new Error(`cloudflared encerrou com código ${code}`));
        } else {
          currentPublicUrl = null;
          currentProvider = null;
          activeTunnel = null;
          tunnelEvents.emit('status', { active: false, publicUrl: null, provider: null });
        }
      });

      // Timeout after 15s if URL not detected
      setTimeout(() => {
        if (!resolved) {
          try { child.kill(); } catch (e) {}
          reject(new Error('Tempo esgotado aguardando URL do Cloudflare Tunnel'));
        }
      }, 15000);

    } catch (err) {
      reject(err);
    }
  });
}

// Fallback: LocalTunnel
async function startLocalTunnel(port = 3000) {
  try {
    const localtunnel = require('localtunnel');
    console.log(`[Túnel] Tentando LocalTunnel para porta ${port}...`);
    const tunnel = await localtunnel({ port: parseInt(port, 10) });

    currentPublicUrl = tunnel.url;
    currentProvider = 'LocalTunnel';
    activeTunnel = {
      stop: () => {
        try { tunnel.close(); } catch (e) {}
        activeTunnel = null;
        currentPublicUrl = null;
        currentProvider = null;
        tunnelEvents.emit('status', { active: false, publicUrl: null, provider: null });
      }
    };

    tunnel.on('close', () => {
      activeTunnel = null;
      currentPublicUrl = null;
      currentProvider = null;
      tunnelEvents.emit('status', { active: false, publicUrl: null, provider: null });
    });

    console.log(`[Túnel LocalTunnel Ativo] 🌐 Link Público: ${tunnel.url}`);
    tunnelEvents.emit('status', { active: true, publicUrl: tunnel.url, provider: 'LocalTunnel' });
    return tunnel.url;
  } catch (err) {
    throw err;
  }
}

// Principal Start Function
async function startTunnel(port = 3000) {
  if (currentPublicUrl) {
    return { publicUrl: currentPublicUrl, provider: currentProvider };
  }

  // 1. Tentar Cloudflare primeiro (melhor experiência: sem interstitials, HTTPS limpo)
  try {
    const url = await startCloudflareTunnel(port);
    return { publicUrl: url, provider: 'Cloudflare' };
  } catch (cfErr) {
    console.warn(`[Túnel] Cloudflare não iniciou: ${cfErr.message}. Tentando LocalTunnel...`);
  }

  // 2. Tentar LocalTunnel como fallback
  try {
    const url = await startLocalTunnel(port);
    return { publicUrl: url, provider: 'LocalTunnel' };
  } catch (ltErr) {
    console.error(`[Túnel] Falha em todos os provedores de túnel: ${ltErr.message}`);
    throw new Error('Não foi possível iniciar o túnel web automático. Verifique a conexão com a internet.');
  }
}

function stopTunnel() {
  if (activeTunnel && activeTunnel.stop) {
    activeTunnel.stop();
  }
  currentPublicUrl = null;
  currentProvider = null;
  activeTunnel = null;
  return { active: false };
}

function getTunnelStatus() {
  return {
    active: !!currentPublicUrl,
    publicUrl: currentPublicUrl,
    provider: currentProvider
  };
}

module.exports = {
  startTunnel,
  stopTunnel,
  getTunnelStatus,
  tunnelEvents
};
