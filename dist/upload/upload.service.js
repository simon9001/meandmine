import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';
import { BadRequestError } from '../utils/errors.js';
cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
});
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export async function uploadProductImage(file, productId) {
    if (file.size > MAX_FILE_SIZE)
        throw new BadRequestError('Image must be under 10MB');
    if (!file.type.startsWith('image/'))
        throw new BadRequestError('File must be an image');
    const buffer = Buffer.from(await file.arrayBuffer());
    const b64 = `data:${file.type};base64,${buffer.toString('base64')}`;
    const result = await cloudinary.uploader.upload(b64, {
        folder: `maschon/products/${productId}`,
        resource_type: 'image',
        transformation: [{ width: 1200, height: 1200, crop: 'limit', quality: 'auto', fetch_format: 'auto' }],
    });
    return {
        publicId: result.public_id,
        url: result.secure_url,
        width: result.width,
        height: result.height,
        format: result.format,
        bytes: result.bytes,
    };
}
export async function uploadReviewImage(file, reviewId) {
    if (file.size > MAX_FILE_SIZE)
        throw new BadRequestError('Image must be under 10MB');
    if (!file.type.startsWith('image/'))
        throw new BadRequestError('File must be an image');
    const buffer = Buffer.from(await file.arrayBuffer());
    const b64 = `data:${file.type};base64,${buffer.toString('base64')}`;
    const result = await cloudinary.uploader.upload(b64, {
        folder: `maschon/reviews/${reviewId}`,
        resource_type: 'image',
        transformation: [{ width: 800, height: 800, crop: 'limit', quality: 'auto', fetch_format: 'auto' }],
    });
    return { publicId: result.public_id, url: result.secure_url };
}
export async function uploadProductMediaImage(file) {
    if (file.size > MAX_FILE_SIZE)
        throw new BadRequestError('Image must be under 10MB');
    if (!file.type.startsWith('image/'))
        throw new BadRequestError('File must be an image');
    const buffer = Buffer.from(await file.arrayBuffer());
    const b64 = `data:${file.type};base64,${buffer.toString('base64')}`;
    const result = await cloudinary.uploader.upload(b64, {
        folder: 'maschon/products',
        resource_type: 'image',
        transformation: [{ width: 1200, height: 1200, crop: 'limit', quality: 'auto', fetch_format: 'auto' }],
    });
    return { publicId: result.public_id, url: result.secure_url };
}
export async function uploadCategoryImage(file) {
    if (file.size > MAX_FILE_SIZE)
        throw new BadRequestError('Image must be under 10MB');
    if (!file.type.startsWith('image/'))
        throw new BadRequestError('File must be an image');
    const buffer = Buffer.from(await file.arrayBuffer());
    const b64 = `data:${file.type};base64,${buffer.toString('base64')}`;
    const result = await cloudinary.uploader.upload(b64, {
        folder: 'maschon/categories',
        resource_type: 'image',
        transformation: [{ width: 800, height: 600, crop: 'fill', gravity: 'auto', quality: 'auto', fetch_format: 'auto' }],
    });
    return { publicId: result.public_id, url: result.secure_url };
}
export async function uploadAvatarImage(file, userId) {
    if (file.size > MAX_FILE_SIZE)
        throw new BadRequestError('Image must be under 10MB');
    if (!file.type.startsWith('image/'))
        throw new BadRequestError('File must be an image');
    const buffer = Buffer.from(await file.arrayBuffer());
    const b64 = `data:${file.type};base64,${buffer.toString('base64')}`;
    const result = await cloudinary.uploader.upload(b64, {
        folder: `maschon/avatars/${userId}`,
        public_id: 'avatar',
        overwrite: true,
        resource_type: 'image',
        transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face', quality: 'auto', fetch_format: 'auto' }],
    });
    return { publicId: result.public_id, url: result.secure_url };
}
export async function uploadPromotionImage(file) {
    if (file.size > MAX_FILE_SIZE)
        throw new BadRequestError('Image must be under 10MB');
    if (!file.type.startsWith('image/'))
        throw new BadRequestError('File must be an image');
    const buffer = Buffer.from(await file.arrayBuffer());
    const b64 = `data:${file.type};base64,${buffer.toString('base64')}`;
    const result = await cloudinary.uploader.upload(b64, {
        folder: 'maschon/promotions',
        resource_type: 'image',
        transformation: [{ width: 1920, height: 900, crop: 'limit', quality: 'auto', fetch_format: 'auto' }],
    });
    return { publicId: result.public_id, url: result.secure_url };
}
export async function deleteImage(publicId) {
    await cloudinary.uploader.destroy(publicId);
}
