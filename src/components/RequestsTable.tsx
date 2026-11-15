"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RequestRow } from "@/lib/data/queries";
import { ColourBadge, EmptyState, StatusBadge } from "./ui";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { Translate } from "@/lib/i18n/core";
import type { Format } from "@/lib/i18n/format";
import { textDirection } from "@/lib/i18n/languages";

// The saved requests list on the Requests page. People can tick requests and archive or
// remove them together, or use the menu at the end of a row for one request. Archiving
// and removing only change where a request is listed: the server keeps every detail,
// decision and history entry, checks permissions again and never changes a decision.

export type TableRow = Pick<RequestRow, "id" | "request_type" | "amount_cents" | "reference_id" | "decision" | "status" | "created_at"> & {
  /** True when only the owner may archive or remove this request and the viewer isn't the owner. */
  locked: boolean;
};

export type ListView = "active" | "archived" | "removed";
type Action = "archive" | "unarchive" | "remove" | "restore";
type Outcome = { done: string[]; failed: Array<{ id: string; reason: string }> };
// Messages are worded when shown, so they follow a change of language while they're on screen.
type Message = { text: (t: Translate) => string; undo?: { action: Action; ids: string[] }; failures: Array<{ row: TableRow | null; reason: string }> };

const UNDO: Record<Action, Action> = { archive: "unarchive", unarchive: "archive", remove: "restore", restore: "remove" };

function rowLabel(r: TableRow, t: Translate, fmt: Format): string {
  return t("requests.table.rowLabel", { reference: r.reference_id ?? t("requests.table.noReference"), type: t(`domain.requestType.${r.request_type}`), date: fmt.dateTime(r.created_at) });
}

