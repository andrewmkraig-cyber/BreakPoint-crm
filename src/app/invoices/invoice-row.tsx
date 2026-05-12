"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent, ReactNode } from "react";

export function InvoiceRow({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();
  function handleKey(e: KeyboardEvent<HTMLTableRowElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      router.push(href);
    }
  }
  return (
    <tr
      role="link"
      tabIndex={0}
      onClick={() => router.push(href)}
      onKeyDown={handleKey}
      className="cursor-pointer border-b border-court-border last:border-b-0 hover:bg-court-surface-subtle/30"
    >
      {children}
    </tr>
  );
}
