import { Injectable } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import {
  GENERATION_IMAGES_DIR,
  TEMPLATE_IMAGES_DIR,
} from './storage.constants';

@Injectable()
export class StorageService {
  async saveTemplateImage(
    templateId: string,
    originalName: string,
    bytes: Buffer,
  ) {
    await mkdir(TEMPLATE_IMAGES_DIR, { recursive: true });

    const extension = extname(originalName).toLowerCase() || '.png';
    const fileName = `${templateId}${extension}`;
    const absPath = join(TEMPLATE_IMAGES_DIR, fileName);

    await writeFile(absPath, bytes);

    // URL path served via ServeStaticModule, not a full URL.
    return {
      absPath,
      urlPath: `/storage/templates/${fileName}`,
    };
  }

  async saveGenerationImage(generationId: string, bytes: Buffer) {
    await mkdir(GENERATION_IMAGES_DIR, { recursive: true });

    const fileName = `${generationId}.png`;
    const absPath = join(GENERATION_IMAGES_DIR, fileName);
    await writeFile(absPath, bytes);

    return {
      absPath,
      urlPath: `/storage/generations/${fileName}`,
    };
  }

  async saveTempSubjectImage(
    generationId: string,
    slotId: string,
    originalName: string,
    bytes: Buffer,
  ) {
    const dir = join(GENERATION_IMAGES_DIR, generationId, 'subjects');
    await mkdir(dir, { recursive: true });

    const extension = extname(originalName).toLowerCase() || '.png';
    const fileName = `${slotId}${extension}`;
    const absPath = join(dir, fileName);

    await writeFile(absPath, bytes);

    return { absPath };
  }

  async saveTempIntermediateImage(
    generationId: string,
    stepName: string,
    bytes: Buffer,
  ) {
    const dir = join(GENERATION_IMAGES_DIR, generationId, 'intermediate');
    await mkdir(dir, { recursive: true });

    const fileName = `${stepName}.png`;
    const absPath = join(dir, fileName);
    await writeFile(absPath, bytes);

    return { absPath };
  }

  async saveTempIntermediateText(
    generationId: string,
    stepName: string,
    text: string,
  ) {
    const dir = join(GENERATION_IMAGES_DIR, generationId, 'intermediate');
    await mkdir(dir, { recursive: true });

    const fileName = `${stepName}.txt`;
    const absPath = join(dir, fileName);
    await writeFile(absPath, text, 'utf8');

    return { absPath };
  }
}
