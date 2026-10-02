/* ============================================================
   FINANÇA — script.js
   Vanilla JS · Firebase Nuvem
   ============================================================ */
'use strict';

/* ============================================================
   🔥 CONFIGURAÇÃO DO FIREBASE
   ============================================================ */
const firebaseConfig = {
  apiKey: "AIzaSyCv4Ewn8SW9jKndQE2AG0f8v0vdALn6j9Y",
  authDomain: "financa-app-e2e7f.firebaseapp.com",
  projectId: "financa-app-e2e7f",
  storageBucket: "financa-app-e2e7f.firebasestorage.app",
  messagingSenderId: "535509838378",
  appId: "1:535509838378:web:311b8604f0c14efed3b153",
  measurementId: "G-1FG2Y8S27F"
};

// Inicializa o Firebase
let db = null;
try { firebase.initializeApp(firebaseConfig); db = firebase.firestore(); } catch (e) { console.warn('Firebase indisponível:', e); }

// Aponta para um documento único que vai guardar todos os seus dados na nuvem
let cloudDataRef = null; // definido após o login: usuarios/{uid}

/* ============================================================
   ESTADO GLOBAL
   ============================================================ */
let state = {
  saldoBase:    {},
  transactions: [],
  accounts:     [],
  piggies:      [],
  budgets:      {},
  ignorados:    [],
  transfers:    [],
  cards:        [],
  currentYear:  new Date().getFullYear(),
  currentMonth: new Date().getMonth(),
  filters: { tipo: 'all', status: 'all', frequencia: 'all', conta: 'all', categoria: 'all', search: '', minVal: '', maxVal: '' },
  editingTxId: null, editingAccountId: null, editingPiggyId: null,
  deletingType: null, deletingId: null, depositPiggyId: null,
};

/* --- PROTEÇÃO XSS (Escapa tags HTML injetadas pelo usuário) --- */
const esc = str => str ? String(str).replace(/[&<>'"]/g, tag => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[tag] || tag)) : '';

/* ============================================================
   UTILITÁRIOS
   ============================================================ */
const uid   = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
const toBRL = v  => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v ?? 0);
const clamp = (v,mn,mx) => Math.min(Math.max(v,mn),mx);
const monthKey = (y, m) => `${y}-${String(m+1).padStart(2,'0')}`;
const monthLabel = (y, m) => new Date(y, m, 1).toLocaleDateString('pt-BR', { month:'long', year:'numeric' });
const fmtDate = iso => { if (!iso) return ''; const [,mon,d] = iso.split('-'); return `${d}/${mon}`; };

const CATEGORY_ICONS = { alimentacao:'🛒', transporte:'🚗', moradia:'🏠', saude:'💊', lazer:'🎬', educacao:'📚', vestuario:'👕', assinaturas:'📱', outros:'📦', salario:'💼', freelance:'💻', investimento:'📈', presente:'🎁', reembolso:'↩️', 'outros-entrada':'✨' };
const catIcon = cat => CATEGORY_ICONS[cat] || '💰';
const CATEGORY_LABELS = { alimentacao:'Alimentação', transporte:'Transporte', moradia:'Moradia', saude:'Saúde', lazer:'Lazer', educacao:'Educação', vestuario:'Vestuário', assinaturas:'Assinaturas', outros:'Outros', salario:'Salário', freelance:'Freelance', investimento:'Investimento', presente:'Presente', reembolso:'Reembolso', 'outros-entrada':'Outros (entrada)' };
const CAT_SAIDA = ['alimentacao','transporte','moradia','saude','lazer','educacao','vestuario','assinaturas','outros'];
const CAT_ENTRADA = ['salario','freelance','investimento','presente','reembolso','outros-entrada'];
const pad2 = n => String(n).padStart(2, '0');
const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; };
const isoToTs = iso => { const [y,m,d] = iso.split('-').map(Number); return new Date(y, m-1, d).getTime(); };
const addMonthsClamp = (y, m0, d, i) => {
  const t = m0 + i, yy = y + Math.floor(t / 12), mm = ((t % 12) + 12) % 12;
  const dd = Math.min(d, new Date(yy, mm + 1, 0).getDate());
  return { iso: `${yy}-${pad2(mm+1)}-${pad2(dd)}`, ts: new Date(yy, mm, dd).getTime() };
};
const txDate = tx => tx.data ? new Date(isoToTs(tx.data)) : new Date(tx.createdAt);
const piggySaved = p => parseFloat(((p.base || 0) + (p.movs || []).reduce((a, v) => a + v.valor, 0)).toFixed(2));
const piggyForecast = (p, saved) => {
  if (!p.deadline) return '';
  const br = p.deadline.split('-').reverse().join('/');
  if (saved >= p.meta) return `Retirada em ${br}`;
  const dl = new Date(p.deadline + 'T00:00:00'), now = new Date();
  if (dl < now) return 'Prazo vencido';
  const meses = (dl.getFullYear() - now.getFullYear()) * 12 + dl.getMonth() - now.getMonth();
  return `Guardar ${toBRL((p.meta - saved) / Math.max(1, meses))}/mês até ${br}`;
};
const ACCOUNT_TYPE_LABELS = { corrente:'Conta Corrente', poupanca:'Poupança', digital:'Conta Digital', investimento:'Investimento', dinheiro:'Dinheiro em Espécie', outro:'Outro' };
const ACCOUNT_TYPE_ICONS = { corrente:'🏦', poupanca:'💰', digital:'📱', investimento:'📈', dinheiro:'💵', outro:'📦' };

/* ============================================================
   CÁLCULOS DO MÊS (ATUALIZADOS COM LOGICA DO SALDO REAL)
   ============================================================ */
const txOfMonthYM = (y, m) => state.transactions.filter(tx => { const d = txDate(tx); return d.getFullYear() === y && d.getMonth() === m; });
// Movimentação líquida dos cofrinhos no mês (depósitos positivos, retiradas negativas)
const piggyNetYM = (y, m) => state.piggies.reduce((s, p) => s + (p.movs || []).filter(v => v.data.slice(0, 7) === monthKey(y, m)).reduce((a, v) => a + v.valor, 0), 0);

const faturaVenc = (card, iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  let mesFech = m - 1 + (d > card.fechamento ? 1 : 0);
  if (card.vencimento <= card.fechamento) mesFech += 1;
  return addMonthsClamp(y, mesFech, card.vencimento, 0);
};
const accountBalance = id => {
  const acc = state.accounts.find(a => a.id === id) || {};
  const mov = state.transactions.filter(t => t.contaId === id && t.status === 'pago').reduce((x, t) => x + (t.tipo === 'entrada' ? t.valor : -t.valor), 0);
  const tr = state.transfers.reduce((x, t) => x + (t.para === id ? t.valor : 0) - (t.de === id ? t.valor : 0), 0);
  const pg = state.piggies.filter(p => p.contaId === id).reduce((x, p) => x + (p.movs || []).reduce((a, v) => a + v.valor, 0), 0);
  return parseFloat(((acc.ajuste || 0) + mov + tr - pg).toFixed(2));
};
const monthDelta = (y, m) => {
  const txs = txOfMonthYM(y, m);
  const soma = tipo => txs.filter(t => t.tipo === tipo && t.status === 'pago').reduce((a, t) => a + t.valor, 0);
  return soma('entrada') - soma('saida') - piggyNetYM(y, m);
};

