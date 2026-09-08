import { describe, it, expect } from "vitest";
import {
  validateAmount,
  isValidStoredShape,
  formatMoney,
  csvEscape,
  monthKey,
  daysInMonth,
  emptyBudgets,
  normalizeWallet,
  normalizeExpense,
} from "../lib.js";

describe("validateAmount", () => {
  // BUG-004: creation and edit used to disagree on whether 0 is valid.
  // validateAmount(raw, { allowZero }) is now the single source of truth.
  it("rejects 0 by default (transaction amounts)", () => {
    expect(validateAmount("0")).toBeNull();
  });
  it("allows 0 when allowZero is set (budgets/goals)", () => {
    expect(validateAmount("0", { allowZero: true })).toBe(0);
  });
  it("rejects negative numbers regardless of allowZero", () => {
    expect(validateAmount("-5")).toBeNull();
    expect(validateAmount("-5", { allowZero: true })).toBeNull();
  });
  it("rejects non-numeric input", () => {
    expect(validateAmount("abc")).toBeNull();
    expect(validateAmount("")).toBeNull();
  });
  it("accepts positive decimals", () => {
    expect(validateAmount("12.5")).toBe(12.5);
  });
});

describe("isValidStoredShape", () => {
  // BUG-005: valid JSON with the wrong shape must not reach .map()/.length.
  it("accepts a well-formed payload", () => {
    expect(isValidStoredShape({ wallets: [], categories: [] })).toBe(true);
  });
  it("rejects a payload whose categories field is not an array", () => {
    expect(isValidStoredShape({ categories: "hello", wallets: [] })).toBe(false);
  });
  it("rejects a payload whose wallets field is not an array", () => {
    expect(isValidStoredShape({ categories: [], wallets: "hello" })).toBe(false);
  });
  it("rejects null and non-objects", () => {
    expect(isValidStoredShape(null)).toBeFalsy();
    expect(isValidStoredShape("hello")).toBeFalsy();
    expect(isValidStoredShape(42)).toBeFalsy();
  });
  it("allows expenses/settings to be omitted but not wrong-typed", () => {
    expect(isValidStoredShape({ wallets: [], categories: [] })).toBe(true);
    expect(isValidStoredShape({ wallets: [], categories: [], expenses: "nope" })).toBe(false);
    expect(isValidStoredShape({ wallets: [], categories: [], settings: "nope" })).toBe(false);
  });
});

describe("formatMoney", () => {
  it("formats a rounded amount with the given currency", () => {
    expect(formatMoney(1234.6, "RUB")).toContain("1");
    expect(formatMoney(1234.6, "RUB")).toContain("235");
  });
  it("falls back to a plain number + currency code for an unknown currency", () => {
    const result = formatMoney(100, "NOTACURRENCY");
    expect(result).toContain("100");
    expect(result).toContain("NOTACURRENCY");
  });
});

describe("csvEscape", () => {
  it("leaves plain fields untouched", () => {
    expect(csvEscape("coffee")).toBe("coffee");
  });
  it("quotes and escapes fields containing commas, quotes, or newlines", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });
  it("treats null/undefined as an empty field", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });
});

describe("monthKey / daysInMonth", () => {
  it("extracts YYYY-MM from an ISO date string", () => {
    expect(monthKey("2026-03-15")).toBe("2026-03");
  });
  it("computes the correct day count, including leap years", () => {
    expect(daysInMonth(2026, 1)).toBe(28); // Feb 2026, non-leap
    expect(daysInMonth(2024, 1)).toBe(29); // Feb 2024, leap
    expect(daysInMonth(2026, 0)).toBe(31); // Jan
  });
});

describe("emptyBudgets", () => {
  it("maps every category id to 0", () => {
    const categories = [{ id: "food" }, { id: "fun" }];
    expect(emptyBudgets(categories)).toEqual({ food: 0, fun: 0 });
  });
});

describe("normalizeWallet", () => {
  it("fills in missing budgets/goals/recurring on legacy wallets", () => {
    const categories = [{ id: "food" }];
    const w = normalizeWallet({ id: "w1", name: "Main", currency: "RUB" }, categories);
    expect(w.budgets).toEqual({ food: 0 });
    expect(w.goals).toEqual([]);
    expect(w.recurring).toEqual([]);
  });
  it("preserves existing budgets/goals/recurring", () => {
    const categories = [{ id: "food" }];
    const input = { id: "w1", name: "Main", currency: "RUB", budgets: { food: 500 }, goals: [{ id: "g1" }], recurring: [{ id: "r1" }] };
    const w = normalizeWallet(input, categories);
    expect(w.budgets).toEqual({ food: 500 });
    expect(w.goals).toEqual([{ id: "g1" }]);
    expect(w.recurring).toEqual([{ id: "r1" }]);
  });
});

describe("normalizeExpense", () => {
  it("defaults missing type to 'expense'", () => {
    expect(normalizeExpense({ id: "e1", amount: 10 }).type).toBe("expense");
  });
  it("preserves an explicit type", () => {
    expect(normalizeExpense({ id: "e1", amount: 10, type: "income" }).type).toBe("income");
  });
});
