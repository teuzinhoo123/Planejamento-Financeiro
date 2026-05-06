/* ============================================================
   FINANÇA — script.js  (v3)
   Vanilla JS · LocalStorage · Sem dependências externas

   MODELO DE SALDO:
   • state.saldoBase['YYYY-MM'] = saldo inicial daquele mês (definido manualmente OU
     calculado automaticamente como sobra do mês anterior)
   • Ao navegar para um mês sem saldo definido, calcula automaticamente:
       saldoBase[mesAtual] = saldoBase[mesAnterior]
                            + entradas pagas do mês anterior
                            − saídas pagas do mês anterior
   ============================================================ */
'use strict';

/* ============================================================
   CHAVES DE ARMAZENAMENTO (migra v1 e v2 automaticamente)
   ============================================================ */
const KEY_V1 = 'financa_app_v1';
const KEY_V2 = 'financa_app_v2';
const KEY_V3 = 'financa_app_v3';

/* ============================================================
   ESTADO GLOBAL
   ============================================================ */
let state = {
  saldoBase:    {},   // { 'YYYY-MM': number } — saldo inicial de cada mês
  transactions: [],   // { id, tipo, descricao, categoria, contaId, valor, frequencia, status, data, createdAt }
  accounts:     [],   // { id, nome, tipo, cor }
  piggies:      [],   // { id, nome, emoji, meta, guardado, contaId, inicio, deadline }

  currentYear:  0,
  currentMonth: 0,   // 0 = Janeiro

  filters: {
    tipo: 'all', status: 'all', frequencia: 'all',
    conta: 'all', categoria: 'all',
    search: '', minVal: '', maxVal: '',
  },

  editingTxId:      null,
  editingAccountId: null,
  editingPiggyId:   null,
  deletingType:     null,  // 'tx' | 'account' | 'piggy'
  deletingId:       null,
  depositPiggyId:   null,
};

/* ============================================================
   UTILITÁRIOS
   ============================================================ */
const uid   = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
const toBRL = v  => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v ?? 0);
const clamp = (v,mn,mx) => Math.min(Math.max(v,mn),mx);

/** Formata mês como chave 'YYYY-MM' */
const monthKey = (y, m) => `${y}-${String(m+1).padStart(2,'0')}`;

/** Rótulo legível do mês ("Maio de 2025") */
const monthLabel = (y, m) =>
  new Date(y, m, 1).toLocaleDateString('pt-BR', { month:'long', year:'numeric' });

/** Formata ISO date para DD/MM */
const fmtDate = iso => {
  if (!iso) return '';
  const [,mon,d] = iso.split('-');
  return `${d}/${mon}`;
};

const CATEGORY_ICONS = {
  alimentacao:'🛒', transporte:'🚗', moradia:'🏠',
  saude:'💊', lazer:'🎬', educacao:'📚',
  vestuario:'👕', assinaturas:'📱', outros:'📦',
  salario:'💼', freelance:'💻', investimento:'📈',
  presente:'🎁', reembolso:'↩️', 'outros-entrada':'✨',
};
const catIcon = cat => CATEGORY_ICONS[cat] || '💰';

const ACCOUNT_TYPE_LABELS = {
  corrente:'Conta Corrente', poupanca:'Poupança',
  digital:'Conta Digital',   investimento:'Investimento',
  dinheiro:'Dinheiro em Espécie', outro:'Outro',
};
const ACCOUNT_TYPE_ICONS = {
  corrente:'🏦', poupanca:'💰', digital:'📱',
  investimento:'📈', dinheiro:'💵', outro:'📦',
};

/* ============================================================
   CÁLCULO DE SALDO POR MÊS
   O saldo de um mês = saldo inicial do mês (base) + entradas pagas − saídas pagas
   Para navegar, o saldo inicial do próximo mês = sobra do mês atual
   ============================================================ */

/** Retorna todas as transações de um mês/ano específico */
const txOfMonthYM = (y, m) =>
  state.transactions.filter(tx => {
    const d = new Date(tx.createdAt);
    return d.getFullYear() === y && d.getMonth() === m;
  });

/**
 * Calcula o saldo inicial de um mês.
 * Se já definido manualmente, usa esse valor.
 * Caso contrário, percorre para trás até achar um mês com saldo definido
 * e aplica todas as sobras mensais acumuladas.
 */
const getSaldoInicial = (y, m) => {
  const key = monthKey(y, m);
  if (state.saldoBase[key] !== undefined) return state.saldoBase[key];

  // Encontra o mês base mais próximo anterior
  // Percorre até 36 meses para trás
  for (let i = 1; i <= 36; i++) {
    let py = y, pm = m - i;
    while (pm < 0) { pm += 12; py--; }
    const pKey = monthKey(py, pm);
    if (state.saldoBase[pKey] !== undefined) {
      // Calcula acumulando as sobras de cada mês intermediário
      let saldo = state.saldoBase[pKey];
      for (let j = i - 1; j >= 0; j--) {
        let cy = y, cm = m - j;
        while (cm < 0) { cm += 12; cy--; }
        const txs = txOfMonthYM(cy, cm);
        const entradasPagas = txs.filter(t => t.tipo === 'entrada' && t.status === 'pago')
                                  .reduce((a,t) => a + t.valor, 0);
        const saidasPagas   = txs.filter(t => t.tipo === 'saida'   && t.status === 'pago')
                                  .reduce((a,t) => a + t.valor, 0);
        saldo = saldo + entradasPagas - saidasPagas;
      }
      return saldo;
    }
  }
  return 0; // nenhum mês base encontrado
};

/**
 * Calcula os totais para exibir nos cards do mês atual.
 * "Saldo em Conta" = saldo inicial do mês (não muda com pendentes)
 * "Sobras" = saldo inicial + entradas (todas) − saídas (todas)  →  projeção final
 */
