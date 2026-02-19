import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

export { cloudinary };

export function uploadSlipBuffer(buffer: Buffer, opts?: { folder?: string; publicId?: string }) {
  return new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder: opts?.folder ?? "smart-bill/slips",
          public_id: opts?.publicId,
          resource_type: "image",
        },
        (err, result) => {
          if (err || !result) return reject(err);
          resolve({ secure_url: result.secure_url, public_id: result.public_id });
        }
      )
      .end(buffer);
  });
}

export async function deleteByPublicId(publicId?: string) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
  } catch {
    // เงียบไว้ ไม่ให้พังตอนลบไม่สำเร็จ
  }
}
