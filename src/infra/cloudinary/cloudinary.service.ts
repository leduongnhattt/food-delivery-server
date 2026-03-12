import { createHash } from 'crypto';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024; // 5MB

export interface CloudinaryUploadOptions {
  folder?: string;
  maxBytes?: number;
}

/**
 * Uploads a buffer to Cloudinary. Requires CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.
 */
export async function uploadBufferToCloudinary(
  buffer: Buffer,
  mimeType: string,
  options: CloudinaryUploadOptions = {},
): Promise<string> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary is not configured');
  }

  if (!ALLOWED_MIME.includes(mimeType)) {
    throw new Error('Unsupported file type');
  }

  const maxBytes = options.maxBytes ?? MAX_BYTES;
  if (buffer.byteLength > maxBytes) {
    throw new Error('File too large');
  }

  const folder = options.folder ?? 'reviews';
  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
  const signature = createHash('sha1').update(paramsToSign).digest('hex');

  const formData = new FormData();
  formData.append('file', `data:${mimeType};base64,${buffer.toString('base64')}`);
  formData.append('api_key', apiKey);
  formData.append('timestamp', String(timestamp));
  formData.append('signature', signature);
  formData.append('folder', folder);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    { method: 'POST', body: formData },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Upload to cloud failed');
  }

  const data = (await res.json()) as { secure_url?: string };
  if (!data.secure_url) {
    throw new Error('Cloud upload missing URL');
  }
  return data.secure_url;
}
