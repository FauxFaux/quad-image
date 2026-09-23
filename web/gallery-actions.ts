import ensureError from 'ensure-error';

import { putGallery } from './locket/client';
import type { GalleryAddResult } from './components/sign-in';

export function removeSelectedImages(
  images: string[],
  selected: ReadonlySet<string>,
): string[] {
  return images.filter((image) => !selected.has(image));
}

export async function addImagesToGallery(
  gallery: string,
  images: string[],
  galleryPut = putGallery,
): Promise<GalleryAddResult> {
  const results = await Promise.allSettled(
    images.map(async (image) => ({
      image,
      gallery: await galleryPut(gallery, [image]),
    })),
  );

  const failures: GalleryAddResult['failures'] = [];
  let added = 0;
  let publicGallery: string | undefined;
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      added++;
      publicGallery = result.value.gallery.id;
    } else {
      failures.push({
        image: images[index],
        error: ensureError(result.reason).message,
      });
    }
  });
  return { added, publicGallery, failures };
}