// Saldo no início do mês: valor manual (se houver) ou a sobra do mês anterior,
// encadeada mês a mês desde o primeiro mês com dados.
const getSaldoInicial = (y, m) => {
  const idx = (yy, mm) => yy * 12 + mm;
  const meses = [
    ...Object.keys(state.saldoBase).map(k => { const [a, b] = k.split('-').map(Number); return idx(a, b - 1); }),
    ...state.transactions.map(t => { const d = txDate(t); return idx(d.getFullYear(), d.getMonth()); }),
    ...state.piggies.flatMap(p => (p.movs || []).map(v => idx(+v.data.slice(0, 4), +v.data.slice(5, 7) - 1))),
  ];
  const alvo = idx(y, m);
  if (!meses.length || Math.min(...meses) > alvo) return state.saldoBase[monthKey(y, m)] ?? 0;
  let saldo = 0;
  for (let cur = Math.min(...meses); cur < alvo; cur++) {
    const cy = Math.floor(cur / 12), cm = cur % 12;
    const manual = state.saldoBase[monthKey(cy, cm)];
    if (manual !== undefined) saldo = manual;
    saldo += monthDelta(cy, cm);
  }
  return state.saldoBase[monthKey(y, m)] ?? saldo;
};

const calcTotals = () => {
  const y = state.currentYear, m = state.currentMonth;
  const txs = txOfMonthYM(y, m);
  
  const saldoInicial = getSaldoInicial(y, m); // O que sobrou do mês passado
  
  const entradas = txs.filter(t => t.tipo === 'entrada');
  const totalEntradas = entradas.reduce((a,t) => a + t.valor, 0);
  const entradasPagas = entradas.filter(t => t.status === 'pago').reduce((a,t) => a + t.valor, 0);
  
  const saidas = txs.filter(t => t.tipo === 'saida');
  const totalSaidas = saidas.reduce((a,t) => a + t.valor, 0);         
  const saidasPagas = saidas.filter(t => t.status === 'pago').reduce((a,t) => a + t.valor, 0); 
  const saidasPendentes = totalSaidas - saidasPagas;                      
  
  // Saldo atual muda instantaneamente conforme marca coisas como pagas
  const guardadoMes = piggyNetYM(y, m);
  const saldoAtual = saldoInicial + entradasPagas - saidasPagas - guardadoMes;
  const sobras = saldoInicial + totalEntradas - totalSaidas - guardadoMes;

  return { guardadoMes, saldoInicial, saldoAtual, totalEntradas, totalAPagar: totalSaidas, totalPago: saidasPagas, faltaPagar: saidasPendentes, sobras };
};

/* ============================================================
   PERSISTENCIA — LocalStorage (backup local sempre ativo)
   ============================================================ */
const LOCAL_KEY = 'financa_backup_v1';
const snapshot = () => ({ saldoBase: state.saldoBase, transactions: state.transactions, accounts: state.accounts, piggies: state.piggies, budgets: state.budgets, ignorados: state.ignorados, transfers: state.transfers, cards: state.cards });
const applyData = d => {
  state.saldoBase = d.saldoBase || {}; state.transactions = d.transactions || []; state.accounts = d.accounts || [];
  state.budgets = d.budgets || {}; state.ignorados = d.ignorados || []; state.transfers = d.transfers || []; state.cards = d.cards || [];
  // Cofrinhos antigos: o valor já guardado vira "base" (não sai do saldo); novos movimentos saem.
  state.piggies = (d.piggies || []).map(p => p.movs ? p : { ...p, movs: [], base: p.guardado || 0 });
};

const saveLocal = () => {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(snapshot()));
  } catch(e) { console.warn('Erro ao salvar local:', e); }
};

const loadLocal = () => {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    // So restaura se tiver algum dado real (nao sobrescreve com vazio)
    if (!d.transactions?.length && !d.accounts?.length && !d.piggies?.length &&
        !Object.keys(d.saldoBase || {}).length) return false;
    applyData(d);
    return true;
  } catch(e) { return false; }
};

/* ============================================================
   PERSISTENCIA NA NUVEM (Firebase .get() — sem WebChannel)
   ============================================================ */
const startCloudListener = () => {
  if (!cloudDataRef) { loadLocal(); render(); showToast('Modo offline: usando dados locais.'); return; }
  cloudDataRef.get().then((doc) => {
    if (doc.exists) {
      const data = doc.data();
      // Verifica se o Firestore retornou dados reais (nao vazio)
      const hasCloud =
        (data.transactions?.length > 0) ||
        (data.accounts?.length > 0) ||
        (data.piggies?.length > 0) ||
        (Object.keys(data.saldoBase || {}).length > 0);

      if (hasCloud) {
        // Dados na nuvem existem: usa eles e atualiza o backup local
        if (localChanged) { saveState(); } else { applyData(data); saveLocal(); }
      } else {
        // Nuvem veio vazia: tenta restaurar do backup local
        const restoredLocal = loadLocal();
        if (restoredLocal) {
          // Tinha dados locais: sobe eles para a nuvem
          saveState();
          showToast('Dados restaurados do backup local.');
        }
        // Se nao tinha nada nem local, continua com state vazio (primeiro uso)
      }
    } else {
      // Documento nao existe no Firestore
      // Tenta restaurar do backup local antes de criar documento vazio
      const restoredLocal = loadLocal();
      if (restoredLocal) {
        saveState(); // Sobe os dados locais para a nuvem
        showToast('Dados restaurados do backup local.');
      }
      // Se nao tinha local, e primeira vez mesmo
    }
    render();
  }).catch((error) => {
    console.error('Erro ao ler da nuvem:', error);
    // Falha de rede: usa backup local se disponivel
    const restoredLocal = loadLocal();
    if (restoredLocal) {
      showToast('Modo offline — usando dados locais.');
    } else {
      showToast('Sem conexao com a nuvem.');
    }
    render();
    // Tenta reconectar em 8 segundos
    setTimeout(startCloudListener, 8000);
  });
};

let localChanged = false;
const persist = () => {
  localChanged = true;
  saveLocal();
  if (!cloudDataRef) return;
  cloudDataRef.set(snapshot()).catch((error) => {
    console.error('Erro ao salvar na nuvem:', error);
    showToast('Salvo no aparelho. Nuvem indisponível no momento.');
  });
};
const saveState = () => { persist(); render(); };

// Gera os lançamentos "fixos" do mês anterior ao abrir um mês (até o mês seguinte ao atual)
const ensureRecurring = (y, m) => {
  const now = new Date();
  if (y * 12 + m > now.getFullYear() * 12 + now.getMonth() + 1) return;
  const py = m === 0 ? y - 1 : y, pm = m === 0 ? 11 : m - 1, mk = monthKey(y, m);
  const atual = txOfMonthYM(y, m); let criou = false;
  txOfMonthYM(py, pm).filter(t => t.frequencia === 'fixa').forEach(t => {
    const root = t.origem || t.id;
    if (atual.some(a => (a.origem || a.id) === root || (a.descricao === t.descricao && a.tipo === t.tipo)) || state.ignorados.includes(`${root}|${mk}`)) return;
    const dt = addMonthsClamp(y, m, txDate(t).getDate(), 0);
    state.transactions.push({ ...t, id: uid(), origem: root, status: 'pendente', data: dt.iso, createdAt: dt.ts });
    criou = true;
  });
  if (criou) persist();
};

/* ============================================================
   REFERÊNCIAS DOM E TOAST
   ============================================================ */
