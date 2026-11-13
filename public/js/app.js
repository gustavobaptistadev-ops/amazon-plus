/**
 * AMAZON PLUS - CLIENT JAVASCRIPT APP
 * Full-featured Single Page Application (SPA) for mobile & desktop
 */

// Global State
const state = {
  currentTab: 'tabDashboard',
  stocks: { andre: 0, sheyla: 0 },
  loanBalance: { sheylaOwesAndre: 0, andreOwesSheyla: 0, netBalance: 0 },
  settings: {
    product_name: 'Amazon Plus',
    default_unit_price: 270.00,
    default_unit_profit: 50.00,
    default_unit_repasse: 220.00,
    andre_pix_key: ''
  },
  repassePeriod: 'todas',
  repasseSummary: null,
  selectedSaleIdsForSettlement: [],
  networkInfo: null,
  selectedReceiptFile: null
};

// Utilities: Currency formatting in BRL
function formatBRL(amount) {
  const val = parseFloat(amount || 0);
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Utilities: Date/time formatting in PT-BR
function formatDateTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDateOnly(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

// Toast Notifications
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✓' : '⚠️'}</span>
    <div>${message}</div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Tab Switching
function switchTab(tabId) {
  state.currentTab = tabId;

  // Update tab sections
  document.querySelectorAll('.tab-content').forEach((sec) => {
    sec.classList.remove('active');
  });
  const targetSec = document.getElementById(tabId);
  if (targetSec) targetSec.classList.add('active');

  // Update bottom nav
  document.querySelectorAll('.bottom-nav .nav-item').forEach((btn) => {
    btn.classList.remove('active');
    if (btn.getAttribute('data-tab') === tabId) {
      btn.classList.add('active');
    }
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Refresh tab specific data
  if (tabId === 'tabDashboard') {
    loadDashboard();
  } else if (tabId === 'tabStocks') {
    loadStocksData();
  } else if (tabId === 'tabSale') {
    updateSaleBreakdown();
  } else if (tabId === 'tabSales') {
    loadSalesList();
  } else if (tabId === 'tabRepasse') {
    loadRepasse();
  } else if (tabId === 'tabConnect') {
    loadNetworkInfo();
    loadSettings();
  }
}

// ==========================================
// ==========================================
// LOCAL-FIRST OFFLINE & WEB CLOUD STORAGE ENGINE
// ==========================================

const localStore = {
  KEY: 'AMAZON_PLUS_DATA_V2',
  getDb() {
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(this.KEY));
    } catch (e) {}
    if (!data) {
      data = {
        stocks: [
          { id: 'andre', owner_name: 'André', current_quantity: 25, updated_at: new Date().toISOString() },
          { id: 'sheyla', owner_name: 'Sheyla', current_quantity: 20, updated_at: new Date().toISOString() }
        ],
        loans: [],
        sales: [],
        settlements: [],
        movements: [
          { id: 1, stock_id: 'andre', type: 'entrada', quantity: 25, notes: 'Carga inicial', created_at: new Date().toISOString() },
          { id: 2, stock_id: 'sheyla', type: 'entrada', quantity: 20, notes: 'Carga inicial', created_at: new Date().toISOString() }
        ],
        settings: {
          product_name: 'Amazon Plus',
          default_unit_price: '270.00',
          default_unit_profit: '50.00',
          default_unit_repasse: '220.00',
          andre_pix_key: ''
        }
      };
      this.saveDb(data);
    }
    return data;
  },
  saveDb(data) {
    localStorage.setItem(this.KEY, JSON.stringify(data));
  },
  getStocks() {
    const db = this.getDb();
    return { stocks: db.stocks, loanBalance: this.getLoanBalance() };
  },
  getLoanBalance() {
    const db = this.getDb();
    let sheylaOwesAndre = 0;
    let andreOwesSheyla = 0;
    db.loans.forEach(l => {
      if (l.status !== 'devolvido') {
        const pending = l.quantity - (l.quantity_returned || 0);
        if (l.lender_stock_id === 'andre' && l.borrower_stock_id === 'sheyla') {
          sheylaOwesAndre += pending;
        } else if (l.lender_stock_id === 'sheyla' && l.borrower_stock_id === 'andre') {
          andreOwesSheyla += pending;
        }
      }
    });
    return { sheylaOwesAndre, andreOwesSheyla, netBalance: sheylaOwesAndre - andreOwesSheyla };
  },
  adjustStock(stockId, delta, type, notes = '') {
    const db = this.getDb();
    const stock = db.stocks.find(s => s.id === stockId);
    if (!stock) throw new Error('Estoque não encontrado');
    stock.current_quantity = Math.max(0, stock.current_quantity + delta);
    stock.updated_at = new Date().toISOString();
    db.movements.unshift({
      id: Date.now(),
      stock_id: stockId,
      type,
      quantity: Math.abs(delta),
      notes,
      created_at: new Date().toISOString()
    });
    this.saveDb(db);
    return stock;
  },
  createLoan({ lender_stock_id, borrower_stock_id, quantity, notes }) {
    const db = this.getDb();
    const qty = parseInt(quantity, 10);
    const lender = db.stocks.find(s => s.id === lender_stock_id);
    const borrower = db.stocks.find(s => s.id === borrower_stock_id);
    if (lender.current_quantity < qty) throw new Error('Estoque insuficiente para emprestar');
    lender.current_quantity -= qty;
    borrower.current_quantity += qty;
    const loan = {
      id: Date.now(),
      lender_stock_id,
      borrower_stock_id,
      lender_name: lender_stock_id === 'andre' ? 'André' : 'Sheyla',
      borrower_name: borrower_stock_id === 'andre' ? 'André' : 'Sheyla',
      quantity: qty,
      quantity_returned: 0,
      status: 'pendente',
      notes: notes || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    db.loans.unshift(loan);
    db.movements.unshift({ id: Date.now(), stock_id: lender_stock_id, type: 'emprestimo_saida', quantity: qty, notes: `Empréstimo para ${borrower.owner_name}`, created_at: new Date().toISOString() });
    db.movements.unshift({ id: Date.now() + 1, stock_id: borrower_stock_id, type: 'emprestimo_entrada', quantity: qty, notes: `Recebido de ${lender.owner_name}`, created_at: new Date().toISOString() });
    this.saveDb(db);
    return loan;
  },
  returnLoan(loanId, returnQuantity, notes = '') {
    const db = this.getDb();
    const loan = db.loans.find(l => l.id == loanId);
    if (!loan) throw new Error('Empréstimo não encontrado');
    const qty = parseInt(returnQuantity, 10);
    loan.quantity_returned = (loan.quantity_returned || 0) + qty;
    if (loan.quantity_returned >= loan.quantity) loan.status = 'devolvido';
    else loan.status = 'parcial';
    const lender = db.stocks.find(s => s.id === loan.lender_stock_id);
    const borrower = db.stocks.find(s => s.id === loan.borrower_stock_id);
    borrower.current_quantity = Math.max(0, borrower.current_quantity - qty);
    lender.current_quantity += qty;
    this.saveDb(db);
    return loan;
  },
  createSale(saleData) {
    const db = this.getDb();
    const qty = parseInt(saleData.quantity || 1, 10);
    const stock = db.stocks.find(s => s.id === saleData.stock_id);
    if (!stock || stock.current_quantity < qty) throw new Error('Estoque insuficiente');
    stock.current_quantity -= qty;
    const unitPrice = parseFloat(saleData.unit_price || 270);
    const unitProfit = parseFloat(saleData.unit_profit || 50);
    const unitRepasse = unitPrice - unitProfit;
    const count = db.sales.length + 1;
    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const saleCode = `AP-${datePrefix}-${String(count).padStart(4, '0')}`;
    const sale = {
      id: Date.now(),
      sale_code: saleCode,
      stock_id: saleData.stock_id,
      product_name: saleData.product_name || 'Amazon Plus',
      quantity: qty,
      unit_price: unitPrice,
      total_price: unitPrice * qty,
      unit_profit: unitProfit,
      total_profit: unitProfit * qty,
      unit_repasse_andre: unitRepasse,
      total_repasse_andre: unitRepasse * qty,
      customer_name: saleData.customer_name || 'Cliente Avulso',
      customer_phone: saleData.customer_phone || '',
      payment_method: saleData.payment_method || 'PIX',
      receipt_url: saleData.receipt_url || null,
      repasse_status: 'pendente',
      notes: saleData.notes || '',
      created_at: new Date().toISOString(),
      stock_owner_name: stock.owner_name
    };
    db.sales.unshift(sale);
    db.movements.unshift({ id: Date.now(), stock_id: saleData.stock_id, type: 'venda', quantity: qty, notes: `Venda #${saleCode}`, created_at: new Date().toISOString() });
    this.saveDb(db);
    return sale;
  },
  deleteSale(id) {
    const db = this.getDb();
    const index = db.sales.findIndex(s => s.id == id);
    if (index === -1) throw new Error('Venda não encontrada');
    const sale = db.sales[index];
    const stock = db.stocks.find(s => s.id === sale.stock_id);
    if (stock) stock.current_quantity += sale.quantity;
    db.sales.splice(index, 1);
    this.saveDb(db);
    return { success: true };
  },
  getDashboardData() {
    const db = this.getDb();
    const stocks = db.stocks;
    const loanBalance = this.getLoanBalance();
    const today = new Date().toISOString().slice(0, 10);
    const todaySales = db.sales.filter(s => s.created_at.startsWith(today));
    let today_units = 0, today_gross = 0, today_profit = 0, today_repasse = 0;
    todaySales.forEach(s => {
      today_units += s.quantity;
      today_gross += s.total_price;
      today_profit += s.total_profit;
      today_repasse += s.total_repasse_andre;
    });
    const pendingSales = db.sales.filter(s => s.repasse_status === 'pendente');
    let units_pending = 0, gross_pending = 0, profit_pending = 0, repasse_pending = 0;
    pendingSales.forEach(s => {
      units_pending += s.quantity;
      gross_pending += s.total_price;
      profit_pending += s.total_profit;
      repasse_pending += s.total_repasse_andre;
    });
    let all_units = 0, all_gross = 0, all_profit = 0, all_repasse = 0;
    db.sales.forEach(s => {
      all_units += s.quantity;
      all_gross += s.total_price;
      all_profit += s.total_profit;
      all_repasse += s.total_repasse_andre;
    });
    return {
      stocks,
      loanBalance,
      settings: db.settings,
      todayStats: { today_units, today_gross, today_profit, today_repasse },
      repassePending: { units_pending, gross_pending, profit_pending, repasse_pending },
      allTimeStats: { all_units, all_gross, all_profit, all_repasse },
      recentSales: db.sales.slice(0, 8),
      activeLoans: db.loans.filter(l => l.status !== 'devolvido')
    };
  },
  getRepasseSummary(period = 'todas') {
    const db = this.getDb();
    let pendingSales = db.sales.filter(s => s.repasse_status === 'pendente');
    let units_in_period = 0, gross_in_period = 0, profit_in_period = 0, repasse_in_period = 0;
    pendingSales.forEach(s => {
      units_in_period += s.quantity;
      gross_in_period += s.total_price;
      profit_in_period += s.total_profit;
      repasse_in_period += s.total_repasse_andre;
    });
    return {
      period,
      pendingSales,
      periodTotals: { units_in_period, gross_in_period, profit_in_period, repasse_in_period },
      globalPending: { units_pending: units_in_period, gross_pending: gross_in_period, profit_pending: profit_in_period, repasse_pending: repasse_in_period },
      totalSettled: { units_settled: 0, gross_settled: 0, profit_settled: 0, repasse_settled: 0 }
    };
  },
  createSettlement({ period_type, sale_ids, notes }) {
    const db = this.getDb();
    const ids = Array.isArray(sale_ids) ? sale_ids : (typeof sale_ids === 'string' ? JSON.parse(sale_ids) : []);
    const salesToSettle = db.sales.filter(s => ids.includes(s.id));
    let totalUnits = 0, totalGross = 0, totalProfit = 0, totalRepasse = 0;
    salesToSettle.forEach(s => {
      s.repasse_status = 'liquidado';
      totalUnits += s.quantity;
      totalGross += s.total_price;
      totalProfit += s.total_profit;
      totalRepasse += s.total_repasse_andre;
    });
    const settlement = {
      id: Date.now(),
      settlement_code: `REP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(db.settlements.length + 1).padStart(3, '0')}`,
      period_type,
      total_units_sold: totalUnits,
      total_gross_amount: totalGross,
      total_profit_retained: totalProfit,
      total_repasse_amount: totalRepasse,
      notes,
      created_at: new Date().toISOString()
    };
    db.settlements.unshift(settlement);
    this.saveDb(db);
    return settlement;
  }
};

// ==========================================
// API CLIENT WITH LOCAL-FIRST FALLBACK
// ==========================================

async function fetchAPI(endpoint, options = {}) {
  // Se for ambiente estático (como GitHub Pages) ou sem backend ativo, usar localStore
  const isStaticHost = window.location.hostname.includes('github.io') || window.location.protocol === 'file:';

  if (!isStaticHost) {
    try {
      const res = await fetch(endpoint, options);
      if (res.ok) {
        const data = await res.json();
        if (data.success) return data.data;
      }
    } catch (netErr) {
      console.warn('API local indisponível, usando armazenamento local do navegador...');
    }
  }

  // Fallback transparente usando localStore
  const url = endpoint.split('?')[0];

  if (url === '/api/dashboard') {
    return localStore.getDashboardData();
  } else if (url === '/api/stocks') {
    return localStore.getStocks();
  } else if (url === '/api/stocks/adjust' && options.method === 'POST') {
    const body = JSON.parse(options.body);
    return localStore.adjustStock(body.stock_id, body.delta, body.type, body.notes);
  } else if (url === '/api/stocks/movements') {
    return localStore.getDb().movements;
  } else if (url === '/api/loans' && options.method === 'POST') {
    const body = JSON.parse(options.body);
    return localStore.createLoan(body);
  } else if (url === '/api/loans' && (!options.method || options.method === 'GET')) {
    return { loans: localStore.getDb().loans, balance: localStore.getLoanBalance() };
  } else if (url.startsWith('/api/loans/') && url.endsWith('/return')) {
    const id = url.split('/')[3];
    const body = JSON.parse(options.body);
    return localStore.returnLoan(id, body.quantity, body.notes);
  } else if (url === '/api/sales' && (!options.method || options.method === 'GET')) {
    return localStore.getDb().sales;
  } else if (url === '/api/repasse') {
    return localStore.getRepasseSummary();
  } else if (url === '/api/settlements') {
    return localStore.getDb().settlements;
  } else if (url.startsWith('/api/settlements/')) {
    const id = url.split('/')[3];
    return localStore.getDb().settlements.find(s => s.id == id);
  } else if (url === '/api/settings') {
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      const db = localStore.getDb();
      db.settings = { ...db.settings, ...body };
      localStore.saveDb(db);
      return db.settings;
    }
    return localStore.getDb().settings;
  } else if (url === '/api/network-info') {
    return {
      localIp: 'web',
      port: 443,
      networkUrl: window.location.href,
      localUrl: window.location.href,
      activeUrl: window.location.href,
      tunnel: { active: true, publicUrl: window.location.href, provider: 'GitHub Pages Web' },
      qrCodeDataUrl: null
    };
  }

  return {};
}

// ==========================================
// 1. DASHBOARD
// ==========================================

async function loadDashboard() {
  try {
    const data = await fetchAPI('/api/dashboard');
    if (!data) return;

    // 1. Estoques André e Sheyla
    let andreQty = 0;
    let sheylaQty = 0;

    data.stocks.forEach((s) => {
      if (s.id === 'andre') andreQty = s.current_quantity;
      if (s.id === 'sheyla') sheylaQty = s.current_quantity;
    });

    state.stocks.andre = andreQty;
    state.stocks.sheyla = sheylaQty;

    const elAndre = document.getElementById('andreStockCount');
    const elSheyla = document.getElementById('sheylaStockCount');
    if (elAndre) elAndre.textContent = andreQty;
    if (elSheyla) elSheyla.textContent = sheylaQty;

    // Status pills
    const elAndreStatus = document.getElementById('andreStockStatus');
    const elSheylaStatus = document.getElementById('sheylaStockStatus');
    if (elAndreStatus) {
      elAndreStatus.textContent = andreQty <= 3 ? 'Estoque Baixo' : 'Disponível';
      elAndreStatus.style.background = andreQty <= 3 ? '#fee2e2' : 'rgba(0,0,0,0.06)';
      elAndreStatus.style.color = andreQty <= 3 ? '#b91c1c' : 'var(--text-muted)';
    }
    if (elSheylaStatus) {
      elSheylaStatus.textContent = sheylaQty <= 3 ? 'Estoque Baixo' : 'Disponível';
      elSheylaStatus.style.background = sheylaQty <= 3 ? '#fee2e2' : 'rgba(0,0,0,0.06)';
      elSheylaStatus.style.color = sheylaQty <= 3 ? '#b91c1c' : 'var(--text-muted)';
    }

    // Atualiza saldos também na aba de Nova Venda
    const elSaleAndre = document.getElementById('saleSelectAndreBalance');
    const elSaleSheyla = document.getElementById('saleSelectSheylaBalance');
    if (elSaleAndre) elSaleAndre.textContent = `Saldo: ${andreQty} un.`;
    if (elSaleSheyla) elSaleSheyla.textContent = `Saldo: ${sheylaQty} un.`;

    // 2. Banner de Empréstimo Ativo
    state.loanBalance = data.loanBalance;
    const loanBanner = document.getElementById('loanInterlinkBanner');
    const loanTitle = document.getElementById('loanInterlinkTitle');
    const loanDesc = document.getElementById('loanInterlinkDesc');

    if (data.loanBalance.netBalance !== 0) {
      loanBanner.style.display = 'flex';
      if (data.loanBalance.netBalance > 0) {
        loanTitle.textContent = `Sheyla possui ${data.loanBalance.netBalance} frasco(s) de André`;
        loanDesc.textContent = `Sheyla tomou emprestado ${data.loanBalance.sheylaOwesAndre} un. de André. Regularize com a devolução quando repor.`;
      } else {
        const net = Math.abs(data.loanBalance.netBalance);
        loanTitle.textContent = `André possui ${net} frasco(s) de Sheyla`;
        loanDesc.textContent = `André tomou emprestado ${data.loanBalance.andreOwesSheyla} un. de Sheyla. Regularize com a devolução quando repor.`;
      }
    } else {
      loanBanner.style.display = 'none';
    }

    // 3. Financeiro do dia & Repasse
    const today = data.todayStats;
    const repassePending = data.repassePending;
    const allTime = data.allTimeStats;

    document.getElementById('dashTodayUnits').textContent = `${today.today_units || 0} un.`;
    document.getElementById('dashTodayGross').textContent = `${formatBRL(today.today_gross)} faturado`;
    document.getElementById('dashTodayProfit').textContent = formatBRL(today.today_profit);

    document.getElementById('dashPendingRepasse').textContent = formatBRL(repassePending.repasse_pending);
    document.getElementById('dashPendingUnits').textContent = `${repassePending.units_pending || 0} unidades pendentes`;

    const settledGross = (allTime.all_repasse || 0) - (repassePending.repasse_pending || 0);
    const settledUnits = (allTime.all_units || 0) - (repassePending.units_pending || 0);
    document.getElementById('dashSettledRepasse').textContent = formatBRL(settledGross);
    document.getElementById('dashSettledUnits').textContent = `${settledUnits} un. repassadas`;

    // 4. Feed de Vendas Recentes
    renderRecentSales(data.recentSales);

  } catch (err) {
    console.error('Erro ao carregar dashboard', err);
  }
}

function renderRecentSales(sales) {
  const feed = document.getElementById('dashRecentSalesFeed');
  if (!feed) return;

  if (!sales || sales.length === 0) {
    feed.innerHTML = `
      <div style="text-align:center; padding:24px; color:var(--text-muted); font-size:0.88rem;">
        Nenhuma venda registrada ainda. Clique em "Lançar Nova Venda"!
      </div>
    `;
    return;
  }

  feed.innerHTML = sales.map((sale) => {
    const isAndre = sale.stock_id === 'andre';
    const isSettled = sale.repasse_status === 'liquidado';

    return `
      <div class="feed-item">
        <div class="feed-left">
          <div class="feed-avatar ${isAndre ? 'andre' : 'sheyla'}">
            ${isAndre ? 'A' : 'S'}
          </div>
          <div>
            <div class="feed-title">${escapeHTML(sale.customer_name || 'Cliente')} (${sale.quantity}x Amazon Plus)</div>
            <div class="feed-meta">
              <span>${formatDateTime(sale.created_at)}</span>
              <span>•</span>
              <span style="font-weight:700; color:${isAndre ? 'var(--andre-primary)' : 'var(--sheyla-primary)'}">
                Estoque ${isAndre ? 'André' : 'Sheyla'}
              </span>
              <span>•</span>
              <span>${sale.payment_method || 'PIX'}</span>
            </div>
            ${sale.receipt_url ? `
              <button class="receipt-btn-thumbnail" onclick="openLightbox('${sale.receipt_url}')">
                📷 Ver Comprovante
              </button>
            ` : ''}
          </div>
        </div>
        <div class="feed-right">
          <div class="feed-amount">${formatBRL(sale.total_price)}</div>
          <div class="feed-badge ${isSettled ? 'badge-settled' : 'badge-pending'}">
            ${isSettled ? '✓ Repassado' : '⏳ Repasse Pendente: ' + formatBRL(sale.total_repasse_andre)}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ==========================================
// 2. ESTOQUES & EMPRÉSTIMOS
// ==========================================

async function loadStocksData() {
  try {
    const data = await fetchAPI('/api/stocks');
    let andreQty = 0;
    let sheylaQty = 0;

    data.stocks.forEach((s) => {
      if (s.id === 'andre') andreQty = s.current_quantity;
      if (s.id === 'sheyla') sheylaQty = s.current_quantity;
    });

    state.stocks.andre = andreQty;
    state.stocks.sheyla = sheylaQty;

    document.getElementById('andreDetailedCount').textContent = andreQty;
    document.getElementById('sheylaDetailedCount').textContent = sheylaQty;

    // Balanço de empréstimos
    loadLoans();
    loadMovements();
  } catch (err) {
    console.error(err);
  }
}

async function loadLoans() {
  try {
    const data = await fetchAPI('/api/loans');
    const balanceBox = document.getElementById('loansBalanceSummaryBox');
    const feed = document.getElementById('loansListFeed');

    // Resumo do balanço
    const b = data.balance;
    if (b.netBalance === 0) {
      balanceBox.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px; color:var(--text-main); font-size:0.88rem;">
          <span style="font-size:1.2rem;">⚖️</span>
          <div><strong>Balanço 100% Zerado:</strong> Nenhum frasco pendente de devolução entre André e Sheyla.</div>
        </div>
      `;
    } else if (b.netBalance > 0) {
      balanceBox.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px; color:#92400e; font-size:0.88rem;">
          <span style="font-size:1.2rem;">🤝</span>
          <div>
            <strong>Saldo em aberto:</strong> Sheyla possui <strong>${b.netBalance} frasco(s)</strong> emprestado(s) de André.
            <br><span style="font-size:0.78rem; color:var(--text-muted);">Quando Sheyla repuser o estoque, utilize o botão "Devolver" para retornar os frascos ao André.</span>
          </div>
        </div>
      `;
    } else {
      const net = Math.abs(b.netBalance);
      balanceBox.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px; color:#92400e; font-size:0.88rem;">
          <span style="font-size:1.2rem;">🤝</span>
          <div>
            <strong>Saldo em aberto:</strong> André possui <strong>${net} frasco(s)</strong> emprestado(s) de Sheyla.
            <br><span style="font-size:0.78rem; color:var(--text-muted);">Quando André repuser o estoque, utilize o botão "Devolver" para retornar os frascos à Sheyla.</span>
          </div>
        </div>
      `;
    }

    // Lista de empréstimos
    if (!data.loans || data.loans.length === 0) {
      feed.innerHTML = `<div style="text-align:center; padding:18px; color:var(--text-muted); font-size:0.85rem;">Nenhum empréstimo registrado.</div>`;
      return;
    }

    feed.innerHTML = data.loans.map((loan) => {
      const isSettled = loan.status === 'devolvido';
      const pending = loan.quantity - loan.quantity_returned;
      const lenderIsAndre = loan.lender_stock_id === 'andre';

      return `
        <div class="feed-item">
          <div class="feed-left">
            <div class="feed-avatar ${lenderIsAndre ? 'andre' : 'sheyla'}">
              🔄
            </div>
            <div>
              <div class="feed-title">
                ${loan.lender_name} emprestou ${loan.quantity} un. para ${loan.borrower_name}
              </div>
              <div class="feed-meta">
                <span>${formatDateTime(loan.created_at)}</span>
                ${loan.notes ? `<span>• ${escapeHTML(loan.notes)}</span>` : ''}
              </div>
              <div style="font-size:0.76rem; color:var(--text-muted); margin-top:2px;">
                Devolvido: ${loan.quantity_returned} de ${loan.quantity} un. (${pending} pendentes)
              </div>
            </div>
          </div>
          <div class="feed-right">
            <div class="feed-badge ${isSettled ? 'badge-settled' : 'badge-pending'}">
              ${isSettled ? '✓ Totalmente Devolvido' : `⏳ Faltam ${pending} un.`}
            </div>
            ${!isSettled ? `
              <div style="margin-top:6px;">
                <button class="btn-stock-action" style="padding:4px 10px; font-size:0.75rem;" onclick="openReturnLoanModal(${loan.id}, '${loan.lender_name}', '${loan.borrower_name}', ${pending})">
                  Devolver
                </button>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error(err);
  }
}

async function loadMovements() {
  try {
    const movements = await fetchAPI('/api/stocks/movements?limit=40');
    const feed = document.getElementById('movementsListFeed');
    if (!feed) return;

    if (!movements || movements.length === 0) {
      feed.innerHTML = `<div style="text-align:center; padding:18px; color:var(--text-muted); font-size:0.85rem;">Nenhuma movimentação registrada.</div>`;
      return;
    }

    const typeLabels = {
      entrada: '📥 Entrada de Estoque',
      saida_manual: '📤 Saída / Ajuste Manual',
      venda: '🛍️ Venda',
      emprestimo_saida: '🔄 Empréstimo (Saída)',
      emprestimo_entrada: '🔄 Empréstimo (Entrada)',
      devolucao_saida: '↩️ Devolução (Saída)',
      devolucao_entrada: '↩️ Devolução (Retorno)'
    };

    feed.innerHTML = movements.map((m) => {
      const isAndre = m.stock_id === 'andre';
      return `
        <div class="feed-item">
          <div class="feed-left">
            <div class="feed-avatar ${isAndre ? 'andre' : 'sheyla'}">
              ${isAndre ? 'A' : 'S'}
            </div>
            <div>
              <div class="feed-title">
                ${typeLabels[m.type] || m.type} (${m.quantity} un.)
              </div>
              <div class="feed-meta">
                <span>${formatDateTime(m.created_at)}</span>
                <span>•</span>
                <span style="font-weight:700; color:${isAndre ? 'var(--andre-primary)' : 'var(--sheyla-primary)'}">
                  Estoque ${isAndre ? 'André' : 'Sheyla'}
                </span>
                ${m.notes ? `<span>• ${escapeHTML(m.notes)}</span>` : ''}
              </div>
            </div>
          </div>
          <div class="feed-right">
            <div class="feed-amount" style="font-size:0.88rem;">
              ${m.type.includes('entrada') || m.type === 'devolucao_entrada' ? '+' : '-'}${m.quantity} un.
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error(err);
  }
}

// ==========================================
// 3. NOVA VENDA (1 A 1)
// ==========================================

function stepSaleQty(delta) {
  const input = document.getElementById('saleQtyInput');
  if (!input) return;
  let val = parseInt(input.value || 1, 10) + delta;
  if (val < 1) val = 1;
  input.value = val;
  updateSaleBreakdown();
}

function updateSaleBreakdown() {
  const input = document.getElementById('saleQtyInput');
  const qty = parseInt(input ? input.value : 1, 10) || 1;

  const unitPrice = state.settings.default_unit_price || 270.00;
  const unitProfit = state.settings.default_unit_profit || 50.00;
  const unitRepasse = unitPrice - unitProfit;

  const totalPrice = unitPrice * qty;
  const totalProfit = unitProfit * qty;
  const totalRepasse = unitRepasse * qty;

  const priceUnitEl = document.getElementById('breakdownPriceUnit');
  const profitTotalEl = document.getElementById('breakdownProfitTotal');
  const repasseTotalEl = document.getElementById('breakdownRepasseTotal');

  if (priceUnitEl) priceUnitEl.innerHTML = `${qty}x de ${formatBRL(unitPrice)} = <strong>${formatBRL(totalPrice)}</strong>`;
  if (profitTotalEl) profitTotalEl.textContent = `+ ${formatBRL(totalProfit)}`;
  if (repasseTotalEl) repasseTotalEl.textContent = formatBRL(totalRepasse);

  // Checar saldo do estoque selecionado
  const selectedStockInput = document.querySelector('input[name="sale_stock_id"]:checked');
  const stockId = selectedStockInput ? selectedStockInput.value : 'andre';
  const available = state.stocks[stockId] || 0;

  const submitBtn = document.getElementById('btnSubmitSale');
  if (submitBtn) {
    if (available < qty) {
      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.5';
      submitBtn.innerHTML = `⚠️ Estoque de ${stockId === 'andre' ? 'André' : 'Sheyla'} insuficiente (${available} un. disp.)`;
    } else {
      submitBtn.disabled = false;
      submitBtn.style.opacity = '1';
      submitBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        Confirmar Venda & Baixar Estoque (${qty} un.)
      `;
    }
  }
}

// Receipt Image Selection & Preview
function handleReceiptFileSelect(input) {
  if (input.files && input.files[0]) {
    const file = input.files[0];
    state.selectedReceiptFile = file;

    const previewBox = document.getElementById('receiptPreviewBox');
    const previewImg = document.getElementById('receiptPreviewImg');
    const dropZone = document.getElementById('receiptDropZone');

    const reader = new FileReader();
    reader.onload = function (e) {
      previewImg.src = e.target.result;
      previewBox.style.display = 'block';
      dropZone.style.display = 'none';
    };
    reader.readAsDataURL(file);
  }
}

function removeReceiptFile(event) {
  if (event) event.stopPropagation();
  state.selectedReceiptFile = null;
  const input = document.getElementById('saleReceiptInput');
  if (input) input.value = '';

  const previewBox = document.getElementById('receiptPreviewBox');
  const dropZone = document.getElementById('receiptDropZone');
  if (previewBox) previewBox.style.display = 'none';
  if (dropZone) dropZone.style.display = 'block';
}

// Submit Sale
async function handleSaleSubmit(e) {
  e.preventDefault();
  const submitBtn = document.getElementById('btnSubmitSale');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Gravando venda e baixando estoque...';

  try {
    const stockId = document.querySelector('input[name="sale_stock_id"]:checked').value;
    const qty = parseInt(document.getElementById('saleQtyInput').value, 10);
    const customerName = document.getElementById('saleCustomerName').value;
    const customerPhone = document.getElementById('saleCustomerPhone').value;
    const paymentMethod = document.getElementById('salePaymentMethod').value;
    const notes = document.getElementById('saleNotes').value;

    const formData = new FormData();
    formData.append('stock_id', stockId);
    formData.append('quantity', qty);
    formData.append('unit_price', state.settings.default_unit_price || 270.00);
    formData.append('unit_profit', state.settings.default_unit_profit || 50.00);
    formData.append('customer_name', customerName);
    formData.append('customer_phone', customerPhone);
    formData.append('payment_method', paymentMethod);
    formData.append('notes', notes);

    if (state.selectedReceiptFile) {
      formData.append('receipt', state.selectedReceiptFile);
    }

    let saleDataResult = null;
    const isStaticHost = window.location.hostname.includes('github.io') || window.location.protocol === 'file:';

    if (!isStaticHost) {
      try {
        const res = await fetch('/api/sales', { method: 'POST', body: formData });
        if (res.ok) {
          const data = await res.json();
          if (data.success) saleDataResult = data.data;
        }
      } catch (e) {}
    }

    if (!saleDataResult) {
      let receiptBase64 = null;
      const previewImg = document.getElementById('receiptPreviewImg');
      if (previewImg && previewImg.src && previewImg.src.startsWith('data:')) {
        receiptBase64 = previewImg.src;
      }
      saleDataResult = localStore.createSale({
        stock_id: stockId,
        quantity: qty,
        unit_price: state.settings.default_unit_price || 270.00,
        unit_profit: state.settings.default_unit_profit || 50.00,
        customer_name: customerName,
        customer_phone: customerPhone,
        payment_method: paymentMethod,
        receipt_url: receiptBase64,
        notes
      });
    }

    showToast(`Venda ${saleDataResult.sale_code} registrada com sucesso!`, 'success');

    // Limpar formulário
    document.getElementById('saleForm').reset();
    document.getElementById('saleQtyInput').value = '1';
    removeReceiptFile();

    // Recarregar dashboard e estoques
    await loadDashboard();
    updateSaleBreakdown();

    // Redirecionar para o Dashboard
    switchTab('tabDashboard');

  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    updateSaleBreakdown();
  }
}

// ==========================================
// 4. HISTÓRICO DE VENDAS
// ==========================================

async function loadSalesList() {
  try {
    const stockId = document.getElementById('filterSalesStock').value;
    const repasseStatus = document.getElementById('filterSalesRepasse').value;

    let url = '/api/sales?limit=100';
    if (stockId) url += `&stock_id=${stockId}`;
    if (repasseStatus) url += `&repasse_status=${repasseStatus}`;

    const sales = await fetchAPI(url);
    const container = document.getElementById('salesListContainer');
    if (!container) return;

    if (!sales || sales.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding:24px; color:var(--text-muted);">Nenhuma venda encontrada com os filtros selecionados.</div>`;
      return;
    }

    container.innerHTML = sales.map((sale) => {
      const isAndre = sale.stock_id === 'andre';
      const isSettled = sale.repasse_status === 'liquidado';

      return `
        <div class="feed-item">
          <div class="feed-left">
            <div class="feed-avatar ${isAndre ? 'andre' : 'sheyla'}">
              ${isAndre ? 'A' : 'S'}
            </div>
            <div>
              <div class="feed-title">
                ${escapeHTML(sale.customer_name || 'Cliente')} (${sale.quantity}x Amazon Plus)
              </div>
              <div class="feed-meta">
                <span>Código: <strong>${sale.sale_code}</strong></span>
                <span>•</span>
                <span>${formatDateTime(sale.created_at)}</span>
              </div>
              <div class="feed-meta">
                <span style="font-weight:700; color:${isAndre ? 'var(--andre-primary)' : 'var(--sheyla-primary)'}">
                  Estoque ${isAndre ? 'André' : 'Sheyla'}
                </span>
                <span>•</span>
                <span>Pagamento: ${sale.payment_method || 'PIX'}</span>
                ${sale.customer_phone ? `<span>• Tel: ${escapeHTML(sale.customer_phone)}</span>` : ''}
              </div>
              <div style="font-size:0.78rem; color:var(--text-muted); margin-top:4px;">
                Preço: ${formatBRL(sale.total_price)} | Lucro: <strong style="color:var(--color-primary)">${formatBRL(sale.total_profit)}</strong> | Repasse André: <strong style="color:var(--gold-primary)">${formatBRL(sale.total_repasse_andre)}</strong>
              </div>
              ${sale.receipt_url ? `
                <button class="receipt-btn-thumbnail" onclick="openLightbox('${sale.receipt_url}')">
                  📷 Ver Comprovante de Pagamento
                </button>
              ` : ''}
            </div>
          </div>
          <div class="feed-right">
            <div class="feed-amount">${formatBRL(sale.total_price)}</div>
            <div class="feed-badge ${isSettled ? 'badge-settled' : 'badge-pending'}">
              ${isSettled ? '✓ Repasse Liquidado' : '⏳ Repasse Pendente'}
            </div>
            ${!isSettled ? `
              <div style="margin-top:8px;">
                <button class="btn-secondary" style="padding:4px 8px; font-size:0.7rem; color:var(--danger); border-color:#fca5a5;" onclick="confirmDeleteSale(${sale.id}, '${sale.sale_code}')">
                  Excluir / Estornar
                </button>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error(err);
  }
}

async function confirmDeleteSale(id, code) {
  if (!confirm(`Deseja realmente excluir a venda ${code}? O estoque será estornado automaticamente.`)) {
    return;
  }

  try {
    await fetchAPI(`/api/sales/${id}`, { method: 'DELETE' });
    showToast(`Venda ${code} cancelada e estoque estornado!`, 'success');
    loadSalesList();
    loadDashboard();
  } catch (err) {
    console.error(err);
  }
}

// ==========================================
// 5. CONTROLE DE REPASSE AO ANDRÉ
// ==========================================

function setRepassePeriod(period, btn) {
  state.repassePeriod = period;
  document.querySelectorAll('.pill-filter-bar .pill-chip').forEach((p) => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadRepasse();
}

async function loadRepasse() {
  try {
    const data = await fetchAPI(`/api/repasse?period=${state.repassePeriod}`);
    state.repasseSummary = data;

    // Métricas do período
    const totals = data.periodTotals;
    document.getElementById('repasseUnitsPeriod').textContent = `${totals.units_in_period || 0} un.`;
    document.getElementById('repasseGrossPeriod').textContent = formatBRL(totals.gross_in_period);
    document.getElementById('repasseProfitPeriod').textContent = formatBRL(totals.profit_in_period);
    document.getElementById('repasseTotalPeriod').textContent = formatBRL(totals.repasse_in_period);

    // Vendas pendentes do período
    const feed = document.getElementById('repassePendingSalesFeed');
    state.selectedSaleIdsForSettlement = data.pendingSales.map(s => s.id);

    const openSettlementBtn = document.getElementById('btnOpenSettlementModal');
    if (openSettlementBtn) {
      openSettlementBtn.disabled = data.pendingSales.length === 0;
      openSettlementBtn.style.opacity = data.pendingSales.length === 0 ? '0.5' : '1';
    }

    if (!data.pendingSales || data.pendingSales.length === 0) {
      feed.innerHTML = `
        <div style="text-align:center; padding:24px; color:var(--text-muted); font-size:0.88rem;">
          🎉 Nenhuma venda pendente de repasse no período selecionado!
        </div>
      `;
    } else {
      feed.innerHTML = data.pendingSales.map((sale) => {
        const isAndre = sale.stock_id === 'andre';
        return `
          <div class="feed-item">
            <div class="feed-left">
              <input type="checkbox" checked onchange="toggleSaleSettlementSelection(${sale.id}, this)" style="width:18px; height:18px; accent-color:var(--color-primary); cursor:pointer;">
              <div>
                <div class="feed-title">
                  ${escapeHTML(sale.customer_name || 'Cliente')} (${sale.quantity}x Amazon Plus)
                </div>
                <div class="feed-meta">
                  <span>${formatDateTime(sale.created_at)}</span>
                  <span>• Estoque ${isAndre ? 'André' : 'Sheyla'}</span>
                  <span>• Código: ${sale.sale_code}</span>
                </div>
              </div>
            </div>
            <div class="feed-right">
              <div class="feed-amount" style="color:var(--gold-primary);">
                Repasse: ${formatBRL(sale.total_repasse_andre)}
              </div>
              <div style="font-size:0.75rem; color:var(--text-muted);">
                (Venda: ${formatBRL(sale.total_price)} | Lucro: ${formatBRL(sale.total_profit)})
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    // Carregar histórico de liquidações / settlements
    loadSettlementsHistory();

  } catch (err) {
    console.error(err);
  }
}

function toggleSaleSettlementSelection(saleId, checkbox) {
  if (checkbox.checked) {
    if (!state.selectedSaleIdsForSettlement.includes(saleId)) {
      state.selectedSaleIdsForSettlement.push(saleId);
    }
  } else {
    state.selectedSaleIdsForSettlement = state.selectedSaleIdsForSettlement.filter(id => id !== saleId);
  }

  // Recalcular totais dos selecionados
  const sales = state.repasseSummary.pendingSales.filter(s => state.selectedSaleIdsForSettlement.includes(s.id));
  let totalUnits = 0;
  let totalGross = 0;
  let totalProfit = 0;
  let totalRepasse = 0;

  sales.forEach(s => {
    totalUnits += s.quantity;
    totalGross += s.total_price;
    totalProfit += s.total_profit;
    totalRepasse += s.total_repasse_andre;
  });

  document.getElementById('repasseUnitsPeriod').textContent = `${totalUnits} un.`;
  document.getElementById('repasseGrossPeriod').textContent = formatBRL(totalGross);
  document.getElementById('repasseProfitPeriod').textContent = formatBRL(totalProfit);
  document.getElementById('repasseTotalPeriod').textContent = formatBRL(totalRepasse);

  const openSettlementBtn = document.getElementById('btnOpenSettlementModal');
  if (openSettlementBtn) {
    openSettlementBtn.disabled = sales.length === 0;
    openSettlementBtn.style.opacity = sales.length === 0 ? '0.5' : '1';
  }
}

async function loadSettlementsHistory() {
  try {
    const settlements = await fetchAPI('/api/settlements');
    const feed = document.getElementById('settlementsHistoryFeed');
    if (!feed) return;

    if (!settlements || settlements.length === 0) {
      feed.innerHTML = `<div style="text-align:center; padding:18px; color:var(--text-muted); font-size:0.85rem;">Nenhum fechamento registrado ainda.</div>`;
      return;
    }

    feed.innerHTML = settlements.map((set) => {
      return `
        <div class="feed-item">
          <div class="feed-left">
            <div class="feed-avatar" style="background:var(--gold-bg); color:var(--gold-primary); border:1.5px solid var(--gold-border);">
              💸
            </div>
            <div>
              <div class="feed-title">
                Fechamento ${set.settlement_code} (${set.total_units_sold} frascos)
              </div>
              <div class="feed-meta">
                <span>${formatDateTime(set.created_at)}</span>
                <span>• Tipo: ${set.period_type}</span>
                ${set.notes ? `<span>• ${escapeHTML(set.notes)}</span>` : ''}
              </div>
              <div style="margin-top:6px; display:flex; gap:8px;">
                <button class="btn-secondary" style="padding:4px 8px; font-size:0.75rem;" onclick="viewSettlementReceiptModal(${set.id})">
                  📲 Ver Recibo WhatsApp
                </button>
                ${set.payment_receipt_url ? `
                  <button class="receipt-btn-thumbnail" onclick="openLightbox('${set.payment_receipt_url}')">
                    📷 Comprovante PIX
                  </button>
                ` : ''}
              </div>
            </div>
          </div>
          <div class="feed-right">
            <div class="feed-amount" style="color:var(--gold-primary);">
              ${formatBRL(set.total_repasse_amount)}
            </div>
            <div class="feed-badge badge-settled">
              ✓ Quitado ao André
            </div>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error(err);
  }
}

function openSettlementModal() {
  if (state.selectedSaleIdsForSettlement.length === 0) {
    showToast('Nenhuma venda selecionada para repasse.', 'error');
    return;
  }

  const sales = state.repasseSummary.pendingSales.filter(s => state.selectedSaleIdsForSettlement.includes(s.id));
  let totalUnits = 0;
  let totalRepasse = 0;

  sales.forEach(s => {
    totalUnits += s.quantity;
    totalRepasse += s.total_repasse_andre;
  });

  document.getElementById('modalSettlementTotal').textContent = formatBRL(totalRepasse);
  document.getElementById('modalSettlementUnits').textContent = `Referente a ${totalUnits} frasco(s) vendido(s)`;

  const pixDisplay = document.getElementById('settlementPixDisplay');
  pixDisplay.value = state.settings.andre_pix_key || 'Chave PIX não cadastrada (configure na aba Celular)';

  openModal('modalSettlement');
}

async function handleSettlementSubmit(e) {
  e.preventDefault();
  const confirmBtn = document.getElementById('btnConfirmSettlement');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Processando fechamento...';

  try {
    const notes = document.getElementById('settlementNotes').value;
    const fileInput = document.getElementById('settlementReceiptInput');

    const formData = new FormData();
    formData.append('period_type', state.repassePeriod);
    formData.append('sale_ids', JSON.stringify(state.selectedSaleIdsForSettlement));
    formData.append('notes', notes);

    if (fileInput.files && fileInput.files[0]) {
      formData.append('payment_receipt', fileInput.files[0]);
    }

    let settlementResult = null;
    const isStaticHost = window.location.hostname.includes('github.io') || window.location.protocol === 'file:';

    if (!isStaticHost) {
      try {
        const res = await fetch('/api/repasse/settle', { method: 'POST', body: formData });
        if (res.ok) {
          const data = await res.json();
          if (data.success) settlementResult = data.data;
        }
      } catch (e) {}
    }

    if (!settlementResult) {
      settlementResult = localStore.createSettlement({
        period_type: state.repassePeriod,
        sale_ids: state.selectedSaleIdsForSettlement,
        notes
      });
    }

    closeModal('modalSettlement');
    showToast(`Fechamento ${settlementResult.settlement_code} realizado com sucesso!`, 'success');

    // Abre modal com o recibo formatado para WhatsApp
    renderWhatsappReceipt(settlementResult);
    openModal('modalReceiptView');

    // Recarregar dados
    loadRepasse();
    loadDashboard();

  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Confirmar Repasse Feito';
  }
}

async function viewSettlementReceiptModal(settlementId) {
  try {
    const settlement = await fetchAPI(`/api/settlements/${settlementId}`);
    renderWhatsappReceipt(settlement);
    openModal('modalReceiptView');
  } catch (err) {
    console.error(err);
  }
}

function renderWhatsappReceipt(settlement) {
  const text = `🤝 *ACERTO DE REPASSE - AMAZON PLUS* 📦
━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 *Data:* ${formatDateTime(settlement.created_at)}
🔖 *Código:* ${settlement.settlement_code}
👤 *Beneficiário:* André

📦 *Total de Frascos Vendidos:* ${settlement.total_units_sold} unidade(s)
💵 *Preço Unitário Padrão:* R$ 270,00 cada
💰 *Faturamento Total:* ${formatBRL(settlement.total_gross_amount)}
🛡️ *Lucro Retido (R$ 50/un):* ${formatBRL(settlement.total_profit_retained)}

➡️ *VALOR TOTAL DO REPASSE: ${formatBRL(settlement.total_repasse_amount)}*
✅ *Status:* LIQUIDADO VIA PIX
━━━━━━━━━━━━━━━━━━━━━━━━━━
${settlement.notes ? `📝 *Observação:* ${settlement.notes}\n` : ''}Obrigado sócio! Estoque e repasse atualizados no sistema.`;

  document.getElementById('whatsappReceiptText').textContent = text;
}

function copyWhatsappText() {
  const text = document.getElementById('whatsappReceiptText').textContent;
  navigator.clipboard.writeText(text).then(() => {
    showToast('Recibo copiado! Abra o WhatsApp do André e cole.', 'success');
  }).catch(() => {
    showToast('Não foi possível copiar automaticamente.', 'error');
  });
}

function copyAndrePixKey() {
  const key = document.getElementById('settlementPixDisplay').value;
  if (!key || key.includes('não cadastrada')) {
    showToast('Cadastre a chave PIX do André na aba Celular/Configurações.', 'error');
    return;
  }
  navigator.clipboard.writeText(key).then(() => {
    showToast('Chave PIX copiada!', 'success');
  });
}

// ==========================================
// 6. MODAIS: ENTRADA / SAÍDA / EMPRÉSTIMOS
// ==========================================

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('active');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
}

// Modal Estoque Ajuste
function openStockAdjustModal(stockId, movementType = 'entrada') {
  document.getElementById('adjustStockId').value = stockId;
  document.getElementById('adjustMovementType').value = movementType;

  const isAndre = stockId === 'andre';
  const personName = isAndre ? 'André' : 'Sheyla';
  const title = movementType === 'entrada' ? `Entrada no Estoque de ${personName}` : `Ajuste / Baixa de Estoque de ${personName}`;

  document.getElementById('modalStockAdjustTitle').textContent = title;
  document.getElementById('adjustStockPersonLabel').textContent = `Estoque Selecionado: ${personName}`;
  document.getElementById('adjustQuantity').value = '10';
  document.getElementById('adjustNotes').value = '';

  openModal('modalStockAdjust');
}

async function handleStockAdjustSubmit(e) {
  e.preventDefault();
  const stockId = document.getElementById('adjustStockId').value;
  const movementType = document.getElementById('adjustMovementType').value;
  const rawQty = parseInt(document.getElementById('adjustQuantity').value, 10);
  const notes = document.getElementById('adjustNotes').value;

  const delta = movementType === 'entrada' ? rawQty : -rawQty;

  try {
    await fetchAPI('/api/stocks/adjust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stock_id: stockId,
        delta,
        type: movementType,
        notes
      })
    });

    closeModal('modalStockAdjust');
    showToast(`Estoque de ${stockId === 'andre' ? 'André' : 'Sheyla'} atualizado com sucesso!`, 'success');
    loadDashboard();
    loadStocksData();
  } catch (err) {
    console.error(err);
  }
}

// Modal Empréstimo André <-> Sheyla
function openLoanModal(defaultLender = 'andre', defaultBorrower = 'sheyla') {
  const lenderSelect = document.getElementById('loanLender');
  const borrowerSelect = document.getElementById('loanBorrower');

  if (lenderSelect) lenderSelect.value = defaultLender;
  if (borrowerSelect) borrowerSelect.value = defaultBorrower;

  document.getElementById('loanQuantity').value = '1';
  document.getElementById('loanNotes').value = '';

  openModal('modalLoan');
}

function syncLoanBorrower() {
  const lender = document.getElementById('loanLender').value;
  const borrowerSelect = document.getElementById('loanBorrower');
  borrowerSelect.value = lender === 'andre' ? 'sheyla' : 'andre';
}

async function handleLoanSubmit(e) {
  e.preventDefault();
  const lender = document.getElementById('loanLender').value;
  const borrower = lender === 'andre' ? 'sheyla' : 'andre';
  const qty = parseInt(document.getElementById('loanQuantity').value, 10);
  const notes = document.getElementById('loanNotes').value;

  try {
    await fetchAPI('/api/loans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lender_stock_id: lender,
        borrower_stock_id: borrower,
        quantity: qty,
        notes
      })
    });

    closeModal('modalLoan');
    showToast(`Empréstimo de ${qty} un. registrado com sucesso!`, 'success');
    loadDashboard();
    loadStocksData();
  } catch (err) {
    console.error(err);
  }
}

// Modal Devolução de Empréstimo
function openReturnLoanModal(loanId, lenderName, borrowerName, pendingQty) {
  document.getElementById('returnLoanId').value = loanId;
  document.getElementById('returnLoanDesc').innerHTML = `
    <strong>Devolução:</strong> ${borrowerName} devolvendo para ${lenderName}.
    <br><span style="color:var(--text-muted); font-size:0.8rem;">Saldo pendente atual: ${pendingQty} frascos.</span>
  `;
  const qtyInput = document.getElementById('returnQuantity');
  qtyInput.value = pendingQty;
  qtyInput.max = pendingQty;
  document.getElementById('returnNotes').value = '';

  openModal('modalReturnLoan');
}

async function handleReturnLoanSubmit(e) {
  e.preventDefault();
  const loanId = document.getElementById('returnLoanId').value;
  const qty = parseInt(document.getElementById('returnQuantity').value, 10);
  const notes = document.getElementById('returnNotes').value;

  try {
    await fetchAPI(`/api/loans/${loanId}/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quantity: qty,
        notes
      })
    });

    closeModal('modalReturnLoan');
    showToast(`Devolução de ${qty} un. registrada com sucesso!`, 'success');
    loadDashboard();
    loadStocksData();
  } catch (err) {
    console.error(err);
  }
}

// ==========================================
// 7. LIGHTBOX (VISUALIZADOR DE COMPROVANTES)
// ==========================================

function openLightbox(url) {
  const overlay = document.getElementById('lightboxOverlay');
  const img = document.getElementById('lightboxImg');
  if (overlay && img) {
    img.src = url;
    overlay.classList.add('active');
  }
}

function closeLightbox() {
  const overlay = document.getElementById('lightboxOverlay');
  if (overlay) overlay.classList.remove('active');
}

// ==========================================
// 8. CONEXÃO CELULAR & CONFIGURAÇÕES (TÚNEL WEB 4G)
// ==========================================

async function loadNetworkInfo() {
  try {
    const data = await fetchAPI('/api/network-info');
    state.networkInfo = data;

    const qrImg = document.getElementById('networkQrCodeImg');
    const urlDisplay = document.getElementById('networkUrlDisplay');
    const badge = document.getElementById('tunnelStatusBadge');
    const toggleBtn = document.getElementById('btnToggleTunnel');

    const effectiveUrl = data.activeUrl || data.networkUrl;

    if (qrImg && data.qrCodeDataUrl) qrImg.src = data.qrCodeDataUrl;
    if (urlDisplay) urlDisplay.textContent = effectiveUrl;

    if (badge) {
      if (data.tunnel && data.tunnel.active) {
        badge.textContent = `● Túnel Web 4G Ativo (${data.tunnel.provider || 'Cloudflare'})`;
        badge.style.background = '#dcfce7';
        badge.style.color = '#15803d';
        if (toggleBtn) toggleBtn.textContent = '🔄 Reconectar Túnel';
      } else {
        badge.textContent = '○ Apenas Wi-Fi Local (Túnel Inativo)';
        badge.style.background = '#fef3c7';
        badge.style.color = '#92400e';
        if (toggleBtn) toggleBtn.textContent = '⚡ Ativar Acesso Web 4G';
      }
    }
  } catch (err) {
    console.error(err);
  }
}

async function toggleTunnelAction() {
  const toggleBtn = document.getElementById('btnToggleTunnel');
  if (toggleBtn) {
    toggleBtn.disabled = true;
    toggleBtn.textContent = 'Conectando túnel web...';
  }

  try {
    const isCurrentlyActive = state.networkInfo && state.networkInfo.tunnel && state.networkInfo.tunnel.active;
    if (isCurrentlyActive) {
      await fetchAPI('/api/tunnel/stop', { method: 'POST' });
    }
    const result = await fetchAPI('/api/tunnel/start', { method: 'POST' });
    showToast(`Túnel Web Ativo! Link público: ${result.publicUrl}`, 'success');
    await loadNetworkInfo();
  } catch (err) {
    showToast(`Erro ao iniciar túnel: ${err.message}`, 'error');
  } finally {
    if (toggleBtn) toggleBtn.disabled = false;
  }
}

function copyWhatsappShareMessage() {
  const url = (state.networkInfo && (state.networkInfo.activeUrl || state.networkInfo.networkUrl)) || window.location.origin;
  const message = `🌿 *AMAZON PLUS - ACESSO AO SISTEMA* 📱
━━━━━━━━━━━━━━━━━━━━━━━━━━
Fala sócios! Segue o link de acesso ao sistema do Amazon Plus para abrir no celular no 4G de qualquer lugar:

🔗 ${url}

👉 *Como salvar como aplicativo no celular:*
🍏 *No iPhone:* Abra o link no Safari > Toque em Compartilhar > Selecione "Adicionar à Tela de Início".
🤖 *No Android:* Abra no Chrome > Toque nos 3 pontinhos (⋮) > Selecione "Instalar aplicativo".
━━━━━━━━━━━━━━━━━━━━━━━━━━
O app abre direto em tela cheia com estoque e vendas integrados!`;

  navigator.clipboard.writeText(message).then(() => {
    showToast('Mensagem copiada! Envie para o WhatsApp do André e da Sheyla.', 'success');
  }).catch(() => {
    showToast('Não foi possível copiar automaticamente.', 'error');
  });
}

function copyNetworkUrl() {
  const url = (state.networkInfo && (state.networkInfo.activeUrl || state.networkInfo.networkUrl)) || window.location.origin;
  navigator.clipboard.writeText(url).then(() => {
    showToast('Link de acesso copiado!', 'success');
  });
}

async function loadSettings() {
  try {
    const settings = await fetchAPI('/api/settings');
    state.settings = { ...state.settings, ...settings };

    const pixInput = document.getElementById('cfgAndrePix');
    const priceInput = document.getElementById('cfgUnitPrice');
    const profitInput = document.getElementById('cfgUnitProfit');
    const repasseDisplay = document.getElementById('cfgUnitRepasseDisplay');

    if (pixInput) pixInput.value = settings.andre_pix_key || '';
    if (priceInput) priceInput.value = parseFloat(settings.default_unit_price || 270.00).toFixed(2);
    if (profitInput) profitInput.value = parseFloat(settings.default_unit_profit || 50.00).toFixed(2);

    const price = parseFloat(settings.default_unit_price || 270.00);
    const profit = parseFloat(settings.default_unit_profit || 50.00);
    if (repasseDisplay) repasseDisplay.value = formatBRL(price - profit);

  } catch (err) {
    console.error(err);
  }
}

async function handleSaveSettings(e) {
  e.preventDefault();
  const pix = document.getElementById('cfgAndrePix').value;
  const price = parseFloat(document.getElementById('cfgUnitPrice').value || 270.00);
  const profit = parseFloat(document.getElementById('cfgUnitProfit').value || 50.00);
  const repasse = price - profit;

  try {
    await fetchAPI('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        andre_pix_key: pix,
        default_unit_price: price.toFixed(2),
        default_unit_profit: profit.toFixed(2),
        default_unit_repasse: repasse.toFixed(2)
      })
    });

    state.settings.andre_pix_key = pix;
    state.settings.default_unit_price = price;
    state.settings.default_unit_profit = profit;
    state.settings.default_unit_repasse = repasse;

    showToast('Configurações salvas com sucesso!', 'success');
    updateSaleBreakdown();
  } catch (err) {
    console.error(err);
  }
}

// Helper: Escape HTML
function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==========================================
// INICIALIZAÇÃO
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
  // Service Worker Registration for PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.log('SW Registration skipped in current context:', err);
    });
  }

  // Refresh button
  const btnRefresh = document.getElementById('btnRefresh');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      showToast('Atualizando dados...', 'success');
      loadDashboard();
      if (state.currentTab === 'tabStocks') loadStocksData();
      if (state.currentTab === 'tabSales') loadSalesList();
      if (state.currentTab === 'tabRepasse') loadRepasse();
    });
  }

  // Initial loads
  loadSettings().then(() => {
    loadDashboard();
  });
});