export function RequestsTable({ rows, view }: { rows: TableRow[]; view: ListView }) {
  const router = useRouter();
  const { t, fmt } = useI18n();
  const label = (r: TableRow) => rowLabel(r, t, fmt);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [menu, setMenu] = useState<{ id: string; button: HTMLButtonElement } | null>(null);
  const [confirm, setConfirm] = useState<{ ids: string[]; single: boolean; returnTo: HTMLElement | null } | null>(null);
  const allRef = useRef<HTMLInputElement>(null);

  // Requests that left the list after a refresh can't stay selected.
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(rows.map((r) => r.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  const count = selected.size;
  const allChecked = rows.length > 0 && count === rows.length;
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = count > 0 && !allChecked;
  }, [count, allChecked]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)));

  const closeMenu = useCallback((refocus: boolean) => {
    setMenu((m) => {
      if (refocus) m?.button.focus();
      return null;
    });
  }, []);

  const run = useCallback(
    async (action: Action, ids: string[], opts: { isUndo?: boolean } = {}) => {
      if (busy || ids.length === 0) return;
      setBusy(true);
      setMessage(null);
      const byId = new Map(rows.map((r) => [r.id, r]));
      let outcome: Outcome;
      try {
        const res = await fetch("/api/requests/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ids }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          const error: string | undefined = body.error;
          setMessage({ text: (tr) => error ?? tr("requests.table.didntWork"), failures: [] });
          setBusy(false);
          return;
        }
        outcome = body as Outcome;
      } catch {
        setMessage({ text: (tr) => tr("requests.table.unreachable"), failures: [] });
        setBusy(false);
        return;
      }
      const done = new Set(outcome.done);
      // Only the requests that worked leave the selection, so failed ones can be retried.
      setSelected((prev) => new Set([...prev].filter((id) => !done.has(id))));
      const n = outcome.done.length;
      const text = (tr: Translate) => n === 0
        ? tr(`requests.table.noneDone.${action}`)
        : opts.isUndo
          ? tr("requests.table.undone", { count: n })
          : tr(`requests.table.done.${action}`, { count: n });
      setMessage({
        text,
        undo: n > 0 && !opts.isUndo ? { action: UNDO[action], ids: outcome.done } : undefined,
        failures: outcome.failed.map((f) => ({ row: byId.get(f.id) ?? null, reason: f.reason })),
      });
      setBusy(false);
      router.refresh();
    },
    [busy, rows, router],
  );

  if (rows.length === 0) {
    return (
      <>
        {message && <ActionMessage message={message} busy={busy} onUndo={run} onClose={() => setMessage(null)} />}
        {view === "active" && (
          <EmptyState title={t("requests.table.emptyActive")}>
            <p>{t("requests.table.emptyActiveText")} <Link href="/requests/new/wizard">{t("requests.table.createFirst")}</Link>.</p>
          </EmptyState>
        )}
        {view === "archived" && (
          <EmptyState title={t("requests.table.emptyArchived")}>
            <p>{t("requests.table.emptyArchivedText")}</p>
          </EmptyState>
        )}
        {view === "removed" && (
          <EmptyState title={t("requests.table.emptyRemoved")}>
            <p>{t("requests.table.emptyRemovedText")}</p>
          </EmptyState>
        )}
      </>
    );
  }

  const ids = [...selected];
  const primary: Action = view === "active" ? "archive" : view === "archived" ? "unarchive" : "restore";
  const primaryLabel = view === "active" ? t("requests.table.archiveSelected") : view === "archived" ? t("requests.table.restoreSelected") : t("requests.table.putBackSelected");
  const canRemove = view !== "removed";

  function openConfirm(confirmIds: string[], single: boolean, returnTo: HTMLElement | null) {
    setMenu(null);
    setConfirm({ ids: confirmIds, single, returnTo });
  }

  function rowClick(e: React.MouseEvent<HTMLTableRowElement>, id: string) {
    if ((e.target as HTMLElement).closest("a, button, input, label, .sel-cell, .menu-cell")) return;
    if (window.getSelection()?.toString()) return; // let people copy text
    if (e.metaKey || e.ctrlKey) window.open(`/requests/${id}`, "_blank");
    else router.push(`/requests/${id}`);
  }

  const menuRow = menu ? rows.find((r) => r.id === menu.id) : undefined;

  return (
    <div className="saved-list" data-compass-avoid="">
      {message && <ActionMessage message={message} busy={busy} onUndo={run} onClose={() => setMessage(null)} />}

      {count > 0 && (
        <div className="bulk-bar" role="region" aria-label={t("requests.table.bulkLabel")}>
          <span className="bulk-count" aria-live="polite">{t("requests.table.selected", { count })}</span>
          <button type="button" className="btn small bulk-btn" disabled={busy} onClick={() => run(primary, ids)}>
            {primary === "archive" ? <ArchiveIcon /> : <RestoreIcon />}
            {primaryLabel}
          </button>
          {canRemove && (
            <button type="button" className="btn small bulk-btn danger-outline" disabled={busy} onClick={(e) => openConfirm(ids, false, e.currentTarget)}>
              <BinIcon />
              {t("requests.table.removeSelected")}
            </button>
          )}
          <button type="button" className="link-btn" disabled={busy} onClick={() => setSelected(new Set())}>{t("requests.table.clearSelection")}</button>
        </div>
      )}

      {/* Phones get cards; wider screens get the full table. */}
      <ul className="request-cards" aria-label={t("requests.table.caption")}>
        {rows.map((r) => (
          <li key={r.id} className={`card${selected.has(r.id) ? " is-selected" : ""}`}>
            <div className="rc-top">
              <input type="checkbox" className="sel-box" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={t("requests.table.selectRow", { label: label(r) })} />
              <Link href={`/requests/${r.id}`} className="rc-title"><strong>{t(`domain.requestType.${r.request_type}`)}{r.amount_cents === null ? "" : `, ${fmt.money(r.amount_cents)}`}</strong></Link>
              <ColourBadge colour={r.decision} />
              <MenuButton row={r} label={label(r)} open={menu?.id === r.id} onOpen={(button) => setMenu(menu?.id === r.id ? null : { id: r.id, button })} />
            </div>
            <p className="hint"><bdi>{r.reference_id ?? t("requests.table.noReference")}</bdi> · {fmt.dateTime(r.created_at)}</p>
            <StatusBadge status={r.status} />
          </li>
        ))}
      </ul>

      <div className="table-wrap request-table">
        <table>
          <caption className="sr-only">{t("requests.table.caption")}</caption>
          <thead>
            <tr>
              <th scope="col" className="sel-cell">
                <input ref={allRef} type="checkbox" className="sel-box" checked={allChecked} onChange={toggleAll} aria-label={allChecked ? t("requests.table.unselectAll") : t("requests.table.selectAll")} />
              </th>
              <th scope="col">{t("requests.table.created")}</th>
              <th scope="col">{t("requests.table.type")}</th>
              <th scope="col">{t("requests.table.amount")}</th>
              <th scope="col">{t("requests.table.reference")}</th>
              <th scope="col">{t("requests.table.decision")}</th>
              <th scope="col">{t("requests.table.status")}</th>
              <th scope="col" className="menu-cell"><span className="sr-only">{t("requests.table.actions")}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`clickable-row${selected.has(r.id) ? " is-selected" : ""}`} onClick={(e) => rowClick(e, r.id)}>
                <td className="sel-cell">
                  <label className="sel-hit">
                    <input type="checkbox" className="sel-box" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={t("requests.table.selectRow", { label: label(r) })} />
                  </label>
                </td>
                <td><Link href={`/requests/${r.id}`}>{fmt.dateTime(r.created_at)}</Link></td>
                <td>{t(`domain.requestType.${r.request_type}`)}</td>
                <td>{r.amount_cents === null ? <span className="muted">{t("common.none")}</span> : fmt.money(r.amount_cents)}</td>
                <td>{r.reference_id ? <bdi>{r.reference_id}</bdi> : <span className="muted">{t("common.none")}</span>}</td>
                <td><ColourBadge colour={r.decision} /></td>
                <td><StatusBadge status={r.status} /></td>
                <td className="menu-cell">
                  <MenuButton row={r} label={label(r)} open={menu?.id === r.id} onOpen={(button) => setMenu(menu?.id === r.id ? null : { id: r.id, button })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {menu && menuRow && (
        <RowMenu
          key={menuRow.id}
          row={menuRow}
          view={view}
          anchor={menu.button}
          busy={busy}
          onClose={closeMenu}
          onAction={(action) => {
            setMenu(null);
            if (action === "remove") openConfirm([menuRow.id], true, menu.button);
            else {
              menu.button.focus();
              run(action, [menuRow.id]);
            }
          }}
        />
      )}

      {confirm && (
        <ConfirmRemove
          rows={rows.filter((r) => confirm.ids.includes(r.id))}
          single={confirm.single}
          busy={busy}
          onCancel={() => {
            confirm.returnTo?.focus();
            setConfirm(null); // the selection stays as it was
          }}
          onConfirm={async () => {
            const target = confirm.ids;
            const returnTo = confirm.returnTo;
            setConfirm(null);
            await run("remove", target);
            (returnTo && document.contains(returnTo) ? returnTo : allRef.current)?.focus();
          }}
        />
      )}
    </div>
  );
}

