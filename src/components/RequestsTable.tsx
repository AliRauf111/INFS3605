"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RequestRow } from "@/lib/data/queries";
import { formatAud } from "@/lib/domain/money";
import { REQUEST_TYPE_LABELS } from "@/lib/domain/types";
import { ColourBadge, EmptyState, StatusBadge, formatDateTime } from "./ui";

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
type Message = { text: string; undo?: { action: Action; ids: string[] }; failures: Array<{ label: string; reason: string }> };

const UNDO: Record<Action, Action> = { archive: "unarchive", unarchive: "archive", remove: "restore", restore: "remove" };
const PAST: Record<Action, string> = { archive: "archived", unarchive: "restored", remove: "removed", restore: "put back in the list" };
const VERB: Record<Action, string> = { archive: "archive", unarchive: "restore", remove: "remove", restore: "put back" };
const OWNER_ONLY = "Only the owner can do this to a request that is waiting for them or raises a welfare concern.";

const plural = (n: number) => `${n} request${n === 1 ? "" : "s"}`;
const label = (r: TableRow) => `${r.reference_id ?? "No reference"}, ${REQUEST_TYPE_LABELS[r.request_type]}, ${formatDateTime(r.created_at)}`;

export function RequestsTable({ rows, view }: { rows: TableRow[]; view: ListView }) {
  const router = useRouter();
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
          setMessage({ text: body.error ?? "That didn't work. Nothing was changed. Try again.", failures: [] });
          setBusy(false);
          return;
        }
        outcome = body as Outcome;
      } catch {
        setMessage({ text: "The app couldn't be reached. Nothing was changed. Check your connection and try again.", failures: [] });
        setBusy(false);
        return;
      }
      const done = new Set(outcome.done);
      // Only the requests that worked leave the selection, so failed ones can be retried.
      setSelected((prev) => new Set([...prev].filter((id) => !done.has(id))));
      const n = outcome.done.length;
      const text = n === 0
        ? `No requests were ${PAST[action]}.`
        : opts.isUndo
          ? `Undone. ${plural(n)} ${n === 1 ? "is" : "are"} back where ${n === 1 ? "it was" : "they were"}.`
          : `${plural(n)} ${PAST[action]}.`;
      setMessage({
        text,
        undo: n > 0 && !opts.isUndo ? { action: UNDO[action], ids: outcome.done } : undefined,
        failures: outcome.failed.map((f) => {
          const r = byId.get(f.id);
          return { label: r ? label(r) : "A request", reason: f.reason };
        }),
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
          <EmptyState title="No requests yet">
            <p>Requests appear here once they are saved. <Link href="/requests/new/wizard">Create the first one</Link>.</p>
          </EmptyState>
        )}
        {view === "archived" && (
          <EmptyState title="No archived requests">
            <p>Archived requests show here and can be restored at any time.</p>
          </EmptyState>
        )}
        {view === "removed" && (
          <EmptyState title="No removed requests">
            <p>Requests taken off the lists show here and can be put back.</p>
          </EmptyState>
        )}
      </>
    );
  }

  const ids = [...selected];
  const primary: Action = view === "active" ? "archive" : view === "archived" ? "unarchive" : "restore";
  const primaryLabel = view === "active" ? "Archive Selected" : view === "archived" ? "Restore Selected" : "Put Back Selected";
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
        <div className="bulk-bar" role="region" aria-label="Actions for selected requests">
          <span className="bulk-count" aria-live="polite">{count} selected</span>
          <button type="button" className="btn small bulk-btn" disabled={busy} onClick={() => run(primary, ids)}>
            {primary === "archive" ? <ArchiveIcon /> : <RestoreIcon />}
            {primaryLabel}
          </button>
          {canRemove && (
            <button type="button" className="btn small bulk-btn danger-outline" disabled={busy} onClick={(e) => openConfirm(ids, false, e.currentTarget)}>
              <BinIcon />
              Remove Selected
            </button>
          )}
          <button type="button" className="link-btn" disabled={busy} onClick={() => setSelected(new Set())}>Clear Selection</button>
        </div>
      )}

      {/* Phones get cards; wider screens get the full table. */}
      <ul className="request-cards" aria-label="Requests, newest first">
        {rows.map((r) => (
          <li key={r.id} className={`card${selected.has(r.id) ? " is-selected" : ""}`}>
            <div className="rc-top">
              <input type="checkbox" className="sel-box" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select request ${label(r)}`} />
              <Link href={`/requests/${r.id}`} className="rc-title"><strong>{REQUEST_TYPE_LABELS[r.request_type]}{r.amount_cents === null ? "" : `, ${formatAud(r.amount_cents)}`}</strong></Link>
              <ColourBadge colour={r.decision} />
              <MenuButton row={r} open={menu?.id === r.id} onOpen={(button) => setMenu(menu?.id === r.id ? null : { id: r.id, button })} />
            </div>
            <p className="hint">{r.reference_id ?? "No reference"} · {formatDateTime(r.created_at)}</p>
            <StatusBadge status={r.status} />
          </li>
        ))}
      </ul>

      <div className="table-wrap request-table">
        <table>
          <caption className="sr-only">Requests, newest first</caption>
          <thead>
            <tr>
              <th scope="col" className="sel-cell">
                <input ref={allRef} type="checkbox" className="sel-box" checked={allChecked} onChange={toggleAll} aria-label={allChecked ? "Unselect all requests shown" : "Select all requests shown"} />
              </th>
              <th scope="col">Created</th>
              <th scope="col">Type</th>
              <th scope="col">Amount</th>
              <th scope="col">Reference</th>
              <th scope="col">Decision</th>
              <th scope="col">Status</th>
              <th scope="col" className="menu-cell"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`clickable-row${selected.has(r.id) ? " is-selected" : ""}`} onClick={(e) => rowClick(e, r.id)}>
                <td className="sel-cell">
                  <label className="sel-hit">
                    <input type="checkbox" className="sel-box" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select request ${label(r)}`} />
                  </label>
                </td>
                <td><Link href={`/requests/${r.id}`}>{formatDateTime(r.created_at)}</Link></td>
                <td>{REQUEST_TYPE_LABELS[r.request_type]}</td>
                <td>{r.amount_cents === null ? <span className="muted">None</span> : formatAud(r.amount_cents)}</td>
                <td>{r.reference_id ?? <span className="muted">None</span>}</td>
                <td><ColourBadge colour={r.decision} /></td>
                <td><StatusBadge status={r.status} /></td>
                <td className="menu-cell">
                  <MenuButton row={r} open={menu?.id === r.id} onOpen={(button) => setMenu(menu?.id === r.id ? null : { id: r.id, button })} />
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
  const failed = message.failures.length > 0;
  return (
    <div className={`notice ${failed ? "warning" : "success"} action-msg`} role="status">
      <div className="action-msg-line">
        <span>{message.text}</span>
        {message.undo && (
          <button type="button" className="link-btn" disabled={busy} onClick={() => onUndo(message.undo!.action, message.undo!.ids, { isUndo: true })}>Undo</button>
        )}
        <button type="button" className="link-btn action-msg-close" onClick={onClose} aria-label="Dismiss message">Dismiss</button>
      </div>
      {failed && (
        <>
          <p className="action-msg-sub">{message.failures.length === 1 ? "This request wasn't changed and is still selected:" : `These ${message.failures.length} requests weren't changed and are still selected:`}</p>
          <ul>
            {message.failures.map((f, i) => <li key={i}><strong>{f.label}</strong>: {f.reason}</li>)}
          </ul>
        </>
      )}
    </div>
  );
}

function MenuButton({ row, open, onOpen }: { row: TableRow; open: boolean; onOpen: (b: HTMLButtonElement) => void }) {
  return (
    <button
      type="button"
      className={`dots-btn${open ? " is-open" : ""}`}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? `row-menu-${row.id}` : undefined}
      aria-label={`More actions for request ${label(row)}`}
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
    const left = Math.max(8, Math.min(b.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    setPos({ top, left });
  }, [anchor, onClose]);

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

  const lockedNote = row.locked ? "Owner only" : undefined;
  const item = (action: Action, text: string, icon: React.ReactNode, opts: { danger?: boolean; ownerOnly?: boolean } = {}) => {
    const disabled = busy || (opts.ownerOnly && row.locked);
    return (
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        className={`menu-item${opts.danger ? " danger" : ""}`}
        aria-disabled={disabled || undefined}
        title={opts.ownerOnly && row.locked ? OWNER_ONLY : undefined}
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
      aria-label={`Actions for request ${label(row)}`}
      className="row-menu"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: MENU_WIDTH }}
      onKeyDown={onKeyDown}
    >
      <Link role="menuitem" tabIndex={-1} className="menu-item" href={`/requests/${row.id}`} onClick={() => onClose(false)}>
        <EyeIcon />
        <span>View Details</span>
      </Link>
      {view === "active" && item("archive", "Archive Request", <ArchiveIcon />, { ownerOnly: true })}
      {view === "archived" && item("unarchive", "Restore Request", <RestoreIcon />)}
      {view === "removed" && item("restore", "Put Back in List", <RestoreIcon />)}
      {view !== "removed" && (
        <>
          <div role="separator" className="menu-sep" />
          {item("remove", "Delete Request", <BinIcon />, { danger: true, ownerOnly: true })}
        </>
      )}
    </div>,
    document.body,
  );
}

function ConfirmRemove({ rows, single, busy, onCancel, onConfirm }: { rows: TableRow[]; single: boolean; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
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
      <h2 id="confirm-remove-title">Remove {plural(rows.length)}?</h2>
      <ul className="confirm-list">
        {shown.map((r) => (
          <li key={r.id}>
            <strong>{r.reference_id ?? "No reference"}</strong> · {REQUEST_TYPE_LABELS[r.request_type]}
            {r.amount_cents === null ? "" : ` · ${formatAud(r.amount_cents)}`} · {formatDateTime(r.created_at)}
          </li>
        ))}
        {rows.length > shown.length && <li className="muted">and {rows.length - shown.length} more</li>}
      </ul>
      <p id="confirm-remove-text">
        Details, decisions and history are kept, and you can put {rows.length === 1 ? "it" : "them"} back from Removed Requests.
      </p>
      <div className="confirm-actions">
        <button type="button" className="btn secondary confirm-cancel" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn danger" disabled={busy} onClick={onConfirm}>
          {single ? "Remove Request" : "Remove Selected"}
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
