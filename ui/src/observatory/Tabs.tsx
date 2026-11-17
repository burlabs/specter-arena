import { useRef } from 'react';
import type { KeyboardEvent } from 'react';

export interface TabDefinition<Name extends string> {
  name: Name;
  label: string;
}

interface Props<Name extends string> {
  label: string;
  tabs: ReadonlyArray<TabDefinition<Name>>;
  value: Name;
  panelId: string;
  tabId: (name: Name) => string;
  onChange: (next: Name) => void;
}

/** WAI-ARIA tabs with automatic activation, roving tabindex, arrows, Home and End. */
export function Tabs<Name extends string>({ label, tabs, value, panelId, tabId, onChange }: Props<Name>) {
  const refs = useRef(new Map<Name, HTMLButtonElement>());

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.name === value);
    const last = tabs.length - 1;
    const next =
      event.key === 'ArrowRight' ? (index === last ? 0 : index + 1) : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? last : null;
    const target = next === null ? undefined : tabs[next];
    if (target === undefined) return;
    event.preventDefault();
    onChange(target.name);
    refs.current.get(target.name)?.focus();
  };

  return (
    <div className="sa-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((tab) => (
        <button
          key={tab.name}
          type="button"
          role="tab"
          id={tabId(tab.name)}
          aria-controls={panelId}
          className="sa-tab"
          aria-selected={value === tab.name}
          tabIndex={value === tab.name ? 0 : -1}
          ref={(element) => {
            if (element) refs.current.set(tab.name, element);
            else refs.current.delete(tab.name);
          }}
          onClick={() => onChange(tab.name)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
