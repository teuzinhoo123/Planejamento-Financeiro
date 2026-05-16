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
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Aponta para um documento único que vai guardar todos os seus dados na nuvem
const cloudDataRef = db.collection('banco_financa').doc('meu_estado_global');

/* ============================================================
   ESTADO GLOBAL
   ============================================================ */
let state = {
  saldoBase:    {},
  transactions: [],
  accounts:     [],
  piggies:      [],
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
const ACCOUNT_TYPE_LABELS = { corrente:'Conta Corrente', poupanca:'Poupança', digital:'Conta Digital', investimento:'Investimento', dinheiro:'Dinheiro em Espécie', outro:'Outro' };
const ACCOUNT_TYPE_ICONS = { corrente:'🏦', poupanca:'💰', digital:'📱', investimento:'📈', dinheiro:'💵', outro:'📦' };

/* ============================================================
   CÁLCULOS DO MÊS (ATUALIZADOS COM LOGICA DO SALDO REAL)
   ============================================================ */
const txOfMonthYM = (y, m) => state.transactions.filter(tx => {
  const d = new Date(tx.createdAt); return d.getFullYear() === y && d.getMonth() === m;
});

const getSaldoInicial = (y, m) => {
  // Caso 1: valor manual definido para este mes
  const key = monthKey(y, m);
  if (state.saldoBase[key] !== undefined) return state.saldoBase[key];

  // Caso 2: procura o mes base mais proximo no passado (ate 60 meses)
  // e propaga as sobras mes a mes ate o mes pedido (exclusive)
  for (let i = 1; i <= 60; i++) {
    let baseY = y, baseM = m - i;
    while (baseM < 0) { baseM += 12; baseY--; }

    const baseKey = monthKey(baseY, baseM);
    if (state.saldoBase[baseKey] !== undefined) {
      let saldo = state.saldoBase[baseKey];

      // Processa: base, base+1, ..., alvo-1  (i passos)
      for (let step = 0; step < i; step++) {
        let cy = baseY, cm = baseM + step;
        while (cm > 11) { cm -= 12; cy++; }

        const txs = txOfMonthYM(cy, cm);
        const entradasPagas = txs
          .filter(t => t.tipo === 'entrada' && t.status === 'pago')
          .reduce((a, t) => a + t.valor, 0);
        const saidasPagas = txs
          .filter(t => t.tipo === 'saida' && t.status === 'pago')
          .reduce((a, t) => a + t.valor, 0);

        // Sobra do mes step vira saldo inicial do proximo
        saldo = saldo + entradasPagas - saidasPagas;
      }
      return saldo;
    }
  }
  return 0;
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
  const saldoAtual = saldoInicial + entradasPagas - saidasPagas;
  const sobras = saldoInicial + totalEntradas - totalSaidas;

  return { saldoInicial, saldoAtual, totalEntradas, totalAPagar: totalSaidas, totalPago: saidasPagas, faltaPagar: saidasPendentes, sobras };
};

/* ============================================================
   PERSISTENCIA — LocalStorage (backup local sempre ativo)
   ============================================================ */
const LOCAL_KEY = 'financa_backup_v1';

const saveLocal = () => {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({
      saldoBase:    state.saldoBase,
      transactions: state.transactions,
      accounts:     state.accounts,
      piggies:      state.piggies,
    }));
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
    state.saldoBase    = d.saldoBase    || {};
    state.transactions = d.transactions || [];
    state.accounts     = d.accounts     || [];
    state.piggies      = d.piggies      || [];
    return true;
  } catch(e) { return false; }
};

/* ============================================================
   PERSISTENCIA NA NUVEM (Firebase .get() — sem WebChannel)
   ============================================================ */
