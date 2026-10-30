"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icons";
import { useI18n } from "@/components/i18n/I18nProvider";

// The avatar in the top bar: opens a small panel with the signed-in name, role, Settings and Sign Out.
// Escape or a click elsewhere closes it, and focus goes back to the avatar.
export function UserMenu({ name, role, initials }: { name: string; role: string; initials: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={root}>
      <button ref={button} type="button" className="profile" aria-expanded={open} aria-controls={id} aria-label={t("shell.account", { name, role })} onClick={() => setOpen((v) => !v)}>
        <span className="avatar owner" aria-hidden="true">{initials}</span>
      </button>
      <div id={id} className="user-menu-panel" hidden={!open}>
        <p className="um-name">{name}</p>
        <p className="um-role"><span className="badge role-badge">{role}</span></p>
        <Link className="um-link" href="/settings" onClick={() => setOpen(false)}><Icon name="settings" size={16} /> {t("shell.settings")}</Link>
        <form action="/api/auth/logout" method="post">
          <button className="btn secondary small" type="submit"><Icon name="signout" size={16} /> {t("shell.signOut")}</button>
        </form>
      </div>
    </div>
  );
}
