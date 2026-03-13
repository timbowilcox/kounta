"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

interface CommandBarContextValue {
  isOpen: boolean;
  open: (prefill?: string) => void;
  close: () => void;
  prefill: string;
}

const CommandBarContext = createContext<CommandBarContextValue | null>(null);

export function useCommandBar(): CommandBarContextValue {
  const ctx = useContext(CommandBarContext);
  if (!ctx) throw new Error("useCommandBar must be used inside <CommandBarProvider>");
  return ctx;
}

export function CommandBarProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [prefill, setPrefill] = useState("");

  const open = useCallback((text?: string) => {
    setPrefill(text ?? "");
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setPrefill("");
  }, []);

  // Global keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (isOpen) {
          close();
        } else {
          open();
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, open, close]);

  return (
    <CommandBarContext.Provider value={{ isOpen, open, close, prefill }}>
      {children}
    </CommandBarContext.Provider>
  );
}