const $ = id => document.getElementById(id);
const el = {
  currentMonthLabel: $('currentMonthLabel'), prevMonth: $('prevMonth'), nextMonth: $('nextMonth'),
  tabBtns: document.querySelectorAll('.tab-btn'), tabPanels: document.querySelectorAll('.tab-panel'),
  saldoConta: $('saldoConta'), editBalanceBtn: $('editBalanceBtn'),
  totalAPagar: $('totalAPagar'), totalPago: $('totalPago'), faltaPagar: $('faltaPagar'), sobras: $('sobras'), sobrasCard: $('sobrasCard'),
  accountsList: $('accountsList'), categoryBreakdown: $('categoryBreakdown'), categoryMonthHint: $('categoryMonthHint'), openAccountFormBtn: $('openAccountFormBtn'),
  openFormBtn: $('openFormBtn'), filterToggleBtn: $('filterToggleBtn'), filterPanel: $('filterPanel'), filterCountBadge: $('filterCountBadge'),
  filterTipo: $('filterTipo'), filterStatus: $('filterStatus'), filterFrequencia: $('filterFrequencia'), filterConta: $('filterConta'), filterCategoria: $('filterCategoria'), filterSearch: $('filterSearch'), filterMinVal: $('filterMinVal'), filterMaxVal: $('filterMaxVal'), clearFiltersBtn: $('clearFiltersBtn'), resultsInfo: $('resultsInfo'), resultsCount: $('resultsCount'), resultsTotal: $('resultsTotal'), transactionsList: $('transactionsList'), emptyState: $('emptyState'),
  piggyTotal: $('piggyTotal'), piggyGoalSummary: $('piggyGoalSummary'), openPiggyFormBtn: $('openPiggyFormBtn'), piggyList: $('piggyList'), piggyEmptyState: $('piggyEmptyState'),
  balanceModal: $('balanceModal'), balanceInput: $('balanceInput'), saveBalanceBtn: $('saveBalanceBtn'), cancelBalanceBtn: $('cancelBalanceBtn'),
  accountModal: $('accountModal'), accountModalTitle: $('accountModalTitle'), accountNameInput: $('accountNameInput'), accountTypeInput: $('accountTypeInput'), accountColorPicker: $('accountColorPicker'), saveAccountBtn: $('saveAccountBtn'), cancelAccountBtn: $('cancelAccountBtn'),
  formModal: $('formModal'), formModalTitle: $('formModalTitle'), tipoToggle: $('tipoToggle'), descricaoInput: $('descricaoInput'), categoriaInput: $('categoriaInput'), contaInput: $('contaInput'), valorInput: $('valorInput'), frequenciaInput: $('frequenciaInput'), statusToggle: $('statusToggle'), dataInput: $('dataInput'), saveFormBtn: $('saveFormBtn'), cancelFormBtn: $('cancelFormBtn'),
  piggyModal: $('piggyModal'), piggyModalTitle: $('piggyModalTitle'), piggyNameInput: $('piggyNameInput'), piggyEmojiPicker: $('piggyEmojiPicker'), piggyGoalInput: $('piggyGoalInput'), piggySavedInput: $('piggySavedInput'), piggyAccountInput: $('piggyAccountInput'), piggyStartInput: $('piggyStartInput'), piggyDeadlineInput: $('piggyDeadlineInput'), savePiggyBtn: $('savePiggyBtn'), cancelPiggyBtn: $('cancelPiggyBtn'),
  piggyDepositModal: $('piggyDepositModal'), piggyDepositSub: $('piggyDepositSub'), depositAmountInput: $('depositAmountInput'), saveDepositBtn: $('saveDepositBtn'), cancelDepositBtn: $('cancelDepositBtn'),
  deleteModal: $('deleteModal'), deleteModalTitle: $('deleteModalTitle'), confirmDeleteBtn: $('confirmDeleteBtn'), cancelDeleteBtn: $('cancelDeleteBtn'),
  toast: $('toast'),
};

let _toastTimer = null;
const showToast = (msg, action) => {
  clearTimeout(_toastTimer); el.toast.textContent = msg;
  if (action) {
    const b = document.createElement('button'); b.className = 'toast-action'; b.textContent = action.label;
    b.onclick = () => { el.toast.classList.remove('show'); action.fn(); };
    el.toast.appendChild(b);
  }
  el.toast.classList.add('show');
  _toastTimer = setTimeout(() => el.toast.classList.remove('show'), action ? 6000 : 2800);
};

const openModal  = ov => { ov.classList.add('open'); document.body.style.overflow = 'hidden'; };
const closeModal = ov => { ov.classList.remove('open'); document.body.style.overflow = ''; ov.querySelector('.modal-card').style.transform = ''; };
const onOverlay  = (e, ov) => { if (e.target === ov) closeModal(ov); };

const switchTab = tabId => {
  el.tabBtns.forEach(b => {
    const isActive = b.dataset.tab === tabId;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  el.tabPanels.forEach(p => p.classList.toggle('active', p.id === `tab-${tabId}`));
};

const getToggle = wrap => wrap.querySelector('.toggle-btn.active')?.dataset.value ?? null;
const setToggle = (wrap, val) => wrap.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.value === val));

/* ============================================================
   RENDERIZAÇÃO
   ============================================================ */
const renderHeader = () => { el.currentMonthLabel.textContent = monthLabel(state.currentYear, state.currentMonth); };

const renderDashboard = () => {
  const { saldoInicial, saldoAtual, totalAPagar, totalPago, faltaPagar, sobras, guardadoMes } = calcTotals();
  el.saldoConta.textContent  = toBRL(saldoAtual); 
  el.totalAPagar.textContent = toBRL(totalAPagar);
  el.totalPago.textContent   = toBRL(totalPago);
  el.faltaPagar.textContent  = toBRL(faltaPagar);
  el.sobras.textContent      = toBRL(sobras);
  el.sobrasCard.className = `summary-card ${sobras < 0 ? 'card--red' : 'card--blue'}`;
  $('balanceSub').textContent = `Sobra do mês anterior: ${toBRL(saldoInicial)}` + (guardadoMes ? ` · Cofrinhos no mês: ${guardadoMes > 0 ? '-' : '+'}${toBRL(Math.abs(guardadoMes))}` : '');
  renderAccounts(); renderCategoryBreakdown(); renderChart(); renderCards();
};

