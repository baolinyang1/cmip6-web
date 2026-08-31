"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { VARIABLE_OPTIONS, type Variable } from "./chartTraces";

type VariableTabsProps = {
  value: Variable;
  onChange: (variable: Variable) => void;
};

const TAB_WIDTH = "10.5rem";

export default function VariableTabs({ value, onChange }: VariableTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<Variable, HTMLButtonElement>());
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  const updateIndicator = useCallback(() => {
    const scrollEl = scrollRef.current;
    const activeTab = tabRefs.current.get(value);
    if (!scrollEl || !activeTab) return;
    setIndicator({
      left: activeTab.offsetLeft - scrollEl.scrollLeft,
      width: activeTab.offsetWidth
    });
  }, [value]);

  useLayoutEffect(() => {
    const activeTab = tabRefs.current.get(value);
    activeTab?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    updateIndicator();
  }, [value, updateIndicator]);

  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const onScroll = () => updateIndicator();
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", updateIndicator);
    return () => {
      scrollEl.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", updateIndicator);
    };
  }, [updateIndicator]);

  return (
    <div className="relative w-full overflow-hidden rounded-lg bg-[#edf2f2] p-0.5">
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0.5 top-0.5 rounded-md bg-white shadow-[0_2px_8px_rgba(25,65,68,.1)] transition-[left,width] duration-200 ease-out"
        style={{ left: indicator.left, width: indicator.width }}
      />
      <div
        ref={scrollRef}
        className="relative flex snap-x snap-mandatory overflow-x-auto scroll-smooth scrollbar-thin [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#c5d0d0]"
        role="tablist"
        aria-label="Climate variable"
      >
        {VARIABLE_OPTIONS.map((option) => {
          const active = value === option.id;
          return (
            <button
              key={option.id}
              ref={(node) => {
                if (node) tabRefs.current.set(option.id, node);
                else tabRefs.current.delete(option.id);
              }}
              type="button"
              role="tab"
              aria-selected={active}
              className={`relative z-10 shrink-0 snap-start cursor-pointer border-0 bg-transparent px-3 py-2 text-[11px] font-bold leading-tight whitespace-nowrap transition-colors ${
                active ? "text-brand" : "text-muted hover:text-ink"
              }`}
              style={{ width: TAB_WIDTH }}
              onClick={() => onChange(option.id)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
