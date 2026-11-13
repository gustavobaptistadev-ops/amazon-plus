const express = require('express');
const cors = require('cors');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const multer = require('multer');
const QRCode = require('qrcode');
const dbAPI = require('./database.js');
const tunnelManager = require('./tunnel.js');

const app = express();
const PORT = process.env.PORT || 3000;

// Garantir diretório de uploads
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Configurar upload com multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'comprovante-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // Até 15MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif|pdf|heic|heif/;
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    const mime = file.mimetype;
    if (allowed.test(ext) || allowed.test(mime)) {
      cb(null, true);
    } else {
      cb(new Error('Formato de arquivo não suportado. Envie imagens JPG, PNG, WEBP ou PDF.'));
    }
  }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// Helper: obter IP local da rede Wi-Fi / Ethernet
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Ignora loopback e IPv6
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// ==========================================
// ROTAS DE API
// ==========================================

// 1. Dashboard
app.get('/api/dashboard', (req, res) => {
  try {
    const data = dbAPI.getDashboardData();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Informações de Rede e QR Code para Celular (Local e 4G/Túnel Web)
app.get('/api/network-info', async (req, res) => {
  try {
    const localIp = getLocalIpAddress();
    const networkUrl = `http://${localIp}:${PORT}`;
    const localUrl = `http://localhost:${PORT}`;
    const tunnel = tunnelManager.getTunnelStatus();

    // Prioriza o link público da web se o túnel estiver ativo
    const activeUrl = tunnel.active && tunnel.publicUrl ? tunnel.publicUrl : networkUrl;

    const qrCodeDataUrl = await QRCode.toDataURL(activeUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
      color: {
        dark: '#064e3b',
        light: '#ffffff'
      }
    });

    res.json({
      success: true,
      data: {
        localIp,
        port: PORT,
        networkUrl,
        localUrl,
        activeUrl,
        tunnel,
        qrCodeDataUrl
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2.1 Controle do Túnel Web (4G / Acesso Externo)
app.get('/api/tunnel/status', (req, res) => {
  res.json({ success: true, data: tunnelManager.getTunnelStatus() });
});

app.post('/api/tunnel/start', async (req, res) => {
  try {
    const result = await tunnelManager.startTunnel(PORT);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/tunnel/stop', (req, res) => {
  const result = tunnelManager.stopTunnel();
  res.json({ success: true, data: result });
});

// 3. Estoques
app.get('/api/stocks', (req, res) => {
  try {
    const stocks = dbAPI.getStocks();
    const loanBalance = dbAPI.getLoanBalance();
    res.json({ success: true, data: { stocks, loanBalance } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/stocks/adjust', (req, res) => {
  try {
    const { stock_id, delta, type, notes } = req.body;
    if (!stock_id || delta === undefined || !type) {
      return res.status(400).json({ success: false, error: 'Campos obrigatórios: stock_id, delta, type' });
    }
    const updatedStock = dbAPI.adjustStock(stock_id, parseInt(delta, 10), type, null, notes || '');
    res.json({ success: true, data: updatedStock });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/stocks/movements', (req, res) => {
  try {
    const limit = parseInt(req.query.limit || 100, 10);
    const movements = dbAPI.getMovements(limit);
    res.json({ success: true, data: movements });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Empréstimos entre André e Sheyla
app.get('/api/loans', (req, res) => {
  try {
    const loans = dbAPI.getLoans();
    const balance = dbAPI.getLoanBalance();
    res.json({ success: true, data: { loans, balance } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/loans', (req, res) => {
  try {
    const { lender_stock_id, borrower_stock_id, quantity, notes } = req.body;
    if (!lender_stock_id || !borrower_stock_id || !quantity) {
      return res.status(400).json({ success: false, error: 'Campos obrigatórios: lender_stock_id, borrower_stock_id, quantity' });
    }
    const loan = dbAPI.createLoan({ lender_stock_id, borrower_stock_id, quantity, notes });
    res.json({ success: true, data: loan });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/loans/:id/return', (req, res) => {
  try {
    const loanId = parseInt(req.params.id, 10);
    const { quantity, notes } = req.body;
    if (!quantity) {
      return res.status(400).json({ success: false, error: 'Informe a quantidade a devolver.' });
    }
    const updatedLoan = dbAPI.returnLoan(loanId, parseInt(quantity, 10), notes || '');
    res.json({ success: true, data: updatedLoan });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 5. Vendas 1 a 1 de Amazon Plus
app.get('/api/sales', (req, res) => {
  try {
    const { stock_id, repasse_status, limit, start_date, end_date } = req.query;
    const sales = dbAPI.getSales({
      stockId: stock_id || null,
      repasseStatus: repasse_status || null,
      limit: limit ? parseInt(limit, 10) : 200,
      startDate: start_date || null,
      endDate: end_date || null
    });
    res.json({ success: true, data: sales });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/sales', upload.single('receipt'), (req, res) => {
  try {
    const body = req.body;
    let receipt_filename = null;
    let receipt_url = null;

    if (req.file) {
      receipt_filename = req.file.filename;
      receipt_url = `/uploads/${req.file.filename}`;
    }

    const sale = dbAPI.createSale({
      stock_id: body.stock_id,
      product_name: body.product_name || 'Amazon Plus',
      quantity: body.quantity || 1,
      unit_price: body.unit_price || 270.00,
      unit_profit: body.unit_profit || 50.00,
      customer_name: body.customer_name || 'Cliente Avulso',
      customer_phone: body.customer_phone || '',
      payment_method: body.payment_method || 'PIX',
      receipt_filename,
      receipt_url,
      notes: body.notes || ''
    });

    res.json({ success: true, data: sale });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/sales/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const result = dbAPI.deleteSale(id);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 6. Repasse ao André e Fechamentos
app.get('/api/repasse', (req, res) => {
  try {
    const { period, start_date, end_date } = req.query;
    const summary = dbAPI.getRepasseSummary(period || 'todas', start_date, end_date);
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/repasse/settle', upload.single('payment_receipt'), (req, res) => {
  try {
    let { period_type, sale_ids, notes } = req.body;
    if (typeof sale_ids === 'string') {
      try {
        sale_ids = JSON.parse(sale_ids);
      } catch (e) {
        sale_ids = sale_ids.split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean);
      }
    }

    let payment_receipt_filename = null;
    let payment_receipt_url = null;

    if (req.file) {
      payment_receipt_filename = req.file.filename;
      payment_receipt_url = `/uploads/${req.file.filename}`;
    }

    const settlement = dbAPI.createSettlement({
      period_type: period_type || 'avulso',
      sale_ids,
      notes: notes || '',
      payment_receipt_filename,
      payment_receipt_url
    });

    res.json({ success: true, data: settlement });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/settlements', (req, res) => {
  try {
    const settlements = dbAPI.getSettlements();
    res.json({ success: true, data: settlements });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/settlements/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const settlement = dbAPI.getSettlementById(id);
    if (!settlement) return res.status(404).json({ success: false, error: 'Acerto não encontrado' });
    res.json({ success: true, data: settlement });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Configurações
app.get('/api/settings', (req, res) => {
  try {
    const settings = dbAPI.getSettings();
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/settings', (req, res) => {
  try {
    const entries = req.body;
    for (const [key, val] of Object.entries(entries)) {
      dbAPI.updateSetting(key, val);
    }
    res.json({ success: true, data: dbAPI.getSettings() });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 8. Backup e Restauração
app.get('/api/backup', (req, res) => {
  try {
    const db = dbAPI.getDb();
    const backup = {
      exported_at: new Date().toISOString(),
      settings: db.prepare('SELECT * FROM settings').all(),
      stocks: db.prepare('SELECT * FROM stocks').all(),
      movements: db.prepare('SELECT * FROM stock_movements').all(),
      loans: db.prepare('SELECT * FROM loans').all(),
      sales: db.prepare('SELECT * FROM sales').all(),
      settlements: db.prepare('SELECT * FROM settlements').all()
    };
    res.setHeader('Content-Disposition', `attachment; filename=backup-amazon-plus-${new Date().toISOString().slice(0, 10)}.json`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(backup, null, 2));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fallback SPA
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', async () => {
  const localIp = getLocalIpAddress();
  console.log('====================================================');
  console.log('🌿 AMAZON PLUS - SISTEMA INTEGRADO DE GESTÃO');
  console.log('====================================================');
  console.log(`💻 No seu Computador (Servidor): http://localhost:${PORT}`);
  console.log(`📱 No Celular na mesma Wi-Fi: http://${localIp}:${PORT}`);

  // Iniciar túnel web automático se requisitado via CLI ou ENV
  const shouldStartTunnel = process.argv.includes('--tunnel') || process.env.AUTO_TUNNEL === 'true';
  let targetUrl = `http://${localIp}:${PORT}`;

  if (shouldStartTunnel) {
    try {
      console.log('🌐 Conectando Túnel Web Seguro para 4G / Celulares remotos...');
      const tunnel = await tunnelManager.startTunnel(PORT);
      targetUrl = tunnel.publicUrl;
      console.log('----------------------------------------------------');
      console.log(`🌍 ACESSO REMOTO / 4G (André & Sheyla):`);
      console.log(`🔗 ${tunnel.publicUrl}`);
      console.log('   (Qualquer celular abre este link no 4G de qualquer lugar!)');
    } catch (e) {
      console.warn(`[Aviso Túnel] ${e.message}`);
    }
  }

  console.log('----------------------------------------------------');
  try {
    const qrTerminal = await QRCode.toString(targetUrl, { type: 'terminal', small: true });
    console.log('📲 Escaneie o QR Code abaixo com a câmera do celular:');
    console.log(qrTerminal);
  } catch (e) {
    // ignore qr terminal error
  }
  console.log('====================================================');
});