const renderChart = () => {
  const NOMES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'], dados = [];
  for (let k = 5; k >= 0; k--) {
    const t = state.currentYear * 12 + state.currentMonth - k, txs = txOfMonthYM(Math.floor(t / 12), t % 12);
    const soma = tp => txs.filter(x => x.tipo === tp).reduce((a, x) => a + x.valor, 0);
    dados.push({ nome: NOMES[t % 12], e: soma('entrada'), s: soma('saida') });
  }
  const max = Math.max(1, ...dados.flatMap(d => [d.e, d.s]));
  const bar = (x, v, cls) => { const h = Math.round((v / max) * 90); return `<rect class="${cls}" x="${x}" y="${100 - h}" width="14" height="${h}" rx="3"/>`; };
  $('monthChart').innerHTML = `<svg viewBox="0 0 300 120" role="img" aria-label="Entradas e saídas dos últimos 6 meses">${dados.map((d, i) => bar(12 + i * 48, d.e, 'bar-in') + bar(28 + i * 48, d.s, 'bar-out') + `<text x="${27 + i * 48}" y="115" text-anchor="middle">${d.nome}</text>`).join('')}</svg>`;
};
const renderCards = () => {
  const box = $('cardsList');
  if (!state.cards.length) { box.innerHTML = '<span class="input-hint">Nenhum cartão cadastrado.</span>'; return; }
  const txs = txOfMonthYM(state.currentYear, state.currentMonth);
  box.innerHTML = state.cards.map(c => {
    const f = txs.filter(t => t.cartaoId === c.id), total = f.reduce((a, t) => a + t.valor, 0), pend = f.some(t => t.status !== 'pago');
    return `
    <div class="account-card">
      <div class="account-dot">💳</div>
      <div class="account-info">
        <div class="account-name">${esc(c.nome)}</div>
        <div class="account-type">Fecha dia ${c.fechamento} · vence dia ${c.vencimento}</div>
        <div class="account-balance">Fatura do mês: ${toBRL(total)}${f.length && !pend ? ' · paga' : ''}</div>
      </div>
      <div class="account-actions">
        ${pend ? `<button class="account-action-btn" data-action="pay-card" data-id="${c.id}" aria-label="Pagar fatura">✅</button>` : ''}
        <button class="account-action-btn" data-action="edit-card" data-id="${c.id}" aria-label="Editar cartão">✏️</button>
        <button class="account-action-btn delete" data-action="delete-card" data-id="${c.id}" aria-label="Excluir cartão">🗑️</button>
      </div>
    </div>`;
  }).join('');
};
const renderAccounts = () => {
  if (!state.accounts.length) {
    el.accountsList.innerHTML = `<p style="font-size:var(--fs-sm);color:var(--text-muted);padding:var(--sp-3) 0 var(--sp-5)">Nenhuma conta cadastrada.</p>`;
    return;
  }
  el.accountsList.innerHTML = state.accounts.map(acc => `
    <div class="account-card">
      <div class="account-dot" style="background:${esc(acc.cor)}">${ACCOUNT_TYPE_ICONS[acc.tipo] || '🏦'}</div>
      <div class="account-info">
        <div class="account-name">${esc(acc.nome)}</div>
        <div class="account-type">${ACCOUNT_TYPE_LABELS[acc.tipo] || acc.tipo}</div>
        <div class="account-balance" data-balance="${acc.id}" role="button" tabindex="0">${toBRL(accountBalance(acc.id))}</div>
      </div>
      <div class="account-actions">
        <button class="account-action-btn" data-action="edit-account" data-id="${acc.id}" aria-label="Editar conta">✏️</button>
        <button class="account-action-btn delete" data-action="delete-account" data-id="${acc.id}" aria-label="Excluir conta">🗑️</button>
      </div>
    </div>`).join('');
};

const renderCategoryBreakdown = () => {
  const txs = txOfMonthYM(state.currentYear, state.currentMonth).filter(t => t.tipo === 'saida');
  const total = txs.reduce((a,t) => a + t.valor, 0);
  if (el.categoryMonthHint) el.categoryMonthHint.textContent = monthLabel(state.currentYear, state.currentMonth) + ' · toque para definir limite';
  if (!txs.length) { el.categoryBreakdown.innerHTML = `<p style="font-size:var(--fs-sm);color:var(--text-muted);padding:var(--sp-2) 0 var(--sp-5)">Sem saídas registradas.</p>`; return; }
  
  const map = {}; txs.forEach(t => { map[t.categoria] = (map[t.categoria]||0) + t.valor; });
  const sorted = Object.entries(map).sort((a,b) => b[1]-a[1]);

  el.categoryBreakdown.innerHTML = sorted.map(([cat, val]) => {
    const limite = state.budgets[cat] || 0;
    const pct = limite > 0 ? Math.min(100, Math.round((val/limite)*100)) : (total > 0 ? Math.round((val/total)*100) : 0);
    const cls = limite > 0 ? (val > limite ? ' over' : val >= limite*0.8 ? ' warn' : '') : '';
    return `
      <div class="cat-row" data-cat="${cat}" role="button" tabindex="0">
        <div class="cat-row-top">
          <span class="cat-row-icon">${catIcon(cat)}</span>
          <span class="cat-row-name">${esc(CATEGORY_LABELS[cat] || cat)}</span>
          <span class="cat-row-value">${toBRL(val)}${limite ? ` / ${toBRL(limite)}` : ''}</span>
        </div>
        <div class="cat-row-bar"><div class="cat-row-fill${cls}" style="width:${pct}%"></div></div>
      </div>`;
  }).join('');
};

const renderPiggies = () => {
  const totalGuardado = state.piggies.reduce((a,p) => a + piggySaved(p), 0);
  el.piggyTotal.textContent = toBRL(totalGuardado);
  el.piggyGoalSummary.textContent = `em ${state.piggies.length} cofrinho${state.piggies.length !== 1 ? 's' : ''}`;

  if (!state.piggies.length) { el.piggyList.innerHTML = ''; el.piggyEmptyState.style.display = 'block'; return; }
  el.piggyEmptyState.style.display = 'none';

  el.piggyList.innerHTML = state.piggies.map(p => {
    const saved = piggySaved(p);
    const pct = p.meta > 0 ? clamp(Math.round((saved/p.meta)*100), 0, 100) : 0;
    const complete = pct >= 100;
    return `
      <div class="piggy-card">
        <div class="piggy-card-top">
          <span class="piggy-emoji">${p.emoji || '🐷'}</span>
          <div class="piggy-info">
            <div class="piggy-name">${esc(p.nome)}</div>
            <div class="piggy-amounts"><span class="piggy-saved">${toBRL(saved)}</span> <span class="piggy-of">de</span> <span class="piggy-goal">${toBRL(p.meta)}</span></div>
          </div>
          <div class="piggy-card-actions">
            <button class="piggy-action-btn" data-action="edit-piggy" data-id="${p.id}" aria-label="Editar cofrinho">✏️</button>
            <button class="piggy-action-btn delete" data-action="delete-piggy" data-id="${p.id}" aria-label="Excluir cofrinho">🗑️</button>
          </div>
        </div>
        <div class="piggy-progress-wrap"><div class="piggy-progress-bar"><div class="piggy-progress-fill ${complete?'complete':''}" style="width:${pct}%"></div></div></div>
        <div class="piggy-card-footer"><span class="piggy-forecast">${piggyForecast(p, saved)}</span><span class="piggy-pct ${complete?'complete':''}" style="margin-left:auto">${pct}%</span></div>
        ${complete ? `<div class="piggy-complete-badge">🎉 Meta atingida!</div>` : ''}<div class="piggy-btns">${complete ? '' : `<button class="btn-deposit" data-action="deposit" data-id="${p.id}">+ Guardar</button>`}<button class="btn-deposit btn-withdraw" data-action="withdraw" data-id="${p.id}">Retirar</button></div>
      </div>`;
  }).join('');
};

const populateAccountSelects = () => {
  const opts = state.accounts.map(a => `<option value="${a.id}">${ACCOUNT_TYPE_ICONS[a.tipo]||'🏦'} ${esc(a.nome)}</option>`).join('');
  [el.contaInput, el.piggyAccountInput].forEach(sel => { const prev = sel.value; sel.innerHTML = `<option value="">— Sem conta —</option>${opts}`; if (prev) sel.value = prev; });
  const chipOpts = state.accounts.map(a => `<button class="chip${state.filters.conta===a.id?' active':''}" data-value="${a.id}">${esc(a.nome)}</button>`).join('');
  el.filterConta.innerHTML = `<button class="chip${state.filters.conta==='all'?' active':''}" data-value="all">Todas</button>${chipOpts}`;
};

