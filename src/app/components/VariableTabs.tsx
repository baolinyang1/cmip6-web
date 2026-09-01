"use client";

import SlidingTabs from "./SlidingTabs";
import { VARIABLE_OPTIONS, type Variable } from "./chartTraces";

type VariableTabsProps = {
  value: Variable;
  onChange: (variable: Variable) => void;
};

export default function VariableTabs({ value, onChange }: VariableTabsProps) {
  return (
    <SlidingTabs
      options={VARIABLE_OPTIONS}
      value={value}
      onChange={onChange}
      ariaLabel="Climate variable"
      tabWidth="10.5rem"
    />
  );
}
