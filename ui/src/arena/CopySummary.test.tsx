import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopySummary } from './CopySummary';

afterEach(() => vi.unstubAllGlobals());

const press = () => fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostic summary' }));

describe('CopySummary', () => {
  it('writes the freshly built text to the clipboard and says it copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const build = vi.fn(() => 'the summary');
    render(<CopySummary build={build} />);
    expect(build).not.toHaveBeenCalled();
    press();
    await waitFor(() => expect(screen.getByText('Copied.')).toBeTruthy());
    expect(writeText).toHaveBeenCalledExactlyOnceWith('the summary');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows the same text in a read-only, focused and selected textarea when the clipboard refuses', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    render(<CopySummary build={() => 'the summary'} />);
    press();
    const area = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Diagnostic summary text' });
    expect(area.readOnly).toBe(true);
    expect(area.value).toBe('the summary');
    expect(document.activeElement).toBe(area);
    expect(area.selectionStart).toBe(0);
    expect(area.selectionEnd).toBe('the summary'.length);
    expect(screen.getByText('Copy was refused. Select the text below.')).toBeTruthy();
  });

  it('falls back the same way when there is no clipboard at all', async () => {
    vi.stubGlobal('navigator', {});
    render(<CopySummary build={() => 'text'} />);
    press();
    expect(await screen.findByRole('textbox', { name: 'Diagnostic summary text' })).toBeTruthy();
  });
});
