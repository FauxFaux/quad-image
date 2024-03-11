import '@testing-library/jest-dom';
import '@testing-library/jest-dom/jest-globals';

import { describe, test, expect, jest } from '@jest/globals';
import { render, screen } from '@testing-library/preact';
import { Printer, Upload } from '../../web/components/upload';

describe('Upload', () => {
  test('can detect clipboard availability in jsdom', () => {
    const printer = mockPrinter();
    const mockUpload = jest.fn();
    render(<Upload printer={printer} triggerUploads={mockUpload} />);
    expect(
      screen.getByTitle('pull image(s) directly from the clipboard'),
    ).toBeInTheDocument();
  });
});

const mockPrinter = () => {
  return {
    error: jest.fn<Printer['error']>(),
    warn: jest.fn<Printer['warn']>(),
  };
};
