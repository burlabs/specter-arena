import type { RefObject } from 'react';
import { Icon } from '../observatory/ui';
import { FILTERS, SORTS } from './collection';
import type { Filter, Sort, ViewState } from './collection';
import { COLLECTION } from './copy';

interface Props {
  view: ViewState;
  onChange: (next: ViewState) => void;
  searchRef: RefObject<HTMLInputElement>;
}

/** Search, Filter and Sort. Native controls, in tab order before the cards; they change what is shown and nothing else. */
export function CollectionToolbar({ view, onChange, searchRef }: Props) {
  return (
    <div className="sa-collection-toolbar">
      <label className="sa-search">
        <Icon name="search" />
        <span className="sa-visually-hidden">{COLLECTION.searchLabel}</span>
        <input
          ref={searchRef}
          type="search"
          value={view.query}
          placeholder={COLLECTION.searchPlaceholder}
          onChange={(event) => onChange({ ...view, query: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && view.query !== '') onChange({ ...view, query: '' });
          }}
        />
      </label>
      <label>
        <span>{COLLECTION.filterLabel}</span>
        <select value={view.filter} onChange={(event) => onChange({ ...view, filter: event.target.value as Filter })}>
          {FILTERS.map((filter) => (
            <option key={filter} value={filter}>
              {COLLECTION.filters[filter]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{COLLECTION.sortLabel}</span>
        <select value={view.sort} onChange={(event) => onChange({ ...view, sort: event.target.value as Sort })}>
          {SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {COLLECTION.sorts[sort]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
