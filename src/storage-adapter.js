/**
 * Пример адаптера, повторяющего интерфейс window.storage
 * (get/set/delete/list), которым пользуется budget-tracker.jsx,
 * но поверх обычного localStorage — для запуска вне Claude Artifacts.
 *
 * Использование: подключить этот файл раньше рендера App и один раз
 * назначить window.storage = createLocalStorageAdapter(), либо
 * заменить прямые вызовы window.storage.* в компоненте на импорт
 * из этого модуля.
 *
 * Namespace нужен, чтобы не столкнуться по ключам с другими данными
 * в localStorage, если он используется на странице для чего-то ещё.
 */
export function createLocalStorageAdapter(namespace = "budget-tracker") {
  const ns = (key) => `${namespace}:${key}`;

  return {
    async get(key, _shared = false) {
      const raw = window.localStorage.getItem(ns(key));
      if (raw === null) return null;
      return { key, value: raw, shared: false };
    },

    async set(key, value, _shared = false) {
      try {
        window.localStorage.setItem(ns(key), value);
        return { key, value, shared: false };
      } catch (e) {
        // localStorage может кинуть QuotaExceededError — приложение
        // трактует "falsy" результат как ошибку сохранения.
        return null;
      }
    },

    async delete(key, _shared = false) {
      const existed = window.localStorage.getItem(ns(key)) !== null;
      window.localStorage.removeItem(ns(key));
      return { key, deleted: existed, shared: false };
    },

    async list(prefix = "", _shared = false) {
      const keys = [];
      const fullPrefix = ns(prefix);
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(fullPrefix)) {
          keys.push(k.slice(namespace.length + 1));
        }
      }
      return { keys, prefix, shared: false };
    },
  };
}

// Пример подключения в src/main.jsx до рендера:
//
//   import { createLocalStorageAdapter } from "./storage-adapter.example.js";
//   window.storage = createLocalStorageAdapter();
//
// После этого budget-tracker.jsx можно использовать без изменений —
// он вызывает window.storage.get/set с тем же контрактом.