const calcTotals = () => {
  const y = state.currentYear, m = state.currentMonth;
  const txs = txOfMonthYM(y, m);

  const saldoInicial   = getSaldoInicial(y, m);

  const totalEntradas  = txs.filter(t => t.tipo === 'entrada')
                             .reduce((a,t) => a + t.valor, 0);

  const saidas         = txs.filter(t => t.tipo === 'saida');
  const totalSaidas    = saidas.reduce((a,t) => a + t.valor, 0);          // Total a pagar
  const saidasPagas    = saidas.filter(t => t.status === 'pago')
                               .reduce((a,t) => a + t.valor, 0);          // Já pago
  const saidasPendentes = totalSaidas - saidasPagas;                      // Falta pagar

  // Sobras = saldo inicial + entradas recebidas − total de saídas (projeção)
  const sobras = saldoInicial + totalEntradas - totalSaidas;

  return {
    saldoInicial,
    totalEntradas,
    totalAPagar:   totalSaidas,
    totalPago:     saidasPagas,
    faltaPagar:    saidasPendentes,
    sobras,
  };
};

/* ============================================================
   PERSISTÊNCIA — LocalStorage
   ============================================================ */
const saveState = () => {
  try {
    localStorage.setItem(KEY_V3, JSON.stringify({
      saldoBase:    state.saldoBase,
      transactions: state.transactions,
      accounts:     state.accounts,
      piggies:      state.piggies,
    }));
  } catch(e) { showToast('⚠️ Erro ao salvar dados.'); }
};

const loadState = () => {
  try {
    // Tenta v3 primeiro
    const raw3 = localStorage.getItem(KEY_V3);
    if (raw3) {
      const s = JSON.parse(raw3);
      state.saldoBase    = (s.saldoBase && typeof s.saldoBase === 'object') ? s.saldoBase : {};
      state.transactions = Array.isArray(s.transactions) ? s.transactions : [];
      state.accounts     = Array.isArray(s.accounts)     ? s.accounts     : [];
      state.piggies      = Array.isArray(s.piggies)      ? s.piggies      : [];
      return;
    }
    // Migração v2 → v3
    const raw2 = localStorage.getItem(KEY_V2);
    if (raw2) {
      const s = JSON.parse(raw2);
      const saldo = s.saldo ?? 0;
      // Guarda o saldo antigo como base do mês atual
      const now = new Date();
      state.saldoBase    = { [monthKey(now.getFullYear(), now.getMonth())]: saldo };
      state.transactions = Array.isArray(s.transactions) ? s.transactions : [];
      state.accounts     = Array.isArray(s.accounts)     ? s.accounts     : [];
      state.piggies      = Array.isArray(s.piggies)      ? s.piggies      : [];
      saveState();
      console.info('✅ Dados migrados v2 → v3');
      return;
    }
    // Migração v1 → v3
    const raw1 = localStorage.getItem(KEY_V1);
    if (raw1) {
      const s = JSON.parse(raw1);
      const now = new Date();
      state.saldoBase    = { [monthKey(now.getFullYear(), now.getMonth())]: s.saldo ?? 0 };
      state.transactions = Array.isArray(s.transactions) ? s.transactions : [];
      state.accounts     = [];
      state.piggies      = [];
      saveState();
      console.info('✅ Dados migrados v1 → v3');
    }
  } catch(e) { console.warn('Erro ao carregar dados:', e); }
};

/* ============================================================
   REFERÊNCIAS DOM
   ============================================================ */
const $ = id => document.getElementById(id);
const el = {
  currentMonthLabel:  $('currentMonthLabel'),
  prevMonth:          $('prevMonth'),
  nextMonth:          $('nextMonth'),
  tabBtns:            document.querySelectorAll('.tab-btn'),
  tabPanels:          document.querySelectorAll('.tab-panel'),
  // dashboard
  saldoConta:         $('saldoConta'),
  editBalanceBtn:     $('editBalanceBtn'),
  totalAPagar:        $('totalAPagar'),
  totalPago:          $('totalPago'),
  faltaPagar:         $('faltaPagar'),
  sobras:             $('sobras'),
  accountsList:       $('accountsList'),
  categoryBreakdown:  $('categoryBreakdown'),
  categoryMonthHint:  $('categoryMonthHint'),
  openAccountFormBtn: $('openAccountFormBtn'),
  // transactions
  openFormBtn:        $('openFormBtn'),
  filterToggleBtn:    $('filterToggleBtn'),
  filterPanel:        $('filterPanel'),
  filterCountBadge:   $('filterCountBadge'),
  filterTipo:         $('filterTipo'),
  filterStatus:       $('filterStatus'),
  filterFrequencia:   $('filterFrequencia'),
  filterConta:        $('filterConta'),
  filterCategoria:    $('filterCategoria'),
  filterSearch:       $('filterSearch'),
  filterMinVal:       $('filterMinVal'),
  filterMaxVal:       $('filterMaxVal'),
  clearFiltersBtn:    $('clearFiltersBtn'),
  resultsInfo:        $('resultsInfo'),
  resultsCount:       $('resultsCount'),
  resultsTotal:       $('resultsTotal'),
  transactionsList:   $('transactionsList'),
  emptyState:         $('emptyState'),
  // piggy
  piggyTotal:         $('piggyTotal'),
  piggyGoalSummary:   $('piggyGoalSummary'),
  openPiggyFormBtn:   $('openPiggyFormBtn'),
  piggyList:          $('piggyList'),
  piggyEmptyState:    $('piggyEmptyState'),
  // modal: saldo
  balanceModal:       $('balanceModal'),
  balanceInput:       $('balanceInput'),
  balanceModalSub:    $('balanceModalSub'),
  saveBalanceBtn:     $('saveBalanceBtn'),
  cancelBalanceBtn:   $('cancelBalanceBtn'),
  // modal: conta
  accountModal:       $('accountModal'),
  accountModalTitle:  $('accountModalTitle'),
  accountNameInput:   $('accountNameInput'),
  accountTypeInput:   $('accountTypeInput'),
  accountColorPicker: $('accountColorPicker'),
  saveAccountBtn:     $('saveAccountBtn'),
  cancelAccountBtn:   $('cancelAccountBtn'),
  // modal: lançamento
  formModal:          $('formModal'),
  formModalTitle:     $('formModalTitle'),
  tipoToggle:         $('tipoToggle'),
  descricaoInput:     $('descricaoInput'),
  categoriaInput:     $('categoriaInput'),
  contaInput:         $('contaInput'),
  valorInput:         $('valorInput'),
  frequenciaInput:    $('frequenciaInput'),
  statusToggle:       $('statusToggle'),
  dataInput:          $('dataInput'),
  saveFormBtn:        $('saveFormBtn'),
  cancelFormBtn:      $('cancelFormBtn'),
  // modal: cofrinho
  piggyModal:         $('piggyModal'),
  piggyModalTitle:    $('piggyModalTitle'),
  piggyNameInput:     $('piggyNameInput'),
  piggyEmojiPicker:   $('piggyEmojiPicker'),
  piggyGoalInput:     $('piggyGoalInput'),
  piggySavedInput:    $('piggySavedInput'),
  piggyAccountInput:  $('piggyAccountInput'),
  piggyStartInput:    $('piggyStartInput'),
  piggyDeadlineInput: $('piggyDeadlineInput'),
  savePiggyBtn:       $('savePiggyBtn'),
  cancelPiggyBtn:     $('cancelPiggyBtn'),
  // modal: depósito
  piggyDepositModal:  $('piggyDepositModal'),
  piggyDepositSub:    $('piggyDepositSub'),
  depositAmountInput: $('depositAmountInput'),
  saveDepositBtn:     $('saveDepositBtn'),
  cancelDepositBtn:   $('cancelDepositBtn'),
  // modal: delete
  deleteModal:        $('deleteModal'),
  deleteModalTitle:   $('deleteModalTitle'),
  confirmDeleteBtn:   $('confirmDeleteBtn'),
  cancelDeleteBtn:    $('cancelDeleteBtn'),
  toast:              $('toast'),
};

