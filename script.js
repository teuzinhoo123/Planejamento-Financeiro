/* ============================================================
   FINANÇA — Lógica Principal (script.js)
   Vanilla JS · LocalStorage · Sem dependências externas
   ============================================================ */

'use strict';

/* ============================================================
   1. ESTADO GLOBAL
   ============================================================ */
const APP_KEY = 'financa_app_v1';

/**
 * Estado central da aplicação.
 * Toda persistência passa por saveState().
 */
let state = {
  saldo: 0,                 // Saldo atual em conta (editável)
  transactions: [],         // Array de transações (todos os meses)
  currentYear: 0,           // Ano sendo visualizado
  currentMonth: 0,          // Mês sendo visualizado (0 = Jan)
  editingId: null,          // ID da transação em edição (null = nova)
  deletingId: null,         // ID da transação a excluir
  filter: 'all',            // Filtro ativo: all | entrada | saida | pendente
};

/* ============================================================
   2. UTILITÁRIOS
   ============================================================ */

/** Gera ID único baseado em timestamp + random */
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;

/**
 * Formata número como moeda BRL (R$ 1.234,56)
 * @param {number} value
 * @returns {string}
 */
const toBRL = (value) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

/**
 * Retorna o nome do mês + ano formatado (ex: "Maio de 2025")
 * @param {number} year
 * @param {number} month - 0-indexed
 * @returns {string}
 */
const monthLabel = (year, month) => {
  const d = new Date(year, month, 1);
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
};

/** Mapeamento de categoria → emoji */
const CATEGORY_ICONS = {
  alimentacao: '🛒', transporte: '🚗', moradia: '🏠',
  saude: '💊', lazer: '🎬', educacao: '📚',
  vestuario: '👕', assinaturas: '📱', outros: '📦',
  salario: '💼', freelance: '💻', investimento: '📈',
  presente: '🎁', reembolso: '↩️', 'outros-entrada': '✨',
};
const catIcon = (cat) => CATEGORY_ICONS[cat] || '💰';

/** Formata data ISO (YYYY-MM-DD) para exibição (DD/MM) */
const fmtDate = (iso) => {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
};

/* ============================================================
   3. PERSISTÊNCIA — LocalStorage
   ============================================================ */

/** Salva o estado completo no LocalStorage */
const saveState = () => {
  try {
    localStorage.setItem(APP_KEY, JSON.stringify({
      saldo: state.saldo,
      transactions: state.transactions,
    }));
  } catch (e) {
    showToast('⚠️ Erro ao salvar dados.', 'error');
  }
};

/** Carrega o estado do LocalStorage (chamado na inicialização) */
const loadState = () => {
  try {
    const raw = localStorage.getItem(APP_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      state.saldo = saved.saldo ?? 0;
      state.transactions = Array.isArray(saved.transactions) ? saved.transactions : [];
    }
  } catch (e) {
    console.warn('Não foi possível carregar dados salvos:', e);
  }
};

/* ============================================================
   4. SELEÇÃO DE ELEMENTOS DO DOM
   ============================================================ */
const $ = (id) => document.getElementById(id);

const els = {
  // Header
  currentMonthLabel: $('currentMonthLabel'),
  prevMonth:         $('prevMonth'),
  nextMonth:         $('nextMonth'),

  // Hero saldo
  saldoConta:        $('saldoConta'),
  balanceSub:        $('balanceSub'),
  editBalanceBtn:    $('editBalanceBtn'),

  // Cards resumo
  totalAPagar:  $('totalAPagar'),
  totalPago:    $('totalPago'),
  faltaPagar:   $('faltaPagar'),
  sobras:       $('sobras'),

  // Botão add
  openFormBtn: $('openFormBtn'),

  // Filtros
  filterBtns: document.querySelectorAll('.filter-btn'),

  // Lista
  transactionsList: $('transactionsList'),
  emptyState:       $('emptyState'),

  // Modal: saldo
  balanceModal:    $('balanceModal'),
  balanceInput:    $('balanceInput'),
  saveBalanceBtn:  $('saveBalanceBtn'),
  cancelBalanceBtn:$('cancelBalanceBtn'),

  // Modal: formulário
  formModal:       $('formModal'),
  formModalTitle:  $('formModalTitle'),
  tipoToggle:      $('tipoToggle'),
  descricaoInput:  $('descricaoInput'),
  categoriaInput:  $('categoriaInput'),
  valorInput:      $('valorInput'),
  frequenciaInput: $('frequenciaInput'),
  statusToggle:    $('statusToggle'),
  dataInput:       $('dataInput'),
  saveFormBtn:     $('saveFormBtn'),
  cancelFormBtn:   $('cancelFormBtn'),

  // Modal: confirmação delete
  deleteModal:      $('deleteModal'),
  confirmDeleteBtn: $('confirmDeleteBtn'),
  cancelDeleteBtn:  $('cancelDeleteBtn'),

  // Toast
  toast: $('toast'),
};

