import { useState, useEffect, useMemo, useRef } from "react";
import {
  Plus, X, ChevronLeft, ChevronRight, Wallet, ChevronDown, Settings, Trash2,
  Pencil, Check, Search, Download, Upload, Target, Repeat,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

const DEFAULT_CATEGORIES = [
  { id: "food", label: "Еда", color: "#3F6B52" },
  { id: "transport", label: "Транспорт", color: "#A9772E" },
  { id: "housing", label: "Жильё", color: "#4A6B7A" },
  { id: "fun", label: "Развлечения", color: "#7A5C6B" },
  { id: "health", label: "Здоровье", color: "#A44A34" },
  { id: "other", label: "Прочее", color: "#6B655A" },
];

const CURRENCIES = ["RUB", "USD", "EUR", "GBP", "KZT", "GEL", "AMD", "TRY", "UAH", "CNY"];
const DEFAULT_SETTINGS = { theme: "light", confirmActions: false };

const THEMES = {
  light: {
    bg: "#E7E2D3", panel: "#F5F1E6", ink: "#21302B", sub: "#6B655A",
    line: "#C9C0A8", lineMuted: "#DAD3BF", btnBg: "#21302B", btnText: "#EFEAE0",
    positive: "#3F6B52", negative: "#A44A34", gold: "#A9772E", overlay: "rgba(33,48,43,0.45)",
  },
  dark: {
    bg: "#1C211D", panel: "#242B26", ink: "#E8E2D2", sub: "#9C9686",
    line: "#3A4038", lineMuted: "#2E332C", btnBg: "#E8E2D2", btnText: "#1C211D",
    positive: "#6FAE8B", negative: "#D07E5F", gold: "#C99A4A", overlay: "rgba(0,0,0,0.6)",
  },
};

const STORAGE_KEY = "budget-tracker:v4";
const LEGACY_V3_KEY = "budget-tracker:v3";
const LEGACY_V2_KEY = "budget-tracker:v2";
const LEGACY_V1_KEY = "budget-tracker:v1";
const MONTHS_RU = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const MONTHS_RU_SHORT = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"];

function todayISO() {
  // Local calendar date, not UTC — toISOString() would shift near midnight
  // in timezones ahead of UTC and misdate the entry.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function monthKey(dateStr) { return dateStr.slice(0, 7); }
function daysInMonth(year, monthIndex) { return new Date(year, monthIndex + 1, 0).getDate(); }

// A single source of truth for "is this a usable amount", so create and
// edit flows can't silently disagree (e.g. 0 allowed on edit but not create).
function validateAmount(raw, { allowZero = false } = {}) {
  const val = parseFloat(raw);
  if (isNaN(val)) return null;
  if (val < 0) return null;
  if (val === 0 && !allowZero) return null;
  return val;
}

// Guards against corrupted-but-valid JSON (e.g. {"categories":"hello"})
// slipping past JSON.parse and crashing later on .map()/.length.
function isValidStoredShape(p) {
  return (
    p && typeof p === "object" &&
    Array.isArray(p.wallets) &&
    Array.isArray(p.categories) &&
    (p.expenses === undefined || Array.isArray(p.expenses)) &&
    (p.settings === undefined || typeof p.settings === "object")
  );
}

function formatMoney(amount, currency) {
  try {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 0 }).format(Math.round(amount));
  } catch (e) {
    return `${new Intl.NumberFormat("ru-RU").format(Math.round(amount))} ${currency}`;
  }
}

