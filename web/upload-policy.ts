const MiB = 1024 * 1024;

export const shrinkThreshold = MiB;
export const maxUploadBytes = 9 * MiB;
export const initialLossyQuality = 0.9;

export const nextLossyQuality = (quality: number, bytes: number) => {
  if (quality === initialLossyQuality && bytes > 5 * MiB) return 0.5;
  if (quality === 0.5 && bytes > maxUploadBytes) return 0.2;
  return undefined;
};

export const selectUpload = (
  originalBytes: number,
  encodedBytes: number,
  requiresConversion = false,
): 'original' | 'resized' => {
  const originalFits = originalBytes <= maxUploadBytes;
  if (
    encodedBytes <= maxUploadBytes &&
    (requiresConversion || !originalFits || encodedBytes <= originalBytes * 0.9)
  ) {
    return 'resized';
  }
  if (originalFits && !requiresConversion) return 'original';
  throw new Error('Image cannot be reduced below the 9 MiB upload limit');
};