/* ============================================================
   5. TOAST — Notificações
   ============================================================ */
let _toastTimer = null;

/**
 * Exibe um toast temporário no fundo da tela.
 * @param {string} msg  - Mensagem a exibir
 */
const showToast = (msg) => {
  clearTimeout(_toastTimer);
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  _toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2800);
};

/* ============================================================
   6. MODAIS — Helpers de abertura e fechamento
   ============================================================ */

/**
 * Abre um overlay de modal.
 * @param {HTMLElement} overlay
 */
const openModal = (overlay) => {
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
};

/**
 * Fecha um overlay de modal.
 * @param {HTMLElement} overlay
 */
const closeModal = (overlay) => {
  overlay.classList.remove('open');
  document.body.style.overflow = '';
};

/** Fecha ao clicar fora do card (no overlay) */
const onOverlayClick = (e, overlay) => {
  if (e.target === overlay) closeModal(overlay);
};

/* ============================================================
   7. CÁLCULOS DO MÊS
   ============================================================ */

/**
 * Filtra transações para o mês/ano atual do estado.
 * @returns {Array} transações do mês
 */
const txOfMonth = () =>
  state.transactions.filter(tx => {
    const d = new Date(tx.createdAt);
    return d.getFullYear() === state.currentYear &&
           d.getMonth() === state.currentMonth;
  });

/**
 * Calcula os totais do mês e retorna um objeto com os valores.
 * @returns {{ totalAPagar, totalPago, faltaPagar, sobras }}
 */
const calcTotals = () => {
  const txs = txOfMonth();

  // Soma apenas saídas
  const saidas = txs.filter(tx => tx.tipo === 'saida');
  const totalAPagar = saidas.reduce((acc, tx) => acc + tx.valor, 0);
  const totalPago   = saidas
    .filter(tx => tx.status === 'pago')
    .reduce((acc, tx) => acc + tx.valor, 0);
  const faltaPagar  = totalAPagar - totalPago;

  // Entradas do mês
  const totalEntradas = txs
    .filter(tx => tx.tipo === 'entrada')
    .reduce((acc, tx) => acc + tx.valor, 0);

  // Sobras = Saldo + Entradas - Total a Pagar
  const sobras = state.saldo + totalEntradas - totalAPagar;

  return { totalAPagar, totalPago, faltaPagar, sobras };
};

/* ============================================================
   8. RENDER — Atualiza a UI
   ============================================================ */

/** Atualiza o rótulo do mês no header */
const renderHeader = () => {
  els.currentMonthLabel.textContent = monthLabel(state.currentYear, state.currentMonth);
};

/** Atualiza os cards de resumo e o hero de saldo */
const renderSummary = () => {
  // Hero — Saldo em conta
  els.saldoConta.textContent = toBRL(state.saldo);

  const { totalAPagar, totalPago, faltaPagar, sobras } = calcTotals();

  els.totalAPagar.textContent = toBRL(totalAPagar);
  els.totalPago.textContent   = toBRL(totalPago);
  els.faltaPagar.textContent  = toBRL(faltaPagar);
  els.sobras.textContent      = toBRL(sobras);

  // Destaca "Sobras" em vermelho se negativo
  const sobrasCard = els.sobras.closest('.summary-card');
  sobrasCard.classList.toggle('card--red', sobras < 0);
  sobrasCard.classList.toggle('card--blue', sobras >= 0);
  els.sobras.style.color = sobras < 0
    ? 'var(--clr-red-text)'
    : 'var(--clr-blue-text)';
};

/**
 * Cria o HTML de um item de transação.
 * @param {Object} tx - Objeto de transação
 * @returns {string} HTML string
 */
