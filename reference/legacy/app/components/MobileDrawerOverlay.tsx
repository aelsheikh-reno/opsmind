"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useMobileMenu } from "@/app/contexts/MobileMenuContext";
import Sidebar, { type SidebarProps } from "./Sidebar";

export default function MobileDrawerOverlay(props: SidebarProps) {
  const { isOpen, close } = useMobileMenu();
  const pathname = usePathname();

  useEffect(() => {
    close();
  }, [pathname, close]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-black/40" onClick={close} />
      <div className="absolute left-0 top-0 bottom-0 w-60 shadow-xl animate-slide-in-left">
        <Sidebar {...props} onClose={close} />
      </div>
    </div>
  );
}
