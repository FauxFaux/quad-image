import { describe, test, vi } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { Printer, Upload } from '../../web/components/upload';

describe('Upload', () => {
  test('can detect clipboard availability in jsdom', () => {
    const printer = mockPrinter();
    const mockUpload = vi.fn();
    render(<Upload printer={printer} triggerUploads={mockUpload} />);
    // throws on absent
    screen.getByTitle('pull image(s) directly from the clipboard');
  });
});

const mockPrinter = () => {
  return {
    error: vi.fn<Printer['error']>(),
    warn: vi.fn<Printer['warn']>(),
  };
};
