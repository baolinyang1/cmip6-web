"use client";

import { useEffect, useId, useRef, useState } from "react";

export type HelpDropdownOption<T extends string> = {
  id: T;
  label: string;
  help: string[];
};

type HelpDropdownProps<T extends string> = {
  options: readonly HelpDropdownOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  id?: string;
};

export default function HelpDropdown<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  id
}: HelpDropdownProps<T>) {
  const autoId = useId();
  const listId = id ?? autoId;
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [helpId, setHelpId] = useState<T | null>(null);

  const selected = options.find((option) => option.id === value) ?? options[0];
  const helpOption = helpId ? options.find((option) => option.id === helpId) : undefined;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setHelpId(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setHelpId(null);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="help-dropdown" ref={rootRef}>
      <button
        type="button"
        id={listId}
        className="help-dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${listId}-menu`}
        aria-label={ariaLabel}
        onClick={() => {
          setOpen((current) => !current);
          setHelpId(null);
        }}
      >
        <span>{selected?.label}</span>
        <span className="help-dropdown-caret" aria-hidden>
          ▾
        </span>
      </button>

      {open ? (
        <div className="help-dropdown-menu" id={`${listId}-menu`} role="listbox" aria-label={ariaLabel}>
          {options.map((option) => {
            const active = option.id === value;
            const helpOpen = helpId === option.id;
            return (
              <div
                key={option.id}
                className={`help-dropdown-option${active ? " active" : ""}`}
                role="option"
                aria-selected={active}
              >
                <button
                  type="button"
                  className="help-dropdown-option-label"
                  onClick={() => {
                    onChange(option.id);
                    setOpen(false);
                    setHelpId(null);
                  }}
                >
                  {option.label}
                </button>
                <button
                  type="button"
                  className={`help-icon${helpOpen ? " active" : ""}`}
                  aria-label={`Help: ${option.label}`}
                  aria-expanded={helpOpen}
                  title="Help"
                  onClick={(event) => {
                    event.stopPropagation();
                    setHelpId((current) => (current === option.id ? null : option.id));
                  }}
                >
                  ?
                </button>
              </div>
            );
          })}
          {helpOption ? (
            <div className="control-help help-dropdown-help" role="region" aria-label={`${helpOption.label} help`}>
              {helpOption.help.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
