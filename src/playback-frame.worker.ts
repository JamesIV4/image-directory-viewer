self.onmessage = async ({ data: url }: MessageEvent<string>) => {
  let bitmap: ImageBitmap | undefined;
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('Frame unavailable');
    bitmap = await createImageBitmap(await response.blob());
    self.postMessage({ bitmap }, { transfer: [bitmap] });
  } catch {
    bitmap?.close();
    self.postMessage({ bitmap: null });
  }
};
