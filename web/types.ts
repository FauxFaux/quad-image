// e/UVsA2KAc3n.png
export type ImageId = string;

// green!battery staple
export type GallerySecret = string;

// green:z25E-PzBTg
export type GalleryPub = string;

export const plausibleGallerySecret = (secret: GallerySecret) =>
  /^([a-zA-Z][a-zA-Z0-9]{3,9})!(.{4,99})$/.test(secret);
