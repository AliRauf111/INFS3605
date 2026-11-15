import { A11yTrigger } from "@/components/a11y/A11yPanel";

// Every signed-in page opens with this: the heading on the left and the page's actions on
// the right, lined up with the edge of the main content. The Accessibility button is always
// in this action area, last (rightmost) by default. The dashboard is the one exception: there
// it sits just before New Request, which stays rightmost (a11y="first").
export function PageHeader({
  children,
  actions,
  a11y = "last",
  className,
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
  a11y?: "first" | "last";
  className?: string;
}) {
  return (
    <div className={`page-head${className ? ` ${className}` : ""}`}>
      <div className="page-title">{children}</div>
      <PageActions a11y={a11y}>{actions}</PageActions>
    </div>
  );
}

/** The action area on its own, for headers laid out by a page's own component. */
export function PageActions({ children, a11y = "last", className }: { children?: React.ReactNode; a11y?: "first" | "last"; className?: string }) {
  return (
    <div className={`page-actions${className ? ` ${className}` : ""}`}>
      {a11y === "first" && <A11yTrigger />}
      {children}
      {a11y === "last" && <A11yTrigger />}
    </div>
  );
}