const renderTransactions = () => {
  let txs = txOfMonthYM(state.currentYear, state.currentMonth);
  const f = state.filters;
  txs = txs.filter(tx => {
    if (f.tipo !== 'all' && tx.tipo !== f.tipo) return false;
    if (f.status !== 'all' && tx.status !== f.status) return false;
    if (f.frequencia !== 'all' && tx.frequencia !== f.frequencia) return false;
    if (f.conta !== 'all' && (tx.contaId||'') !== f.conta) return false;
    if (f.categoria !== 'all' && tx.categoria !== f.categoria) return false;
    if (f.search && !tx.descricao.toLowerCase().includes(f.search.toLowerCase())) return false;
    if (f.minVal !== '' && tx.valor < parseFloat(f.minVal)) return false;
    if (f.maxVal !== '' && tx.valor > parseFloat(f.maxVal)) return false;
    return true;
  });
  txs.sort((a,b) => txDate(b) - txDate(a) || b.createdAt - a.createdAt);

  const count = (f.tipo!=='all') + (f.status!=='all') + (f.frequencia!=='all') + (f.conta!=='all') + (f.categoria!=='all') + (f.search!=='') + (f.minVal!=='') + (f.maxVal!=='');
  el.filterCountBadge.textContent = count;
  el.filterCountBadge.style.display = count > 0 ? 'inline-flex' : 'none';
  el.filterToggleBtn.classList.toggle('has-filters', count > 0);

  if (count > 0 || el.filterPanel.style.display !== 'none') {
    el.resultsInfo.style.display = 'flex'; el.resultsCount.textContent = `${txs.length} itens`;
    const soma = txs.reduce((a,t) => a + (t.tipo==='saida'?-t.valor:t.valor), 0); el.resultsTotal.textContent = `Total: ${toBRL(soma)}`;
  } else { el.resultsInfo.style.display = 'none'; }

  if (!txs.length) { el.transactionsList.innerHTML = ''; el.emptyState.style.display = 'block'; return; }
  el.emptyState.style.display = 'none';

  el.transactionsList.innerHTML = txs.map(tx => {
    const isChecked = tx.status === 'pago';
    const conta = tx.contaId ? state.accounts.find(a => a.id === tx.contaId) : null;
    return `
      <div class="tx-item ${isChecked?'is-paid':''}" data-id="${tx.id}">
        <button class="tx-check ${isChecked?'checked':''}" data-action="toggle" data-id="${tx.id}" aria-label="Alternar entre pago e pendente">${isChecked?'✓':''}</button>
        <div class="tx-icon ${tx.tipo}-icon">${catIcon(tx.categoria)}</div>
        <div class="tx-info">
          <div class="tx-desc">${esc(tx.descricao)||'Sem descrição'}</div>
          <div class="tx-meta">
            <span class="tx-badge badge-${tx.status}">${tx.status==='pago'?(tx.tipo==='entrada'?'recebido':'pago'):'pendente'}</span>
            ${conta?`<span class="tx-badge" style="background:${esc(conta.cor)}22;color:${esc(conta.cor)}; border:1px solid ${esc(conta.cor)}44">${esc(conta.nome)}</span>`:''}
            ${tx.data?`<span class="tx-date">${fmtDate(tx.data)}</span>`:''}
          </div>
        </div>
        <div class="tx-right">
          <span class="tx-amount ${tx.tipo}">${tx.tipo==='entrada'?'+':''}${toBRL(tx.valor)}</span>
          <div class="tx-actions">
            <button class="tx-action-btn" data-action="edit" data-id="${tx.id}" aria-label="Editar lançamento">✏️</button>
            <button class="tx-action-btn delete" data-action="delete" data-id="${tx.id}" aria-label="Excluir lançamento">🗑️</button>
          </div>
        </div>
      </div>`;
  }).join('');
};

const render = () => { ensureRecurring(state.currentYear, state.currentMonth); renderHeader(); renderDashboard(); renderTransactions(); renderPiggies(); populateAccountSelects(); };

/* ============================================================
   LÓGICA DE FORMULÁRIOS
   ============================================================ */
const syncParcelas = () => {
  const usaCartao = getToggle(el.tipoToggle) === 'saida' && !state.editingTxId && !!$('cartaoInput').value;
  $('parcelasGroup').style.display = usaCartao ? '' : 'none';
  if (!usaCartao) $('parcelasInput').value = 1;
  const n = clamp(parseInt($('parcelasInput').value) || 1, 1, 60), v = parseFloat(el.valorInput.value);
  $('parcelasTotal').textContent = (n > 1 && v > 0) ? `${n}x de ${toBRL(v)} = total de ${toBRL(parseFloat((n * v).toFixed(2)))}` : 'O valor acima é o de cada parcela.';
};
const syncCategorias = keep => {
  const tipo = getToggle(el.tipoToggle), lista = tipo === 'entrada' ? CAT_ENTRADA : CAT_SAIDA;
  el.categoriaInput.innerHTML = lista.map(c => `<option value="${c}">${catIcon(c)} ${CATEGORY_LABELS[c]}</option>`).join('');
  if (keep && lista.includes(keep)) el.categoriaInput.value = keep;
  $('cartaoInput').innerHTML = '<option value="">Conta (débito, Pix ou dinheiro)</option>' + state.cards.map(c => `<option value="${c.id}">💳 ${esc(c.nome)}</option>`).join('');
  $('cartaoGroup').style.display = (tipo === 'saida' && !state.editingTxId && state.cards.length) ? '' : 'none';
  syncParcelas();
};
const resetForm = () => {
  state.editingTxId = null; el.formModalTitle.textContent = 'Novo Lançamento';
  setToggle(el.tipoToggle, 'saida'); el.descricaoInput.value = ''; el.contaInput.value = ''; el.valorInput.value = ''; el.frequenciaInput.value = 'variavel';
  setToggle(el.statusToggle, 'pago'); // Começa como pago por padrão
  el.dataInput.value = todayLocal(); $('parcelasInput').value = 1; syncCategorias();
};

const populateForm = tx => {
  el.formModalTitle.textContent = 'Editar Lançamento';
  setToggle(el.tipoToggle, tx.tipo); el.descricaoInput.value = tx.descricao; syncCategorias(tx.categoria);
  el.contaInput.value = tx.contaId || ''; el.valorInput.value = tx.valor; el.frequenciaInput.value = tx.frequencia;
  setToggle(el.statusToggle, tx.status); el.dataInput.value = tx.data || '';
};

const saveTx = () => {
  const tipo = getToggle(el.tipoToggle); const descricao = el.descricaoInput.value.trim(); const valor = parseFloat(parseFloat(el.valorInput.value).toFixed(2));
  if (!descricao || isNaN(valor)||valor<=0) { showToast('⚠️ Descrição e valor são obrigatórios.'); return; }
  const data = { tipo, descricao, valor, categoria: el.categoriaInput.value, contaId: el.contaInput.value || null, frequencia: el.frequenciaInput.value, status: getToggle(el.statusToggle), data: el.dataInput.value || null };
  
  if (state.editingTxId) {
    const idx = state.transactions.findIndex(t => t.id === state.editingTxId);
    if (idx > -1) state.transactions[idx] = { ...state.transactions[idx], ...data, ...(data.data ? { createdAt: isoToTs(data.data) } : {}) };
    showToast('✏️ Lançamento atualizado!');
  } else {
    const [y,m,d] = (data.data || todayLocal()).split('-').map(Number);
    const n = (tipo === 'saida' && $('cartaoInput').value) ? clamp(parseInt($('parcelasInput').value) || 1, 1, 60) : 1;
    const card = tipo === 'saida' ? state.cards.find(c => c.id === $('cartaoInput').value) : null;
    const compra = data.data || todayLocal(), base = card ? faturaVenc(card, compra) : null;
    for (let i = 0; i < n; i++) {
      const [by, bm, bd] = base ? base.iso.split('-').map(Number) : [y, m, d];
      const dt = base ? addMonthsClamp(by, bm-1, bd, i) : addMonthsClamp(y, m-1, d, i);
      state.transactions.push({ id: uid(), ...data, descricao: n > 1 ? `${descricao} (${i+1}/${n})` : descricao, status: (card || i > 0) ? 'pendente' : data.status, frequencia: n > 1 ? 'variavel' : data.frequencia, data: dt.iso, createdAt: dt.ts, ...(card ? { cartaoId: card.id, dataCompra: compra } : {}) });
    }
    showToast(n > 1 ? `✅ ${n}x de ${toBRL(data.valor)} lançadas (total ${toBRL(parseFloat((n * data.valor).toFixed(2)))})` : '✅ Lançamento adicionado!');
  }
  saveState(); closeModal(el.formModal);
};

