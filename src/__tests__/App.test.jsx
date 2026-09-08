import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App.jsx";

// ---------------------------------------------------------------------------
// Helpers
//
// Most labels in this UI are plain <label> siblings without htmlFor/id, so
// getByLabelText can't reach the fields. Each helper below scopes to the
// section it belongs to and picks the field by a locally unique attribute.
// ---------------------------------------------------------------------------

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

function getGoalsSection() {
  return screen.getByRole("heading", { name: /Финансовые цели/ }).parentElement;
}

// A goal's name renders in the row's header flex div; the row itself is one
// level up and holds the saved-amount control and the delete button.
function getGoalRow(name) {
  return screen.getByText(name).parentElement.parentElement;
}

// ByRole matches accessible names without normalizing whitespace, and
// formatMoney separates digit groups and the currency sign with non-breaking
// spaces — so amounts have to be matched with a regex, where \s covers both.
const ZERO_RUB = /^0\s₽$/;

// The "Сумма" placeholder is unique to the recurring-operations form, which
// only exists while the settings panel is open.
function getRecurringForm() {
  return screen.getByPlaceholderText("Сумма").closest("form");
}

function getRecurringSection() {
  return getRecurringForm().parentElement;
}

async function openSettings(user) {
  await user.click(screen.getByLabelText("Настройки"));
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

// The wallet switcher button and the menu items below it share the same
// accessible name ("<name> <currency>"), so capture the switcher's container
// while the menu is still closed and address the menu through it afterwards.
async function openWalletMenu(user, currentName) {
  const switcher = screen.getByRole("button", { name: new RegExp(currentName) });
  const box = switcher.parentElement;
  await user.click(switcher);
  return box.querySelector("div");
}

async function startCreatingWallet(user, currentName) {
  const menu = await openWalletMenu(user, currentName);
  await user.click(within(menu).getByRole("button", { name: /Новый кошелёк/ }));
  return menu;
}

async function createWallet(user, { from, name, currency }) {
  const menu = await startCreatingWallet(user, from);
  await user.type(within(menu).getByPlaceholderText("Название"), name);
  if (currency) await user.selectOptions(within(menu).getByRole("combobox"), currency);
  await user.click(within(menu).getByRole("button", { name: "Создать" }));
}

async function addGoal(user, { name, target }) {
  const section = getGoalsSection();
  if (name) await user.type(within(section).getByPlaceholderText("например, новый ноутбук"), name);
  if (target !== undefined) {
    await user.type(section.querySelector("form").querySelector("input[type=number]"), String(target));
  }
  await user.click(within(section).getByRole("button", { name: /Добавить цель/ }));
}

// Requires the settings panel to be open.
async function addRecurring(user, { description, amount, day }) {
  const form = getRecurringForm();
  if (description) await user.type(within(form).getByPlaceholderText("Название"), description);
  if (amount !== undefined) await user.type(within(form).getByPlaceholderText("Сумма"), String(amount));
  if (day !== undefined) {
    const dayInput = within(form).getByTitle("День месяца");
    await user.clear(dayInput);
    await user.type(dayInput, String(day));
  }
  // The submit button is icon-only and has no accessible name.
  await user.click(form.querySelector('button[type="submit"]'));
}

describe("Записи и категории", () => {
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

    const before = screen.getByText("Остаток бюджета").nextElementSibling.textContent;

    await openSettings(user);

    // Category rows don't have unique labels, so find "Развлечения" (fun) row's delete button directly.
    const catRow = within(getCategoriesSection()).getByDisplayValue("Развлечения").closest("div");
    await user.click(within(catRow).getByRole("button", { name: "Удалить категорию" }));

    // The entry must survive under "Без категории" and the total must be unchanged.
    expect(await screen.findByText("Без категории")).toBeInTheDocument();
    expect(screen.getByText("Игровой набор")).toBeInTheDocument();
    const after = screen.getByText("Остаток бюджета").nextElementSibling.textContent;
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

    await openSettings(user);
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

    await openSettings(user);
    const file = new File([JSON.stringify({ categories: "hello", wallets: [] })], "bad.json", { type: "application/json" });
    const input = document.querySelector('input[type="file"]');
    await user.upload(input, file);

    expect(await screen.findByText(/Не удалось прочитать файл/)).toBeInTheDocument();
    // Existing data must be untouched.
    expect(screen.getByText("Кофе")).toBeInTheDocument();
  });
});

