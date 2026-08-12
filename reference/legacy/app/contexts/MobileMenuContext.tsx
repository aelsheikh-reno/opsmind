"use client";
import { createContext, useCallback, useContext, useState, ReactNode } from "react";

type MobileMenuCtx = { isOpen: boolean; open: () => void; close: () => void };
const MobileMenuContext = createContext<MobileMenuCtx>({ isOpen: false, open: () => {}, close: () => {} });

export function MobileMenuProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open  = useCallback(() => setIsOpen(true),  []);
  const close = useCallback(() => setIsOpen(false), []);
  return (
    <MobileMenuContext.Provider value={{ isOpen, open, close }}>
      {children}
    </MobileMenuContext.Provider>
  );
}

export function useMobileMenu() { return useContext(MobileMenuContext); }