const startCloudListener = () => {
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
        state.saldoBase    = data.saldoBase    || {};
        state.transactions = data.transactions || [];
        state.accounts     = data.accounts     || [];
        state.piggies      = data.piggies      || [];
        saveLocal();
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

const saveState = () => {
  // Salva SEMPRE no local primeiro (instantaneo, sem falha de rede)
  saveLocal();
  // Depois envia para a nuvem
  cloudDataRef.set({
    saldoBase:    state.saldoBase,
    transactions: state.transactions,
    accounts:     state.accounts,
    piggies:      state.piggies,
  }).catch((error) => {
    console.error('Erro ao salvar na nuvem:', error);
    showToast('Salvo localmente. Nuvem indisponivel no momento.');
  });
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
const showToast = msg => {
  clearTimeout(_toastTimer); el.toast.textContent = msg; el.toast.classList.add('show');
  _toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2800);
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
  const { saldoAtual, totalAPagar, totalPago, faltaPagar, sobras } = calcTotals();
  el.saldoConta.textContent  = toBRL(saldoAtual); 
  el.totalAPagar.textContent = toBRL(totalAPagar);
  el.totalPago.textContent   = toBRL(totalPago);
  el.faltaPagar.textContent  = toBRL(faltaPagar);
  el.sobras.textContent      = toBRL(sobras);
  el.sobrasCard.className = `summary-card ${sobras < 0 ? 'card--red' : 'card--blue'}`;
  renderAccounts(); renderCategoryBreakdown();
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
      </div>
      <div class="account-actions">
        <button class="account-action-btn" data-action="edit-account" data-id="${acc.id}">✏️</button>
        <button class="account-action-btn delete" data-action="delete-account" data-id="${acc.id}">🗑️</button>
      </div>
    </div>`).join('');
};

const renderCategoryBreakdown = () => {
  const txs = txOfMonthYM(state.currentYear, state.currentMonth).filter(t => t.tipo === 'saida');
  const total = txs.reduce((a,t) => a + t.valor, 0);
  if (el.categoryMonthHint) el.categoryMonthHint.textContent = monthLabel(state.currentYear, state.currentMonth);
  if (!txs.length) { el.categoryBreakdown.innerHTML = `<p style="font-size:var(--fs-sm);color:var(--text-muted);padding:var(--sp-2) 0 var(--sp-5)">Sem saídas registradas.</p>`; return; }
  
  const map = {}; txs.forEach(t => { map[t.categoria] = (map[t.categoria]||0) + t.valor; });
  const sorted = Object.entries(map).sort((a,b) => b[1]-a[1]);

  el.categoryBreakdown.innerHTML = sorted.map(([cat, val]) => {
    const pct = total > 0 ? Math.round((val/total)*100) : 0;
    return `
      <div class="cat-row">
        <div class="cat-row-top">
          <span class="cat-row-icon">${catIcon(cat)}</span>
          <span class="cat-row-name">${esc(cat.replace(/-/g,' '))}</span>
          <span class="cat-row-value">${toBRL(val)}</span>
        </div>
        <div class="cat-row-bar"><div class="cat-row-fill" style="width:${pct}%"></div></div>
      </div>`;
  }).join('');
};

const renderPiggies = () => {
  const totalGuardado = state.piggies.reduce((a,p) => a + (p.guardado||0), 0);
  el.piggyTotal.textContent = toBRL(totalGuardado);
  el.piggyGoalSummary.textContent = `em ${state.piggies.length} cofrinho${state.piggies.length !== 1 ? 's' : ''}`;

  if (!state.piggies.length) { el.piggyList.innerHTML = ''; el.piggyEmptyState.style.display = 'block'; return; }
  el.piggyEmptyState.style.display = 'none';

  el.piggyList.innerHTML = state.piggies.map(p => {
    const pct = p.meta > 0 ? clamp(Math.round((p.guardado/p.meta)*100), 0, 100) : 0;
    const complete = pct >= 100;
    return `
      <div class="piggy-card">
        <div class="piggy-card-top">
          <span class="piggy-emoji">${p.emoji || '🐷'}</span>
          <div class="piggy-info">
            <div class="piggy-name">${esc(p.nome)}</div>
            <div class="piggy-amounts"><span class="piggy-saved">${toBRL(p.guardado)}</span> <span class="piggy-of">de</span> <span class="piggy-goal">${toBRL(p.meta)}</span></div>
          </div>
          <div class="piggy-card-actions">
            <button class="piggy-action-btn" data-action="edit-piggy" data-id="${p.id}">✏️</button>
            <button class="piggy-action-btn delete" data-action="delete-piggy" data-id="${p.id}">🗑️</button>
          </div>
        </div>
        <div class="piggy-progress-wrap"><div class="piggy-progress-bar"><div class="piggy-progress-fill ${complete?'complete':''}" style="width:${pct}%"></div></div></div>
        <div class="piggy-card-footer"><span class="piggy-pct ${complete?'complete':''}" style="margin-left:auto">${pct}%</span></div>
        ${complete ? `<div class="piggy-complete-badge">🎉 Meta atingida!</div>` : `<button class="btn-deposit" data-action="deposit" data-id="${p.id}">+ Guardar dinheiro</button>`}
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
  txs.sort((a,b) => b.createdAt - a.createdAt);

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
        <button class="tx-check ${isChecked?'checked':''}" data-action="toggle" data-id="${tx.id}">${isChecked?'✓':''}</button>
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
            <button class="tx-action-btn" data-action="edit" data-id="${tx.id}">✏️</button>
            <button class="tx-action-btn delete" data-action="delete" data-id="${tx.id}">🗑️</button>
          </div>
        </div>
      </div>`;
  }).join('');
};

const render = () => { renderHeader(); renderDashboard(); renderTransactions(); renderPiggies(); populateAccountSelects(); };

/* ============================================================
   LÓGICA DE FORMULÁRIOS
   ============================================================ */
const resetForm = () => {
  state.editingTxId = null; el.formModalTitle.textContent = 'Novo Lançamento';
  setToggle(el.tipoToggle, 'saida'); el.descricaoInput.value = ''; el.categoriaInput.value = 'alimentacao'; el.contaInput.value = ''; el.valorInput.value = ''; el.frequenciaInput.value = 'variavel';
  setToggle(el.statusToggle, 'pago'); // Começa como pago por padrão
  el.dataInput.value = new Date().toISOString().slice(0,10);
};

const populateForm = tx => {
  el.formModalTitle.textContent = 'Editar Lançamento';
  setToggle(el.tipoToggle, tx.tipo); el.descricaoInput.value = tx.descricao; el.categoriaInput.value = tx.categoria;
  el.contaInput.value = tx.contaId || ''; el.valorInput.value = tx.valor; el.frequenciaInput.value = tx.frequencia;
  setToggle(el.statusToggle, tx.status); el.dataInput.value = tx.data || '';
};

const saveTx = () => {
  const tipo = getToggle(el.tipoToggle); const descricao = el.descricaoInput.value.trim(); const valor = parseFloat(parseFloat(el.valorInput.value).toFixed(2));
  if (!descricao || isNaN(valor)||valor<=0) { showToast('⚠️ Descrição e valor são obrigatórios.'); return; }
  const data = { tipo, descricao, valor, categoria: el.categoriaInput.value, contaId: el.contaInput.value || null, frequencia: el.frequenciaInput.value, status: getToggle(el.statusToggle), data: el.dataInput.value || null };
  
  if (state.editingTxId) {
    const idx = state.transactions.findIndex(t => t.id === state.editingTxId);
    if (idx > -1) state.transactions[idx] = { ...state.transactions[idx], ...data };
    showToast('✏️ Lançamento atualizado!');
  } else {
    const dStr = el.dataInput.value || new Date().toISOString().slice(0,10); const [y,m,d] = dStr.split('-').map(Number);
    state.transactions.push({ id:uid(), ...data, createdAt: new Date(y,m-1,d).getTime() });
    showToast('✅ Lançamento adicionado!');
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
  el.balanceInput.value = atual > 0 ? atual : '';
  openModal(el.balanceModal);
});
el.saveBalanceBtn.addEventListener('click', () => {
  const v = parseFloat(el.balanceInput.value); if (isNaN(v)||v<0) return;
  state.saldoBase[monthKey(state.currentYear, state.currentMonth)] = v;
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
  el.piggyStartInput.value = new Date().toISOString().slice(0,10); el.piggyDeadlineInput.value = ''; _piggyEmoji = '🐷';
  el.piggyEmojiPicker.querySelectorAll('.emoji-btn').forEach(b => b.classList.toggle('active', b.dataset.value === '🐷'));
};
const populatePiggyForm = p => {
  el.piggyModalTitle.textContent = 'Editar Cofrinho'; el.piggyNameInput.value = p.nome; el.piggyGoalInput.value = p.meta; el.piggySavedInput.value = p.guardado;
  el.piggyAccountInput.value = p.contaId || ''; el.piggyStartInput.value = p.inicio || ''; el.piggyDeadlineInput.value = p.deadline|| ''; _piggyEmoji = p.emoji || '🐷';
  el.piggyEmojiPicker.querySelectorAll('.emoji-btn').forEach(b => b.classList.toggle('active', b.dataset.value === _piggyEmoji));
};
const savePiggy = () => {
  const nome = el.piggyNameInput.value.trim(); const meta = parseFloat(el.piggyGoalInput.value);
  if (!nome || isNaN(meta)||meta<=0) return;
  const data = { nome, emoji: _piggyEmoji, meta, guardado: parseFloat(el.piggySavedInput.value) || 0, contaId: el.piggyAccountInput.value || null, inicio: el.piggyStartInput.value || null, deadline: el.piggyDeadlineInput.value || null };
  if (state.editingPiggyId) {
    const idx = state.piggies.findIndex(p => p.id === state.editingPiggyId);
    if (idx > -1) state.piggies[idx] = { ...state.piggies[idx], ...data };
  } else { state.piggies.push({ id:uid(), ...data }); }
  saveState(); closeModal(el.piggyModal); showToast('🐷 Cofrinho salvo!');
};
const editPiggy = id => { const p = state.piggies.find(x => x.id === id); if (!p) return; state.editingPiggyId = id; populateAccountSelects(); populatePiggyForm(p); openModal(el.piggyModal); };
const openDeposit = id => { const p = state.piggies.find(x => x.id === id); if (!p) return; state.depositPiggyId = id; el.piggyDepositSub.textContent = `"${p.nome}" · Guardado: ${toBRL(p.guardado)} de ${toBRL(p.meta)}`; el.depositAmountInput.value = ''; openModal(el.piggyDepositModal); };
const saveDeposit = () => {
  const p = state.piggies.find(x => x.id === state.depositPiggyId); if (!p) return;
  const val = parseFloat(el.depositAmountInput.value); if (isNaN(val)||val<=0) return;
  p.guardado = parseFloat((p.guardado + val).toFixed(2)); saveState(); closeModal(el.piggyDepositModal); showToast(`🐷 ${toBRL(val)} guardado!`);
};

/* ============================================================
   EVENTOS PRINCIPAIS
   ============================================================ */
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
    if (btn.dataset.action==='delete-account') { state.deletingType='account'; state.deletingId=btn.dataset.id; openModal(el.deleteModal); }
  });

  el.openFormBtn.addEventListener('click', () => { resetForm(); populateAccountSelects(); openModal(el.formModal); });
  el.saveFormBtn.addEventListener('click', saveTx); el.cancelFormBtn.addEventListener('click', () => closeModal(el.formModal)); el.formModal.addEventListener('click', e => onOverlay(e, el.formModal));
  el.tipoToggle.addEventListener('click', e => { const b=e.target.closest('.toggle-btn'); if(b) setToggle(el.tipoToggle, b.dataset.value); });
  el.statusToggle.addEventListener('click', e => { const b=e.target.closest('.toggle-btn'); if(b) setToggle(el.statusToggle, b.dataset.value); });

  el.transactionsList.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]'); if (!btn) return;
    if (btn.dataset.action==='toggle') toggleStatus(btn.dataset.id);
    if (btn.dataset.action==='edit') editTx(btn.dataset.id);
    if (btn.dataset.action==='delete') { state.deletingType='tx'; state.deletingId=btn.dataset.id; openModal(el.deleteModal); }
  });

  el.openPiggyFormBtn.addEventListener('click', () => { resetPiggyForm(); populateAccountSelects(); openModal(el.piggyModal); });
  el.savePiggyBtn.addEventListener('click', savePiggy); el.cancelPiggyBtn.addEventListener('click', () => closeModal(el.piggyModal)); el.piggyModal.addEventListener('click', e => onOverlay(e, el.piggyModal));
  el.piggyEmojiPicker.addEventListener('click', e => { const b = e.target.closest('.emoji-btn'); if (!b) return; _piggyEmoji = b.dataset.value; el.piggyEmojiPicker.querySelectorAll('.emoji-btn').forEach(x => x.classList.toggle('active', x.dataset.value === _piggyEmoji)); });
  
  el.piggyList.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]'); if (!btn) return;
    if (btn.dataset.action==='edit-piggy') editPiggy(btn.dataset.id);
    if (btn.dataset.action==='delete-piggy') { state.deletingType='piggy'; state.deletingId=btn.dataset.id; openModal(el.deleteModal); }
    if (btn.dataset.action==='deposit') openDeposit(btn.dataset.id);
  });
  el.saveDepositBtn.addEventListener('click', saveDeposit); el.cancelDepositBtn.addEventListener('click', () => closeModal(el.piggyDepositModal)); el.piggyDepositModal.addEventListener('click', e => onOverlay(e, el.piggyDepositModal));

  el.confirmDeleteBtn.addEventListener('click', () => {
    const { deletingType:t, deletingId:id } = state;
    if (t==='tx') state.transactions = state.transactions.filter(x => x.id!==id);
    if (t==='account') state.accounts = state.accounts.filter(x => x.id!==id);
    if (t==='piggy') state.piggies = state.piggies.filter(x => x.id!==id);
    state.deletingType = null; state.deletingId = null; saveState(); closeModal(el.deleteModal); showToast('🗑️ Excluído.');
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
   LOGIN INICIAL (TELA DE SENHA)
   ============================================================ */
const checkLogin = () => {
  const overlay = $('loginOverlay');
  if (sessionStorage.getItem('financa_auth') === 'true') {
    overlay.style.display = 'none';
  } else {
    $('loginBtn').addEventListener('click', () => {
      if ($('loginPassword').value === '1234') { // <-- SENHA PARA ENTRAR
        sessionStorage.setItem('financa_auth', 'true');
        overlay.style.display = 'none';
      } else {
        $('loginError').style.display = 'block';
        $('loginPassword').value = '';
      }
    });
    $('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') $('loginBtn').click(); });
  }
};

/* ============================================================
   RECUPERACAO DE DADOS
   Injeta os dados salvos no localStorage e Firestore caso
   o banco esteja vazio. Roda uma unica vez e se auto-remove.
   ============================================================ */
const RECOVERY_FLAG = 'financa_recovery_done_v1';
const recoverData = () => {
  // Ja rodou antes? Nao faz nada.
  if (localStorage.getItem(RECOVERY_FLAG)) return;

  const DADOS_RECUPERADOS = {"saldoBase":{"2026-05":6118.4},"transactions":[{"id":"mornz98g-38p0x","tipo":"saida","descricao":"CARTAO ABRIL","categoria":"outros","valor":422.18,"frequencia":"variavel","status":"pendente","data":"2026-05-04","createdAt":1777863600000},{"id":"mornzqxy-y5oaq","tipo":"saida","descricao":"ACERVO","categoria":"alimentacao","valor":129.8,"frequencia":"variavel","status":"pendente","data":"2026-05-04","createdAt":1777863600000},{"id":"mornzzfv-45ug4","tipo":"saida","descricao":"CACAU SHOW","categoria":"alimentacao","valor":89.9,"frequencia":"variavel","status":"pendente","data":"2026-05-04","createdAt":1777863600000},{"id":"moro0aqu-h53cj","tipo":"saida","descricao":"HAMBURGUER","categoria":"alimentacao","valor":105.93,"frequencia":"variavel","status":"pendente","data":"2026-05-04","createdAt":1777863600000},{"id":"moro0h0r-0wmkb","tipo":"saida","descricao":"MARMITA 1","categoria":"alimentacao","valor":23,"frequencia":"variavel","status":"pendente","data":"2026-05-04","createdAt":1777863600000},{"id":"moro0nh6-2w7bc","tipo":"saida","descricao":"LANCHE 1","categoria":"alimentacao","valor":23,"frequencia":"variavel","status":"pendente","data":"2026-05-04","createdAt":1777863600000},{"id":"moro0uc0-x8apc","tipo":"saida","descricao":"MARMITA 2","categoria":"alimentacao","valor":23,"frequencia":"variavel","status":"pendente","data":"2026-05-04","createdAt":1777863600000},{"id":"moro19i8-0g7ke","tipo":"saida","descricao":"ZARA","categoria":"vestuario","valor":93,"frequencia":"variavel","status":"pendente","data":"2026-05-04","createdAt":1777863600000},{"id":"moro1n6t-kol7i","tipo":"saida","descricao":"INGRESSO","categoria":"lazer","valor":213.33,"frequencia":"variavel","status":"pendente","data":"2026-05-04","createdAt":1777863600000},{"id":"moro23od-0ycs2","tipo":"saida","descricao":"DINHEIRO YAN","categoria":"outros","valor":212,"frequencia":"variavel","status":"pendente","data":"2026-05-04","createdAt":1777863600000},{"id":"moro2h8c-2p7ac","tipo":"saida","descricao":"MALHARIA IPANEMA 100","categoria":"vestuario","valor":25,"frequencia":"variavel","status":"pendente","data":"2026-05-04","createdAt":1777863600000},{"id":"moro324p-sf4sc","tipo":"saida","descricao":"FLORES DIA DAS MULHERES","categoria":"outros","valor":137,"frequencia":"variavel","status":"pendente","data":"2026-05-04","createdAt":1777863600000},{"id":"moro3cw3-bo75k","tipo":"saida","descricao":"MC DOANLDS 1","categoria":"alimentacao","valor":19.9,"frequencia":"variavel","status":"pendente","data":"2026-05-04","createdAt":1777863600000},{"id":"moro3lja-uuiss","tipo":"saida","descricao":"UBER","categoria":"transporte","valor":7.23,"frequencia":"variavel","status":"pendente","data":"2026-05-04","createdAt":1777863600000},{"id":"moro3vf8-gluir","tipo":"saida","descricao":"RACAO 1","categoria":"outros","valor":78.5,"frequencia":"variavel","status":"pendente","data":"2026-05-04","createdAt":1777863600000},{"id":"moro49vm-zb7gp","tipo":"saida","descricao":"DEBOCHE","categoria":"lazer","valor":50.93,"frequencia":"variavel","status":"pendente","data":"2026-05-04","createdAt":1777863600000},{"id":"morobk6r-6hkir","tipo":"saida","descricao":"BIGBOX","categoria":"alimentacao","valor":12.27,"frequencia":"variavel","status":"pendente","data":"2026-05-04","createdAt":1777863600000},{"id":"moroby4j-xhoxi","tipo":"saida","descricao":"SHOPPE EMPRESTIMO","categoria":"outros","valor":97.66,"frequencia":"variavel","status":"pago","data":"2026-05-04","createdAt":1777863600000},{"id":"moroccn8-051fx","tipo":"saida","descricao":"SALGADO","categoria":"alimentacao","valor":6,"frequencia":"variavel","status":"pendente","data":"2026-05-04","createdAt":1777863600000},{"id":"morocjqr-hpt9m","tipo":"saida","descricao":"99","categoria":"transporte","valor":11.88,"frequencia":"variavel","status":"pendente","data":"2026-05-04","createdAt":1777863600000},{"id":"morocttp-ln1jg","tipo":"saida","descricao":"CASA DO PAO DE QUEIJO","categoria":"alimentacao","valor":11,"frequencia":"variavel","status":"pendente","data":"2026-05-04","createdAt":1777863600000},{"id":"morod0z3-aa37s","tipo":"saida","descricao":"SABOR GLACE","categoria":"alimentacao","valor":13.36,"frequencia":"variavel","status":"pendente","data":"2026-05-04","createdAt":1777863600000},{"id":"morodd4k-jimxw","tipo":"saida","descricao":"PERFUME","categoria":"vestuario","valor":149.9,"frequencia":"variavel","status":"pendente","data":"2026-05-04","createdAt":1777863600000},{"id":"morodro8-biy2r","tipo":"saida","descricao":"SHOPPE COSTURA","categoria":"outros","valor":128.26,"frequencia":"variavel","status":"pendente","data":"2026-05-04","createdAt":1777863600000},{"id":"moroebys-p3cn5","tipo":"saida","descricao":"CARTAO DE DEBITO","categoria":"outros","valor":312.8,"frequencia":"variavel","status":"pago","data":"2026-05-04","createdAt":1777863600000},{"id":"moroen4m-ejm0w","tipo":"saida","descricao":"PS5","categoria":"outros","valor":161,"frequencia":"variavel","status":"pago","data":"2026-05-04","createdAt":1777863600000},{"id":"morofjl7-9141m","tipo":"saida","descricao":"LUIZA PIZZA","categoria":"alimentacao","valor":9.2,"frequencia":"variavel","status":"pago","data":"2026-05-04","createdAt":1777863600000},{"id":"morogk6q-981pu","tipo":"saida","descricao":"ANA","categoria":"lazer","valor":50,"frequencia":"variavel","status":"pago","data":"2026-05-04","createdAt":1777863600000},{"id":"morohafv-yhgfo","tipo":"saida","descricao":"COURO","categoria":"vestuario","valor":44.08,"frequencia":"variavel","status":"pendente","data":"2026-05-04","createdAt":1777863600000},{"id":"moroi3t3-fnu01","tipo":"saida","descricao":"MACBOOK","categoria":"outros","valor":477.65,"frequencia":"variavel","status":"pago","data":"2026-05-04","createdAt":1777863600000},{"id":"moroit9q-i9mpn","tipo":"saida","descricao":"AIRBNB","categoria":"outros","valor":342,"frequencia":"variavel","status":"pago","data":"2026-05-04","createdAt":1777863600000},{"id":"moroxupr-r04vr","tipo":"saida","descricao":"TECIDOS","categoria":"outros","valor":150,"frequencia":"variavel","status":"pendente","data":"2026-05-04","createdAt":1777863600000},{"id":"moslsih1-w900a","tipo":"saida","descricao":"Passaporte Tiago","categoria":"outros","valor":257.9,"frequencia":"variavel","status":"pendente","data":"2026-05-05","createdAt":1777950000000},{"id":"moslt1c6-zm9xg","tipo":"saida","descricao":"Cama","categoria":"outros","valor":350,"frequencia":"variavel","status":"pago","data":"2026-05-05","createdAt":1777950000000},{"id":"moslz3y4-0a4y8","tipo":"saida","descricao":"GASTOS DO MES ( ANIVERSARIOS","categoria":"alimentacao","valor":50,"frequencia":"variavel","status":"pendente","data":"2026-05-05","createdAt":1777950000000},{"id":"mot28sbp-crzkz","tipo":"saida","descricao":"CELULAR ARRUMAR","categoria":"outros","valor":200,"frequencia":"variavel","status":"pendente","data":"2026-05-05","createdAt":1777950000000},{"id":"moth96gv-iy0c7","tipo":"saida","descricao":"calca show","categoria":"vestuario","valor":123.45,"frequencia":"variavel","status":"pago","data":"2026-05-06","createdAt":1778036400000,"contaId":null},{"id":"mou4sh1i-zbqwu","tipo":"saida","descricao":"salgado","valor":7,"categoria":"alimentacao","contaId":null,"frequencia":"variavel","status":"pago","data":"2026-05-06","createdAt":1778036400000}],"accounts":[{"id":"mou3jvc9-hh9mt","nome":"Banco do Brasil","tipo":"corrente","cor":"#F59E0B"}],"piggies":[{"id":"mou3j6p9-5efva","nome":"MACBOOK","emoji":"💻","meta":3000,"guardado":1500,"contaId":"mou3jvc9-hh9mt","inicio":"2026-05-06","deadline":null}]};

  // Grava no localStorage (backup imediato)
  try {
    localStorage.setItem('financa_backup_v1', JSON.stringify(DADOS_RECUPERADOS));
    localStorage.setItem('financa_app_v3', JSON.stringify(DADOS_RECUPERADOS));
    localStorage.setItem(RECOVERY_FLAG, '1');
    console.log('%c✅ Dados recuperados com sucesso!', 'color:#2DBE72;font-weight:bold;font-size:13px');
  } catch(e) {
    console.error('Erro na recuperacao:', e);
  }
};

const init = () => {
  recoverData(); // Restaura dados antes de qualquer coisa
  checkLogin();
  wireEvents();
  startCloudListener();
};

document.addEventListener('DOMContentLoaded', init);
