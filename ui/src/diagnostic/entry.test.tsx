// SPECTER-DIAGNOSTIC-ONLY
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DECLARED_API, isPathPermitted } from '../../fixtures/api-allowlist';
import { makeCell, makeSnapshot } from './components/testData';
import DiagnosticEntry from './entry';
import { DIAGNOSTIC_MARKER } from './model';

const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@kirocrew/app-sdk', () => ({ useAppApi: () => client }));

const SNAPSHOT = makeSnapshot({ cells: [makeCell({ question: 'Does the synthetic probe answer?' })] });
const notFound = () => new Error('Request failed with status 404');

beforeEach(() => {
  client.get.mockReset();
  client.post.mockReset();
  client.get.mockResolvedValue(SNAPSHOT);
  client.post.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('DiagnosticEntry', () => {
  it('fetches the probe snapshot and hands it to the page', async () => {
    render(<DiagnosticEntry />);
    expect(await screen.findByText('Does the synthetic probe answer?')).toBeTruthy();
    expect(client.get).toHaveBeenCalledWith('/apps/specter-arena/api/probe/snapshot');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('No snapshot loaded.')).toBeNull();
  });

  it('only calls paths the release manifest permits', async () => {
    render(<DiagnosticEntry />);
    await screen.findByText('Does the synthetic probe answer?');
    fireEvent.click(screen.getByRole('button', { name: 'Run probe steps' }));
    await waitFor(() => expect(client.post).toHaveBeenCalled());
    for (const [path] of [...client.get.mock.calls, ...client.post.mock.calls]) {
      expect(isPathPermitted(DECLARED_API, new URL(path, 'http://localhost').pathname)).toBe(true);
    }
  });

  it('carries the diagnostic marker at runtime', async () => {
    const { container } = render(<DiagnosticEntry />);
    await screen.findByText('Does the synthetic probe answer?');
    expect(container.querySelector(`[data-specter-diagnostic="${DIAGNOSTIC_MARKER}"]`)).not.toBeNull();
  });

  it('passes a null snapshot and "probe routes not enabled" on a 404', async () => {
    client.get.mockRejectedValue(notFound());
    render(<DiagnosticEntry />);
    expect((await screen.findByRole('alert')).textContent).toBe('Could not load the snapshot: probe routes not enabled');
    expect(screen.getByText('No snapshot loaded.')).toBeTruthy();
  });

  it('passes a null snapshot and the error text on a network error', async () => {
    client.get.mockRejectedValue(new Error('network down'));
    render(<DiagnosticEntry />);
    expect((await screen.findByRole('alert')).textContent).toBe('Could not load the snapshot: network down');
    expect(screen.getByText('No snapshot loaded.')).toBeTruthy();
  });

  it('renders a non-Error rejection as text', async () => {
    client.get.mockRejectedValue('offline');
    render(<DiagnosticEntry />);
    expect((await screen.findByRole('alert')).textContent).toBe('Could not load the snapshot: offline');
  });

  it('shows no state message of its own: the page alert is the only one', async () => {
    client.get.mockRejectedValue(notFound());
    const { container } = render(<DiagnosticEntry />);
    await screen.findByRole('alert');
    expect(container.querySelector('form')?.textContent).toBe('Probe bot slugSave probe configRun probe stepsRefresh snapshot');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('saves the probe config with the typed slug, then refreshes the snapshot', async () => {
    render(<DiagnosticEntry />);
    await screen.findByText('Does the synthetic probe answer?');
    fireEvent.change(screen.getByLabelText('Probe bot slug'), { target: { value: 'probe-bot' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save probe config' }));
    await waitFor(() => expect(client.get).toHaveBeenCalledTimes(2));
    expect(client.post).toHaveBeenCalledWith('/apps/specter-arena/api/probe/config', { probeSlug: 'probe-bot' });
  });

  it('runs the probe steps, then refreshes the snapshot', async () => {
    render(<DiagnosticEntry />);
    await screen.findByText('Does the synthetic probe answer?');
    fireEvent.click(screen.getByRole('button', { name: 'Run probe steps' }));
    await waitFor(() => expect(client.get).toHaveBeenCalledTimes(2));
    expect(client.post).toHaveBeenCalledWith('/apps/specter-arena/api/probe/run', {});
  });

  it('keeps the snapshot and reports a failed action through the page', async () => {
    client.post.mockRejectedValue(new Error('Request failed with status 503'));
    render(<DiagnosticEntry />);
    await screen.findByText('Does the synthetic probe answer?');
    fireEvent.click(screen.getByRole('button', { name: 'Run probe steps' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not load the snapshot: Request failed with status 503');
    expect(screen.getByText('Does the synthetic probe answer?')).toBeTruthy();
    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it('clears the load error when a refresh succeeds', async () => {
    client.get.mockRejectedValueOnce(notFound());
    render(<DiagnosticEntry />);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh snapshot' }));
    expect(await screen.findByText('Does the synthetic probe answer?')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
