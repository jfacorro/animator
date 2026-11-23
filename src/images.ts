// Reading a picture to trace over: shrunk to a sensible size so projects stay small.
import { fitImage, type RefImage } from './model/aids';

export const MAX_IMAGE_BYTES = 40 * 1024 * 1024;

export function readImageFile(file: File, canvasW: number, canvasH: number): Promise<RefImage> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_IMAGE_BYTES) {
      reject(new Error('That picture is too big. Use one under 40 MB.'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This browser can’t open that picture. Try a PNG or JPEG.'));
    };
    img.onload = () => {
      URL.revokeObjectURL(url);
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      // Keep up to twice the canvas size, so zooming in still looks sharp.
      const s = Math.min(1, (2 * canvasW) / iw, (2 * canvasH) / ih);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(iw * s));
      c.height = Math.max(1, Math.round(ih * s));
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, c.width, c.height);
      // WebP keeps transparency and is small; browsers without it give PNG instead.
      const data = c.toDataURL('image/webp', 0.9);
      resolve({ data, ...fitImage(iw, ih, canvasW, canvasH) });
    };
    img.src = url;
  });
}