const txHTML = (tx) => {
  const isChecked = tx.status === 'pago';
  return `
    <div class="tx-item ${isChecked ? 'is-paid' : ''}" data-id="${tx.id}">
      <!-- Checkbox de status rápido -->
      <button
        class="tx-check ${isChecked ? 'checked' : ''}"
        data-action="toggle"
        data-id="${tx.id}"
        title="${isChecked ? 'Marcar como pendente' : 'Marcar como pago'}"
        aria-label="Alterar status"
      >${isChecked ? '✓' : ''}</button>

      <!-- Ícone de categoria -->
      <div class="tx-icon ${tx.tipo}-icon" aria-hidden="true">
        ${catIcon(tx.categoria)}
      </div>

      <!-- Info central -->
      <div class="tx-info">
        <div class="tx-desc">${tx.descricao || 'Sem descrição'}</div>
        <div class="tx-meta">
          <span class="tx-badge badge-${tx.frequencia}">${tx.frequencia}</span>
          <span class="tx-badge badge-${tx.status}">${tx.status === 'pago' ? (tx.tipo === 'entrada' ? 'recebido' : 'pago') : 'pendente'}</span>
          ${tx.data ? `<span class="tx-date">${fmtDate(tx.data)}</span>` : ''}
        </div>
      </div>

      <!-- Valor -->
      <span class="tx-amount ${tx.tipo}">
        ${tx.tipo === 'entrada' ? '+' : ''}${toBRL(tx.valor)}
      </span>

      <!-- Botões de ação -->
      <div class="tx-actions">
        <button class="tx-action-btn edit" data-action="edit" data-id="${tx.id}" title="Editar" aria-label="Editar lançamento">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="tx-action-btn delete" data-action="delete" data-id="${tx.id}" title="Excluir" aria-label="Excluir lançamento">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    </div>
  `;
};

/**
 * Renderiza a lista de transações do mês com base no filtro ativo.
 */
const renderList = () => {
  let txs = txOfMonth();

  // Aplica filtro
  if (state.filter !== 'all') {
    if (state.filter === 'pendente') {
      txs = txs.filter(tx => tx.status === 'pendente');
    } else {
      txs = txs.filter(tx => tx.tipo === state.filter);
    }
  }

  // Ordena: mais recente primeiro (por createdAt)
  txs.sort((a, b) => b.createdAt - a.createdAt);

  if (txs.length === 0) {
    els.transactionsList.innerHTML = '';
    els.emptyState.style.display = 'block';
  } else {
    els.emptyState.style.display = 'none';
    els.transactionsList.innerHTML = txs.map(txHTML).join('');
  }
};

/** Renderização completa — chama todas as partes */
const render = () => {
  renderHeader();
  renderSummary();
  renderList();
};

/* ============================================================
   9. FORMULÁRIO — Leitura e Escrita
   ============================================================ */

/** Lê o valor ativo de um toggle group */
const getToggleValue = (toggleEl) => {
  const active = toggleEl.querySelector('.toggle-btn.active');
  return active ? active.dataset.value : null;
};

/** Define o botão ativo em um toggle group */
const setToggleValue = (toggleEl, value) => {
  toggleEl.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === value);
  });
};

/** Limpa e prepara o formulário para um NOVO lançamento */
const resetForm = () => {
  state.editingId = null;
  els.formModalTitle.textContent = 'Novo Lançamento';
  setToggleValue(els.tipoToggle, 'saida');
  els.descricaoInput.value   = '';
  els.categoriaInput.value   = 'alimentacao';
  els.valorInput.value       = '';
  els.frequenciaInput.value  = 'variavel';
  setToggleValue(els.statusToggle, 'pendente');
  // Data padrão: hoje
  els.dataInput.value = new Date().toISOString().slice(0, 10);
};

/**
 * Popula o formulário com os dados de uma transação (para edição).
 * @param {Object} tx
 */
const populateForm = (tx) => {
  els.formModalTitle.textContent = 'Editar Lançamento';
  setToggleValue(els.tipoToggle, tx.tipo);
  els.descricaoInput.value  = tx.descricao;
  els.categoriaInput.value  = tx.categoria;
  els.valorInput.value      = tx.valor;
  els.frequenciaInput.value = tx.frequencia;
  setToggleValue(els.statusToggle, tx.status);
  els.dataInput.value       = tx.data || '';
};

/**
 * Valida o formulário. Retorna null se válido, ou string de erro.
 * @returns {string|null}
 */
const validateForm = () => {
  if (!els.descricaoInput.value.trim()) return 'Informe uma descrição.';
  const val = parseFloat(els.valorInput.value);
  if (isNaN(val) || val <= 0) return 'Informe um valor maior que zero.';
  return null;
};

