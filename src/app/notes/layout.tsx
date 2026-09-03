"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { CommandPalette } from "@/components/notes/CommandPalette";
import { SearchProvider } from "@/lib/search/react";
import { StoreProvider } from "@/lib/store/react";

export default function NotesLayout({ children }: { children: ReactNode }) {
  return (
    <StoreProvider>
      <SearchProvider>
      <div className="flex min-h-full flex-1 flex-col">
        <nav className="flex items-center gap-4 border-b border-line bg-card px-5 py-2 text-sm">
          <Link href="/notes" className="font-semibold text-ink">
            Notes
          </Link>
          <Link href="/" className="text-ink-soft hover:text-ink">
            Cards from a file
          </Link>
          <Link href="/ink-test" className="text-ink-soft hover:text-ink">
            Pen tuning
          </Link>
          <span className="ml-auto flex items-center gap-3 text-xs text-ink-soft">
            <CommandPalette />
            Stored on this device only
          </span>
        </nav>
        {children}
      </div>
      </SearchProvider>
    </StoreProvider>
  );
}
