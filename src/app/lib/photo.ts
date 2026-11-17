/**
 * A picked image as a small square JPEG data: URL (centre-cropped), small enough for one sheet cell.
 * Tries lower quality until it fits `maxChars`.
 */
export async function squarePhoto(file: File, size = 160, maxChars = 40000): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Pick an image file');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error("That image couldn't be opened"));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; // transparent PNGs get a white background, not black
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    for (const q of [0.85, 0.7, 0.55, 0.4]) {
      const data = canvas.toDataURL('image/jpeg', q);
      if (data.length <= maxChars) return data;
    }
    throw new Error('That photo is too detailed; try another one');
  } finally {
    URL.revokeObjectURL(url);
  }
}
