"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import type { Variable } from "./chartTraces";
import { X_LABELS, X_POSITIONS, isTemperatureVariable, yAxisTitle } from "./chartTraces";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

export const MIN_WINDOW_WIDTH = 420;
export const MIN_WINDOW_HEIGHT = 300;
export const COLLAPSED_HEIGHT = 48;

export type ChartWindowModel = {
  id: string;
  title: string;
  subtitle: string;
  variable: Variable;
  traces: unknown[];
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  collapsed: boolean;
  /** Size to restore when expanding after collapse. */
  savedWidth?: number;
  savedHeight?: number;
};

type ChartWindowProps = {
  chart: ChartWindowModel;
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, width: number, height: number) => void;
  onToggleCollapse: (id: string) => void;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

export default function ChartWindow({
  chart,
  onClose,
  onFocus,
  onMove,
  onResize,
  onToggleCollapse
}: ChartWindowProps) {
  const moveRef = useRef<DragState | null>(null);
  const resizeRef = useRef<DragState | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [plotSize, setPlotSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (chart.collapsed) return;
    const element = bodyRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setPlotSize({
        width: Math.max(240, Math.round(rect.width)),
        height: Math.max(180, Math.round(rect.height))
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [chart.collapsed, chart.width, chart.height]);

  const startMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    moveRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: chart.x,
      originY: chart.y
    };
    onFocus(chart.id);
  }, [chart.id, chart.x, chart.y, onFocus]);

  const handleMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = moveRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    onMove(chart.id, drag.originX + (event.clientX - drag.startX), drag.originY + (event.clientY - drag.startY));
  }, [chart.id, onMove]);

  const startResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (chart.collapsed) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: chart.width,
      originY: chart.height
    };
    onFocus(chart.id);
  }, [chart.id, chart.width, chart.height, chart.collapsed, onFocus]);

  const handleResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = resizeRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    onResize(chart.id, drag.originX + (event.clientX - drag.startX), drag.originY + (event.clientY - drag.startY));
  }, [chart.id, onResize]);

  const endDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (moveRef.current?.pointerId === event.pointerId) moveRef.current = null;
    if (resizeRef.current?.pointerId === event.pointerId) resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  return (
    <div
      className={`chart-window${chart.collapsed ? " collapsed" : ""}`}
      style={{
        left: chart.x,
        top: chart.y,
        width: chart.width,
        height: chart.collapsed ? COLLAPSED_HEIGHT : chart.height,
        zIndex: chart.zIndex
      }}
      onPointerDownCapture={() => onFocus(chart.id)}
    >
      <div
        className="chart-window-titlebar"
        onPointerDown={startMove}
        onPointerMove={handleMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="chart-window-titles" title={`${chart.title}\n${chart.subtitle}`}>
          <strong>{chart.title}</strong>
          <span title={chart.subtitle}>{chart.subtitle}</span>
        </div>
        <div className="chart-window-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label={chart.collapsed ? "Expand chart" : "Collapse chart"}
            title={chart.collapsed ? "Expand" : "Collapse"}
            onClick={() => onToggleCollapse(chart.id)}
          >
            {chart.collapsed ? "▢" : "–"}
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Remove chart"
            title="Remove"
            onClick={() => onClose(chart.id)}
          >
            ×
          </button>
        </div>
      </div>

      {!chart.collapsed ? (
        <>
          <div className="chart-window-body" ref={bodyRef}>
            {plotSize.width > 0 ? (
              <Plot
                data={chart.traces as never[]}
                layout={{
                  width: plotSize.width,
                  height: plotSize.height,
                  autosize: false,
                  margin: { l: 58, r: 16, t: 46, b: 96 },
                  paper_bgcolor: "rgba(0,0,0,0)",
                  plot_bgcolor: "rgba(0,0,0,0)",
                  font: { family: "Inter, system-ui, sans-serif", color: "#203039", size: 11 },
                  hovermode: "closest",
                  violinmode: "overlay",
                  xaxis: {
                    tickmode: "array",
                    tickvals: X_POSITIONS,
                    ticktext: X_LABELS,
                    tickangle: -45,
                    range: [-1.2, 22.2],
                    fixedrange: false,
                    tickfont: { size: 9 },
                    gridcolor: "rgba(105,125,130,.13)",
                    zeroline: false
                  },
                  yaxis: {
                    title: { text: yAxisTitle(chart.variable), font: { size: 11 } },
                    range: isTemperatureVariable(chart.variable) ? [-5, 20] : undefined,
                    tickfont: { size: 10 },
                    gridcolor: "rgba(105,125,130,.18)",
                    zerolinecolor: "rgba(70,90,95,.35)"
                  },
                  legend: {
                    orientation: "h",
                    x: 0,
                    xanchor: "left",
                    y: 1.03,
                    yanchor: "bottom",
                    font: { size: 10 }
                  }
                }}
                config={{
                  displaylogo: false,
                  toImageButtonOptions: {
                    format: "png",
                    filename: `Quarters_${chart.title}_${chart.subtitle}`
                      .replaceAll(" · ", "_")
                      .replaceAll(" ", "_")
                      .replace(/[<>:"/\\|?*]/g, "")
                      .replace(/_+/g, "_")
                      .replace(/^_|_$/g, "") || "chart"
                  }
                }}
              />
            ) : null}
          </div>

          <div
            className="chart-window-resize"
            aria-hidden="true"
            onPointerDown={startResize}
            onPointerMove={handleResize}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        </>
      ) : null}
    </div>
  );
}
