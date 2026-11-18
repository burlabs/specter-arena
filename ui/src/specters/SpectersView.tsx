import { EmptyState, Panel } from '../observatory/ui';

export function SpectersView() {
  return (
    <Panel label="Specters">
      <EmptyState title="Specters are not part of this build yet" body="Summoning and portraits arrive in a later update. The roster is unchanged." />
    </Panel>
  );
}