const toggleStatus = id => {
  const tx = state.transactions.find(t => t.id === id); if (!tx) return;
  tx.status = tx.status === 'pago' ? 'pendente' : 'pago'; 
  saveState(); showToast(tx.status === 'pago' ? '✅ Marcado como pago!' : '🔄 Marcado como pendente.');
};

const editTx = id => {
  const tx = state.transactions.find(t => t.id === id); if (!tx) return;
  state.editingTxId = id; populateAccountSelects(); populateForm(tx); openModal(el.formModal);
};

/* --- Configurações Extras --- */
el.editBalanceBtn.addEventListener('click', () => {
  const key = monthKey(state.currentYear, state.currentMonth);
  const atual = getSaldoInicial(state.currentYear, state.currentMonth);
  el.balanceInput.value = state.saldoBase[key] !== undefined ? String(state.saldoBase[key]).replace('.', ',') : ''; el.balanceInput.placeholder = String(atual).replace('.', ',');
  openModal(el.balanceModal);
});
el.saveBalanceBtn.addEventListener('click', () => {
  const raw = el.balanceInput.value.trim().replace(',', '.'), k = monthKey(state.currentYear, state.currentMonth);
  if (raw === '') delete state.saldoBase[k]; else { const v = parseFloat(raw); if (isNaN(v)) { showToast('⚠️ Valor inválido.'); return; } state.saldoBase[k] = v; }
  saveState(); closeModal(el.balanceModal); showToast('💰 Saldo atualizado!');
});

let _accountColor = '#4F8EF7';
const resetAccountForm = () => {
  state.editingAccountId = null; el.accountModalTitle.textContent = 'Nova Conta'; el.accountNameInput.value = ''; el.accountTypeInput.value = 'corrente'; _accountColor = '#4F8EF7';
  el.accountColorPicker.querySelectorAll('.color-dot').forEach(d => d.classList.toggle('active', d.dataset.color === _accountColor));
};
const populateAccountForm = acc => {
  el.accountModalTitle.textContent = 'Editar Conta'; el.accountNameInput.value = acc.nome; el.accountTypeInput.value = acc.tipo; _accountColor = acc.cor;
  el.accountColorPicker.querySelectorAll('.color-dot').forEach(d => d.classList.toggle('active', d.dataset.color === acc.cor));
};
const saveAccount = () => {
  const nome = el.accountNameInput.value.trim(); if (!nome) { showToast('⚠️ Informe o nome.'); return; }
  const data = { nome, tipo: el.accountTypeInput.value, cor: _accountColor };
  if (state.editingAccountId) {
    const idx = state.accounts.findIndex(a => a.id === state.editingAccountId);
    if (idx > -1) state.accounts[idx] = { ...state.accounts[idx], ...data };
  } else { state.accounts.push({ id:uid(), ...data }); }
  saveState(); closeModal(el.accountModal); showToast('✅ Conta salva!');
};

let _piggyEmoji = '🐷';
const resetPiggyForm = () => {
  state.editingPiggyId = null; el.piggyModalTitle.textContent = 'Novo Cofrinho'; el.piggyNameInput.value = ''; el.piggyGoalInput.value = ''; el.piggySavedInput.value = '0'; el.piggyAccountInput.value = '';
  el.piggyStartInput.value = todayLocal(); el.piggyDeadlineInput.value = ''; _piggyEmoji = '🐷';
  el.piggyEmojiPicker.querySelectorAll('.emoji-btn').forEach(b => b.classList.toggle('active', b.dataset.value === '🐷'));
};
const populatePiggyForm = p => {
  el.piggyModalTitle.textContent = 'Editar Cofrinho'; el.piggyNameInput.value = p.nome; el.piggyGoalInput.value = p.meta; el.piggySavedInput.value = piggySaved(p);
  el.piggyAccountInput.value = p.contaId || ''; el.piggyStartInput.value = p.inicio || ''; el.piggyDeadlineInput.value = p.deadline|| ''; _piggyEmoji = p.emoji || '🐷';
  el.piggyEmojiPicker.querySelectorAll('.emoji-btn').forEach(b => b.classList.toggle('active', b.dataset.value === _piggyEmoji));
};
const savePiggy = () => {
  const nome = el.piggyNameInput.value.trim(); const meta = parseFloat(el.piggyGoalInput.value);
  if (!nome || isNaN(meta)||meta<=0) { showToast('⚠️ Informe o nome e a meta.'); return; }
  const novo = parseFloat(el.piggySavedInput.value) || 0;
  const data = { nome, emoji: _piggyEmoji, meta, contaId: el.piggyAccountInput.value || null, inicio: el.piggyStartInput.value || null, deadline: el.piggyDeadlineInput.value || null };
  if (state.editingPiggyId) {
    const idx = state.piggies.findIndex(p => p.id === state.editingPiggyId);
    if (idx > -1) {
      const p = state.piggies[idx], diff = parseFloat((novo - piggySaved(p)).toFixed(2));
      state.piggies[idx] = { ...p, ...data, movs: diff ? [...p.movs, { id: uid(), data: todayLocal(), valor: diff }] : p.movs };
    }
  } else { state.piggies.push({ id: uid(), ...data, base: 0, movs: novo > 0 ? [{ id: uid(), data: todayLocal(), valor: novo }] : [] }); }
  saveState(); closeModal(el.piggyModal); showToast('🐷 Cofrinho salvo!');
};
const editPiggy = id => { const p = state.piggies.find(x => x.id === id); if (!p) return; state.editingPiggyId = id; populateAccountSelects(); populatePiggyForm(p); openModal(el.piggyModal); };
const openDeposit = (id, sign = 1) => {
  const p = state.piggies.find(x => x.id === id); if (!p) return;
  state.depositPiggyId = id; state.depositSign = sign;
  $('piggyDepositTitle').textContent = sign > 0 ? 'Guardar no Cofrinho' : 'Retirar do Cofrinho';
  el.saveDepositBtn.textContent = sign > 0 ? 'Guardar 🐷' : 'Retirar';
  el.piggyDepositSub.textContent = `"${p.nome}" · Guardado: ${toBRL(piggySaved(p))} de ${toBRL(p.meta)}. ` + (sign > 0 ? 'O valor sai do saldo da conta.' : 'O valor volta ao saldo da conta.');
  el.depositAmountInput.value = ''; openModal(el.piggyDepositModal);
};
const saveDeposit = () => {
  const p = state.piggies.find(x => x.id === state.depositPiggyId); if (!p) return;
  const val = parseFloat(el.depositAmountInput.value); if (isNaN(val)||val<=0) return;
  const sign = state.depositSign || 1;
  if (sign < 0 && val > piggySaved(p)) { showToast('⚠️ Valor maior que o guardado.'); return; }
  p.movs.push({ id: uid(), data: todayLocal(), valor: sign * val });
  saveState(); closeModal(el.piggyDepositModal);
  showToast(sign > 0 ? `🐷 ${toBRL(val)} guardado e retirado do saldo.` : `💸 ${toBRL(val)} voltou ao saldo.`);
};

