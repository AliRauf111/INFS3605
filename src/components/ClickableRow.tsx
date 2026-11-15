"use client";
import { useRouter } from "next/navigation";

// A table row that opens its request when clicked anywhere. The real link stays in the
// first cell for keyboards and screen readers. (Stretching that link over the row with
// CSS doesn't work in Safari, which ignores position on table rows, so every link ended
// up covering the whole table and the last row won.)
export function ClickableRow({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();
  function onClick(e: React.MouseEvent<HTMLTableRowElement>) {
    if ((e.target as HTMLElement).closest("a, button, input, label")) return; // the link handles itself
    if (window.getSelection()?.toString()) return; // let people copy text
    if (e.metaKey || e.ctrlKey) window.open(href, "_blank");
    else router.push(href);
  }
  return <tr className="clickable-row" onClick={onClick}>{children}</tr>;
}
