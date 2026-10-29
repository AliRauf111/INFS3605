"use client";
import { useState } from "react";
import { Icon } from "@/components/Icons";
import type { CapacitySeries } from "@/lib/overview/capacity";

// "A little room to grow": booked hours against the hours tutors offer, from the tutor
// calendar, drawn like the Studio design. Hover or focus a day (or week) to read it in the
// tip; the same figures are listed for screen readers.

export type PeriodKey = "week" | "next" | "month";
export type CapacityPeriod = { key: PeriodKey; label: string; series: CapacitySeries; max: number; change: string; tip: number; long: string };

const X0 = 15;
const X1 = 505;
const BASE = 160;
const SPAN = 135;

function path(pts: Array<[number, number]>): string {
  return pts.map(([x, y], i) => (i ? `C${(pts[i - 1][0] + x) / 2} ${pts[i - 1][1]} ${(pts[i - 1][0] + x) / 2} ${y} ${x} ${y}` : `M${x} ${y}`)).join(" ");
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function tipText(label: string, b: number, a: number) {
  return { head: a > 0 ? `${Math.round((b / a) * 100)}% booked` : "No hours offered", line: `${label} · ${fmt(b)} of ${fmt(a)}h` };
}

export function CapacityCard({ periods, initial }: { periods: CapacityPeriod[]; initial: PeriodKey }) {
  const [key, setKey] = useState<PeriodKey>(initial);
  const p = periods.find((x) => x.key === key) ?? periods[0];
  const { labels, booked, offered, percent } = p.series;
  const [tip, setTip] = useState<number | null>(null);
  const at = tip ?? p.tip;
  const n = labels.length;
  const pts = (v: number[]) => v.map((h, i): [number, number] => [X0 + (n > 1 ? (i * (X1 - X0)) / (n - 1) : 0), BASE - (h / p.max) * SPAN]);
  const bp = pts(booked);
  const line = path(bp);
  const fill = `${line} L${X1} ${BASE} L${X0} ${BASE}Z`;
  const t = tipText(labels[at] ?? "", booked[at] ?? 0, offered[at] ?? 0);

  return (
    <div className="card chart-card" id="capacity">
      <div className="card-head">
        <div>
          <h2 id="cap-heading">A little room to grow</h2>
          <p className="caption">Booked lessons against your available tutor hours</p>
        </div>
        <select className="select" aria-label="Capacity chart period" value={key} onChange={(e) => { setKey(e.target.value as PeriodKey); setTip(null); }}>
          {periods.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
      </div>
      <div className="legend"><span><i style={{ background: "#b09ad4" }} />Booked</span><span><i style={{ background: "#b9cfe8" }} />Available</span></div>
      <div className="chart-summary">
        <strong>{percent ?? "–"}{percent !== null && <small>%</small>}</strong>
        <span>{percent === null ? <>No tutor hours offered<br />{p.long}</> : <>of tutor capacity booked<br />{p.change}</>}</span>
      </div>
      <div className="chart-wrap" onMouseLeave={() => setTip(null)}>
        <svg className="capacity-chart" viewBox="0 0 560 190" role="img" aria-label={`Tutor capacity, ${p.long}. ${percent === null ? "No hours offered." : `${percent}% of available hours booked.`} Hover or focus each point for its hours.`}>
          <defs>
            <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c6b1e7" stopOpacity=".25" /><stop offset="1" stopColor="#c6b1e7" stopOpacity="0" /></linearGradient>
            <pattern id="chartLines" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M2 0v6" stroke="#d6c6ea" strokeWidth="1" opacity=".6" /></pattern>
          </defs>
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <path className="gridline" d={`M10 ${25 + i * 45}h510`} />
              <text x="530" y={28 + i * 45}>{Math.round(p.max * (1 - i / 3))}h</text>
            </g>
          ))}
          <path d={fill} fill="url(#chartFill)" />
          <path d={fill} fill="url(#chartLines)" />
          <path className="line" stroke="#b8cde4" d={path(pts(offered))} />
          <path className="line" stroke="#ad93d0" d={line} />
          {labels.map((l, i) => (
            <g key={l}>
              <text x={bp[i][0]} y="183" textAnchor="middle">{l}</text>
              <g tabIndex={0} aria-label={`${l}: ${fmt(booked[i])} of ${fmt(offered[i])} hours booked`} onMouseOver={() => setTip(i)} onFocus={() => setTip(i)} onBlur={() => setTip(null)}>
                <rect x={bp[i][0] - 20} y="15" width="40" height="150" fill="transparent" />
                <circle cx={bp[i][0]} cy={bp[i][1]} r={i === at ? 4 : 2.5} fill="#b59bd5" stroke="white" strokeWidth="2" />
                <title>{`${l}: ${fmt(booked[i])} / ${fmt(offered[i])}h`}</title>
              </g>
            </g>
          ))}
        </svg>
        <div className="chart-tip" aria-live="polite"><strong>{t.head}</strong>{t.line}</div>
      </div>
      <ul className="sr-only">
        {labels.map((l, i) => <li key={l}>{l}: {fmt(booked[i])} of {fmt(offered[i])} hours booked</li>)}
      </ul>
      <p className="chart-note"><Icon name="info" />From the tutor calendar · hover the chart to explore</p>
    </div>
  );
}