describe("Кошельки", () => {
  it("creates a wallet in another currency and switches to it", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Бюджет");

    await createWallet(user, { from: "Основной", name: "Долларовый", currency: "USD" });

    // The new wallet becomes current, and amounts are formatted in its currency.
    const switcher = await screen.findByRole("button", { name: /Долларовый/ });
    expect(switcher).toHaveTextContent("USD");
    expect(screen.getByText("Остаток бюджета").nextElementSibling.textContent).toContain("$");
  });

  it("rejects a wallet whose name is already taken, ignoring case", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Бюджет");

    const menu = await startCreatingWallet(user, "Основной");
    await user.type(within(menu).getByPlaceholderText("Название"), "основной");
    await user.click(within(menu).getByRole("button", { name: "Создать" }));

    expect(within(menu).getByText("Кошелёк с таким названием уже есть")).toBeInTheDocument();
    // Still exactly one wallet in the list — nothing was created.
    expect(within(menu).getAllByRole("button", { name: /Основной/ })).toHaveLength(1);
  });

  it("rejects a wallet with an empty name", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Бюджет");

    const menu = await startCreatingWallet(user, "Основной");
    await user.click(within(menu).getByRole("button", { name: "Создать" }));

    expect(within(menu).getByText("Введите название кошелька")).toBeInTheDocument();
  });

  it("keeps each wallet's transactions separate", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Бюджет");

    await addExpense(user, { description: "Кофе", amount: "350" });
    expect(await screen.findByText("Кофе")).toBeInTheDocument();

    await createWallet(user, { from: "Основной", name: "Долларовый", currency: "USD" });

    // The new wallet starts empty — the other wallet's entry must not leak in.
    expect(screen.queryByText("Кофе")).not.toBeInTheDocument();
    expect(screen.getByText("Ничего не найдено. Измените фильтры или добавьте первую запись выше.")).toBeInTheDocument();

    const menu = await openWalletMenu(user, "Долларовый");
    await user.click(within(menu).getByRole("button", { name: /Основной/ }));

    expect(await screen.findByText("Кофе")).toBeInTheDocument();
  });
});

describe("Финансовые цели", () => {
  it("adds a goal and shows it at 0% progress", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Бюджет");
    expect(screen.getByText("Пока нет ни одной цели.")).toBeInTheDocument();

    await addGoal(user, { name: "Новый ноутбук", target: 50000 });

    const row = getGoalRow("Новый ноутбук");
    expect(row).toHaveTextContent("50 000 ₽");
    expect(row).toHaveTextContent("0%");
    expect(screen.queryByText("Пока нет ни одной цели.")).not.toBeInTheDocument();
  });

  it("rejects a goal with an empty name", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Бюджет");

    await addGoal(user, { target: 50000 });

    expect(screen.getByText("Введите название цели")).toBeInTheDocument();
    expect(screen.getByText("Пока нет ни одной цели.")).toBeInTheDocument();
  });

  it("rejects a goal with target 0", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Бюджет");

    await addGoal(user, { name: "Отпуск", target: 0 });

    expect(screen.getByText("Сумма цели должна быть больше 0")).toBeInTheDocument();
    expect(screen.getByText("Пока нет ни одной цели.")).toBeInTheDocument();
  });

  it("edits the saved amount and recalculates the percentage", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Бюджет");
    await addGoal(user, { name: "Новый ноутбук", target: 50000 });

    const row = getGoalRow("Новый ноутбук");
    await user.click(within(row).getByRole("button", { name: ZERO_RUB }));
    const input = within(row).getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "5000");
    await user.tab(); // commit on blur

    const updated = getGoalRow("Новый ноутбук");
    expect(updated).toHaveTextContent("5 000 ₽");
    expect(updated).toHaveTextContent("10%");
  });

  // BUG-003: Enter/blur/Escape all route through one commit path. Escape must
  // cancel the edit rather than save the draft the blur it triggers carries.
  it("cancels a saved-amount edit on Escape", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Бюджет");
    await addGoal(user, { name: "Новый ноутбук", target: 50000 });

    const row = getGoalRow("Новый ноутбук");
    await user.click(within(row).getByRole("button", { name: ZERO_RUB }));
    const input = within(row).getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "9999");
    await user.keyboard("{Escape}");

    const unchanged = getGoalRow("Новый ноутбук");
    expect(within(unchanged).getByRole("button", { name: ZERO_RUB })).toBeInTheDocument();
    expect(unchanged).not.toHaveTextContent("9 999");
  });

  it("deletes a goal", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Бюджет");
    await addGoal(user, { name: "Новый ноутбук", target: 50000 });

    const row = getGoalRow("Новый ноутбук");
    await user.click(within(row).getByRole("button", { name: "Удалить цель" }));

    expect(screen.queryByText("Новый ноутбук")).not.toBeInTheDocument();
    expect(screen.getByText("Пока нет ни одной цели.")).toBeInTheDocument();
  });

  // BUG-003: Enter used to commit twice (once via onKeyDown, once via the blur
  // it triggers), which could raise the confirmation dialog twice for one
  // keystroke. Enter now only blurs, so exactly one dialog appears and one
  // confirmation settles the edit.
  it("gates a saved-amount edit behind the confirmation dialog when confirmations are on", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Бюджет");

    await openSettings(user);
    await user.click(screen.getByRole("button", { name: "Выключено" }));
    await openSettings(user); // close the panel again

    await addGoal(user, { name: "Новый ноутбук", target: 50000 });

    // Cancelling the dialog leaves the goal untouched.
    await user.click(within(getGoalRow("Новый ноутбук")).getByRole("button", { name: ZERO_RUB }));
    let input = within(getGoalRow("Новый ноутбук")).getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "5000");
    await user.keyboard("{Enter}");

    expect(screen.getByText(/Изменить накопление по цели/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Подтвердить" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Отмена" }));
    expect(within(getGoalRow("Новый ноутбук")).getByRole("button", { name: ZERO_RUB })).toBeInTheDocument();

    // Confirming applies it, and no second dialog is left behind.
    await user.click(within(getGoalRow("Новый ноутбук")).getByRole("button", { name: ZERO_RUB }));
    input = within(getGoalRow("Новый ноутбук")).getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "5000");
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Подтвердить" }));

    expect(getGoalRow("Новый ноутбук")).toHaveTextContent("5 000 ₽");
    expect(screen.queryByRole("button", { name: "Подтвердить" })).not.toBeInTheDocument();
  });
});

