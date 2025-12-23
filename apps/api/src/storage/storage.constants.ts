import { join } from 'node:path';

export const STORAGE_ROOT = join(process.cwd(), 'storage');
export const TEMPLATE_IMAGES_DIR = join(STORAGE_ROOT, 'templates');
export const GENERATION_IMAGES_DIR = join(STORAGE_ROOT, 'generations');