function ActionMessage({ message, busy, onUndo, onClose }: { message: Message; busy: boolean; onUndo: (a: Action, ids: string[], o: { isUndo: boolean }) => void; onClose: () => void }) {
  const { t, fmt } = useI18n();
  const failed = message.failures.length > 0;
  return (
    <div className={`notice ${failed ? "warning" : "success"} action-msg`} role="status">
      <div className="action-msg-line">
        <span>{message.text(t)}</span>
        {message.undo && (
          <button type="button" className="link-btn" disabled={busy} onClick={() => onUndo(message.undo!.action, message.undo!.ids, { isUndo: true })}>{t("requests.table.undo")}</button>
        )}
        <button type="button" className="link-btn action-msg-close" onClick={onClose} aria-label={t("requests.table.dismissLabel")}>{t("requests.table.dismiss")}</button>
      </div>
      {failed && (
        <>
          <p className="action-msg-sub">{t("requests.table.notChanged", { count: message.failures.length })}</p>
          <ul>
            {message.failures.map((f, i) => <li key={i}><strong>{f.row ? rowLabel(f.row, t, fmt) : t("requests.table.aRequest")}</strong>: {f.reason}</li>)}
          </ul>
        </>
      )}
    </div>
  );
}

function MenuButton({ row, label, open, onOpen }: { row: TableRow; label: string; open: boolean; onOpen: (b: HTMLButtonElement) => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className={`dots-btn${open ? " is-open" : ""}`}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? `row-menu-${row.id}` : undefined}
      aria-label={t("requests.table.moreActions", { label })}
      onClick={(e) => onOpen(e.currentTarget)}
    >
      <DotsIcon />
    </button>
  );
}

const MENU_WIDTH = 210;

