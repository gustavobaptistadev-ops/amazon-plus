/**
 * Database manager for Amazon Plus Gestão
 * Uses Node.js 24 native SQLite (node:sqlite DatabaseSync)
 * Provides robust ACID persistence with zero external binary dependencies.
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'amazon_plus.sqlite');

let dbInstance = null;

function getDb() {
  if (!dbInstance) {
    dbInstance = new DatabaseSync(DB_PATH);
    initSchema(dbInstance);
  }
  return dbInstance;
}

function initSchema(db) {
  // 1. Configurações gerais
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Defaults
  const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
  insertSetting.run('product_name', 'Amazon Plus');
  insertSetting.run('default_unit_price', '270.00');
  insertSetting.run('default_unit_profit', '50.00');
  insertSetting.run('default_unit_repasse', '220.00');
  insertSetting.run('andre_pix_key', '');

  // 2. Estoques (André e Sheyla com 'y')
  db.exec(`
    CREATE TABLE IF NOT EXISTS stocks (
      id TEXT PRIMARY KEY,
      owner_name TEXT NOT NULL,
      current_quantity INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);

  const now = new Date().toISOString();
  const insertStock = db.prepare(`INSERT OR IGNORE INTO stocks (id, owner_name, current_quantity, updated_at) VALUES (?, ?, ?, ?)`);
  insertStock.run('andre', 'André', 0, now);
  insertStock.run('sheyla', 'Sheyla', 0, now);

  // 3. Movimentações de estoque
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_id TEXT NOT NULL,
      type TEXT NOT NULL, /* 'entrada', 'saida_manual', 'venda', 'emprestimo_saida', 'emprestimo_entrada', 'devolucao_saida', 'devolucao_entrada' */
      quantity INTEGER NOT NULL,
      reference_id INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // 4. Empréstimos entre André e Sheyla
  db.exec(`
    CREATE TABLE IF NOT EXISTS loans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lender_stock_id TEXT NOT NULL, /* Quem emprestou ('andre' ou 'sheyla') */
      borrower_stock_id TEXT NOT NULL, /* Quem pegou emprestado ('sheyla' ou 'andre') */
      quantity INTEGER NOT NULL,
      quantity_returned INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pendente', /* 'pendente', 'parcial', 'devolvido' */
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // 5. Vendas 1 a 1 de Amazon Plus
  db.exec(`
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_code TEXT UNIQUE,
      stock_id TEXT NOT NULL, /* 'andre' ou 'sheyla' */
      product_name TEXT NOT NULL DEFAULT 'Amazon Plus',
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL DEFAULT 270.00,
      total_price REAL NOT NULL DEFAULT 270.00,
      unit_profit REAL NOT NULL DEFAULT 50.00,
      total_profit REAL NOT NULL DEFAULT 50.00,
      unit_repasse_andre REAL NOT NULL DEFAULT 220.00,
      total_repasse_andre REAL NOT NULL DEFAULT 220.00,
      customer_name TEXT,
      customer_phone TEXT,
      payment_method TEXT DEFAULT 'PIX',
      receipt_filename TEXT,
      receipt_url TEXT,
      repasse_status TEXT NOT NULL DEFAULT 'pendente', /* 'pendente', 'liquidado' */
      settlement_id INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // 6. Fechamentos de Repasse ao André (Settlements)
  db.exec(`
    CREATE TABLE IF NOT EXISTS settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      settlement_code TEXT UNIQUE,
      period_type TEXT NOT NULL, /* 'diario', 'semanal', 'quinzenal', 'mensal', 'avulso' */
      start_date TEXT,
      end_date TEXT,
      total_units_sold INTEGER NOT NULL,
      total_gross_amount REAL NOT NULL,
      total_profit_retained REAL NOT NULL,
      total_repasse_amount REAL NOT NULL,
      payment_receipt_filename TEXT,
      payment_receipt_url TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'pago',
      created_at TEXT NOT NULL
    );
  `);
}

