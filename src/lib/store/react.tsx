"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Store } from "./db";

/**
 * React glue for the store: one Store per app, and a hook that re-runs a
 * query whenever any op is committed.
 */

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<Store | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let opened: Store | null = null;
    Store.open()
      .then((s) => {
        if (cancelled) {
          s.close();
          return;
        }
        opened = s;
        setStore(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not open local storage.");
      });
    return () => {
      cancelled = true;
      opened?.close();
    };
  }, []);

  if (error) {
    return (
      <div role="alert" className="m-6 rounded-2xl bg-warn-soft px-5 py-4 text-sm text-warn">
        Notes need browser storage, which is not available here ({error}). Private browsing windows and some embedded browsers block it.
      </div>
    );
  }
  if (!store) return <div className="m-6 text-sm text-ink-soft">Opening your notes…</div>;
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside StoreProvider");
  return store;
}

/** Run a query now and again after every commit. `deps` restart the query. */
export function useLiveQuery<T>(query: (store: Store) => Promise<T>, deps: unknown[]): T | undefined {
  const store = useStore();
  const [value, setValue] = useState<T | undefined>(undefined);
  useEffect(() => {
    let active = true;
    const run = () => {
      query(store).then((v) => {
        if (active) setValue(v);
      });
    };
    run();
    const unsubscribe = store.subscribe(run);
    return () => {
      active = false;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, ...deps]);
  return value;
}
