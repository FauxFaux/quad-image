export async function getGallery(
  gallery: string,
): Promise<{ id: string; type: 'image' }[]> {
  const resp = await fetch(`/api/gallery/${gallery}`);
  const body: any = await resp.json();
  if (!body?.data) {
    throw new Error(`missing data in response: ${JSON.stringify(body)}`);
  }

  return body.data;
}

export async function putGallery(gallery: string, images: string[]) {
  const resp = await fetch('/api/gallery', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        type: 'gallery',
        attributes: {
          gallery,
          images,
        },
      },
    }),
  });
  if (!resp.ok) {
    throw new Error(`failed to call gallery: ${resp.status}`);
  }
  const body: any = await resp.json();
  if (!body?.data) {
    throw new Error(`missing data in response: ${JSON.stringify(body)}`);
  }

  return body.data;
}