// Helper methods
const dbAPI = {
  getDb,

  // Settings
  getSettings() {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const result = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  },

  updateSetting(key, value) {
    const db = getDb();
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
  },

  // Stocks
  getStocks() {
    const db = getDb();
    return db.prepare('SELECT * FROM stocks ORDER BY id ASC').all();
  },

  getStockById(stockId) {
    const db = getDb();
    return db.prepare('SELECT * FROM stocks WHERE id = ?').get(stockId);
  },

  adjustStock(stockId, delta, movementType, refId = null, notes = '') {
    const db = getDb();
    const now = new Date().toISOString();
    
    // Update stock quantity
    db.prepare('UPDATE stocks SET current_quantity = current_quantity + ?, updated_at = ? WHERE id = ?')
      .run(delta, now, stockId);
      
    // Record movement
    db.prepare(`
      INSERT INTO stock_movements (stock_id, type, quantity, reference_id, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(stockId, movementType, Math.abs(delta), refId, notes, now);

    return db.prepare('SELECT * FROM stocks WHERE id = ?').get(stockId);
  },

  // Stock movements
  getMovements(limit = 100) {
    const db = getDb();
    return db.prepare(`
      SELECT m.*, s.owner_name 
      FROM stock_movements m 
      LEFT JOIN stocks s ON m.stock_id = s.id 
      ORDER BY m.id DESC 
      LIMIT ?
    `).all(limit);
  },

  // Loans (Empréstimos entre André e Sheyla)
  createLoan({ lender_stock_id, borrower_stock_id, quantity, notes = '' }) {
    const db = getDb();
    const now = new Date().toISOString();
    const qty = parseInt(quantity, 10);

    if (qty <= 0) throw new Error('A quantidade deve ser maior que zero.');
    if (lender_stock_id === borrower_stock_id) throw new Error('Origem e destino do empréstimo devem ser diferentes.');

    // Verificar se quem empresta tem estoque suficiente
    const lenderStock = this.getStockById(lender_stock_id);
    if (!lenderStock || lenderStock.current_quantity < qty) {
      throw new Error(`Estoque insuficiente de ${lender_stock_id === 'andre' ? 'André' : 'Sheyla'}. Saldo atual: ${lenderStock ? lenderStock.current_quantity : 0}`);
    }

    // Inserir registro de empréstimo
    const result = db.prepare(`
      INSERT INTO loans (lender_stock_id, borrower_stock_id, quantity, quantity_returned, status, notes, created_at, updated_at)
      VALUES (?, ?, ?, 0, 'pendente', ?, ?, ?)
    `).run(lender_stock_id, borrower_stock_id, qty, notes, now, now);

    const loanId = result.lastInsertRowid;

    // Atualiza estoques
    // Quem emprestou: decrementa
    this.adjustStock(lender_stock_id, -qty, 'emprestimo_saida', loanId, `Empréstimo de ${qty} un. para ${borrower_stock_id === 'andre' ? 'André' : 'Sheyla'}`);
    // Quem recebeu: incrementa
    this.adjustStock(borrower_stock_id, qty, 'emprestimo_entrada', loanId, `Recebido empréstimo de ${qty} un. de ${lender_stock_id === 'andre' ? 'André' : 'Sheyla'}`);

    return this.getLoanById(loanId);
  },

  getLoanById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM loans WHERE id = ?').get(id);
  },

  getLoans() {
    const db = getDb();
    return db.prepare(`
      SELECT l.*, 
             s1.owner_name AS lender_name,
             s2.owner_name AS borrower_name
      FROM loans l
      LEFT JOIN stocks s1 ON l.lender_stock_id = s1.id
      LEFT JOIN stocks s2 ON l.borrower_stock_id = s2.id
      ORDER BY l.id DESC
    `).all();
  },

  returnLoan(loanId, returnQuantity, notes = '') {
    const db = getDb();
    const loan = this.getLoanById(loanId);
    if (!loan) throw new Error('Empréstimo não encontrado.');

    const returnQty = parseInt(returnQuantity, 10);
    const pendingQty = loan.quantity - loan.quantity_returned;

    if (returnQty <= 0) throw new Error('Quantidade de devolução inválida.');
    if (returnQty > pendingQty) {
      throw new Error(`Quantidade a devolver (${returnQty}) maior que o saldo pendente (${pendingQty}).`);
    }

    // Verificar se quem vai devolver tem estoque disponível
    const borrowerStock = this.getStockById(loan.borrower_stock_id);
    if (!borrowerStock || borrowerStock.current_quantity < returnQty) {
      throw new Error(`Estoque de ${loan.borrower_stock_id === 'andre' ? 'André' : 'Sheyla'} insuficiente para devolução. Saldo atual: ${borrowerStock ? borrowerStock.current_quantity : 0}`);
    }

    const newReturned = loan.quantity_returned + returnQty;
    const newStatus = newReturned >= loan.quantity ? 'devolvido' : 'parcial';
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE loans 
      SET quantity_returned = ?, status = ?, updated_at = ?, notes = CASE WHEN ? != '' THEN notes || ' | ' || ? ELSE notes END
      WHERE id = ?
    `).run(newReturned, newStatus, now, notes, notes, loanId);

    // Ajustar os estoques na devolução:
    // Quem tomou emprestado agora devolve (diminui)
    this.adjustStock(loan.borrower_stock_id, -returnQty, 'devolucao_saida', loanId, `Devolução de empréstimo #${loanId} para ${loan.lender_stock_id === 'andre' ? 'André' : 'Sheyla'}`);
    // Quem emprestou recebe de volta (aumenta)
    this.adjustStock(loan.lender_stock_id, returnQty, 'devolucao_entrada', loanId, `Retorno de empréstimo #${loanId} de ${loan.borrower_stock_id === 'andre' ? 'André' : 'Sheyla'}`);

    return this.getLoanById(loanId);
  },

  // Balanço de empréstimos entre André e Sheyla
  getLoanBalance() {
    const db = getDb();
    // Sheyla deve para André:
    const sheylaOwesAndre = db.prepare(`
      SELECT COALESCE(SUM(quantity - quantity_returned), 0) AS total
      FROM loans
      WHERE lender_stock_id = 'andre' AND borrower_stock_id = 'sheyla' AND status != 'devolvido'
    `).get().total;

    // André deve para Sheyla:
    const andreOwesSheyla = db.prepare(`
      SELECT COALESCE(SUM(quantity - quantity_returned), 0) AS total
      FROM loans
      WHERE lender_stock_id = 'sheyla' AND borrower_stock_id = 'andre' AND status != 'devolvido'
    `).get().total;

    return {
      sheylaOwesAndre,
      andreOwesSheyla,
      netBalance: sheylaOwesAndre - andreOwesSheyla // Se > 0, Sheyla deve a André. Se < 0, André deve a Sheyla.
    };
  },

  // Sales (Vendas 1 a 1 de Amazon Plus com comprovante e repasse)
  createSale(saleData) {
    const db = getDb();
    const now = new Date().toISOString();
    const qty = parseInt(saleData.quantity || 1, 10);
    const unitPrice = parseFloat(saleData.unit_price || 270.00);
    const unitProfit = parseFloat(saleData.unit_profit || 50.00);
    const unitRepasse = unitPrice - unitProfit;

    const totalPrice = unitPrice * qty;
    const totalProfit = unitProfit * qty;
    const totalRepasse = unitRepasse * qty;

    const stockId = saleData.stock_id; // 'andre' ou 'sheyla'
    const stock = this.getStockById(stockId);

    if (!stock || stock.current_quantity < qty) {
      throw new Error(`Estoque insuficiente de ${stockId === 'andre' ? 'André' : 'Sheyla'}. Disponível: ${stock ? stock.current_quantity : 0} un.`);
    }

    // Gerar código único de venda: ex AP-202611-0001
    const count = db.prepare('SELECT COUNT(*) as cnt FROM sales').get().cnt + 1;
    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const saleCode = `AP-${datePrefix}-${String(count).padStart(4, '0')}`;

    const stmt = db.prepare(`
      INSERT INTO sales (
        sale_code, stock_id, product_name, quantity, unit_price, total_price,
        unit_profit, total_profit, unit_repasse_andre, total_repasse_andre,
        customer_name, customer_phone, payment_method, receipt_filename,
        receipt_url, repasse_status, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', ?, ?)
    `);

    const result = stmt.run(
      saleCode,
      stockId,
      saleData.product_name || 'Amazon Plus',
      qty,
      unitPrice,
      totalPrice,
      unitProfit,
      totalProfit,
      unitRepasse,
      totalRepasse,
      saleData.customer_name || 'Cliente Avulso',
      saleData.customer_phone || '',
      saleData.payment_method || 'PIX',
      saleData.receipt_filename || null,
      saleData.receipt_url || null,
      saleData.notes || '',
      now
    );

    const saleId = result.lastInsertRowid;

    // Baixa automática no estoque correspondente
    this.adjustStock(stockId, -qty, 'venda', saleId, `Venda #${saleCode} (${qty} un. Amazon Plus)`);

    return this.getSaleById(saleId);
  },

  getSaleById(id) {
    const db = getDb();
    return db.prepare(`
      SELECT s.*, st.owner_name as stock_owner_name 
      FROM sales s 
      LEFT JOIN stocks st ON s.stock_id = st.id 
      WHERE s.id = ?
    `).get(id);
  },

  getSales({ limit = 200, stockId = null, repasseStatus = null, startDate = null, endDate = null } = {}) {
    const db = getDb();
    let query = `
      SELECT s.*, st.owner_name as stock_owner_name 
      FROM sales s 
      LEFT JOIN stocks st ON s.stock_id = st.id 
      WHERE 1=1
    `;
    const params = [];

    if (stockId) {
      query += ` AND s.stock_id = ?`;
      params.push(stockId);
    }
    if (repasseStatus) {
      query += ` AND s.repasse_status = ?`;
      params.push(repasseStatus);
    }
    if (startDate) {
      query += ` AND s.created_at >= ?`;
      params.push(startDate);
    }
    if (endDate) {
      query += ` AND s.created_at <= ?`;
      params.push(endDate);
    }

    query += ` ORDER BY s.id DESC LIMIT ?`;
    params.push(limit);

    return db.prepare(query).all(...params);
  },

  deleteSale(id) {
    const db = getDb();
    const sale = this.getSaleById(id);
    if (!sale) throw new Error('Venda não encontrada.');
    if (sale.repasse_status === 'liquidado') {
      throw new Error('Não é possível excluir uma venda com repasse já liquidado. Cancele o repasse primeiro.');
    }

    // Estorna estoque
    this.adjustStock(sale.stock_id, sale.quantity, 'entrada', sale.id, `Estorno por exclusão da venda #${sale.sale_code}`);

    db.prepare('DELETE FROM sales WHERE id = ?').run(id);
    return { success: true };
  },

  // Repasse & Fechamentos (Settlements)
  getRepasseSummary(period = 'todas', customStart = null, customEnd = null) {
    const db = getDb();
    let dateFilter = '';
    const params = [];

    const now = new Date();
    if (period === 'diario') {
      const today = now.toISOString().slice(0, 10);
      dateFilter = `AND DATE(created_at) = ?`;
      params.push(today);
    } else if (period === 'semanal') {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      dateFilter = `AND created_at >= ?`;
      params.push(sevenDaysAgo);
    } else if (period === 'quinzenal') {
      const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString();
      dateFilter = `AND created_at >= ?`;
      params.push(fifteenDaysAgo);
    } else if (period === 'mensal') {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      dateFilter = `AND created_at >= ?`;
      params.push(monthStart);
    } else if (period === 'custom' && customStart && customEnd) {
      dateFilter = `AND created_at >= ? AND created_at <= ?`;
      params.push(customStart, customEnd);
    }

    // Vendas pendentes de repasse dentro do período
    const pendingSales = db.prepare(`
      SELECT * FROM sales 
      WHERE repasse_status = 'pendente' ${dateFilter}
      ORDER BY id ASC
    `).all(...params);

    // Totais de todas as pendências globais
    const globalPending = db.prepare(`
      SELECT 
        COALESCE(SUM(quantity), 0) AS units_pending,
        COALESCE(SUM(total_price), 0) AS gross_pending,
        COALESCE(SUM(total_profit), 0) AS profit_pending,
        COALESCE(SUM(total_repasse_andre), 0) AS repasse_pending
      FROM sales
      WHERE repasse_status = 'pendente'
    `).get();

    // Totais do período selecionado
    const periodTotals = db.prepare(`
      SELECT 
        COALESCE(SUM(quantity), 0) AS units_in_period,
        COALESCE(SUM(total_price), 0) AS gross_in_period,
        COALESCE(SUM(total_profit), 0) AS profit_in_period,
        COALESCE(SUM(total_repasse_andre), 0) AS repasse_in_period
      FROM sales
      WHERE repasse_status = 'pendente' ${dateFilter}
    `).get(...params);

    // Totais já liquidados historicamente
    const totalSettled = db.prepare(`
      SELECT 
        COALESCE(SUM(total_units_sold), 0) AS units_settled,
        COALESCE(SUM(total_gross_amount), 0) AS gross_settled,
        COALESCE(SUM(total_profit_retained), 0) AS profit_settled,
        COALESCE(SUM(total_repasse_amount), 0) AS repasse_settled
      FROM settlements
      WHERE status = 'pago'
    `).get();

    return {
      period,
      pendingSales,
      periodTotals,
      globalPending,
      totalSettled
    };
  },

  createSettlement({ period_type, sale_ids = [], notes = '', payment_receipt_filename = null, payment_receipt_url = null }) {
    const db = getDb();
    if (!sale_ids || sale_ids.length === 0) {
      throw new Error('Nenhuma venda selecionada para repasse.');
    }

    const placeholders = sale_ids.map(() => '?').join(',');
    const salesToSettle = db.prepare(`
      SELECT * FROM sales 
      WHERE id IN (${placeholders}) AND repasse_status = 'pendente'
    `).all(...sale_ids);

    if (salesToSettle.length === 0) {
      throw new Error('Nenhuma das vendas selecionadas está pendente de repasse.');
    }

    let totalUnits = 0;
    let totalGross = 0;
    let totalProfit = 0;
    let totalRepasse = 0;

    for (const sale of salesToSettle) {
      totalUnits += sale.quantity;
      totalGross += sale.total_price;
      totalProfit += sale.total_profit;
      totalRepasse += sale.total_repasse_andre;
    }

    const now = new Date().toISOString();
    const count = db.prepare('SELECT COUNT(*) as cnt FROM settlements').get().cnt + 1;
    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const settlementCode = `REP-${datePrefix}-${String(count).padStart(3, '0')}`;

    const stmt = db.prepare(`
      INSERT INTO settlements (
        settlement_code, period_type, start_date, end_date,
        total_units_sold, total_gross_amount, total_profit_retained, total_repasse_amount,
        payment_receipt_filename, payment_receipt_url, notes, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pago', ?)
    `);

    const result = stmt.run(
      settlementCode,
      period_type || 'avulso',
      salesToSettle[0].created_at,
      salesToSettle[salesToSettle.length - 1].created_at,
      totalUnits,
      totalGross,
      totalProfit,
      totalRepasse,
      payment_receipt_filename,
      payment_receipt_url,
      notes,
      now
    );

    const settlementId = result.lastInsertRowid;

    // Atualizar status das vendas para liquidado
    const updateSaleStmt = db.prepare(`
      UPDATE sales 
      SET repasse_status = 'liquidado', settlement_id = ? 
      WHERE id = ?
    `);

    for (const sale of salesToSettle) {
      updateSaleStmt.run(settlementId, sale.id);
    }

    return this.getSettlementById(settlementId);
  },

  getSettlements() {
    const db = getDb();
    return db.prepare('SELECT * FROM settlements ORDER BY id DESC').all();
  },

  getSettlementById(id) {
    const db = getDb();
    const settlement = db.prepare('SELECT * FROM settlements WHERE id = ?').get(id);
    if (!settlement) return null;

    settlement.sales = db.prepare(`
      SELECT s.*, st.owner_name as stock_owner_name 
      FROM sales s 
      LEFT JOIN stocks st ON s.stock_id = st.id 
      WHERE s.settlement_id = ?
      ORDER BY s.id ASC
    `).all(id);

    return settlement;
  },

  // Dashboard consolidado
  getDashboardData() {
    const db = getDb();
    const stocks = this.getStocks();
    const loanBalance = this.getLoanBalance();
    const settings = this.getSettings();

    // Vendas de hoje
    const today = new Date().toISOString().slice(0, 10);
    const todayStats = db.prepare(`
      SELECT 
        COALESCE(SUM(quantity), 0) AS today_units,
        COALESCE(SUM(total_price), 0) AS today_gross,
        COALESCE(SUM(total_profit), 0) AS today_profit,
        COALESCE(SUM(total_repasse_andre), 0) AS today_repasse
      FROM sales 
      WHERE DATE(created_at) = ?
    `).get(today);

    // Totais de repasses pendentes
    const repassePending = db.prepare(`
      SELECT 
        COALESCE(SUM(quantity), 0) AS units_pending,
        COALESCE(SUM(total_price), 0) AS gross_pending,
        COALESCE(SUM(total_profit), 0) AS profit_pending,
        COALESCE(SUM(total_repasse_andre), 0) AS repasse_pending
      FROM sales 
      WHERE repasse_status = 'pendente'
    `).get();

    // Total histórico geral
    const allTimeStats = db.prepare(`
      SELECT 
        COALESCE(SUM(quantity), 0) AS all_units,
        COALESCE(SUM(total_price), 0) AS all_gross,
        COALESCE(SUM(total_profit), 0) AS all_profit,
        COALESCE(SUM(total_repasse_andre), 0) AS all_repasse
      FROM sales
    `).get();

    // Últimas 8 vendas
    const recentSales = db.prepare(`
      SELECT s.*, st.owner_name as stock_owner_name 
      FROM sales s 
      LEFT JOIN stocks st ON s.stock_id = st.id 
      ORDER BY s.id DESC 
      LIMIT 8
    `).all();

    // Empréstimos ativos
    const activeLoans = db.prepare(`
      SELECT l.*, s1.owner_name AS lender_name, s2.owner_name AS borrower_name
      FROM loans l
      LEFT JOIN stocks s1 ON l.lender_stock_id = s1.id
      LEFT JOIN stocks s2 ON l.borrower_stock_id = s2.id
      WHERE l.status != 'devolvido'
      ORDER BY l.id DESC
    `).all();

    return {
      stocks,
      loanBalance,
      settings,
      todayStats,
      repassePending,
      allTimeStats,
      recentSales,
      activeLoans
    };
  }
};

module.exports = dbAPI;
