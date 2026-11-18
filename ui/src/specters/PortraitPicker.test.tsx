import { setSpecterScenario } from '@kirocrew/app-sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAssetCache } from './assetCache';
import { MAX_UPLOAD_BYTES, PortraitPicker } from './PortraitPicker';

beforeEach(() => {
  clearAssetCache();
  setSpecterScenario('specters-none');
});

function setup(currentAssetId: string | null = null) {
  const onApply = vi.fn();
  const onCancel = vi.fn();
  render(<PortraitPicker currentAssetId={currentAssetId} busy={false} onApply={onApply} onCancel={onCancel} />);
  return { onApply, onCancel };
}

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const fileInput = () => screen.getByLabelText(/^Upload a PNG/) as HTMLInputElement;
const choose = (file: File) => fireEvent.change(fileInput(), { target: { files: [file] } });

describe('PortraitPicker upload', () => {
  it('rejects a non-PNG type before any request', async () => {
    setup();
    await screen.findByRole('radiogroup');
    choose(new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Only PNG images can be used.');
  });

  it('rejects an image over 1 MB before any request', async () => {
    setup();
    await screen.findByRole('radiogroup');
    choose(new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], 'big.png', { type: 'image/png' }));
    expect((await screen.findByRole('alert')).textContent).toBe('That image is larger than 1 MB.');
  });

  it('shows the server words when a file named .png is not a PNG', async () => {
    setup();
    await screen.findByRole('radiogroup');
    choose(new File(['hello'], 'notes.png', { type: 'image/png' }));
    expect((await screen.findByRole('alert')).textContent).toBe('That file is not a valid PNG image the app can use.');
  });

  it('adds an uploaded PNG to the gallery, selects it and applies it', async () => {
    const { onApply } = setup();
    await screen.findByRole('radiogroup');
    choose(new File([new Uint8Array(PNG_HEAD)], 'my <face>.png', { type: 'image/png' }));
    const radio = await screen.findByRole('radio', { name: /my face/ });
    await waitFor(() => expect((radio as HTMLInputElement).checked).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith((radio as HTMLInputElement).value);
  });

  it('uses no label when the file name leaves nothing usable', async () => {
    setup();
    await screen.findByRole('radiogroup');
    choose(new File([new Uint8Array(PNG_HEAD)], '<>.png', { type: 'image/png' }));
    expect(await screen.findByRole('radio', { name: /Uploaded portrait/ })).toBeTruthy();
  });

  it('ignores an empty selection', async () => {
    setup();
    await screen.findByRole('radiogroup');
    fireEvent.change(fileInput(), { target: { files: [] } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports an unreadable file as a failed upload', async () => {
    setup();
    await screen.findByRole('radiogroup');
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      queueMicrotask(() => this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>));
    });
    choose(new File([new Uint8Array(PNG_HEAD)], 'a.png', { type: 'image/png' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not reach the app backend. Nothing was changed.');
    vi.restoreAllMocks();
  });

  it('applies null for No portrait and calls Cancel', async () => {
    const { onApply, onCancel } = setup('ast_current');
    await screen.findByRole('radiogroup');
    fireEvent.click(screen.getByRole('radio', { name: /No portrait/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