describe("Регулярные операции", () => {
  it("adds a recurring template and lists it in settings", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Бюджет");

    await openSettings(user);
    expect(screen.getByText("Пока нет ни одной")).toBeInTheDocument();

    await addRecurring(user, { description: "Аренда", amount: 30000, day: 5 });

    const section = getRecurringSection();
    expect(section).toHaveTextContent("Аренда");
    expect(section).toHaveTextContent("30 000 ₽");
    expect(section).toHaveTextContent("день 5");
    expect(screen.queryByText("Пока нет ни одной")).not.toBeInTheDocument();
  });

  it("rejects a recurring template with an empty name", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Бюджет");

    await openSettings(user);
    await addRecurring(user, { amount: 30000 });

    expect(screen.getByText("Введите название операции")).toBeInTheDocument();
    expect(screen.getByText("Пока нет ни одной")).toBeInTheDocument();
  });

  it("rejects a recurring template with amount 0", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Бюджет");

    await openSettings(user);
    await addRecurring(user, { description: "Аренда", amount: 0 });

    expect(screen.getByText("Сумма должна быть больше 0")).toBeInTheDocument();
    expect(screen.getByText("Пока нет ни одной")).toBeInTheDocument();
  });

  it("offers a pending template in the banner and stops offering it once applied", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Бюджет");

    await openSettings(user);
    await addRecurring(user, { description: "Аренда", amount: 30000, day: 5 });
    await openSettings(user); // close the panel so only the banner shows the template

    const banner = screen.getByText(/Регулярные операции за/).closest("div");
    expect(within(banner).getByText(/Аренда/)).toBeInTheDocument();

    await user.click(within(banner).getByRole("button", { name: /Добавить/ }));

    // Applied once: the entry lands in the ledger and the banner stops offering it.
    expect(screen.getByText("Аренда")).toBeInTheDocument();
    expect(screen.queryByText(/Регулярные операции за/)).not.toBeInTheDocument();
    expect(screen.getByText(/Потрачено/)).toHaveTextContent("30 000");
  });

  it("deletes a recurring template", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Бюджет");

    await openSettings(user);
    await addRecurring(user, { description: "Аренда", amount: 30000, day: 5 });

    await user.click(within(getRecurringSection()).getByRole("button", { name: "Удалить регулярную операцию" }));

    expect(screen.getByText("Пока нет ни одной")).toBeInTheDocument();
    expect(screen.queryByText(/Регулярные операции за/)).not.toBeInTheDocument();
  });
});
