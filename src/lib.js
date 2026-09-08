// Pure helpers shared by App.jsx. Kept in their own module (rather than
// exported from App.jsx) so the component file only exports components —
// see oxlint's react(only-export-components) / Fast Refresh rule — and so
// they can be unit tested without pulling in the whole component tree.

export function todayISO() {
  // Local calendar date, not UTC — toISOString() would shift near midnight
  // in timezones ahead of UTC and misdate the entry.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function monthKey(dateStr) { return dateStr.slice(0, 7); }
export function daysInMonth(year, monthIndex) { return new Date(year, monthIndex + 1, 0).getDate(); }

// A single source of truth for "is this a usable amount", so create and
// edit flows can't silently disagree (e.g. 0 allowed on edit but not create).
export function validateAmount(raw, { allowZero = false } = {}) {
  const val = parseFloat(raw);
  if (isNaN(val)) return null;
  if (val < 0) return null;
  if (val === 0 && !allowZero) return null;
  return val;
}

// Guards against corrupted-but-valid JSON (e.g. {"categories":"hello"})
// slipping past JSON.parse and crashing later on .map()/.length.
export function isValidStoredShape(p) {
  return (
    p && typeof p === "object" &&
    Array.isArray(p.wallets) &&
    Array.isArray(p.categories) &&
    (p.expenses === undefined || Array.isArray(p.expenses)) &&
    (p.settings === undefined || typeof p.settings === "object")
  );
}

export function formatMoney(amount, currency) {
  try {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 0 }).format(Math.round(amount));
  } catch (e) {
    return `${new Intl.NumberFormat("ru-RU").format(Math.round(amount))} ${currency}`;
  }
}

export function emptyBudgets(categories) { return categories.reduce((acc, c) => ({ ...acc, [c.id]: 0 }), {}); }
export function normalizeWallet(w, categories) {
  return {
    id: w.id, name: w.name, currency: w.currency,
    budgets: w.budgets || emptyBudgets(categories),
    goals: w.goals || [],
    recurring: w.recurring || [],
  };
}
export function normalizeExpense(e) { return { ...e, type: e.type || "expense" }; }

export function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
export function csvEscape(field) {
  const s = String(field ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