/* ============================================================
   TOAST
   ============================================================ */
let _toastTimer = null;
const showToast = msg => {
  clearTimeout(_toastTimer);
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  _toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2800);
};

/* ============================================================
   MODAIS
   ============================================================ */
const openModal  = ov => { ov.classList.add('open');    document.body.style.overflow = 'hidden'; };
const closeModal = ov => { ov.classList.remove('open'); document.body.style.overflow = ''; };
const onOverlay  = (e, ov) => { if (e.target === ov) closeModal(ov); };

/* ============================================================
   ABAS (TABS)
   ============================================================ */
const switchTab = tabId => {
  el.tabBtns.forEach  (b => b.classList.toggle('active', b.dataset.tab === tabId));
  el.tabPanels.forEach(p => p.classList.toggle('active', p.id === `tab-${tabId}`));
};

/* ============================================================
   TOGGLE GROUP
   ============================================================ */
const getToggle = wrap => wrap.querySelector('.toggle-btn.active')?.dataset.value ?? null;
const setToggle = (wrap, val) =>
  wrap.querySelectorAll('.toggle-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.value === val));

/* ============================================================
   RENDER — HEADER
   ============================================================ */
const renderHeader = () => {
  el.currentMonthLabel.textContent =
    monthLabel(state.currentYear, state.currentMonth);
};

/* ============================================================
   RENDER — DASHBOARD
   ============================================================ */
const renderDashboard = () => {
  const { saldoInicial, totalEntradas, totalAPagar, totalPago, faltaPagar, sobras } = calcTotals();
  const key = monthKey(state.currentYear, state.currentMonth);
  const isManual = state.saldoBase[key] !== undefined;

  // Saldo: mostra o saldo inicial do mês
  el.saldoConta.textContent = toBRL(saldoInicial);
  // Sublegenda indica se é automático ou manual
  const sub = el.editBalanceBtn.closest('.balance-hero').querySelector('.balance-sub');
  if (sub) {
    sub.textContent = isManual
      ? 'Saldo definido manualmente — clique no lápis para editar'
      : 'Calculado automaticamente com base no mês anterior';
  }

  // Cards
  el.totalAPagar.textContent = toBRL(totalAPagar);
  el.totalPago.textContent   = toBRL(totalPago);
  el.faltaPagar.textContent  = toBRL(faltaPagar);
  el.sobras.textContent      = toBRL(sobras);

  // Cor do card Sobras
  const sobrasCard = el.sobras.closest('.summary-card');
  sobrasCard.className = `summary-card ${sobras < 0 ? 'card--red' : 'card--blue'}`;
  el.sobras.style.color = sobras < 0 ? 'var(--clr-red-text)' : 'var(--clr-blue-text)';

  renderAccounts();
  renderCategoryBreakdown();
};

/* ============================================================
   RENDER — CONTAS
   ============================================================ */
const renderAccounts = () => {
  if (!state.accounts.length) {
    el.accountsList.innerHTML =
      `<p style="font-size:var(--fs-sm);color:var(--text-muted);padding:var(--sp-3) 0 var(--sp-5)">
         Nenhuma conta cadastrada ainda. Toque em "+ Nova Conta".
       </p>`;
    return;
  }
  el.accountsList.innerHTML = state.accounts.map(acc => `
    <div class="account-card">
      <div class="account-dot" style="background:${acc.cor}">
        ${ACCOUNT_TYPE_ICONS[acc.tipo] || '🏦'}
      </div>
      <div class="account-info">
        <div class="account-name">${acc.nome}</div>
        <div class="account-type">${ACCOUNT_TYPE_LABELS[acc.tipo] || acc.tipo}</div>
      </div>
      <div class="account-actions">
        <button class="account-action-btn" data-action="edit-account" data-id="${acc.id}" title="Editar">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="account-action-btn delete" data-action="delete-account" data-id="${acc.id}" title="Excluir">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    </div>`).join('');
};

/* ============================================================
   RENDER — BREAKDOWN POR CATEGORIA
   ============================================================ */
const renderCategoryBreakdown = () => {
  const txs   = txOfMonthYM(state.currentYear, state.currentMonth).filter(t => t.tipo === 'saida');
  const total = txs.reduce((a,t) => a + t.valor, 0);

  if (el.categoryMonthHint)
    el.categoryMonthHint.textContent = monthLabel(state.currentYear, state.currentMonth);

  if (!txs.length) {
    el.categoryBreakdown.innerHTML =
      `<p style="font-size:var(--fs-sm);color:var(--text-muted);padding:var(--sp-2) 0 var(--sp-5)">Sem saídas registradas neste mês.</p>`;
    return;
  }
  const map = {};
  txs.forEach(t => { map[t.categoria] = (map[t.categoria]||0) + t.valor; });
  const sorted = Object.entries(map).sort((a,b) => b[1]-a[1]);

  el.categoryBreakdown.innerHTML = sorted.map(([cat, val]) => {
    const pct = total > 0 ? Math.round((val/total)*100) : 0;
    return `
      <div class="cat-row">
        <div class="cat-row-top">
          <span class="cat-row-icon">${catIcon(cat)}</span>
          <span class="cat-row-name">${cat.replace(/-/g,' ')}</span>
          <span class="cat-row-value">${toBRL(val)}</span>
        </div>
        <div class="cat-row-bar">
          <div class="cat-row-fill" style="width:${pct}%"></div>
        </div>
      </div>`;
  }).join('');
};

/* ============================================================
   RENDER — COFRINHOS
   ============================================================ */
const renderPiggies = () => {
  const totalGuardado = state.piggies.reduce((a,p) => a + (p.guardado||0), 0);
  el.piggyTotal.textContent       = toBRL(totalGuardado);
  el.piggyGoalSummary.textContent =
    `em ${state.piggies.length} cofrinho${state.piggies.length !== 1 ? 's' : ''}`;

  if (!state.piggies.length) {
    el.piggyList.innerHTML           = '';
    el.piggyEmptyState.style.display = 'block';
    return;
  }
  el.piggyEmptyState.style.display = 'none';

  el.piggyList.innerHTML = state.piggies.map(p => {
    const pct      = p.meta > 0 ? clamp(Math.round((p.guardado/p.meta)*100), 0, 100) : 0;
    const complete = pct >= 100;
    const falta    = Math.max(0, p.meta - p.guardado);
    const acc      = p.contaId ? state.accounts.find(a => a.id === p.contaId) : null;

    let diasInfo = '', diasColor = 'inherit';
    if (p.deadline) {
      const hoje = new Date(); hoje.setHours(0,0,0,0);
      const dead = new Date(p.deadline + 'T00:00:00');
      const diff = Math.ceil((dead - hoje) / 86400000);
      if (diff > 0)       { diasInfo = `${diff} dias restantes`; }
      else if (diff === 0){ diasInfo = 'Vence hoje!'; diasColor = 'var(--clr-orange-text)'; }
      else                { diasInfo = `Venceu há ${Math.abs(diff)} dias`; diasColor = 'var(--clr-red-text)'; }
    }

    return `
      <div class="piggy-card">
        <div class="piggy-card-top">
          <span class="piggy-emoji">${p.emoji || '🐷'}</span>
          <div class="piggy-info">
            <div class="piggy-name">${p.nome}</div>
            <div class="piggy-amounts">
              <span class="piggy-saved">${toBRL(p.guardado)}</span>
              <span class="piggy-of">de</span>
              <span class="piggy-goal">${toBRL(p.meta)}</span>
            </div>
          </div>
          <div class="piggy-card-actions">
            <button class="piggy-action-btn" data-action="edit-piggy" data-id="${p.id}" title="Editar">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="piggy-action-btn delete" data-action="delete-piggy" data-id="${p.id}" title="Excluir">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          </div>
        </div>

        <div class="piggy-progress-wrap">
          <div class="piggy-progress-bar">
            <div class="piggy-progress-fill ${complete?'complete':''}" style="width:${pct}%"></div>
          </div>
        </div>

        <div class="piggy-card-footer">
          ${acc ? `<span class="piggy-meta-item">🏦&nbsp;<strong style="color:${acc.cor}">${acc.nome}</strong></span>` : ''}
          ${p.inicio   ? `<span class="piggy-meta-item">📅&nbsp;Início: <strong>${fmtDate(p.inicio)}</strong></span>`   : ''}
          ${p.deadline ? `<span class="piggy-meta-item">🎯&nbsp;Retirada: <strong>${fmtDate(p.deadline)}</strong></span>` : ''}
          ${diasInfo   ? `<span class="piggy-meta-item" style="color:${diasColor}">${diasInfo}</span>`                    : ''}
          <span class="piggy-pct ${complete?'complete':''}" style="margin-left:auto">${pct}%</span>
        </div>

        ${complete
          ? `<div class="piggy-complete-badge">🎉 Meta atingida! Parabéns!</div>`
          : `<button class="btn-deposit" data-action="deposit" data-id="${p.id}">
               + Guardar dinheiro
               <span style="opacity:.65;font-size:var(--fs-xs);font-weight:500">(falta ${toBRL(falta)})</span>
             </button>`
        }
      </div>`;
  }).join('');
};

/* ============================================================
   RENDER — SELECT DE CONTAS (formulários)
   ============================================================ */
const populateAccountSelects = () => {
  const opts = state.accounts.map(a =>
    `<option value="${a.id}">${ACCOUNT_TYPE_ICONS[a.tipo]||'🏦'} ${a.nome}</option>`
  ).join('');

  [el.contaInput, el.piggyAccountInput].forEach(sel => {
    const prev = sel.value;
    sel.innerHTML = `<option value="">— Sem conta —</option>${opts}`;
    if (prev) sel.value = prev;
  });

  // Atualiza chips de conta no painel de filtros
  const chipOpts = state.accounts.map(a =>
    `<button class="chip${state.filters.conta===a.id?' active':''}" data-value="${a.id}">${a.nome}</button>`
  ).join('');
  const allCls = state.filters.conta==='all' ? ' active' : '';
  el.filterConta.innerHTML =
    `<button class="chip${allCls}" data-value="all">Todas</button>${chipOpts}`;
};

/* ============================================================
   RENDER — LISTA DE TRANSAÇÕES
   ============================================================ */
const applyFilters = txs => {
  const f = state.filters;
  return txs.filter(tx => {
    if (f.tipo       !== 'all' && tx.tipo           !== f.tipo)      return false;
    if (f.status     !== 'all' && tx.status         !== f.status)    return false;
    if (f.frequencia !== 'all' && tx.frequencia     !== f.frequencia)return false;
    if (f.conta      !== 'all' && (tx.contaId||'')  !== f.conta)     return false;
    if (f.categoria  !== 'all' && tx.categoria      !== f.categoria) return false;
    if (f.search && !tx.descricao.toLowerCase().includes(f.search.toLowerCase())) return false;
    if (f.minVal !== '' && tx.valor < parseFloat(f.minVal)) return false;
    if (f.maxVal !== '' && tx.valor > parseFloat(f.maxVal)) return false;
    return true;
  });
};

const countActiveFilters = () => {
  const f = state.filters;
  return [f.tipo!=='all', f.status!=='all', f.frequencia!=='all',
          f.conta!=='all', f.categoria!=='all',
          f.search!=='', f.minVal!=='', f.maxVal!==''].filter(Boolean).length;
};

const renderTransactions = () => {
  let txs = txOfMonthYM(state.currentYear, state.currentMonth);
  txs = applyFilters(txs);
  txs.sort((a,b) => b.createdAt - a.createdAt);

  const count = countActiveFilters();
  el.filterCountBadge.textContent    = count;
  el.filterCountBadge.style.display  = count > 0 ? 'inline-flex' : 'none';
  el.filterToggleBtn.classList.toggle('has-filters', count > 0);

  const panelOpen = el.filterPanel.style.display !== 'none';
  if (count > 0 || panelOpen) {
    el.resultsInfo.style.display = 'flex';
    el.resultsCount.textContent  = `${txs.length} lançamento${txs.length!==1?'s':''}`;
    const soma = txs.reduce((a,t) => a + (t.tipo==='saida'?-t.valor:t.valor), 0);
    el.resultsTotal.textContent  = `Total: ${toBRL(soma)}`;
  } else {
    el.resultsInfo.style.display = 'none';
  }

  if (!txs.length) {
    el.transactionsList.innerHTML = '';
    el.emptyState.style.display   = 'block';
    return;
  }
  el.emptyState.style.display = 'none';

  el.transactionsList.innerHTML = txs.map(tx => {
    const isChecked = tx.status === 'pago';
    const conta     = tx.contaId ? state.accounts.find(a => a.id === tx.contaId) : null;
    return `
      <div class="tx-item ${isChecked?'is-paid':''}" data-id="${tx.id}">
        <button class="tx-check ${isChecked?'checked':''}"
          data-action="toggle" data-id="${tx.id}"
          title="${isChecked?'Marcar pendente':'Marcar pago'}" aria-label="Alterar status">
          ${isChecked?'✓':''}
        </button>
        <div class="tx-icon ${tx.tipo}-icon">${catIcon(tx.categoria)}</div>
        <div class="tx-info">
          <div class="tx-desc">${tx.descricao||'Sem descrição'}</div>
          <div class="tx-meta">
            <span class="tx-badge badge-${tx.frequencia}">${tx.frequencia}</span>
            <span class="tx-badge badge-${tx.status}">
              ${tx.status==='pago'?(tx.tipo==='entrada'?'recebido':'pago'):'pendente'}
            </span>
            ${conta?`<span class="tx-badge" style="background:${conta.cor}22;color:${conta.cor};border:1px solid ${conta.cor}44">${conta.nome}</span>`:''}
            ${tx.data?`<span class="tx-date">${fmtDate(tx.data)}</span>`:''}
          </div>
        </div>
        <div class="tx-right">
          <span class="tx-amount ${tx.tipo}">
            ${tx.tipo==='entrada'?'+':''}${toBRL(tx.valor)}
          </span>
          <div class="tx-actions">
            <button class="tx-action-btn" data-action="edit" data-id="${tx.id}" title="Editar" aria-label="Editar">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="tx-action-btn delete" data-action="delete" data-id="${tx.id}" title="Excluir" aria-label="Excluir">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          </div>
        </div>
      </div>`;
  }).join('');
};

/* ============================================================
   RENDER COMPLETO
   ============================================================ */
const render = () => {
  renderHeader();
  renderDashboard();
  renderTransactions();
  renderPiggies();
  populateAccountSelects();
};

/* ============================================================
   FORMULÁRIO DE LANÇAMENTO
   ============================================================ */
const resetForm = () => {
  state.editingTxId = null;
  el.formModalTitle.textContent = 'Novo Lançamento';
  setToggle(el.tipoToggle, 'saida');
  el.descricaoInput.value  = '';
  el.categoriaInput.value  = 'alimentacao';
  el.contaInput.value      = '';
  el.valorInput.value      = '';
  el.frequenciaInput.value = 'variavel';
  setToggle(el.statusToggle, 'pendente');
  el.dataInput.value = new Date().toISOString().slice(0,10);
};

const populateForm = tx => {
  el.formModalTitle.textContent = 'Editar Lançamento';
  setToggle(el.tipoToggle, tx.tipo);
  el.descricaoInput.value  = tx.descricao;
  el.categoriaInput.value  = tx.categoria;
  el.contaInput.value      = tx.contaId || '';
  el.valorInput.value      = tx.valor;
  el.frequenciaInput.value = tx.frequencia;
  setToggle(el.statusToggle, tx.status);
  el.dataInput.value       = tx.data || '';
};

const saveTx = () => {
  const tipo       = getToggle(el.tipoToggle);
  const descricao  = el.descricaoInput.value.trim();
  const valor      = parseFloat(parseFloat(el.valorInput.value).toFixed(2));

  if (!descricao)           { showToast('⚠️ Informe uma descrição.');   return; }
  if (isNaN(valor)||valor<=0){ showToast('⚠️ Informe um valor válido.'); return; }

  const data = {
    tipo, descricao, valor,
    categoria:  el.categoriaInput.value,
    contaId:    el.contaInput.value || null,
    frequencia: el.frequenciaInput.value,
    status:     getToggle(el.statusToggle),
    data:       el.dataInput.value || null,
  };

  if (state.editingTxId) {
    const idx = state.transactions.findIndex(t => t.id === state.editingTxId);
    if (idx > -1) state.transactions[idx] = { ...state.transactions[idx], ...data };
    showToast('✏️ Lançamento atualizado!');
  } else {
    const dateStr = el.dataInput.value || new Date().toISOString().slice(0,10);
    const [y,m,d] = dateStr.split('-').map(Number);
    state.transactions.push({ id:uid(), ...data, createdAt: new Date(y,m-1,d).getTime() });
    showToast('✅ Lançamento adicionado!');
  }
  saveState(); closeModal(el.formModal); render();
};

const toggleStatus = id => {
  const tx = state.transactions.find(t => t.id === id);
  if (!tx) return;
  tx.status = tx.status === 'pago' ? 'pendente' : 'pago';
  saveState(); render();
  showToast(tx.status === 'pago' ? '✅ Marcado como pago!' : '🔄 Marcado como pendente.');
};

const editTx = id => {
  const tx = state.transactions.find(t => t.id === id);
  if (!tx) return;
  state.editingTxId = id;
  populateAccountSelects();
  populateForm(tx);
  openModal(el.formModal);
};

/* ============================================================
   CONTAS
   ============================================================ */
let _accountColor = '#4F8EF7';

const resetAccountForm = () => {
  state.editingAccountId = null;
  el.accountModalTitle.textContent = 'Nova Conta';
  el.accountNameInput.value = '';
  el.accountTypeInput.value = 'corrente';
  _accountColor = '#4F8EF7';
  el.accountColorPicker.querySelectorAll('.color-dot').forEach(d =>
    d.classList.toggle('active', d.dataset.color === _accountColor));
};

const populateAccountForm = acc => {
  el.accountModalTitle.textContent = 'Editar Conta';
  el.accountNameInput.value = acc.nome;
  el.accountTypeInput.value = acc.tipo;
  _accountColor = acc.cor;
  el.accountColorPicker.querySelectorAll('.color-dot').forEach(d =>
    d.classList.toggle('active', d.dataset.color === acc.cor));
};

const saveAccount = () => {
  const nome = el.accountNameInput.value.trim();
  if (!nome) { showToast('⚠️ Informe o nome da conta.'); return; }
  const data = { nome, tipo: el.accountTypeInput.value, cor: _accountColor };
  if (state.editingAccountId) {
    const idx = state.accounts.findIndex(a => a.id === state.editingAccountId);
    if (idx > -1) state.accounts[idx] = { ...state.accounts[idx], ...data };
    showToast('✏️ Conta atualizada!');
  } else {
    state.accounts.push({ id:uid(), ...data });
    showToast('✅ Conta adicionada!');
  }
  saveState(); closeModal(el.accountModal); render();
};

/* ============================================================
   COFRINHOS
   ============================================================ */
let _piggyEmoji = '🐷';

const resetPiggyForm = () => {
  state.editingPiggyId = null;
  el.piggyModalTitle.textContent = 'Novo Cofrinho';
  el.piggyNameInput.value     = '';
  el.piggyGoalInput.value     = '';
  el.piggySavedInput.value    = '0';
  el.piggyAccountInput.value  = '';
  el.piggyStartInput.value    = new Date().toISOString().slice(0,10);
  el.piggyDeadlineInput.value = '';
  _piggyEmoji = '🐷';
  el.piggyEmojiPicker.querySelectorAll('.emoji-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.value === '🐷'));
};

const populatePiggyForm = p => {
  el.piggyModalTitle.textContent = 'Editar Cofrinho';
  el.piggyNameInput.value     = p.nome;
  el.piggyGoalInput.value     = p.meta;
  el.piggySavedInput.value    = p.guardado;
  el.piggyAccountInput.value  = p.contaId || '';
  el.piggyStartInput.value    = p.inicio  || '';
  el.piggyDeadlineInput.value = p.deadline|| '';
  _piggyEmoji = p.emoji || '🐷';
  el.piggyEmojiPicker.querySelectorAll('.emoji-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.value === _piggyEmoji));
};

const savePiggy = () => {
  const nome = el.piggyNameInput.value.trim();
  if (!nome) { showToast('⚠️ Informe o nome da meta.'); return; }
  const meta = parseFloat(el.piggyGoalInput.value);
  if (isNaN(meta)||meta<=0) { showToast('⚠️ Informe um valor de meta válido.'); return; }

  const data = {
    nome, emoji: _piggyEmoji, meta,
    guardado:  parseFloat(el.piggySavedInput.value) || 0,
    contaId:   el.piggyAccountInput.value  || null,
    inicio:    el.piggyStartInput.value    || null,
    deadline:  el.piggyDeadlineInput.value || null,
  };

  if (state.editingPiggyId) {
    const idx = state.piggies.findIndex(p => p.id === state.editingPiggyId);
    if (idx > -1) state.piggies[idx] = { ...state.piggies[idx], ...data };
    showToast('✏️ Cofrinho atualizado!');
  } else {
    state.piggies.push({ id:uid(), ...data });
    showToast('🐷 Cofrinho criado!');
  }
  saveState(); closeModal(el.piggyModal); renderPiggies();
};

const editPiggy = id => {
  const p = state.piggies.find(x => x.id === id);
  if (!p) return;
  state.editingPiggyId = id;
  populateAccountSelects();
  populatePiggyForm(p);
  openModal(el.piggyModal);
};

const openDeposit = id => {
  const p = state.piggies.find(x => x.id === id);
  if (!p) return;
  state.depositPiggyId = id;
  el.piggyDepositSub.textContent =
    `"${p.nome}" · Guardado: ${toBRL(p.guardado)} de ${toBRL(p.meta)}`;
  el.depositAmountInput.value = '';
  openModal(el.piggyDepositModal);
  setTimeout(() => el.depositAmountInput.focus(), 300);
};

const saveDeposit = () => {
  const p = state.piggies.find(x => x.id === state.depositPiggyId);
  if (!p) return;
  const val = parseFloat(el.depositAmountInput.value);
  if (isNaN(val)||val<=0) { showToast('⚠️ Informe um valor válido.'); return; }
  p.guardado = parseFloat((p.guardado + val).toFixed(2));
  saveState(); closeModal(el.piggyDepositModal); renderPiggies();
  showToast(`🐷 ${toBRL(val)} guardado com sucesso!`);
};

/* ============================================================
   EXCLUSÃO GENÉRICA
   ============================================================ */
const startDelete = (type, id, title) => {
  state.deletingType = type;
  state.deletingId   = id;
  el.deleteModalTitle.textContent = title || 'Excluir?';
  openModal(el.deleteModal);
};

const confirmDelete = () => {
  const { deletingType:t, deletingId:id } = state;
  if (t==='tx')      state.transactions = state.transactions.filter(x => x.id!==id);
  if (t==='account') state.accounts     = state.accounts.filter(x => x.id!==id);
  if (t==='piggy')   state.piggies      = state.piggies.filter(x => x.id!==id);
  state.deletingType = null; state.deletingId = null;
  saveState(); closeModal(el.deleteModal); render();
  showToast('🗑️ Excluído com sucesso.');
};

/* ============================================================
   FILTROS — helper para grupos de chips
   ============================================================ */
const bindChips = (container, filterKey) => {
  container.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    container.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.filters[filterKey] = chip.dataset.value;
    renderTransactions();
  });
};

/* ============================================================
   WIRING — todos os event listeners
   ============================================================ */
const wireEvents = () => {

  /* Navegação de meses */
  el.prevMonth.addEventListener('click', () => {
    state.currentMonth--;
    if (state.currentMonth < 0) { state.currentMonth = 11; state.currentYear--; }
    render();
  });
  el.nextMonth.addEventListener('click', () => {
    state.currentMonth++;
    if (state.currentMonth > 11) { state.currentMonth = 0; state.currentYear++; }
    render();
  });

  /* Tabs */
  el.tabBtns.forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  );

  /* Modal: Saldo
     O usuário está definindo o saldo INICIAL do mês visualizado */
  el.editBalanceBtn.addEventListener('click', () => {
    const key = monthKey(state.currentYear, state.currentMonth);
    const atual = getSaldoInicial(state.currentYear, state.currentMonth);
    el.balanceInput.value = atual > 0 ? atual : '';
    openModal(el.balanceModal);
    setTimeout(() => el.balanceInput.focus(), 280);
  });
  el.saveBalanceBtn.addEventListener('click', () => {
    const v = parseFloat(el.balanceInput.value);
    if (isNaN(v)||v<0) { showToast('⚠️ Valor inválido.'); return; }
    const key = monthKey(state.currentYear, state.currentMonth);
    state.saldoBase[key] = v;
    saveState(); closeModal(el.balanceModal); renderDashboard();
    showToast('💰 Saldo do mês atualizado!');
  });
  el.cancelBalanceBtn.addEventListener('click', () => closeModal(el.balanceModal));
  el.balanceModal.addEventListener   ('click', e => onOverlay(e, el.balanceModal));
  el.balanceInput.addEventListener   ('keydown', e => { if(e.key==='Enter') el.saveBalanceBtn.click(); });

  /* Modal: Conta */
  el.openAccountFormBtn.addEventListener('click', () => {
    resetAccountForm(); openModal(el.accountModal);
    setTimeout(() => el.accountNameInput.focus(), 280);
  });
  el.saveAccountBtn.addEventListener  ('click', saveAccount);
  el.cancelAccountBtn.addEventListener('click', () => closeModal(el.accountModal));
  el.accountModal.addEventListener    ('click', e => onOverlay(e, el.accountModal));
  el.accountColorPicker.addEventListener('click', e => {
    const dot = e.target.closest('.color-dot');
    if (!dot) return;
    _accountColor = dot.dataset.color;
    el.accountColorPicker.querySelectorAll('.color-dot').forEach(d =>
      d.classList.toggle('active', d.dataset.color === _accountColor));
  });
  /* Delegação: editar/excluir conta */
  el.accountsList.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action==='edit-account') {
      const acc = state.accounts.find(a => a.id===btn.dataset.id);
      if (acc) { state.editingAccountId = acc.id; populateAccountForm(acc); openModal(el.accountModal); }
    }
    if (btn.dataset.action==='delete-account')
      startDelete('account', btn.dataset.id, 'Excluir Conta?');
  });

  /* Modal: Lançamento */
  el.openFormBtn.addEventListener('click', () => {
    resetForm(); populateAccountSelects(); openModal(el.formModal);
    setTimeout(() => el.descricaoInput.focus(), 280);
  });
  el.saveFormBtn.addEventListener  ('click', saveTx);
  el.cancelFormBtn.addEventListener('click', () => closeModal(el.formModal));
  el.formModal.addEventListener    ('click', e => onOverlay(e, el.formModal));
  el.tipoToggle.addEventListener   ('click', e => { const b=e.target.closest('.toggle-btn'); if(b) setToggle(el.tipoToggle,   b.dataset.value); });
  el.statusToggle.addEventListener ('click', e => { const b=e.target.closest('.toggle-btn'); if(b) setToggle(el.statusToggle, b.dataset.value); });
  /* Delegação: ações na lista de transações */
  el.transactionsList.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action==='toggle') toggleStatus(btn.dataset.id);
    if (btn.dataset.action==='edit')   editTx(btn.dataset.id);
    if (btn.dataset.action==='delete') startDelete('tx', btn.dataset.id, 'Excluir Lançamento?');
  });

  /* Modal: Cofrinho */
  el.openPiggyFormBtn.addEventListener('click', () => {
    resetPiggyForm(); populateAccountSelects(); openModal(el.piggyModal);
    setTimeout(() => el.piggyNameInput.focus(), 280);
  });
  el.savePiggyBtn.addEventListener  ('click', savePiggy);
  el.cancelPiggyBtn.addEventListener('click', () => closeModal(el.piggyModal));
  el.piggyModal.addEventListener    ('click', e => onOverlay(e, el.piggyModal));
  el.piggyEmojiPicker.addEventListener('click', e => {
    const b = e.target.closest('.emoji-btn');
    if (!b) return;
    _piggyEmoji = b.dataset.value;
    el.piggyEmojiPicker.querySelectorAll('.emoji-btn').forEach(x =>
      x.classList.toggle('active', x.dataset.value === _piggyEmoji));
  });
  /* Delegação: ações nos cofrinhos */
  el.piggyList.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action==='edit-piggy')   editPiggy(btn.dataset.id);
    if (btn.dataset.action==='delete-piggy') startDelete('piggy', btn.dataset.id, 'Excluir Cofrinho?');
    if (btn.dataset.action==='deposit')      openDeposit(btn.dataset.id);
  });

  /* Modal: Depósito no cofrinho */
  el.saveDepositBtn.addEventListener  ('click', saveDeposit);
  el.cancelDepositBtn.addEventListener('click', () => closeModal(el.piggyDepositModal));
  el.piggyDepositModal.addEventListener('click', e => onOverlay(e, el.piggyDepositModal));
  el.depositAmountInput.addEventListener('keydown', e => { if(e.key==='Enter') el.saveDepositBtn.click(); });

  /* Modal: Delete */
  el.confirmDeleteBtn.addEventListener('click', confirmDelete);
  el.cancelDeleteBtn.addEventListener ('click', () => {
    state.deletingType=null; state.deletingId=null; closeModal(el.deleteModal);
  });
  el.deleteModal.addEventListener('click', e => onOverlay(e, el.deleteModal));

  /* Filtros avançados */
  el.filterToggleBtn.addEventListener('click', () => {
    const isOpen = el.filterPanel.style.display !== 'none';
    el.filterPanel.style.display = isOpen ? 'none' : 'block';
    renderTransactions();
  });
  bindChips(el.filterTipo,       'tipo');
  bindChips(el.filterStatus,     'status');
  bindChips(el.filterFrequencia, 'frequencia');
  bindChips(el.filterConta,      'conta');
  bindChips(el.filterCategoria,  'categoria');

  el.filterSearch.addEventListener('input', () => {
    state.filters.search = el.filterSearch.value; renderTransactions();
  });
  el.filterMinVal.addEventListener('input', () => {
    state.filters.minVal = el.filterMinVal.value; renderTransactions();
  });
  el.filterMaxVal.addEventListener('input', () => {
    state.filters.maxVal = el.filterMaxVal.value; renderTransactions();
  });

  el.clearFiltersBtn.addEventListener('click', () => {
    state.filters = { tipo:'all',status:'all',frequencia:'all',conta:'all',categoria:'all',search:'',minVal:'',maxVal:'' };
    el.filterSearch.value = el.filterMinVal.value = el.filterMaxVal.value = '';
    [el.filterTipo,el.filterStatus,el.filterFrequencia,el.filterConta,el.filterCategoria].forEach(g =>
      g.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.value==='all'))
    );
    renderTransactions();
    showToast('🧹 Filtros limpos.');
  });

  /* ESC fecha qualquer modal */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    [el.balanceModal, el.accountModal, el.formModal,
     el.piggyModal, el.piggyDepositModal, el.deleteModal]
      .forEach(m => { if (m.classList.contains('open')) closeModal(m); });
  });
};