/**
 * Coleta os dados do formulário e retorna um objeto de transação.
 * @returns {Object}
 */
const collectForm = () => ({
  tipo:       getToggleValue(els.tipoToggle),
  descricao:  els.descricaoInput.value.trim(),
  categoria:  els.categoriaInput.value,
  valor:      parseFloat(parseFloat(els.valorInput.value).toFixed(2)),
  frequencia: els.frequenciaInput.value,
  status:     getToggleValue(els.statusToggle),
  data:       els.dataInput.value || null,
});

/* ============================================================
   10. OPERAÇÕES CRUD
   ============================================================ */

/** Salva (cria ou atualiza) uma transação */
const saveTx = () => {
  const err = validateForm();
  if (err) { showToast(`⚠️ ${err}`); return; }

  const data = collectForm();

  if (state.editingId) {
    // Atualiza transação existente
    const idx = state.transactions.findIndex(tx => tx.id === state.editingId);
    if (idx > -1) {
      state.transactions[idx] = { ...state.transactions[idx], ...data };
    }
    showToast('✏️ Lançamento atualizado!');
  } else {
    // Cria nova transação
    // Usa a data selecionada para o createdAt, para aparecer no mês certo
    const dateStr = els.dataInput.value || new Date().toISOString().slice(0, 10);
    const [y, m, d] = dateStr.split('-').map(Number);
    const createdAt = new Date(y, m - 1, d).getTime();

    state.transactions.push({
      id: uid(),
      ...data,
      createdAt,
    });
    showToast('✅ Lançamento adicionado!');
  }

  saveState();
  closeModal(els.formModal);
  render();
};

/**
 * Alterna o status de uma transação entre 'pago' e 'pendente'.
 * @param {string} id
 */
const toggleStatus = (id) => {
  const tx = state.transactions.find(t => t.id === id);
  if (!tx) return;
  tx.status = tx.status === 'pago' ? 'pendente' : 'pago';
  saveState();
  render();
  showToast(tx.status === 'pago' ? '✅ Marcado como pago!' : '🔄 Marcado como pendente.');
};

/**
 * Abre o formulário em modo edição.
 * @param {string} id
 */
const editTx = (id) => {
  const tx = state.transactions.find(t => t.id === id);
  if (!tx) return;
  state.editingId = id;
  populateForm(tx);
  openModal(els.formModal);
};

/**
 * Inicia o fluxo de exclusão (abre modal de confirmação).
 * @param {string} id
 */
const deleteTx = (id) => {
  state.deletingId = id;
  openModal(els.deleteModal);
};

/** Confirma e executa a exclusão */
const confirmDelete = () => {
  if (!state.deletingId) return;
  state.transactions = state.transactions.filter(tx => tx.id !== state.deletingId);
  state.deletingId = null;
  saveState();
  closeModal(els.deleteModal);
  render();
  showToast('🗑️ Lançamento excluído.');
};

/* ============================================================
   11. DELEGAÇÃO DE EVENTOS — Lista de Transações
   ============================================================ */
/**
 * Usa event delegation para capturar cliques na lista.
 * Mais eficiente que adicionar listener em cada item.
 */
els.transactionsList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const { action, id } = btn.dataset;
  if (action === 'toggle') toggleStatus(id);
  if (action === 'edit')   editTx(id);
  if (action === 'delete') deleteTx(id);
});

/* ============================================================
   12. EVENTOS — Navegação de Meses
   ============================================================ */
els.prevMonth.addEventListener('click', () => {
  state.currentMonth--;
  if (state.currentMonth < 0) {
    state.currentMonth = 11;
    state.currentYear--;
  }
  render();
});

els.nextMonth.addEventListener('click', () => {
  state.currentMonth++;
  if (state.currentMonth > 11) {
    state.currentMonth = 0;
    state.currentYear++;
  }
  render();
});

/* ============================================================
   13. EVENTOS — Modal de Saldo
   ============================================================ */
els.editBalanceBtn.addEventListener('click', () => {
  els.balanceInput.value = state.saldo > 0 ? state.saldo : '';
  openModal(els.balanceModal);
  setTimeout(() => els.balanceInput.focus(), 300);
});

els.saveBalanceBtn.addEventListener('click', () => {
  const val = parseFloat(els.balanceInput.value);
  if (isNaN(val) || val < 0) { showToast('⚠️ Informe um valor válido.'); return; }
  state.saldo = val;
  saveState();
  closeModal(els.balanceModal);
  renderSummary();
  showToast('💰 Saldo atualizado!');
});

