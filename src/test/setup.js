import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { createLocalStorageAdapter } from "../storage-adapter.js";

// App.jsx talks to window.storage (get/set/delete/list), which in the real
// app is provided by main.jsx before render. Tests need the same contract,
// so back it with the localStorage adapter jsdom already gives us.
window.storage = createLocalStorageAdapter();

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