function RowMenu({ row, view, anchor, busy, onClose, onAction }: {
  row: TableRow;
  view: ListView;
  anchor: HTMLButtonElement;
  busy: boolean;
  onClose: (refocus: boolean) => void;
  onAction: (a: Action) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { t, fmt, lang } = useI18n();
  const rtl = textDirection(lang) === "rtl";
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Place the menu under its button, or above it near the bottom of the screen, and
  // always inside the window. It is drawn outside the table so the table can't clip it,
  // and it follows its button when the page scrolls.
  const place = useCallback(() => {
    const b = anchor.getBoundingClientRect();
    if (b.bottom < 0 || b.top > window.innerHeight) return onClose(false); // button scrolled away
    const h = ref.current?.offsetHeight ?? 150;
    const gap = 6;
    let top = b.bottom + gap;
    if (top + h > window.innerHeight - 8 && b.top - gap - h > 8) top = b.top - gap - h;
    top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
    // Lined up with the button's end edge: its right in left-to-right text, its left in right-to-left.
    const left = Math.max(8, Math.min(rtl ? b.left : b.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    setPos({ top, left });
  }, [anchor, onClose, rtl]);

  useLayoutEffect(place, [place]);

  const placed = pos !== null;
  useEffect(() => {
    if (placed) ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus({ preventScroll: true });
  }, [placed]);

  useEffect(() => {
    const outside = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose(false);
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("touchstart", outside);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("touchstart", outside);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, onClose, place]);

  function onKeyDown(e: React.KeyboardEvent) {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      onClose(true);
    } else if (e.key === "Tab") {
      onClose(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(i + step + items.length) % items.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      (e.key === "Home" ? items[0] : items[items.length - 1])?.focus();
    }
  }

  const lockedNote = row.locked ? t("requests.table.ownerOnlyShort") : undefined;
  const item = (action: Action, text: string, icon: React.ReactNode, opts: { danger?: boolean; ownerOnly?: boolean } = {}) => {
    const disabled = busy || (opts.ownerOnly && row.locked);
    return (
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        className={`menu-item${opts.danger ? " danger" : ""}`}
        aria-disabled={disabled || undefined}
        title={opts.ownerOnly && row.locked ? t("requests.table.ownerOnly") : undefined}
        onClick={() => !disabled && onAction(action)}
      >
        {icon}
        <span>{text}</span>
        {opts.ownerOnly && lockedNote && <span className="menu-note">{lockedNote}</span>}
      </button>
    );
  };

  return createPortal(
    <div
      ref={ref}
      id={`row-menu-${row.id}`}
      role="menu"
      aria-label={t("requests.table.actionsFor", { label: rowLabel(row, t, fmt) })}
      className="row-menu"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: MENU_WIDTH }}
      onKeyDown={onKeyDown}
    >
      <Link role="menuitem" tabIndex={-1} className="menu-item" href={`/requests/${row.id}`} onClick={() => onClose(false)}>
        <EyeIcon />
        <span>{t("requests.table.viewDetails")}</span>
      </Link>
      {view === "active" && item("archive", t("requests.table.archiveRequest"), <ArchiveIcon />, { ownerOnly: true })}
      {view === "archived" && item("unarchive", t("requests.table.restoreRequest"), <RestoreIcon />)}
      {view === "removed" && item("restore", t("requests.table.putBack"), <RestoreIcon />)}
      {view !== "removed" && (
        <>
          <div role="separator" className="menu-sep" />
          {item("remove", t("requests.table.deleteRequest"), <BinIcon />, { danger: true, ownerOnly: true })}
        </>
      )}
    </div>,
    document.body,
  );
}

function ConfirmRemove({ rows, single, busy, onCancel, onConfirm }: { rows: TableRow[]; single: boolean; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t, fmt } = useI18n();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    d?.querySelector<HTMLButtonElement>(".confirm-cancel")?.focus();
  }, []);
  const shown = rows.slice(0, 6);
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby="confirm-remove-title"
      aria-describedby="confirm-remove-text"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel(); // a click on the dimmed backdrop
      }}
    >
      <h2 id="confirm-remove-title">{t("requests.table.confirmTitle", { count: rows.length })}</h2>
      <ul className="confirm-list">
        {shown.map((r) => (
          <li key={r.id}>
            <strong><bdi>{r.reference_id ?? t("requests.table.noReference")}</bdi></strong> · {t(`domain.requestType.${r.request_type}`)}
            {r.amount_cents === null ? "" : ` · ${fmt.money(r.amount_cents)}`} · {fmt.dateTime(r.created_at)}
          </li>
        ))}
        {rows.length > shown.length && <li className="muted">{t("requests.table.andMore", { count: rows.length - shown.length })}</li>}
      </ul>
      <p id="confirm-remove-text">
        {t("requests.table.confirmText", { count: rows.length })}
      </p>
      <div className="confirm-actions">
        <button type="button" className="btn secondary confirm-cancel" onClick={onCancel}>{t("common.cancel")}</button>
        <button type="button" className="btn danger" disabled={busy} onClick={onConfirm}>
          {single ? t("requests.table.removeRequest") : t("requests.table.removeSelected")}
        </button>
      </div>
    </dialog>
  );
}

// Small line icons, drawn here so no icon library is needed.
const svg = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, focusable: false };
function ArchiveIcon() {
  return <svg {...svg}><rect x="3" y="4" width="18" height="5" rx="1.5" /><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" /><path d="M10 13h4" /></svg>;
}
function BinIcon() {
  return <svg {...svg}><path d="M4 7h16" /><path d="M9 7V4.5h6V7" /><path d="M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7" /><path d="M10 11v6M14 11v6" /></svg>;
}
function EyeIcon() {
  return <svg {...svg}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>;
}
function RestoreIcon() {
  return <svg {...svg}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>;
}
function DotsIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>;
}
