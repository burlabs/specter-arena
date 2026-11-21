import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { RosterCollectorV1, RosterItemV1, SpecterV2, XpSummaryV1 } from '../contracts/types';
import type { WorkRowV1 } from '../work/model';
import { Button } from '../observatory/ui';
import { SpecterInspector } from './SpecterInspector';
import { WorkInspector } from './WorkInspector';
import { ARENA, INSPECTOR } from './copy';
import type { SceneModel } from './sceneModel';
import { selectionId } from './selection';
import type { ArenaSelection } from './selection';

interface Props {
  selection: ArenaSelection | null;
  list: SceneModel;
  bots: readonly RosterItemV1[];
  collector: RosterCollectorV1;
  rosterRevision: number;
  specters: ReadonlyMap<string, SpecterV2>;
  xp: ReadonlyMap<string, XpSummaryV1>;
  items: ReadonlyMap<string, WorkRowV1>;
  onSelect: (selection: ArenaSelection) => void;
  onClose: () => void;
  onLedgerChanged: () => void;
  onWorkChanged: () => void;
}

const keyOf = (selection: ArenaSelection | null): string =>
  selection === null ? '' : `${selection.kind}:${selectionId(selection)}:${selection.kind === 'work' ? (selection.decisionId ?? '') : ''}`;

/**
 * The one place the arena shows evidence. It reads, and its only write is the reused in-app decision flow of the Work
 * tab, labelled as such. Opening it moves focus to its heading; Escape or Close puts focus back where the user was.
 */
export function ArenaInspector({ selection, list, bots, collector, rosterRevision, specters, xp, items, onSelect, onClose, onLedgerChanged, onWorkChanged }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const key = keyOf(selection);

  useEffect(() => {
    if (selection === null) {
      if (wasOpen.current && opener.current?.isConnected) opener.current.focus();
      wasOpen.current = false;
      opener.current = null;
      return;
    }
    if (!wasOpen.current) {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
      wasOpen.current = true;
    }
    headingRef.current?.focus();
  }, [key]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || selection === null) return;
    event.stopPropagation();
    onClose();
  };

  let body;
  if (selection === null) {
    body = <p>{ARENA.selectionEmpty}</p>;
  } else if (selection.kind === 'work') {
    body = (
      <WorkInspector
        key={selection.workId}
        workId={selection.workId}
        decisionId={selection.decisionId ?? null}
        headingRef={headingRef}
        list={list}
        bots={bots}
        known={items.get(selection.workId)}
        onClose={onClose}
        onLedgerChanged={onLedgerChanged}
        onWorkChanged={onWorkChanged}
      />
    );
  } else {
    const specter = list.specters.find((candidate) => candidate.bindingId === selection.bindingId);
    const bot = bots.find((candidate) => candidate.bindingId === selection.bindingId);
    body =
      specter === undefined || bot === undefined ? (
        <div className="sa-arena-inspector__body">
          <h2 ref={headingRef} tabIndex={-1}>
            {INSPECTOR.goneTitle}
          </h2>
          <p role="status">{INSPECTOR.goneBody}</p>
          <Button variant="ghost" onClick={onClose}>
            {INSPECTOR.close}
          </Button>
        </div>
      ) : (
        <SpecterInspector
          key={selection.bindingId}
          specter={specter}
          bot={bot}
          record={specters.get(selection.bindingId)}
          summary={xp.get(selection.bindingId)}
          headingRef={headingRef}
          list={list}
          collector={collector}
          rosterRevision={rosterRevision}
          items={items}
          onSelect={onSelect}
          onClose={onClose}
        />
      );
  }

  return (
    <aside className="sa-arena-inspector" aria-label={INSPECTOR.region} onKeyDown={onKeyDown}>
      {body}
    </aside>
  );
}
