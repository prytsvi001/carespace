// client/src/utils/imagePaste.ts
// Reads a pasted image (Ctrl+V) out of a clipboard event, downscales it via an
// offscreen canvas, and re-encodes as JPEG. Clipboard screenshots are routinely
// multi-MB PNGs, so this resizes/recompresses first rather than rejecting
// oversized pastes outright — a shortcut card preview doesn't need full
// screenshot resolution anyway.
import type { ClipboardEvent } from 'react';

const MAX_DIMENSION = 900;
const JPEG_QUALITY = 0.8;

// Returns the resized image as a data URL, or null if the paste didn't contain
// an image (e.g. plain text was pasted instead).
export async function readPastedImage(e: ClipboardEvent): Promise<string | null> {
  const items = e.clipboardData?.items;
  if (!items) return null;

  let imageFile: File | null = null;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) { imageFile = file; break; }
    }
  }
  if (!imageFile) return null;

  const rawDataUrl = await fileToDataUrl(imageFile);
  return resizeDataUrl(rawDataUrl, MAX_DIMENSION, JPEG_QUALITY);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function resizeDataUrl(dataUrl: string, maxDimension: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        const scale = maxDimension / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(dataUrl); return; } // fall back to the untouched original if canvas is unavailable
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('Failed to load pasted image'));
    img.src = dataUrl;
  });
}
