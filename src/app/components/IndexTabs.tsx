"use client";

import SlidingTabs from "./SlidingTabs";
import { INDEX_OPTIONS, type ClimateIndex } from "./indexTraces";

type IndexTabsProps = {
  value: ClimateIndex;
  onChange: (index: ClimateIndex) => void;
};

export default function IndexTabs({ value, onChange }: IndexTabsProps) {
  return (
    <SlidingTabs
      options={INDEX_OPTIONS}
      value={value}
      onChange={onChange}
      ariaLabel="Climate indices"
      tabWidth="8.25rem"
    />
  );
}
