import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App.jsx";

// The "Категория" <label> isn't programmatically associated with its
// <select> (no htmlFor/id), so it can't be reached via getByLabelText —
// scope to the "Новая запись" form and grab its one combobox instead.
function getAddForm() {
  const heading = screen.getByRole("heading", { name: "Новая запись" });
  return heading.parentElement.querySelector("form");
}

// The settings-panel "Категории" editor is the only place a category name
// renders as an editable text input's value — scope to it so a category
// selected in the "Новая запись" form (also matched by getByDisplayValue)
// doesn't create an ambiguous match.
function getCategoriesSection() {
  return screen.getByText("Категории", { selector: "span" }).closest("div");
}

async function addExpense(user, { description, amount, category }) {
  const form = getAddForm();
  if (category) {
    await user.selectOptions(within(form).getByRole("combobox"), category);
  }
  await user.type(within(form).getByPlaceholderText("например, кофе"), description);
  await user.type(within(form).getByPlaceholderText("0"), String(amount));
  await user.click(within(form).getByRole("button", { name: /Добавить/ }));
}

describe("BudgetTracker", () => {
  it("loads with the default categories and an empty ledger", async () => {
    render(<App />);
    expect(await screen.findByText("Бюджет")).toBeInTheDocument();
    expect(screen.getByText("Ничего не найдено. Измените фильтры или добавьте первую запись выше.")).toBeInTheDocument();
  });

  it("adds a new expense and lists it under Записи", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Бюджет");

    await addExpense(user, { description: "Кофе", amount: "350" });

    expect(await screen.findByText("Кофе")).toBeInTheDocument();
  });

  // BUG-004: amount 0 must be rejected on creation, same as a negative amount.
  it("rejects an expense with amount 0", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Бюджет");

    await addExpense(user, { description: "Ничего", amount: "0" });

    expect(screen.getByText("Сумма должна быть больше 0")).toBeInTheDocument();
    expect(screen.queryByText("Ничего")).not.toBeInTheDocument();
  });

  // BUG-001: deleting a category must not silently drop its expenses from
  // the totals — they should reappear as "Без категории", not vanish.
  it("reassigns expenses to 'Без категории' when their category is deleted, without losing the amount", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Бюджет");

    await addExpense(user, { description: "Игровой набор", amount: "500", category: "fun" });
    expect(await screen.findByText("Игровой набор")).toBeInTheDocument();

    const before = screen.getByText("Остаток бюджета").nextSibling.textContent;

    await user.click(screen.getByLabelText("Настройки"));

    // Category rows don't have unique labels, so find "Развлечения" (fun) row's delete button directly.
    const catRow = within(getCategoriesSection()).getByDisplayValue("Развлечения").closest("div");
    await user.click(within(catRow).getByRole("button", { name: "Удалить категорию" }));

    // The entry must survive under "Без категории" and the total must be unchanged.
    expect(await screen.findByText("Без категории")).toBeInTheDocument();
    expect(screen.getByText("Игровой набор")).toBeInTheDocument();
    const after = screen.getByText("Остаток бюджета").nextSibling.textContent;
    expect(after).toBe(before);
  });

  // BUG-002: deleting a category the "New record" form currently points at
  // must not leave the form referencing a category that no longer exists.
  it("switches the new-record form off a deleted category", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Бюджет");

    const form = getAddForm();
    const select = within(form).getByRole("combobox");
    await user.selectOptions(select, "fun");

    await user.click(screen.getByLabelText("Настройки"));
    const catRow = within(getCategoriesSection()).getByDisplayValue("Развлечения").closest("div");
    await user.click(within(catRow).getByRole("button", { name: "Удалить категорию" }));

    expect(select.value).not.toBe("fun");
    expect(within(select).queryByText("Развлечения")).not.toBeInTheDocument();
  });

  // BUG-005: an import file that parses as JSON but has the wrong shape
  // must be rejected with a visible error, not crash or silently corrupt state.
  it("rejects an import file with a corrupt (but valid-JSON) shape", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Бюджет");

    await addExpense(user, { description: "Кофе", amount: "350" });
    expect(await screen.findByText("Кофе")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Настройки"));
    const file = new File([JSON.stringify({ categories: "hello", wallets: [] })], "bad.json", { type: "application/json" });
    const input = document.querySelector('input[type="file"]');
    await user.upload(input, file);

    expect(await screen.findByText(/Не удалось прочитать файл/)).toBeInTheDocument();
    // Existing data must be untouched.
    expect(screen.getByText("Кофе")).toBeInTheDocument();
  });
});