/* ============================================================
   EVENTOS PRINCIPAIS
   ============================================================ */
const askDelete = (type, id) => {
  const it = ({ tx: state.transactions, account: state.accounts, piggy: state.piggies, card: state.cards })[type].find(x => x.id === id);
  state.deletingType = type; state.deletingId = id;
  el.deleteModalTitle.textContent = `Excluir "${(it && (it.descricao || it.nome)) || 'item'}"?`;
  openModal(el.deleteModal);
};
const wireEvents = () => {
  el.prevMonth.addEventListener('click', () => { state.currentMonth--; if (state.currentMonth < 0) { state.currentMonth = 11; state.currentYear--; } render(); });
  el.nextMonth.addEventListener('click', () => { state.currentMonth++; if (state.currentMonth > 11) { state.currentMonth = 0; state.currentYear++; } render(); });
  el.tabBtns.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  el.cancelBalanceBtn.addEventListener('click', () => closeModal(el.balanceModal)); el.balanceModal.addEventListener('click', e => onOverlay(e, el.balanceModal));
  el.openAccountFormBtn.addEventListener('click', () => { resetAccountForm(); openModal(el.accountModal); });
  el.saveAccountBtn.addEventListener('click', saveAccount); el.cancelAccountBtn.addEventListener('click', () => closeModal(el.accountModal)); el.accountModal.addEventListener('click', e => onOverlay(e, el.accountModal));
  el.accountColorPicker.addEventListener('click', e => { const dot = e.target.closest('.color-dot'); if (!dot) return; _accountColor = dot.dataset.color; el.accountColorPicker.querySelectorAll('.color-dot').forEach(d => d.classList.toggle('active', d.dataset.color === _accountColor)); });
  
  el.accountsList.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]'); if (!btn) return;
    if (btn.dataset.action==='edit-account') { const acc = state.accounts.find(a => a.id===btn.dataset.id); if (acc) { state.editingAccountId = acc.id; populateAccountForm(acc); openModal(el.accountModal); } }
    if (btn.dataset.action==='delete-account') { askDelete('account', btn.dataset.id); }
  });

  el.categoryBreakdown.addEventListener('click', e => {
    const row = e.target.closest('[data-cat]'); if (!row) return; const cat = row.dataset.cat;
    const v = prompt(`Limite mensal para ${CATEGORY_LABELS[cat] || cat} (R$). Deixe vazio para remover:`, state.budgets[cat] || '');
    if (v === null) return; const n = parseFloat(String(v).replace(',', '.'));
    if (isNaN(n) || n <= 0) delete state.budgets[cat]; else state.budgets[cat] = n;
    saveState();
  });
  $('exportBtn').addEventListener('click', () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' }));
    a.download = `financa-${todayLocal()}.json`; a.click(); URL.revokeObjectURL(a.href);
  });
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    f.text().then(txt => {
      const d = JSON.parse(txt); if (!d || !Array.isArray(d.transactions)) throw new Error('inválido');
      if (!confirm('Substituir todos os dados atuais pelos do arquivo?')) return;
      applyData(d); saveState(); showToast('✅ Dados importados.');
    }).catch(() => showToast('⚠️ Arquivo inválido.'));
  });
  $('transferBtn').addEventListener('click', () => {
    if (state.accounts.length < 2) { showToast('⚠️ Cadastre ao menos 2 contas.'); return; }
    const ops = state.accounts.map(a => `<option value="${a.id}">${esc(a.nome)}</option>`).join('');
    $('transferFrom').innerHTML = ops; $('transferTo').innerHTML = ops; $('transferTo').selectedIndex = 1; $('transferValue').value = '';
    openModal($('transferModal'));
  });
  $('cancelTransferBtn').addEventListener('click', () => closeModal($('transferModal')));
  $('saveTransferBtn').addEventListener('click', () => {
    const de = $('transferFrom').value, para = $('transferTo').value, valor = parseFloat($('transferValue').value);
    if (de === para || isNaN(valor) || valor <= 0) { showToast('⚠️ Escolha contas diferentes e um valor.'); return; }
    state.transfers.push({ id: uid(), data: todayLocal(), de, para, valor });
    saveState(); closeModal($('transferModal')); showToast('✅ Transferência registrada.');
  });
  el.accountsList.addEventListener('click', e => {
    const b = e.target.closest('[data-balance]'); if (!b) return;
    const acc = state.accounts.find(a => a.id === b.dataset.balance); if (!acc) return;
    const v = prompt(`Saldo atual de ${acc.nome} (R$):`, accountBalance(acc.id).toFixed(2).replace('.', ','));
    const n = v === null ? NaN : parseFloat(v.replace(',', '.')); if (isNaN(n)) return;
    acc.ajuste = parseFloat((n - (accountBalance(acc.id) - (acc.ajuste || 0))).toFixed(2)); saveState();
  });
  const askCard = (c = {}) => {
    const nome = prompt('Nome do cartão:', c.nome || ''); if (!nome || !nome.trim()) return null;
    const f = parseInt(prompt('Dia de fechamento da fatura (1 a 31):', c.fechamento || ''));
    const v = parseInt(prompt('Dia de vencimento da fatura (1 a 31):', c.vencimento || ''));
    if (!(f >= 1 && f <= 31 && v >= 1 && v <= 31)) { showToast('⚠️ Informe dias entre 1 e 31.'); return null; }
    return { nome: nome.trim(), fechamento: f, vencimento: v };
  };
  $('addCardBtn').addEventListener('click', () => { const c = askCard(); if (c) { state.cards.push({ id: uid(), ...c }); saveState(); } });
  $('cardsList').addEventListener('click', e => {
    const b = e.target.closest('[data-action]'); if (!b) return;
    const id = b.dataset.id, c = state.cards.find(x => x.id === id); if (!c) return;
    if (b.dataset.action === 'edit-card') { const n = askCard(c); if (n) { Object.assign(c, n); saveState(); } }
    if (b.dataset.action === 'delete-card') askDelete('card', id);
    if (b.dataset.action === 'pay-card') {
      txOfMonthYM(state.currentYear, state.currentMonth).forEach(t => { if (t.cartaoId === id) t.status = 'pago'; });
      saveState(); showToast('✅ Fatura marcada como paga.');
    }
  });
  ['cartaoInput', 'parcelasInput'].forEach(id => $(id).addEventListener('input', syncParcelas));
  el.valorInput.addEventListener('input', syncParcelas);
  $('fabBtn').addEventListener('click', () => el.openFormBtn.click());
  document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(o => closeModal(o)); });
  el.openFormBtn.addEventListener('click', () => { resetForm(); populateAccountSelects(); openModal(el.formModal); });
  el.saveFormBtn.addEventListener('click', saveTx); el.cancelFormBtn.addEventListener('click', () => closeModal(el.formModal)); el.formModal.addEventListener('click', e => onOverlay(e, el.formModal));
  el.tipoToggle.addEventListener('click', e => { const b=e.target.closest('.toggle-btn'); if(b) { setToggle(el.tipoToggle, b.dataset.value); syncCategorias(el.categoriaInput.value); } });
  el.statusToggle.addEventListener('click', e => { const b=e.target.closest('.toggle-btn'); if(b) setToggle(el.statusToggle, b.dataset.value); });

  el.transactionsList.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]'); if (!btn) return;
    if (btn.dataset.action==='toggle') toggleStatus(btn.dataset.id);
    if (btn.dataset.action==='edit') editTx(btn.dataset.id);
    if (btn.dataset.action==='delete') { askDelete('tx', btn.dataset.id); }
  });

  el.openPiggyFormBtn.addEventListener('click', () => { resetPiggyForm(); populateAccountSelects(); openModal(el.piggyModal); });
  el.savePiggyBtn.addEventListener('click', savePiggy); el.cancelPiggyBtn.addEventListener('click', () => closeModal(el.piggyModal)); el.piggyModal.addEventListener('click', e => onOverlay(e, el.piggyModal));
  el.piggyEmojiPicker.addEventListener('click', e => { const b = e.target.closest('.emoji-btn'); if (!b) return; _piggyEmoji = b.dataset.value; el.piggyEmojiPicker.querySelectorAll('.emoji-btn').forEach(x => x.classList.toggle('active', x.dataset.value === _piggyEmoji)); });
  
  el.piggyList.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]'); if (!btn) return;
    if (btn.dataset.action==='edit-piggy') editPiggy(btn.dataset.id);
    if (btn.dataset.action==='delete-piggy') { askDelete('piggy', btn.dataset.id); }
    if (btn.dataset.action==='deposit') openDeposit(btn.dataset.id, 1);
    if (btn.dataset.action==='withdraw') openDeposit(btn.dataset.id, -1);
  });
  el.saveDepositBtn.addEventListener('click', saveDeposit); el.cancelDepositBtn.addEventListener('click', () => closeModal(el.piggyDepositModal)); el.piggyDepositModal.addEventListener('click', e => onOverlay(e, el.piggyDepositModal));

  el.confirmDeleteBtn.addEventListener('click', () => {
    const { deletingType:t, deletingId:id } = state;
    let undo = null;
    if (t==='tx') {
      const tx = state.transactions.find(x => x.id===id);
      state.transactions = state.transactions.filter(x => x.id!==id);
      if (tx) {
        const d = txDate(tx), ign = tx.frequencia === 'fixa' ? `${tx.origem || tx.id}|${monthKey(d.getFullYear(), d.getMonth())}` : null;
        if (ign) state.ignorados.push(ign);
        undo = () => { state.transactions.push(tx); state.ignorados = state.ignorados.filter(i => i !== ign); saveState(); };
      }
    }
    if (t==='account') {
      state.accounts = state.accounts.filter(x => x.id!==id);
      state.transactions.forEach(x => { if (x.contaId === id) x.contaId = null; });
      state.piggies.forEach(x => { if (x.contaId === id) x.contaId = null; });
      if (state.filters.conta === id) state.filters.conta = 'all';
      state.transfers = state.transfers.filter(x => x.de !== id && x.para !== id);
    }
    if (t==='piggy') state.piggies = state.piggies.filter(x => x.id!==id);
    if (t==='card') { state.cards = state.cards.filter(x => x.id!==id); state.transactions.forEach(x => { if (x.cartaoId === id) delete x.cartaoId; }); }
    state.deletingType = null; state.deletingId = null; saveState(); closeModal(el.deleteModal);
    showToast('🗑️ Excluído.', undo ? { label: 'Desfazer', fn: undo } : null);
  });
  el.cancelDeleteBtn.addEventListener('click', () => closeModal(el.deleteModal)); el.deleteModal.addEventListener('click', e => onOverlay(e, el.deleteModal));

  el.filterToggleBtn.addEventListener('click', () => { el.filterPanel.style.display = el.filterPanel.style.display !== 'none' ? 'none' : 'block'; renderTransactions(); });
  const bindChips = (c, k) => c.addEventListener('click', e => { const chip = e.target.closest('.chip'); if (!chip) return; c.querySelectorAll('.chip').forEach(x => x.classList.remove('active')); chip.classList.add('active'); state.filters[k] = chip.dataset.value; renderTransactions(); });
  bindChips(el.filterTipo, 'tipo'); bindChips(el.filterStatus, 'status'); bindChips(el.filterFrequencia, 'frequencia'); bindChips(el.filterConta, 'conta'); bindChips(el.filterCategoria, 'categoria');
  el.filterSearch.addEventListener('input', () => { state.filters.search = el.filterSearch.value; renderTransactions(); });
  el.filterMinVal.addEventListener('input', () => { state.filters.minVal = el.filterMinVal.value; renderTransactions(); });
  el.filterMaxVal.addEventListener('input', () => { state.filters.maxVal = el.filterMaxVal.value; renderTransactions(); });
  el.clearFiltersBtn.addEventListener('click', () => {
    state.filters = { tipo:'all',status:'all',frequencia:'all',conta:'all',categoria:'all',search:'',minVal:'',maxVal:'' };
    el.filterSearch.value = el.filterMinVal.value = el.filterMaxVal.value = '';
    [el.filterTipo, el.filterStatus, el.filterFrequencia, el.filterConta, el.filterCategoria].forEach(g => 
      g.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.value === 'all'))
    );
    renderTransactions(); 
    showToast('🧹 Filtros limpos.');
  });

  // Swipe-to-close para touch mobile nativo
  let touchStartY = 0;
  document.querySelectorAll('.modal-card').forEach(card => {
    card.addEventListener('touchstart', e => touchStartY = e.touches[0].clientY, {passive: true});
    card.addEventListener('touchmove', e => {
      const diff = e.touches[0].clientY - touchStartY;
      if (diff > 0 && card.scrollTop === 0) card.style.transform = `translateY(${diff}px)`;
    }, {passive: true});
    card.addEventListener('touchend', e => {
      const diff = e.changedTouches[0].clientY - touchStartY;
      card.style.transform = '';
      if (diff > 120 && card.scrollTop === 0) closeModal(card.closest('.modal-overlay'));
    });
  });
};

