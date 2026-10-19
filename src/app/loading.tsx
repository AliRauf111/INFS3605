// Shown while a page's data loads. On the very first load the full-screen loading
// screen covers it and waits for it to go (data-route-pending); after that, moving
// between pages only shows this small line.
export default function Loading() {
  return <p role="status" className="muted" data-route-pending="">Loading…</p>;
}