/* ============================================================
   DADOS DE DEMONSTRAÇÃO
   Só insere se não houver absolutamente nenhum dado.
   ============================================================ */
const seedDemo = () => {
  if (state.transactions.length > 0 || state.accounts.length > 0) return;

  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const key = monthKey(y, m);

  // Saldo base do mês atual
  state.saldoBase[key] = 3200;

  // Contas demo
  const acc1 = { id:uid(), nome:'Nubank',   tipo:'digital',  cor:'#A855F7' };
  const acc2 = { id:uid(), nome:'Bradesco', tipo:'corrente', cor:'#E25353' };
  state.accounts = [acc1, acc2];

  const mk = (tipo,desc,cat,val,freq,status,dia,contaId) => ({
    id:uid(), tipo, descricao:desc, categoria:cat, contaId:contaId||null,
    valor:val, frequencia:freq, status,
    data: new Date(y,m,dia).toISOString().slice(0,10),
    createdAt: new Date(y,m,dia).getTime(),
  });

  state.transactions = [
    mk('entrada','Salário',          'salario',     5500,  'fixa',    'pago',      5, acc1.id),
    mk('entrada','Freelance — Site', 'freelance',   1800,  'variavel','pago',     18, acc1.id),
    mk('saida',  'Aluguel',          'moradia',     1200,  'fixa',    'pago',      1, acc2.id),
    mk('saida',  'Supermercado',     'alimentacao',  480,  'variavel','pago',      8, acc1.id),
    mk('saida',  'Plano de Saúde',   'saude',        320,  'fixa',    'pago',     10, acc2.id),
    mk('saida',  'Netflix',          'assinaturas',  55.90,'fixa',    'pago',     12, acc1.id),
    mk('saida',  'Spotify',          'assinaturas',  21.90,'fixa',    'pago',     12, acc1.id),
    mk('saida',  'Gasolina',         'transporte',   250,  'variavel','pendente', 15, acc2.id),
    mk('saida',  'Farmácia',         'saude',         87.50,'variavel','pago',    3,  acc1.id),
    mk('saida',  'Curso Online',     'educacao',     199,  'variavel','pendente', 20, acc1.id),
    mk('saida',  'Jantar fora',      'lazer',        145,  'variavel','pago',      7, acc2.id),
    mk('saida',  'Energia Elétrica', 'moradia',      185,  'fixa',    'pendente', 22, acc2.id),
  ];

  state.piggies = [
    { id:uid(), nome:'Viagem para Europa',    emoji:'✈️', meta:8000,  guardado:2350,
      contaId:acc1.id, inicio:`${y}-01-01`, deadline:`${y+1}-06-01` },
    { id:uid(), nome:'Reserva de Emergência', emoji:'🛡️', meta:15000, guardado:6200,
      contaId:acc2.id, inicio:`${y}-01-01`, deadline:null },
  ];

  saveState();
};

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */
const init = () => {
  const now = new Date();
  state.currentYear  = now.getFullYear();
  state.currentMonth = now.getMonth();

  loadState();   // carrega dados persistidos (ou migra versão anterior)
  seedDemo();    // demo apenas se banco vazio
  wireEvents();  // vincula todos os listeners
  render();      // renderiza tudo

  console.log('%c◈ Finança v3 — OK', 'color:#4F8EF7;font-weight:bold;font-size:13px');
};

document.addEventListener('DOMContentLoaded', init);