function emptyBudgets(categories) { return categories.reduce((acc, c) => ({ ...acc, [c.id]: 0 }), {}); }
function normalizeWallet(w, categories) {
  return {
    id: w.id, name: w.name, currency: w.currency,
    budgets: w.budgets || emptyBudgets(categories),
    goals: w.goals || [],
    recurring: w.recurring || [],
  };
}
function normalizeExpense(e) { return { ...e, type: e.type || "expense" }; }
function defaultWallet(categories) {
  return { id: `w-${Date.now()}`, name: "Основной", currency: "RUB", budgets: emptyBudgets(categories), goals: [], recurring: [] };
}
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function csvEscape(field) {
  const s = String(field ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function LedgerTooltip({ active, payload, label, currency, categories, t }) {
  if (!active || !payload || !payload.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div className="sans text-xs px-3 py-2" style={{ background: t.panel, border: `1px solid ${t.line}`, color: t.ink }}>
      <p className="serif text-sm mb-1">{label}</p>
      {payload.filter((p) => p.value).map((p) => (
        <div key={p.dataKey} className="flex justify-between gap-4">
          <span>{categories.find((c) => c.id === p.dataKey)?.label}</span>
          <span className="mono">{formatMoney(p.value, currency)}</span>
        </div>
      ))}
      <div className="flex justify-between gap-4 mt-1 pt-1" style={{ borderTop: `1px solid ${t.lineMuted}` }}>
        <span>Всего</span><span className="mono">{formatMoney(total, currency)}</span>
      </div>
    </div>
  );
}

export default function BudgetTracker() {
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [wallets, setWallets] = useState([defaultWallet(DEFAULT_CATEGORIES)]);
  const [currentWalletId, setCurrentWalletId] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [importError, setImportError] = useState(false);

  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [addingWallet, setAddingWallet] = useState(false);
  const [newWalletName, setNewWalletName] = useState("");
  const [newWalletCurrency, setNewWalletCurrency] = useState("RUB");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatColor, setNewCatColor] = useState("#5C6B4A");
  const [confirmState, setConfirmState] = useState(null);

  // Inline validation messages per form — silent no-ops used to leave the
  // user guessing why nothing happened.
  const [formError, setFormError] = useState("");
  const [walletError, setWalletError] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [goalError, setGoalError] = useState("");
  const [recurringError, setRecurringError] = useState("");
  // Draft values for inline category-name edits, committed (and validated)
  // on blur rather than on every keystroke — lets duplicate/empty checks
  // run against a finished value instead of a half-typed one.
  const [categoryLabelDrafts, setCategoryLabelDrafts] = useState({});

  const [newGoalName, setNewGoalName] = useState("");
  const [newGoalTarget, setNewGoalTarget] = useState("");
  const [editingGoalId, setEditingGoalId] = useState(null);
  const [goalDraft, setGoalDraft] = useState("");

  const [newRecDesc, setNewRecDesc] = useState("");
  const [newRecAmount, setNewRecAmount] = useState("");
  const [newRecCategory, setNewRecCategory] = useState("food");
  const [newRecType, setNewRecType] = useState("expense");
  const [newRecDay, setNewRecDay] = useState("1");

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({ search: "", category: "all", type: "all", dateFrom: "", dateTo: "", onlyOverBudget: false });

  const walletBoxRef = useRef(null);
  const settingsBtnRef = useRef(null);
  const settingsPanelRef = useRef(null);
  const importInputRef = useRef(null);
  const cancelBudgetEditRef = useRef(false);
  const cancelGoalEditRef = useRef(false);

  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  const [form, setForm] = useState({ type: "expense", amount: "", category: "food", description: "", date: todayISO() });
  const [editingBudget, setEditingBudget] = useState(null);
  const [budgetDraft, setBudgetDraft] = useState("");
  const [editingRowId, setEditingRowId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);

  const t = THEMES[settings.theme] || THEMES.light;

  function requestConfirm(message, onConfirm) {
    if (settings.confirmActions) setConfirmState({ message, onConfirm });
    else onConfirm();
  }

  // Load from persistent storage (with migration from older shapes)
  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY, false);
        if (res && res.value) {
          const p = JSON.parse(res.value);
          if (!isValidStoredShape(p)) throw new Error("corrupt v4 shape");
          const cats = p.categories && p.categories.length ? p.categories : DEFAULT_CATEGORIES;
          const w = (p.wallets && p.wallets.length ? p.wallets : [defaultWallet(cats)]).map((x) => normalizeWallet(x, cats));
          setCategories(cats);
          setSettings({ ...DEFAULT_SETTINGS, ...(p.settings || {}) });
          setWallets(w);
          setCurrentWalletId(p.currentWalletId || w[0].id);
          setExpenses((p.expenses || []).map(normalizeExpense));
          setLoaded(true);
          return;
        }
      } catch (e) { /* try older shape */ }
      try {
        const v3 = await window.storage.get(LEGACY_V3_KEY, false);
        if (v3 && v3.value) {
          const p = JSON.parse(v3.value);
          if (!isValidStoredShape(p)) throw new Error("corrupt v3 shape");
          const cats = p.categories && p.categories.length ? p.categories : DEFAULT_CATEGORIES;
          const w = (p.wallets && p.wallets.length ? p.wallets : [defaultWallet(cats)]).map((x) => normalizeWallet(x, cats));
          setCategories(cats);
          setSettings({ ...DEFAULT_SETTINGS, ...(p.settings || {}) });
          setWallets(w);
          setCurrentWalletId(p.currentWalletId || w[0].id);
          setExpenses((p.expenses || []).map(normalizeExpense));
          setLoaded(true);
          return;
        }
      } catch (e) { /* try v2 */ }
      try {
        const v2 = await window.storage.get(LEGACY_V2_KEY, false);
        if (v2 && v2.value) {
          const p = JSON.parse(v2.value);
          if (!p || typeof p !== "object" || !Array.isArray(p.wallets)) throw new Error("corrupt v2 shape");
          const cats = DEFAULT_CATEGORIES;
          const w = (p.wallets && p.wallets.length ? p.wallets : [defaultWallet(cats)]).map((x) => normalizeWallet(x, cats));
          setCategories(cats);
          setSettings(DEFAULT_SETTINGS);
          setWallets(w);
          setCurrentWalletId(p.currentWalletId || w[0].id);
          setExpenses((p.expenses || []).map(normalizeExpense));
          setLoaded(true);
          return;
        }
      } catch (e) { /* try v1 */ }
      try {
        const v1 = await window.storage.get(LEGACY_V1_KEY, false);
        if (v1 && v1.value) {
          const p = JSON.parse(v1.value);
          if (!p || typeof p !== "object" || (p.expenses !== undefined && !Array.isArray(p.expenses))) throw new Error("corrupt v1 shape");
          const cats = DEFAULT_CATEGORIES;
          const w = defaultWallet(cats);
          w.budgets = p.budgets || emptyBudgets(cats);
          const migrated = (p.expenses || []).map((e) => normalizeExpense({ ...e, walletId: w.id }));
          setCategories(cats);
          setSettings(DEFAULT_SETTINGS);
          setWallets([w]);
          setCurrentWalletId(w.id);
          setExpenses(migrated);
          setLoaded(true);
          return;
        }
      } catch (e) { /* no legacy data */ }
      const cats = DEFAULT_CATEGORIES;
      const w = defaultWallet(cats);
      setCategories(cats); setWallets([w]); setCurrentWalletId(w.id); setLoaded(true);
    })();
  }, []);

  // Close wallet menu / settings panel on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (walletBoxRef.current && !walletBoxRef.current.contains(e.target)) {
        setWalletMenuOpen(false); setAddingWallet(false);
      }
      const clickedBtn = settingsBtnRef.current && settingsBtnRef.current.contains(e.target);
      const clickedPanel = settingsPanelRef.current && settingsPanelRef.current.contains(e.target);
      if (!clickedBtn && !clickedPanel) setSettingsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Persist on change. Debounced and guarded against out-of-order writes:
  // rapid successive edits (typing, quick clicks) used to each fire their
  // own async storage.set() call, and if an older call resolved after a
  // newer one, it could silently overwrite fresher data with stale data.
  // Coalescing into one write per quiet pause avoids that for the common
  // case, and the write-id guard below drops any result that isn't from
  // the most recently issued save.
  const saveIdRef = useRef(0);
  useEffect(() => {
    if (!loaded) return;
    const myId = ++saveIdRef.current;
    const timer = setTimeout(() => {
      (async () => {
        try {
          const result = await window.storage.set(STORAGE_KEY, JSON.stringify({ wallets, currentWalletId, expenses, categories, settings }), false);
          if (saveIdRef.current === myId) setSaveError(!result);
        } catch (e) {
          if (saveIdRef.current === myId) setSaveError(true);
        }
      })();
    }, 400);
    return () => clearTimeout(timer);
  }, [wallets, currentWalletId, expenses, categories, settings, loaded]);

  const currentWallet = wallets.find((w) => w.id === currentWalletId) || wallets[0];
  const currency = currentWallet?.currency || "RUB";
  const budgets = currentWallet?.budgets || emptyBudgets(categories);
  const goals = currentWallet?.goals || [];
  const recurring = currentWallet?.recurring || [];

  const currentMonthKey = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`;
  const prevMonthDate = new Date(viewYear, viewMonth - 1, 1);
  const prevMonthKey = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;

  const walletExpenses = useMemo(() => expenses.filter((e) => e.walletId === currentWalletId), [expenses, currentWalletId]);

  const monthTransactions = useMemo(
    () => walletExpenses.filter((e) => monthKey(e.date) === currentMonthKey).sort((a, b) => (a.date < b.date ? 1 : -1)),
    [walletExpenses, currentMonthKey]
  );
  const monthExpenseList = useMemo(() => monthTransactions.filter((e) => e.type === "expense"), [monthTransactions]);
  const monthIncomeList = useMemo(() => monthTransactions.filter((e) => e.type === "income"), [monthTransactions]);

  const spentByCategory = useMemo(() => {
    const map = {};
    categories.forEach((c) => (map[c.id] = 0));
    monthExpenseList.forEach((e) => { map[e.category] = (map[e.category] || 0) + Number(e.amount); });
    return map;
  }, [monthExpenseList, categories]);

  const totalSpent = monthExpenseList.reduce((s, e) => s + Number(e.amount), 0);
  const totalIncome = monthIncomeList.reduce((s, e) => s + Number(e.amount), 0);
  const totalBudget = categories.reduce((s, c) => s + (budgets[c.id] || 0), 0);
  const remaining = totalBudget - totalSpent;
  const monthBalance = totalIncome - totalSpent;

  const chartData = useMemo(() => {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      let m = viewMonth - i, y = viewYear;
      while (m < 0) { m += 12; y -= 1; }
      const key = `${y}-${String(m + 1).padStart(2, "0")}`;
      const row = { key, label: MONTHS_RU_SHORT[m] };
      categories.forEach((c) => (row[c.id] = 0));
      walletExpenses.filter((e) => e.type === "expense" && monthKey(e.date) === key).forEach((e) => {
        row[e.category] = (row[e.category] || 0) + Number(e.amount);
      });
      months.push(row);
    }
    return months;
  }, [walletExpenses, viewMonth, viewYear, categories]);

  const analytics = useMemo(() => {
    const dim = daysInMonth(viewYear, viewMonth);
    const prevSpent = walletExpenses
      .filter((e) => e.type === "expense" && monthKey(e.date) === prevMonthKey)
      .reduce((s, e) => s + Number(e.amount), 0);
    const pctChange = prevSpent > 0 ? ((totalSpent - prevSpent) / prevSpent) * 100 : null;
    const avgDaily = totalSpent / dim;
    const topCategories = categories
      .map((c) => ({ ...c, spent: spentByCategory[c.id] || 0 }))
      .filter((c) => c.spent > 0)
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 3);
    const byDay = {};
    monthExpenseList.forEach((e) => { byDay[e.date] = (byDay[e.date] || 0) + Number(e.amount); });
    let mostExpensiveDay = null;
    Object.entries(byDay).forEach(([date, amount]) => {
      if (!mostExpensiveDay || amount > mostExpensiveDay.amount) mostExpensiveDay = { date, amount };
    });
    return { pctChange, avgDaily, topCategories, mostExpensiveDay, count: monthExpenseList.length };
  }, [walletExpenses, monthExpenseList, spentByCategory, categories, viewYear, viewMonth, prevMonthKey, totalSpent]);

  const pendingRecurring = useMemo(
    () => recurring.filter((rec) => !walletExpenses.some((e) => e.recurringId === rec.id && monthKey(e.date) === currentMonthKey)),
    [recurring, walletExpenses, currentMonthKey]
  );

  const overBudgetCategoryIds = useMemo(
    () => categories.filter((c) => (spentByCategory[c.id] || 0) > (budgets[c.id] || 0)).map((c) => c.id),
    [categories, spentByCategory, budgets]
  );

  const filteredTransactions = useMemo(() => {
    let list = walletExpenses;
    if (filters.dateFrom) list = list.filter((e) => e.date >= filters.dateFrom);
    if (filters.dateTo) list = list.filter((e) => e.date <= filters.dateTo);
    if (!filters.dateFrom && !filters.dateTo) list = list.filter((e) => monthKey(e.date) === currentMonthKey);
    if (filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      list = list.filter((e) => e.description.toLowerCase().includes(q));
    }
    if (filters.category !== "all") list = list.filter((e) => e.category === filters.category);
    if (filters.type !== "all") list = list.filter((e) => e.type === filters.type);
    if (filters.onlyOverBudget) list = list.filter((e) => overBudgetCategoryIds.includes(e.category));
    return list.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [walletExpenses, filters, currentMonthKey, overBudgetCategoryIds]);

  const filtersActive = filters.search || filters.category !== "all" || filters.type !== "all" || filters.dateFrom || filters.dateTo || filters.onlyOverBudget;

  function changeMonth(delta) {
    let m = viewMonth + delta, y = viewYear;
    if (m < 0) { m = 11; y -= 1; } else if (m > 11) { m = 0; y += 1; }
    setViewMonth(m); setViewYear(y);
  }

  function updateWallet(updater) {
    setWallets((prev) => prev.map((w) => (w.id === currentWalletId ? updater(w) : w)));
  }
  function updateCurrentWalletBudgets(catId, value) {
    updateWallet((w) => ({ ...w, budgets: { ...w.budgets, [catId]: value } }));
  }

  function handleAdd(e) {
    e.preventDefault();
    const amt = validateAmount(form.amount);
    if (amt === null) { setFormError("Сумма должна быть больше 0"); return; }
    if (!currentWalletId) return;
    setFormError("");
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      walletId: currentWalletId, type: form.type,
      amount: amt, category: form.type === "income" ? null : form.category,
      description: form.description.trim() || (form.type === "income" ? "Доход" : (categories.find((c) => c.id === form.category)?.label ?? "")),
      date: form.date,
    };
    setExpenses((prev) => [...prev, entry]);
    setForm({ type: form.type, amount: "", category: form.category, description: "", date: form.date });
  }

  function handleDelete(id) { setExpenses((prev) => prev.filter((e) => e.id !== id)); }

  function startEditBudget(catId) { setEditingBudget(catId); setBudgetDraft(String(budgets[catId] ?? 0)); }
  function commitEditBudget(catId) {
    if (cancelBudgetEditRef.current) { cancelBudgetEditRef.current = false; setEditingBudget(null); return; }
    // Budgets may legitimately be 0 (no limit set), so zero is allowed here
    // even though transaction amounts below require > 0.
    const safeVal = validateAmount(budgetDraft, { allowZero: true }) ?? 0;
    setEditingBudget(null);
    const label = categories.find((c) => c.id === catId)?.label || catId;
    requestConfirm(`Изменить бюджет категории «${label}» на ${formatMoney(safeVal, currency)}?`, () => updateCurrentWalletBudgets(catId, safeVal));
  }
  // Enter and the blur it triggers used to both call commit, which could
  // fire the confirmation dialog twice for one keystroke. Enter now only
  // blurs the field; onBlur is the single place that actually commits.
  // Escape sets a flag so that the blur it also triggers cancels instead
  // of committing the (unwanted) draft value.
  function handleBudgetKeyDown(e) {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") { cancelBudgetEditRef.current = true; e.currentTarget.blur(); }
  }

  function startEditRow(e) {
    setEditingRowId(e.id);
    setEditDraft({ date: e.date, type: e.type, category: e.category || categories[0]?.id || "", description: e.description, amount: String(e.amount) });
  }
  function cancelEditRow() { setEditingRowId(null); setEditDraft(null); }
  function saveEditRow(id) {
    const amt = validateAmount(editDraft.amount);
    if (amt === null) return;
    setExpenses((prev) => prev.map((e) => (e.id === id ? {
      ...e, date: editDraft.date, type: editDraft.type,
      category: editDraft.type === "income" ? null : editDraft.category,
      description: editDraft.description.trim() || e.description, amount: amt,
    } : e)));
    setEditingRowId(null); setEditDraft(null);
  }

  function handleAddWallet(e) {
    e.preventDefault();
    const name = newWalletName.trim();
    if (!name) { setWalletError("Введите название кошелька"); return; }
    if (wallets.some((w) => w.name.trim().toLowerCase() === name.toLowerCase())) {
      setWalletError("Кошелёк с таким названием уже есть"); return;
    }
    setWalletError("");
    const w = { id: `w-${Date.now()}`, name, currency: newWalletCurrency, budgets: emptyBudgets(categories), goals: [], recurring: [] };
    setWallets((prev) => [...prev, w]);
    setCurrentWalletId(w.id);
    setNewWalletName(""); setNewWalletCurrency("RUB"); setAddingWallet(false); setWalletMenuOpen(false);
  }

  function handleAddCategory(e) {
    e.preventDefault();
    const name = newCatName.trim();
    if (!name) { setCategoryError("Введите название категории"); return; }
    if (categories.some((c) => c.label.trim().toLowerCase() === name.toLowerCase())) {
      setCategoryError("Категория с таким названием уже есть"); return;
    }
    setCategoryError("");
    setCategories((prev) => [...prev, { id: `c-${Date.now()}`, label: name, color: newCatColor }]);
    setNewCatName(""); setNewCatColor("#5C6B4A");
  }
  function handleRenameCategory(catId, label) { setCategories((prev) => prev.map((c) => (c.id === catId ? { ...c, label } : c))); }
  // Renaming used to write straight to state on every keystroke, so an
  // empty or duplicate name could be saved silently mid-typing. Now the
  // input keeps a local draft and only commits (with validation) on blur.
  function handleCategoryLabelChange(catId, value) {
    setCategoryLabelDrafts((prev) => ({ ...prev, [catId]: value }));
  }
  function commitCategoryLabel(catId) {
    const draft = categoryLabelDrafts[catId];
    if (draft === undefined) return;
    setCategoryLabelDrafts((prev) => { const next = { ...prev }; delete next[catId]; return next; });
    const trimmed = draft.trim();
    if (!trimmed) { setCategoryError("Название категории не может быть пустым"); return; }
    if (categories.some((c) => c.id !== catId && c.label.trim().toLowerCase() === trimmed.toLowerCase())) {
      setCategoryError("Категория с таким названием уже есть"); return;
    }
    setCategoryError("");
    handleRenameCategory(catId, trimmed);
  }
  function handleCategoryLabelKeyDown(e) {
    if (e.key === "Enter") e.currentTarget.blur();
  }
  function handleRecolorCategory(catId, color) { setCategories((prev) => prev.map((c) => (c.id === catId ? { ...c, color } : c))); }
  function handleDeleteCategory(catId) {
    const label = categories.find((c) => c.id === catId)?.label || catId;
    requestConfirm(
      `Удалить категорию «${label}»? Существующие записи с этой категорией перейдут в «Без категории».`,
      () => {
        setCategories((prev) => prev.filter((c) => c.id !== catId));
        // Reassign rather than leave a dangling reference — orphaned
        // expenses used to keep counting toward totals while becoming
        // invisible in the per-category breakdown.
        setExpenses((prev) => prev.map((e) => (e.category === catId ? { ...e, category: null } : e)));
        setForm((f) => (f.category === catId ? { ...f, category: categories.find((c) => c.id !== catId)?.id || "" } : f));
        if (newRecCategory === catId) setNewRecCategory(categories.find((c) => c.id !== catId)?.id || "");
      }
    );
  }

  function handleAddGoal(e) {
    e.preventDefault();
    const name = newGoalName.trim();
    const target = validateAmount(newGoalTarget);
    if (!name) { setGoalError("Введите название цели"); return; }
    if (target === null) { setGoalError("Сумма цели должна быть больше 0"); return; }
    setGoalError("");
    updateWallet((w) => ({ ...w, goals: [...w.goals, { id: `g-${Date.now()}`, name, target, saved: 0 }] }));
    setNewGoalName(""); setNewGoalTarget("");
  }
  function startEditGoal(goal) { setEditingGoalId(goal.id); setGoalDraft(String(goal.saved)); }
  function commitEditGoal(goalId) {
    if (cancelGoalEditRef.current) { cancelGoalEditRef.current = false; setEditingGoalId(null); return; }
    const val = validateAmount(goalDraft, { allowZero: true });
    setEditingGoalId(null);
    if (val === null) return;
    const goal = goals.find((g) => g.id === goalId);
    requestConfirm(`Изменить накопление по цели «${goal.name}» на ${formatMoney(val, currency)}?`,
      () => updateWallet((w) => ({ ...w, goals: w.goals.map((g) => (g.id === goalId ? { ...g, saved: val } : g)) })));
  }
  function handleGoalKeyDown(e) {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") { cancelGoalEditRef.current = true; e.currentTarget.blur(); }
  }
  function handleDeleteGoal(goalId) {
    const goal = goals.find((g) => g.id === goalId);
    requestConfirm(`Удалить цель «${goal.name}»?`, () => updateWallet((w) => ({ ...w, goals: w.goals.filter((g) => g.id !== goalId) })));
  }

  function handleAddRecurring(e) {
    e.preventDefault();
    const desc = newRecDesc.trim();
    const amt = validateAmount(newRecAmount);
    if (!desc) { setRecurringError("Введите название операции"); return; }
    if (amt === null) { setRecurringError("Сумма должна быть больше 0"); return; }
    setRecurringError("");
    const day = Math.min(31, Math.max(1, parseInt(newRecDay) || 1));
    const rec = { id: `r-${Date.now()}`, description: desc, amount: amt, category: newRecType === "income" ? null : newRecCategory, type: newRecType, day };
    updateWallet((w) => ({ ...w, recurring: [...w.recurring, rec] }));
    setNewRecDesc(""); setNewRecAmount(""); setNewRecDay("1");
  }
  function handleDeleteRecurring(id) { updateWallet((w) => ({ ...w, recurring: w.recurring.filter((r) => r.id !== id) })); }
  function applyRecurring(rec) {
    const dim = daysInMonth(viewYear, viewMonth);
    const day = Math.min(rec.day, dim);
    const date = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, walletId: currentWalletId,
      type: rec.type, amount: rec.amount, category: rec.category, description: rec.description, date, recurringId: rec.id,
    };
    setExpenses((prev) => [...prev, entry]);
  }

  function exportJSON() {
    const data = { wallets, currentWalletId, expenses, categories, settings, exportedAt: new Date().toISOString() };
    downloadFile("budget-tracker-export.json", JSON.stringify(data, null, 2), "application/json");
  }
  function exportCSV() {
    const rows = [["Дата", "Тип", "Категория", "Описание", "Сумма", "Валюта"]];
    walletExpenses.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((e) => {
      rows.push([e.date, e.type === "income" ? "Доход" : "Расход", e.type === "income" ? "" : catLabel(e.category), e.description, String(e.amount), currency]);
    });
    const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
    downloadFile(`${currentWallet.name}-operations.csv`, csv, "text/csv;charset=utf-8;");
  }
  function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!isValidStoredShape(parsed)) throw new Error("bad shape");
        requestConfirm("Импортировать данные? Текущие данные в приложении будут заменены.", () => {
          const cats = parsed.categories;
          setCategories(cats);
          setSettings({ ...DEFAULT_SETTINGS, ...(parsed.settings || {}) });
          const w = parsed.wallets.map((x) => normalizeWallet(x, cats));
          setWallets(w);
          setCurrentWalletId(parsed.currentWalletId || w[0]?.id);
          setExpenses((parsed.expenses || []).map(normalizeExpense));
        });
      } catch (err) {
        setImportError(true);
        setTimeout(() => setImportError(false), 4000);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  const catColor = (id) => categories.find((c) => c.id === id)?.color || t.sub;
  const catLabel = (id) => categories.find((c) => c.id === id)?.label || "Без категории";
  const resetFilters = () => setFilters({ search: "", category: "all", type: "all", dateFrom: "", dateTo: "", onlyOverBudget: false });

  if (!loaded || !currentWallet) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center" style={{ background: t.bg }}>
        <p className="sans text-sm" style={{ color: t.sub }}>Загрузка…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex justify-center" style={{ background: t.bg }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap');
        .serif { font-family: 'Source Serif 4', serif; }
        .mono { font-family: 'IBM Plex Mono', monospace; font-variant-numeric: tabular-nums; }
        .sans { font-family: 'Inter', sans-serif; }
        input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        .ledger-input { background: transparent; border: none; border-bottom: 1px solid ${t.line}; outline: none; padding: 4px 2px; color: ${t.ink}; }
        .ledger-input:focus { border-bottom: 1.5px solid ${t.ink}; }
        .btn-focus:focus-visible { outline: 2px solid ${t.ink}; outline-offset: 2px; }
        input[type=color] { -webkit-appearance: none; border: none; background: none; width: 20px; height: 20px; padding: 0; cursor: pointer; }
        input[type=color]::-webkit-color-swatch-wrapper { padding: 0; }
        input[type=color]::-webkit-color-swatch { border: 1px solid ${t.line}; border-radius: 50%; }
      `}</style>

      <div className="w-full max-w-2xl px-5 sm:px-8 py-10 sm:py-14">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 gap-3 flex-wrap">
          <div>
            <h1 className="serif text-3xl sm:text-4xl" style={{ color: t.ink }}>Бюджет</h1>
            <p className="sans text-sm mt-1" style={{ color: t.sub }}>Личный учёт финансов</p>
          </div>
          <div className="flex items-center gap-4 sans" style={{ color: t.ink }}>
            <div className="flex items-center gap-3">
              <button onClick={() => changeMonth(-1)} aria-label="Предыдущий месяц" className="btn-focus p-1 rounded hover:opacity-60 transition-opacity"><ChevronLeft size={18} /></button>
              <span className="text-sm w-32 text-center select-none">{MONTHS_RU[viewMonth]} {viewYear}</span>
              <button onClick={() => changeMonth(1)} aria-label="Следующий месяц" className="btn-focus p-1 rounded hover:opacity-60 transition-opacity"><ChevronRight size={18} /></button>
            </div>
            <button ref={settingsBtnRef} onClick={() => setSettingsOpen((o) => !o)} aria-label="Настройки"
              className="btn-focus p-1.5 rounded-full hover:opacity-60 transition-opacity"
              style={{ background: settingsOpen ? t.panel : "transparent", border: `1px solid ${settingsOpen ? t.line : "transparent"}` }}>
              <Settings size={17} />
            </button>
          </div>
        </div>

        {/* Settings panel */}
        {settingsOpen && (
          <div ref={settingsPanelRef} className="mb-8 p-4 sans text-sm" style={{ background: t.panel, border: `1px solid ${t.line}`, color: t.ink }}>
            <div className="flex items-center justify-between py-2" style={{ borderBottom: `1px solid ${t.lineMuted}` }}>
              <span>Тема</span>
              <div className="flex gap-1">
                {["light", "dark"].map((mode) => (
                  <button key={mode} onClick={() => setSettings((s) => ({ ...s, theme: mode }))} className="btn-focus text-xs px-3 py-1 rounded-full"
                    style={{ background: settings.theme === mode ? t.btnBg : "transparent", color: settings.theme === mode ? t.btnText : t.ink, border: `1px solid ${t.line}` }}>
                    {mode === "light" ? "Светлая" : "Тёмная"}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between py-2" style={{ borderBottom: `1px solid ${t.lineMuted}` }}>
              <div>
                <span>Подтверждение действий</span>
                <p className="text-xs mt-0.5" style={{ color: t.sub }}>Спрашивать перед изменением сумм по бюджету/цели и удалением категории</p>
              </div>
              <button onClick={() => setSettings((s) => ({ ...s, confirmActions: !s.confirmActions }))} className="btn-focus text-xs px-3 py-1 rounded-full flex-shrink-0"
                style={{ background: settings.confirmActions ? t.btnBg : "transparent", color: settings.confirmActions ? t.btnText : t.ink, border: `1px solid ${t.line}` }}>
                {settings.confirmActions ? "Включено" : "Выключено"}
              </button>
            </div>

            <div className="py-2" style={{ borderBottom: `1px solid ${t.lineMuted}` }}>
              <span>Категории</span>
              <div className="mt-2">
                {categories.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 py-1.5">
                    <input type="color" value={c.color} onChange={(e) => handleRecolorCategory(c.id, e.target.value)} aria-label="Цвет категории" />
                    <input
                      type="text"
                      value={categoryLabelDrafts[c.id] ?? c.label}
                      onChange={(e) => handleCategoryLabelChange(c.id, e.target.value)}
                      onBlur={() => commitCategoryLabel(c.id)}
                      onKeyDown={handleCategoryLabelKeyDown}
                      className="ledger-input sans text-sm flex-1"
                    />
                    <button onClick={() => handleDeleteCategory(c.id)} aria-label="Удалить категорию" className="btn-focus hover:opacity-60" style={{ color: t.negative }}><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
              <form onSubmit={handleAddCategory} className="flex items-center gap-2 pt-2 mt-1" style={{ borderTop: `1px solid ${t.lineMuted}` }}>
                <input type="color" value={newCatColor} onChange={(e) => setNewCatColor(e.target.value)} aria-label="Цвет новой категории" />
                <input type="text" placeholder="Новая категория" value={newCatName} onChange={(e) => { setNewCatName(e.target.value); setCategoryError(""); }} className="ledger-input sans text-sm flex-1" />
                <button type="submit" className="btn-focus text-xs px-3 py-1.5 rounded-full flex items-center gap-1" style={{ background: t.btnBg, color: t.btnText }}><Plus size={12} /> Добавить</button>
              </form>
              {categoryError && <p className="text-xs mt-1.5" style={{ color: t.negative }}>{categoryError}</p>}
            </div>

            <div className="py-2" style={{ borderBottom: `1px solid ${t.lineMuted}` }}>
              <span className="flex items-center gap-1.5"><Repeat size={13} /> Регулярные операции</span>
              <div className="mt-2">
                {recurring.length === 0 && <p className="text-xs" style={{ color: t.sub }}>Пока нет ни одной</p>}
                {recurring.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 py-1.5 text-xs">
                    <span className="flex-1 truncate">{r.description}</span>
                    <span style={{ color: t.sub }}>{r.type === "income" ? "доход" : catLabel(r.category)}</span>
                    <span className="mono">{formatMoney(r.amount, currency)}</span>
                    <span style={{ color: t.sub }}>день {r.day}</span>
                    <button onClick={() => handleDeleteRecurring(r.id)} aria-label="Удалить регулярную операцию" className="btn-focus hover:opacity-60" style={{ color: t.negative }}><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
              <form onSubmit={handleAddRecurring} className="flex flex-wrap items-center gap-2 pt-2 mt-1" style={{ borderTop: `1px solid ${t.lineMuted}` }}>
                <div className="flex gap-1">
                  {["expense", "income"].map((tp) => (
                    <button key={tp} type="button" onClick={() => setNewRecType(tp)} className="btn-focus text-xs px-2 py-1 rounded-full"
                      style={{ background: newRecType === tp ? t.btnBg : "transparent", color: newRecType === tp ? t.btnText : t.ink, border: `1px solid ${t.line}` }}>
                      {tp === "expense" ? "Расход" : "Доход"}
                    </button>
                  ))}
                </div>
                <input type="text" placeholder="Название" value={newRecDesc} onChange={(e) => setNewRecDesc(e.target.value)} className="ledger-input sans text-xs flex-1 min-w-[100px]" />
                {newRecType === "expense" && (
                  <select value={newRecCategory} onChange={(e) => setNewRecCategory(e.target.value)} className="ledger-input sans text-xs">
                    {categories.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
                  </select>
                )}
                <input type="number" min="0" placeholder="Сумма" value={newRecAmount} onChange={(e) => setNewRecAmount(e.target.value)} className="ledger-input mono text-xs w-20" />
                <input type="number" min="1" max="31" title="День месяца" value={newRecDay} onChange={(e) => setNewRecDay(e.target.value)} className="ledger-input mono text-xs w-14" />
                <button type="submit" className="btn-focus text-xs px-3 py-1.5 rounded-full flex items-center gap-1" style={{ background: t.btnBg, color: t.btnText }}><Plus size={12} /></button>
              </form>
              {recurringError && <p className="text-xs mt-1.5" style={{ color: t.negative }}>{recurringError}</p>}
            </div>

            <div className="py-2">
              <span>Данные</span>
              <div className="flex flex-wrap gap-2 mt-2">
                <button onClick={exportJSON} className="btn-focus text-xs px-3 py-1.5 rounded-full flex items-center gap-1" style={{ border: `1px solid ${t.line}` }}><Download size={12} /> Экспорт JSON</button>
                <button onClick={() => importInputRef.current?.click()} className="btn-focus text-xs px-3 py-1.5 rounded-full flex items-center gap-1" style={{ border: `1px solid ${t.line}` }}><Upload size={12} /> Импорт JSON</button>
                <button onClick={exportCSV} className="btn-focus text-xs px-3 py-1.5 rounded-full flex items-center gap-1" style={{ border: `1px solid ${t.line}` }}><Download size={12} /> Экспорт CSV</button>
                <input ref={importInputRef} type="file" accept="application/json" onChange={handleImportFile} className="hidden" />
              </div>
              {importError && <p className="text-xs mt-2" style={{ color: t.negative }}>Не удалось прочитать файл — проверьте, что это корректный экспорт.</p>}
            </div>
          </div>
        )}

        {/* Wallet switcher */}
        <div ref={walletBoxRef} className="relative mb-8">
          <button onClick={() => setWalletMenuOpen((o) => !o)} className="btn-focus sans text-sm flex items-center gap-2 px-3 py-1.5 rounded-full hover:opacity-85 transition-opacity"
            style={{ background: t.panel, border: `1px solid ${t.line}`, color: t.ink }}>
            <Wallet size={14} />{currentWallet.name}<span className="mono text-xs" style={{ color: t.sub }}>{currentWallet.currency}</span><ChevronDown size={14} />
          </button>
          {walletMenuOpen && (
            <div className="absolute z-10 mt-1 w-64 sans text-sm" style={{ background: t.panel, border: `1px solid ${t.line}`, color: t.ink }}>
              {wallets.map((w) => (
                <button key={w.id} onClick={() => { setCurrentWalletId(w.id); setWalletMenuOpen(false); }}
                  className="w-full text-left px-3 py-2 flex items-center justify-between hover:opacity-70"
                  style={{ borderBottom: `1px solid ${t.lineMuted}`, background: w.id === currentWalletId ? t.bg : "transparent" }}>
                  <span>{w.name}</span><span className="mono text-xs" style={{ color: t.sub }}>{w.currency}</span>
                </button>
              ))}
              {!addingWallet ? (
                <button onClick={() => setAddingWallet(true)} className="w-full text-left px-3 py-2 flex items-center gap-1 hover:opacity-70" style={{ color: t.sub }}><Plus size={13} /> Новый кошелёк</button>
              ) : (
                <form onSubmit={handleAddWallet} className="p-3 flex flex-col gap-2">
                  <input autoFocus type="text" placeholder="Название" value={newWalletName} onChange={(e) => { setNewWalletName(e.target.value); setWalletError(""); }} className="ledger-input sans text-sm" />
                  <select value={newWalletCurrency} onChange={(e) => setNewWalletCurrency(e.target.value)} className="ledger-input sans text-sm">
                    {CURRENCIES.map((c) => (<option key={c} value={c}>{c}</option>))}
                  </select>
                  {walletError && <p className="text-xs" style={{ color: t.negative }}>{walletError}</p>}
                  <div className="flex gap-2 mt-1">
                    <button type="submit" className="btn-focus sans text-xs px-3 py-1.5 rounded-full" style={{ background: t.btnBg, color: t.btnText }}>Создать</button>
                    <button type="button" onClick={() => { setAddingWallet(false); setWalletError(""); }} className="btn-focus sans text-xs px-3 py-1.5" style={{ color: t.sub }}>Отмена</button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>

        {/* Balance */}
        <div className="pb-6 mb-8" style={{ borderBottom: `1px solid ${t.line}` }}>
          <div className="flex items-end justify-between flex-wrap gap-2">
            <div>
              <p className="sans text-xs mb-1" style={{ color: t.sub }}>Остаток бюджета</p>
              <p className="mono text-4xl sm:text-5xl" style={{ color: remaining >= 0 ? t.positive : t.negative }}>
                {remaining < 0 ? "−" : ""}{formatMoney(Math.abs(remaining), currency)}
              </p>
              <p className="sans text-xs mt-1" style={{ color: t.sub }}>
                Баланс месяца: <span className="mono" style={{ color: monthBalance >= 0 ? t.positive : t.negative }}>{monthBalance < 0 ? "−" : "+"}{formatMoney(Math.abs(monthBalance), currency)}</span>
              </p>
            </div>
            <div className="text-right sans text-sm" style={{ color: t.sub }}>
              <p>Доход: <span className="mono">{formatMoney(totalIncome, currency)}</span></p>
              <p>Потрачено: <span className="mono">{formatMoney(totalSpent, currency)}</span></p>
              <p>Бюджет: <span className="mono">{formatMoney(totalBudget, currency)}</span></p>
            </div>
          </div>
        </div>

        {/* Pending recurring for this month */}
        {pendingRecurring.length > 0 && (
          <div className="mb-8 p-3" style={{ background: t.panel, border: `1px dashed ${t.line}` }}>
            <p className="sans text-xs mb-2 flex items-center gap-1.5" style={{ color: t.sub }}><Repeat size={12} /> Регулярные операции за {MONTHS_RU[viewMonth].toLowerCase()}</p>
            {pendingRecurring.map((rec) => (
              <div key={rec.id} className="flex items-center justify-between py-1 text-sm">
                <span className="sans" style={{ color: t.ink }}>{rec.description} <span className="mono" style={{ color: t.sub }}>· {formatMoney(rec.amount, currency)}</span></span>
                <button onClick={() => applyRecurring(rec)} className="btn-focus text-xs px-3 py-1 rounded-full flex items-center gap-1" style={{ background: t.btnBg, color: t.btnText }}><Plus size={11} /> Добавить</button>
              </div>
            ))}
          </div>
        )}

        {/* Monthly chart */}
        <div className="mb-10">
          <h2 className="serif text-lg mb-3" style={{ color: t.ink }}>Динамика по месяцам</h2>
          <div style={{ width: "100%", height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={t.lineMuted} />
                <XAxis dataKey="label" tick={{ fontFamily: "Inter", fontSize: 12, fill: t.sub }} axisLine={{ stroke: t.line }} tickLine={false} />
                <YAxis hide />
                <Tooltip cursor={{ fill: t.lineMuted, opacity: 0.6 }} content={<LedgerTooltip currency={currency} categories={categories} t={t} />} />
                {categories.map((c) => (<Bar key={c.id} dataKey={c.id} stackId="a" fill={c.color} />))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Analytics */}
        <div className="mb-10">
          <h2 className="serif text-lg mb-3" style={{ color: t.ink }}>Аналитика · {MONTHS_RU[viewMonth]}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 mb-4">
            <div>
              <p className="sans text-xs" style={{ color: t.sub }}>Расходы</p>
              <p className="mono text-lg" style={{ color: t.ink }}>{formatMoney(totalSpent, currency)}</p>
              {analytics.pctChange !== null && (
                <p className="sans text-xs" style={{ color: analytics.pctChange <= 0 ? t.positive : t.negative }}>
                  {analytics.pctChange <= 0 ? "" : "+"}{analytics.pctChange.toFixed(0)}% к прошлому месяцу
                </p>
              )}
            </div>
            <div>
              <p className="sans text-xs" style={{ color: t.sub }}>Средний расход</p>
              <p className="mono text-lg" style={{ color: t.ink }}>{formatMoney(analytics.avgDaily, currency)}<span className="sans text-xs" style={{ color: t.sub }}>/день</span></p>
            </div>
            <div>
              <p className="sans text-xs" style={{ color: t.sub }}>Операций за месяц</p>
              <p className="mono text-lg" style={{ color: t.ink }}>{analytics.count}</p>
            </div>
            {analytics.mostExpensiveDay && (
              <div>
                <p className="sans text-xs" style={{ color: t.sub }}>Самый дорогой день</p>
                <p className="mono text-lg" style={{ color: t.ink }}>
                  {analytics.mostExpensiveDay.date.slice(8, 10)}.{analytics.mostExpensiveDay.date.slice(5, 7)}
                  <span className="sans text-xs" style={{ color: t.sub }}> · {formatMoney(analytics.mostExpensiveDay.amount, currency)}</span>
                </p>
              </div>
            )}
          </div>
          {analytics.topCategories.length > 0 && (
            <div>
              <p className="sans text-xs mb-1.5" style={{ color: t.sub }}>Топ категорий</p>
              {analytics.topCategories.map((c, i) => (
                <div key={c.id} className="flex items-center justify-between py-1 text-sm sans" style={{ color: t.ink }}>
                  <span>{["🥇", "🥈", "🥉"][i]} {c.label}</span>
                  <span className="mono">{formatMoney(c.spent, currency)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Categories */}
        <div className="mb-10">
          <h2 className="serif text-lg mb-3" style={{ color: t.ink }}>По категориям</h2>
          <div>
            {categories.map((cat) => {
              const spent = spentByCategory[cat.id] || 0;
              const budget = budgets[cat.id] || 0;
              const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : spent > 0 ? 100 : 0;
              const over = spent > budget;
              return (
                <div key={cat.id} className="py-3 flex items-center gap-4" style={{ borderBottom: `1px solid ${t.lineMuted}` }}>
                  <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: cat.color }} />
                  <span className="sans text-sm w-28 flex-shrink-0 truncate" style={{ color: t.ink }}>{cat.label}</span>
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: t.lineMuted }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: over ? t.negative : cat.color }} />
                  </div>
                  <div className="mono text-sm w-44 text-right flex-shrink-0" style={{ color: over ? t.negative : t.ink }}>
                    {formatMoney(spent, currency)} /{" "}
                    {editingBudget === cat.id ? (
                      <input autoFocus type="number" value={budgetDraft} onChange={(e) => setBudgetDraft(e.target.value)}
                        onBlur={() => commitEditBudget(cat.id)} onKeyDown={handleBudgetKeyDown}
                        className="ledger-input mono w-20 text-right" />
                    ) : (
                      <button onClick={() => startEditBudget(cat.id)} className="btn-focus underline decoration-dotted underline-offset-2 hover:opacity-60">{formatMoney(budget, currency)}</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Goals */}
        <div className="mb-10">
          <h2 className="serif text-lg mb-3 flex items-center gap-1.5" style={{ color: t.ink }}><Target size={17} /> Финансовые цели</h2>
          {goals.length === 0 && <p className="sans text-sm mb-3" style={{ color: t.sub }}>Пока нет ни одной цели.</p>}
          <div>
            {goals.map((g) => {
              const pct = g.target > 0 ? Math.min(100, (g.saved / g.target) * 100) : 0;
              const done = g.saved >= g.target;
              return (
                <div key={g.id} className="py-3" style={{ borderBottom: `1px solid ${t.lineMuted}` }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="sans text-sm" style={{ color: t.ink }}>{g.name}</span>
                    <button onClick={() => handleDeleteGoal(g.id)} aria-label="Удалить цель" className="btn-focus hover:opacity-60" style={{ color: t.negative }}><Trash2 size={13} /></button>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: t.lineMuted }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: done ? t.positive : t.gold }} />
                    </div>
                    <div className="mono text-sm flex-shrink-0" style={{ color: t.ink }}>
                      {editingGoalId === g.id ? (
                        <input autoFocus type="number" value={goalDraft} onChange={(e) => setGoalDraft(e.target.value)}
                          onBlur={() => commitEditGoal(g.id)} onKeyDown={handleGoalKeyDown}
                          className="ledger-input mono w-20 text-right" />
                      ) : (
                        <button onClick={() => startEditGoal(g)} className="btn-focus underline decoration-dotted underline-offset-2 hover:opacity-60">{formatMoney(g.saved, currency)}</button>
                      )}
                      {" "}/ {formatMoney(g.target, currency)} · {pct.toFixed(0)}%
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <form onSubmit={handleAddGoal} className="flex flex-wrap items-end gap-3 pt-3 mt-1">
            <div className="flex flex-col flex-1 min-w-[140px]">
              <label className="sans text-xs mb-1" style={{ color: t.sub }}>Название цели</label>
              <input type="text" placeholder="например, новый ноутбук" value={newGoalName} onChange={(e) => setNewGoalName(e.target.value)} className="ledger-input sans text-sm w-full" />
            </div>
            <div className="flex flex-col">
              <label className="sans text-xs mb-1" style={{ color: t.sub }}>Сумма, {currency}</label>
              <input type="number" min="0" value={newGoalTarget} onChange={(e) => setNewGoalTarget(e.target.value)} className="ledger-input mono text-sm w-28 text-right" />
            </div>
            <button type="submit" className="btn-focus sans text-sm flex items-center gap-1 px-3 py-2 rounded-full hover:opacity-85 transition-opacity flex-shrink-0" style={{ background: t.btnBg, color: t.btnText }}>
              <Plus size={14} /> Добавить цель
            </button>
          </form>
          {goalError && <p className="sans text-xs mt-2" style={{ color: t.negative }}>{goalError}</p>}
        </div>

        {/* Add record */}
        <div className="mb-8">
          <h2 className="serif text-lg mb-3" style={{ color: t.ink }}>Новая запись</h2>
          <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3 sm:gap-4 pb-4" style={{ borderBottom: `1px solid ${t.line}` }}>
            <div className="flex gap-1">
              {["expense", "income"].map((tp) => (
                <button key={tp} type="button" onClick={() => setForm((f) => ({ ...f, type: tp }))} className="btn-focus text-xs px-3 py-1.5 rounded-full"
                  style={{ background: form.type === tp ? t.btnBg : "transparent", color: form.type === tp ? t.btnText : t.ink, border: `1px solid ${t.line}` }}>
                  {tp === "expense" ? "Расход" : "Доход"}
                </button>
              ))}
            </div>
            <div className="flex flex-col">
              <label className="sans text-xs mb-1" style={{ color: t.sub }}>Дата</label>
              <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className="ledger-input sans text-sm" />
            </div>
            {form.type === "expense" && (
              <div className="flex flex-col">
                <label className="sans text-xs mb-1" style={{ color: t.sub }}>Категория</label>
                <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="ledger-input sans text-sm">
                  {categories.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
                </select>
              </div>
            )}
            <div className="flex flex-col flex-1 min-w-[140px]">
              <label className="sans text-xs mb-1" style={{ color: t.sub }}>{form.type === "income" ? "Источник" : "Описание"}</label>
              <input type="text" placeholder={form.type === "income" ? "например, зарплата" : "например, кофе"} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="ledger-input sans text-sm w-full" />
            </div>
            <div className="flex flex-col">
              <label className="sans text-xs mb-1" style={{ color: t.sub }}>Сумма, {currency}</label>
              <input type="number" min="0" step="0.01" placeholder="0" value={form.amount} onChange={(e) => { setForm((f) => ({ ...f, amount: e.target.value })); setFormError(""); }} className="ledger-input mono text-sm w-24 text-right" />
            </div>
            <button type="submit" className="btn-focus sans text-sm flex items-center gap-1 px-3 py-2 rounded-full hover:opacity-85 transition-opacity flex-shrink-0" style={{ background: t.btnBg, color: t.btnText }}>
              <Plus size={14} /> Добавить
            </button>
          </form>
          {formError && <p className="sans text-xs mt-2" style={{ color: t.negative }}>{formError}</p>}
        </div>

        {/* Transactions + filters */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="serif text-lg" style={{ color: t.ink }}>Записи</h2>
            <button onClick={() => setFiltersOpen((o) => !o)} className="btn-focus text-xs px-3 py-1.5 rounded-full flex items-center gap-1"
              style={{ background: filtersActive ? t.btnBg : "transparent", color: filtersActive ? t.btnText : t.sub, border: `1px solid ${t.line}` }}>
              <Search size={12} /> Фильтры{filtersActive ? " · вкл" : ""}
            </button>
          </div>

          {filtersOpen && (
            <div className="mb-4 p-3 flex flex-wrap gap-3 items-end" style={{ background: t.panel, border: `1px solid ${t.line}` }}>
              <div className="flex flex-col">
                <label className="sans text-xs mb-1" style={{ color: t.sub }}>Поиск</label>
                <input type="text" placeholder="описание" value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} className="ledger-input sans text-sm w-32" />
              </div>
              <div className="flex flex-col">
                <label className="sans text-xs mb-1" style={{ color: t.sub }}>Категория</label>
                <select value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))} className="ledger-input sans text-sm">
                  <option value="all">Все</option>
                  {categories.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
                </select>
              </div>
              <div className="flex flex-col">
                <label className="sans text-xs mb-1" style={{ color: t.sub }}>Тип</label>
                <select value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))} className="ledger-input sans text-sm">
                  <option value="all">Все</option><option value="expense">Расход</option><option value="income">Доход</option>
                </select>
              </div>
              <div className="flex flex-col">
                <label className="sans text-xs mb-1" style={{ color: t.sub }}>С даты</label>
                <input type="date" value={filters.dateFrom} onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} className="ledger-input sans text-sm" />
              </div>
              <div className="flex flex-col">
                <label className="sans text-xs mb-1" style={{ color: t.sub }}>По дату</label>
                <input type="date" value={filters.dateTo} onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))} className="ledger-input sans text-sm" />
              </div>
              <label className="flex items-center gap-1.5 sans text-sm pb-1.5" style={{ color: t.ink }}>
                <input type="checkbox" checked={filters.onlyOverBudget} onChange={(e) => setFilters((f) => ({ ...f, onlyOverBudget: e.target.checked }))} />
                только превышения бюджета
              </label>
              <button onClick={resetFilters} className="btn-focus sans text-xs px-3 py-1.5" style={{ color: t.sub }}>Сбросить</button>
            </div>
          )}

          {filteredTransactions.length === 0 ? (
            <p className="sans text-sm py-6" style={{ color: t.sub }}>Ничего не найдено. Измените фильтры или добавьте первую запись выше.</p>
          ) : (
            <div>
              {filteredTransactions.map((e) => (
                editingRowId === e.id ? (
                  <div key={e.id} className="py-3 flex flex-wrap items-end gap-2" style={{ borderBottom: `1px solid ${t.lineMuted}`, background: t.panel }}>
                    <div className="flex gap-1">
                      {["expense", "income"].map((tp) => (
                        <button key={tp} type="button" onClick={() => setEditDraft((d) => ({ ...d, type: tp }))} className="btn-focus text-xs px-2 py-1 rounded-full"
                          style={{ background: editDraft.type === tp ? t.btnBg : "transparent", color: editDraft.type === tp ? t.btnText : t.ink, border: `1px solid ${t.line}` }}>
                          {tp === "expense" ? "Расход" : "Доход"}
                        </button>
                      ))}
                    </div>
                    <input type="date" value={editDraft.date} onChange={(e2) => setEditDraft((d) => ({ ...d, date: e2.target.value }))} className="ledger-input sans text-xs" />
                    {editDraft.type === "expense" && (
                      <select value={editDraft.category} onChange={(e2) => setEditDraft((d) => ({ ...d, category: e2.target.value }))} className="ledger-input sans text-xs">
                        {categories.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
                      </select>
                    )}
                    <input type="text" value={editDraft.description} onChange={(e2) => setEditDraft((d) => ({ ...d, description: e2.target.value }))} className="ledger-input sans text-xs flex-1 min-w-[100px]" />
                    <input type="number" min="0" step="0.01" value={editDraft.amount} onChange={(e2) => setEditDraft((d) => ({ ...d, amount: e2.target.value }))} className="ledger-input mono text-xs w-20 text-right" />
                    <button onClick={() => saveEditRow(e.id)} aria-label="Сохранить" className="btn-focus p-1 rounded-full" style={{ background: t.btnBg, color: t.btnText }}><Check size={13} /></button>
                    <button onClick={cancelEditRow} aria-label="Отмена" className="btn-focus p-1" style={{ color: t.sub }}><X size={14} /></button>
                  </div>
                ) : (
                  <div key={e.id} className="group py-2.5 flex items-center gap-3 sm:gap-4" style={{ borderBottom: `1px solid ${t.lineMuted}` }}>
                    <span className="mono text-xs w-16 flex-shrink-0" style={{ color: t.sub }}>{e.date.slice(8, 10)}.{e.date.slice(5, 7)}</span>
                    <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: e.type === "income" ? t.positive : catColor(e.category) }} />
                    <span className="sans text-sm flex-1 truncate" style={{ color: t.ink }}>{e.description}</span>
                    <span className="sans text-xs hidden sm:inline" style={{ color: t.sub }}>{e.type === "income" ? "доход" : catLabel(e.category)}</span>
                    <span className="mono text-sm w-24 text-right flex-shrink-0" style={{ color: e.type === "income" ? t.positive : t.ink }}>
                      {e.type === "income" ? "+" : ""}{formatMoney(e.amount, currency)}
                    </span>
                    <button onClick={() => startEditRow(e)} aria-label="Редактировать запись" className="btn-focus opacity-0 group-hover:opacity-100 sm:opacity-40 sm:group-hover:opacity-100 transition-opacity flex-shrink-0" style={{ color: t.ink }}><Pencil size={13} /></button>
                    <button onClick={() => handleDelete(e.id)} aria-label="Удалить запись" className="btn-focus opacity-0 group-hover:opacity-100 sm:opacity-40 sm:group-hover:opacity-100 transition-opacity flex-shrink-0" style={{ color: t.negative }}><X size={14} /></button>
                  </div>
                )
              ))}
            </div>
          )}
        </div>

        {saveError && <p className="sans text-xs mt-8" style={{ color: t.negative }}>Не удалось сохранить изменения. Данные будут потеряны при перезагрузке.</p>}
      </div>

      {confirmState && (
        <div className="fixed inset-0 z-20 flex items-center justify-center p-4" style={{ background: t.overlay }}>
          <div className="w-full max-w-sm p-5 sans text-sm" style={{ background: t.panel, border: `1px solid ${t.line}`, color: t.ink }}>
            <p className="serif text-base mb-4">{confirmState.message}</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmState(null)} className="btn-focus text-sm px-3 py-1.5" style={{ color: t.sub }}>Отмена</button>
              <button onClick={() => { confirmState.onConfirm(); setConfirmState(null); }} className="btn-focus text-sm px-3 py-1.5 rounded-full" style={{ background: t.btnBg, color: t.btnText }}>Подтвердить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
