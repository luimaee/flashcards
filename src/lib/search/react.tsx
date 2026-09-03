"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { NotesSearch, type SearchHit } from "./index";
import { useStore } from "@/lib/store/react";

/**
 * Keeps one NotesSearch in sync with the store. The index is rebuilt from
 * the searchIndex store after commits (debounced), which is simple and fast
 * enough for thousands of entries.
 */

interface SearchContextValue {
  search: NotesSearch;
  ready: boolean;
  generation: number;
}

const SearchContext = createContext<SearchContextValue | null>(null);

export function SearchProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const search = useMemo(() => new NotesSearch(), []);
  const [state, setState] = useState({ ready: false, generation: 0 });

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const rebuild = async () => {
      const entries = await store.searchEntries();
      if (!active) return;
      search.replaceAll(entries);
      setState((s) => ({ ready: true, generation: s.generation + 1 }));
    };
    void rebuild();
    const unsubscribe = store.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void rebuild(), 300);
    });
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [store, search]);

  const value = useMemo(() => ({ search, ready: state.ready, generation: state.generation }), [search, state]);
  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearch(): SearchContextValue {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error("useSearch must be used inside SearchProvider");
  return ctx;
}

export function useSearchResults(query: string): SearchHit[] {
  const { search, generation } = useSearch();
  return useMemo(() => {
    void generation; // re-run after the index is rebuilt
    return search.query(query);
  }, [search, query, generation]);
}