els.cancelBalanceBtn.addEventListener('click', () => closeModal(els.balanceModal));
els.balanceModal.addEventListener('click', (e) => onOverlayClick(e, els.balanceModal));

// Salva com Enter
els.balanceInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') els.saveBalanceBtn.click();
});

/* ============================================================
   14. EVENTOS — Modal de Formulário
   ============================================================ */
els.openFormBtn.addEventListener('click', () => {
  resetForm();
  openModal(els.formModal);
  setTimeout(() => els.descricaoInput.focus(), 300);
});

els.saveFormBtn.addEventListener('click', saveTx);
els.cancelFormBtn.addEventListener('click', () => closeModal(els.formModal));
els.formModal.addEventListener('click', (e) => onOverlayClick(e, els.formModal));

// Toggle: Tipo (Entrada/Saída)
els.tipoToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-btn');
  if (!btn) return;
  setToggleValue(els.tipoToggle, btn.dataset.value);
});

// Toggle: Status (Pago/Pendente)
els.statusToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-btn');
  if (!btn) return;
  setToggleValue(els.statusToggle, btn.dataset.value);
});

/* ============================================================
   15. EVENTOS — Modal de Exclusão
   ============================================================ */
els.confirmDeleteBtn.addEventListener('click', confirmDelete);
els.cancelDeleteBtn.addEventListener('click', () => {
  state.deletingId = null;
  closeModal(els.deleteModal);
});
els.deleteModal.addEventListener('click', (e) => onOverlayClick(e, els.deleteModal));

/* ============================================================
   16. EVENTOS — Filtros
   ============================================================ */
els.filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    els.filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.filter = btn.dataset.filter;
    renderList();
  });
});

/* ============================================================
   17. FECHAMENTO COM TECLA ESC
   ============================================================ */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  [els.balanceModal, els.formModal, els.deleteModal].forEach(m => {
    if (m.classList.contains('open')) closeModal(m);
  });
});

/* ============================================================
   18. DADOS DE DEMONSTRAÇÃO
   Inseridos apenas se o usuário não tiver dados ainda
   ============================================================ */
const seedDemo = () => {
  if (state.transactions.length > 0) return; // Não sobrescreve dados reais

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-indexed

  const mk = (tipo, descricao, categoria, valor, frequencia, status, dDay) => ({
    id: uid(),
    tipo, descricao, categoria, valor,
    frequencia, status,
    data: new Date(y, m, dDay).toISOString().slice(0, 10),
    createdAt: new Date(y, m, dDay).getTime(),
  });

  state.transactions = [
    mk('entrada', 'Salário',           'salario',      5500,  'fixa',    'pago',     5),
    mk('saida',   'Aluguel',           'moradia',      1200,  'fixa',    'pago',     1),
    mk('saida',   'Supermercado',      'alimentacao',  480,   'variavel','pago',     8),
    mk('saida',   'Plano de Saúde',    'saude',        320,   'fixa',    'pago',    10),
    mk('saida',   'Netflix',           'assinaturas',  55.90, 'fixa',    'pago',    12),
    mk('saida',   'Spotify',           'assinaturas',  21.90, 'fixa',    'pago',    12),
    mk('saida',   'Gasolina',          'transporte',   250,   'variavel','pendente', 15),
    mk('saida',   'Farmácia',          'saude',        87.50, 'variavel','pago',     3),
    mk('saida',   'Curso Online',      'educacao',     199,   'variavel','pendente', 20),
    mk('entrada', 'Freelance — Site',  'freelance',    1800,  'variavel','pago',    18),
    mk('saida',   'Jantar fora',       'lazer',        145,   'variavel','pago',     7),
    mk('saida',   'Energia Elétrica',  'moradia',      185,   'fixa',    'pendente', 22),
  ];

  state.saldo = 3200;
  saveState();
};

/* ============================================================
   19. INICIALIZAÇÃO
   ============================================================ */
const init = () => {
  // Define mês e ano atual
  const now = new Date();
  state.currentYear  = now.getFullYear();
  state.currentMonth = now.getMonth();

  // Carrega dados salvos
  loadState();

  // Insere dados de demonstração se necessário
  seedDemo();

  // Renderiza tudo
  render();

  console.log('%c◈ Finança iniciado', 'color:#4F8EF7;font-weight:bold;font-size:14px');
};

// Inicializa quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', init);
