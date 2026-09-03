"use client";

import { use } from "react";
import { NoteEditor } from "@/components/notes/NoteEditor";

export default function NotePage({ params }: { params: Promise<{ noteId: string }> }) {
  const { noteId } = use(params);
  return <NoteEditor noteId={noteId} />;
}