/* ============================================================
   AUTENTICAÇÃO (Firebase Auth) — dados em usuarios/{uid}
   ============================================================ */
const authMsg = c => ({
  'auth/invalid-credential': 'E-mail ou senha incorretos.', 'auth/wrong-password': 'E-mail ou senha incorretos.',
  'auth/user-not-found': 'E-mail ou senha incorretos.', 'auth/email-already-in-use': 'Este e-mail já tem conta. Use Entrar.',
  'auth/weak-password': 'Use ao menos 6 caracteres na senha.', 'auth/invalid-email': 'E-mail inválido.',
  'auth/network-request-failed': 'Sem conexão com a internet.',
})[c] || 'Não foi possível entrar. Tente novamente.';

const initAuth = () => {
  const overlay = $('loginOverlay');
  if (!db || !firebase.auth) { overlay.style.display = 'none'; startCloudListener(); return; }
  const auth = firebase.auth();
  const erro = m => { $('loginError').textContent = m; $('loginError').style.display = 'block'; };
  const go = fn => {
    const e = $('loginEmail').value.trim(), p = $('loginPassword').value;
    if (!e || !p) { erro('Informe e-mail e senha.'); return; }
    fn.call(auth, e, p).catch(x => erro(authMsg(x.code)));
  };
  $('loginBtn').addEventListener('click', () => go(auth.signInWithEmailAndPassword));
  $('signupBtn').addEventListener('click', () => go(auth.createUserWithEmailAndPassword));
  $('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') $('loginBtn').click(); });
  $('logoutBtn').addEventListener('click', () => auth.signOut().then(() => location.reload()));
  auth.onAuthStateChanged(user => {
    if (!user) { overlay.style.display = ''; return; }
    overlay.style.display = 'none';
    cloudDataRef = db.collection('usuarios').doc(user.uid);
    startCloudListener();
  });
};

const init = () => { wireEvents(); initAuth(); };

document.addEventListener('DOMContentLoaded', init);
