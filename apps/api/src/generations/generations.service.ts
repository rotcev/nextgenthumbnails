/* eslint-disable
  @typescript-eslint/no-unsafe-assignment,
  @typescript-eslint/no-unsafe-member-access,
  @typescript-eslint/no-unsafe-call,
  @typescript-eslint/no-unsafe-argument
*/
// This file intentionally consumes untyped JSON from Template.config / multipart DTO JSON strings.
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_USER_ID } from '../bootstrap/bootstrap.constants';
import { CreateGenerationDto } from './dto/create-generation.dto';
import { asPrismaJson } from '../prisma/prisma-json';
import { StorageService } from '../storage/storage.service';
import { ImageGenerationService } from '../image-generation/image-generation.service';
import {
  buildGenerationPrompt,
  buildSpecialBackgroundPassPrompt,
  buildSpecialMainPassPrompt,
  buildSpecialChangeTextPrompt,
} from './generations.prompt';
import sharp from 'sharp';
import { buildEditMaskPng } from '../image-generation/mask-builder';

@Injectable()
export class GenerationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly images: ImageGenerationService,
  ) {}

  async listByClient(clientId: string) {
    await this.assertClientOwned(clientId);
    return this.prisma.generation.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async createFromMultipart(
    clientId: string,
    dto: CreateGenerationDto,
    subjectImages: Express.Multer.File[],
  ) {
    await this.assertClientOwned(clientId);

    const template = await this.prisma.template.findFirst({
      where: { id: dto.templateId, clientId },
    });
    if (!template) throw new NotFoundException('Template not found');

    if (!template.imageUrl)
      throw new BadRequestException('Template has no image yet');

    const subjectSlotIds = safeJsonParseStringArray(dto.subjectSlotIdsJson);
    const texts = safeJsonParseTexts(dto.textsJson);
    const customizations = safeJsonParseObject(dto.customizationsJson);
    const userNotes = sanitizeUserNotes(dto.userNotes);

    const templateConfig = (template.config as any) ?? {};
    const knownSlotIds = new Set<string>(
      Array.isArray(templateConfig?.subjectSlots)
        ? templateConfig.subjectSlots
            .map((s: any) => String(s?.id ?? '').trim())
            .filter(Boolean)
        : [],
    );
    const requiredSlotIds = new Set<string>(
      Array.isArray(templateConfig?.formSchema?.subjectSlots)
        ? templateConfig.formSchema.subjectSlots
            .filter((s: any) => Boolean(s?.required))
            .map((s: any) => String(s?.id ?? '').trim())
            .filter(Boolean)
        : [],
    );
    const knownTextKeys = new Set<string>(
      Array.isArray(templateConfig?.formSchema?.textFields)
        ? templateConfig.formSchema.textFields
            .map((t: any) => String(t?.key ?? '').trim())
            .filter(Boolean)
        : Array.isArray(templateConfig?.textRegions)
          ? templateConfig.textRegions
              .map((t: any) => String(t?.key ?? '').trim())
              .filter(Boolean)
          : [],
    );
    const requiredTextKeys = new Set<string>(
      Array.isArray(templateConfig?.formSchema?.textFields)
        ? templateConfig.formSchema.textFields
            .filter((t: any) => Boolean(t?.required))
            .map((t: any) => String(t?.key ?? '').trim())
            .filter(Boolean)
        : [],
    );

    const allowedCustomizationIds = new Set<string>(
      Array.isArray(templateConfig?.formSchema?.customizations)
        ? templateConfig.formSchema.customizations
            .map((c: any) => String(c?.id ?? '').trim())
            .filter(Boolean)
        : [],
    );

    const seen = new Set<string>();
    const dup = subjectSlotIds.find((id) =>
      seen.has(id) ? true : (seen.add(id), false),
    );
    if (dup) throw new BadRequestException(`Duplicate subject slot ID: ${dup}`);

    const unknownSlot = subjectSlotIds.find((id) => !knownSlotIds.has(id));
    if (unknownSlot) {
      throw new BadRequestException(`Unknown subject slot ID: ${unknownSlot}`);
    }

    if (subjectSlotIds.length !== subjectImages.length) {
      throw new BadRequestException(
        'subjectSlotIdsJson length must match number of uploaded subjectImages',
      );
    }

    const missingSlots = [...requiredSlotIds].filter(
      (id) => !subjectSlotIds.includes(id),
    );
    if (missingSlots.length) {
      throw new BadRequestException(
        `Missing required subject uploads: ${missingSlots.join(', ')}`,
      );
    }

    const incomingTextByKey = new Map(
      texts.map((t) => [t.key, (t.value ?? '').trim()]),
    );
    const unknownText = texts.find((t) => !knownTextKeys.has(t.key));
    if (unknownText) {
      throw new BadRequestException(`Unknown text key: ${unknownText.key}`);
    }
    const missingText = [...requiredTextKeys].filter(
      (k) => !(incomingTextByKey.get(k) ?? '').trim(),
    );
    if (missingText.length) {
      throw new BadRequestException(
        `Missing required text: ${missingText.join(', ')}`,
      );
    }

    const unknownCustomization = Object.keys(customizations).find(
      (id) => !allowedCustomizationIds.has(id),
    );
    if (unknownCustomization) {
      throw new BadRequestException(
        `Unknown customization: ${unknownCustomization}`,
      );
    }

    const generation = await this.prisma.generation.create({
      data: {
        clientId,
        templateId: template.id,
        status: 'running',
        promptPayload: asPrismaJson({
          templateId: template.id,
          subjectSlotIds,
          texts,
          customizations,
          userNotes,
          format: dto.format ?? 'png',
        }),
      },
    });

    try {
      const templateAbsPath = resolveStorageAbsPath(template.imageUrl);
      await readFile(templateAbsPath); // fail fast if missing

      const subjectAbsPaths: string[] = [];
      const subjectAbsPathBySlotId = new Map<string, string>();
      for (let i = 0; i < subjectImages.length; i++) {
        const slotId = subjectSlotIds[i];
        const file = subjectImages[i];
        const enhancedBytes = await enhanceSubjectImageBytes(file.buffer);
        const saved = await this.storage.saveTempSubjectImage(
          generation.id,
          slotId,
          // We may re-encode/upscale, so use a stable name for extension choice.
          'subject.png',
          enhancedBytes,
        );
        subjectAbsPaths.push(saved.absPath);
        subjectAbsPathBySlotId.set(slotId, saved.absPath);
      }

      const isSpecial = Boolean((template as any).isSpecial);
      const polygonsRaw = templateConfig?.polygons;
      const polygons = Array.isArray(polygonsRaw) ? polygonsRaw : [];

      const bytes =
        isSpecial && polygons.length
          ? await this.generateSpecialWithMasks({
              template,
              templateAbsPath,
              generationId: generation.id,
              polygons,
              subjectAbsPathBySlotId,
              texts,
              userNotes,
              outputFormat: dto.format ?? 'png',
            })
          : await this.images.generateFromTemplate({
              model: 'gpt-image-1.5',
              prompt: buildGenerationPrompt({
                template,
                reconstructionPrompt: template.reconstructionPrompt,
                subjectSlotIds,
                texts,
                customizations,
                userNotes,
              }),
              size: '1536x1024',
              quality: 'high',
              inputFidelity: 'high',
              templateImageAbsPath: templateAbsPath,
              subjectImageAbsPaths: subjectAbsPaths,
              outputFormat: dto.format ?? 'png',
              moderation: 'low',
            });

      const saved = await this.storage.saveGenerationImage(
        generation.id,
        bytes,
      );

      return await this.prisma.generation.update({
        where: { id: generation.id },
        data: { status: 'succeeded', outputUrl: saved.urlPath },
      });
    } catch (err) {
      await this.prisma.generation.update({
        where: { id: generation.id },
        data: { status: 'failed' },
      });
      throw err;
    }
  }

  private async assertClientOwned(clientId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, userId: DEFAULT_USER_ID },
      select: { id: true },
    });
    if (!client) throw new NotFoundException('Client not found');
  }

  private async generateSpecialWithMasks(args: {
    template: any;
    templateAbsPath: string;
    generationId: string;
    polygons: any[];
    subjectAbsPathBySlotId: Map<string, string>;
    texts: Array<{ key: string; value: string }>;
    userNotes: string | null;
    outputFormat: 'png' | 'jpeg' | 'webp';
  }): Promise<Buffer> {
    const {
      template,
      templateAbsPath,
      generationId,
      polygons,
      subjectAbsPathBySlotId,
      texts,
      userNotes,
      outputFormat,
    } = args;

    const bgAbs = subjectAbsPathBySlotId.get('background') ?? null;
    const mainAbs = subjectAbsPathBySlotId.get('main') ?? null;

    let currentBaseAbsPath = await this.ensureSpecialBase1536x1024({
      generationId,
      templateAbsPath,
    });
    let currentBytes: Buffer | null = null;

    const normalizedPolygons = normalizePolygons(polygons);
    const availableLabels = normalizedPolygons.map((p) => p.label);

    // PASS ORDER (SIMPLE + DETERMINISTIC):
    // - background -> main -> final \"Change the text to\" pass
    // This mirrors the workflow that worked well in the ChatGPT app.

    // 1) Background pass
    if (bgAbs && availableLabels.includes('background')) {
      const { width, height } =
        await readImageDimensionsOrThrow(currentBaseAbsPath);
      const maskBytes = await buildEditMaskPng({
        width,
        height,
        polygons: normalizedPolygons,
        includeLabel: (label) => label === 'background',
      });
      const savedMask = await this.storage.saveTempIntermediateImage(
        generationId,
        'mask-background',
        maskBytes,
      );
      const prompt = buildSpecialBackgroundPassPrompt({ template, userNotes });
      const fallbackPrompt = buildSpecialBackgroundPassPrompt({
        template,
        userNotes: null,
      });
      await this.storage.saveTempIntermediateText(
        generationId,
        'prompt-background',
        prompt,
      );
      await this.storage.saveTempIntermediateText(
        generationId,
        'prompt-background-fallback',
        fallbackPrompt,
      );
      currentBytes = await this.runImageEditOrThrow({
        passName: 'background',
        generationId,
        fn: () =>
          this.images.generateFromTemplate({
            model: 'gpt-image-1.5',
            prompt,
            size: '1536x1024',
            quality: 'high',
            inputFidelity: 'high',
            templateImageAbsPath: currentBaseAbsPath,
            subjectImageAbsPaths: [bgAbs],
            maskImageAbsPath: savedMask.absPath,
            outputFormat,
            moderation: 'low',
          }),
        retryOnModerationBlocked: () =>
          this.images.generateFromTemplate({
            model: 'gpt-image-1.5',
            prompt: fallbackPrompt,
            size: '1536x1024',
            quality: 'high',
            inputFidelity: 'high',
            templateImageAbsPath: currentBaseAbsPath,
            subjectImageAbsPaths: [bgAbs],
            maskImageAbsPath: savedMask.absPath,
            outputFormat,
            moderation: 'low',
          }),
      });
      const saved = await this.storage.saveTempIntermediateImage(
        generationId,
        'pass-1-background',
        currentBytes,
      );
      currentBaseAbsPath = saved.absPath;
    }

    // 2) Main subject pass
    if (mainAbs && availableLabels.includes('main')) {
      const { width, height } =
        await readImageDimensionsOrThrow(currentBaseAbsPath);
      const maskBytes = await buildEditMaskPng({
        width,
        height,
        polygons: normalizedPolygons,
        includeLabel: (label) => label === 'main',
      });
      const savedMask = await this.storage.saveTempIntermediateImage(
        generationId,
        'mask-main',
        maskBytes,
      );
      const prompt = buildSpecialMainPassPrompt({ template, userNotes });
      const fallbackPrompt = buildSpecialMainPassPrompt({
        template,
        userNotes: null,
      });
      await this.storage.saveTempIntermediateText(
        generationId,
        'prompt-main',
        prompt,
      );
      await this.storage.saveTempIntermediateText(
        generationId,
        'prompt-main-fallback',
        fallbackPrompt,
      );
      currentBytes = await this.runImageEditOrThrow({
        passName: 'main',
        generationId,
        fn: () =>
          this.images.generateFromTemplate({
            model: 'gpt-image-1.5',
            prompt,
            size: '1536x1024',
            quality: 'high',
            inputFidelity: 'high',
            templateImageAbsPath: currentBaseAbsPath,
            subjectImageAbsPaths: [mainAbs],
            maskImageAbsPath: savedMask.absPath,
            outputFormat,
            moderation: 'low',
          }),
        retryOnModerationBlocked: () =>
          this.images.generateFromTemplate({
            model: 'gpt-image-1.5',
            prompt: fallbackPrompt,
            size: '1536x1024',
            quality: 'high',
            inputFidelity: 'high',
            templateImageAbsPath: currentBaseAbsPath,
            subjectImageAbsPaths: [mainAbs],
            maskImageAbsPath: savedMask.absPath,
            outputFormat,
            moderation: 'low',
          }),
      });
      const saved = await this.storage.saveTempIntermediateImage(
        generationId,
        'pass-2-main',
        currentBytes,
      );
      currentBaseAbsPath = saved.absPath;
    }

    // 3) Final text pass: \"Change the text to\" (single `text` polygon recommended; auto fallback if none)
    if (texts.length) {
      const [line1, line2] = extractTwoLineText(template, texts);
      const prompt = buildSpecialChangeTextPrompt({
        template,
        line1,
        line2,
        userNotes,
      });
      await this.storage.saveTempIntermediateText(
        generationId,
        'prompt-text',
        prompt,
      );

      currentBytes = await this.runImageEditOrThrow({
        passName: 'text',
        generationId,
        fn: () =>
          this.images.generateFromTemplate({
            model: 'gpt-image-1.5',
            prompt,
            size: '1536x1024',
            quality: 'high',
            inputFidelity: 'high',
            templateImageAbsPath: currentBaseAbsPath,
            subjectImageAbsPaths: [],
            outputFormat,
            moderation: 'low',
          }),
      });
      await this.storage.saveTempIntermediateImage(
        generationId,
        'pass-3-text',
        currentBytes,
      );
    }

    // If no passes ran, fall back to the base template (shouldn't happen if polygons exist).
    if (!currentBytes) {
      const slotIds = [...subjectAbsPathBySlotId.keys()].sort();
      throw new BadRequestException(
        [
          'Special template masks were configured but no valid mask passes ran.',
          `Uploaded slots: ${slotIds.join(', ') || '(none)'}`,
          `Polygon labels found: ${availableLabels.join(', ') || '(none)'}`,
          'Expected at least one of: background, main, text:<key> (or text for all text).',
          'Tip: label your polygons exactly as above in the Advanced tab.',
        ].join(' '),
      );
    }

    return currentBytes;
  }

  private async ensureSpecialBase1536x1024(args: {
    generationId: string;
    templateAbsPath: string;
  }) {
    const { generationId, templateAbsPath } = args;
    const meta = await sharp(templateAbsPath).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w === 1536 && h === 1024) return templateAbsPath;

    // Temporary compatibility: if the template isn't already 1536x1024, rescale it deterministically.
    // We use `fit: "fill"` so existing polygon percent coordinates still align (no crop/pad offsets).
    const bytes = await sharp(templateAbsPath)
      .rotate()
      .resize(1536, 1024, { fit: 'fill' })
      .png()
      .toBuffer();

    const saved = await this.storage.saveTempIntermediateImage(
      generationId,
      'base-1536x1024',
      bytes,
    );
    return saved.absPath;
  }

  private async runImageEditOrThrow<T>(args: {
    generationId: string;
    passName: 'background' | 'text' | 'main';
    fn: () => Promise<T>;
    retryOnModerationBlocked?: () => Promise<T>;
  }): Promise<T> {
    const { generationId, passName, fn, retryOnModerationBlocked } = args;
    try {
      return await fn();
    } catch (err: any) {
      const code = String(err?.code ?? err?.error?.code ?? '').trim();
      if (code === 'moderation_blocked' && retryOnModerationBlocked) {
        try {
          return await retryOnModerationBlocked();
        } catch (retryErr: any) {
          // Fall through and throw the most actionable details from the retry attempt.
          err = retryErr;
        }
      }
      const requestId = String(
        err?.requestID ??
          err?.error?.requestID ??
          err?.headers?.get?.('x-request-id') ??
          '',
      ).trim();
      const msg = String(err?.error?.message ?? err?.message ?? '').trim();
      // Make the cause obvious in the API response.
      throw new BadRequestException(
        [
          `OpenAI image edit failed during special-template pass=${passName} (generationId=${generationId}).`,
          requestId ? `requestId=${requestId}.` : null,
          code ? `code=${code}.` : null,
          msg ? `message=${msg}` : null,
        ]
          .filter(Boolean)
          .join(' '),
      );
    }
  }
}

function resolveStorageAbsPath(urlPath: string) {
  // urlPath looks like: /storage/templates/<file>
  const clean = urlPath.replace(/^\/storage\//, '');
  return join(process.cwd(), 'storage', clean);
}

function safeJsonParseStringArray(text: string): string[] {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function safeJsonParseTexts(
  text: string,
): Array<{ key: string; value: string }> {
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => ({
        key: String(x?.key ?? ''),
        value: String(x?.value ?? ''),
      }))
      .filter((x) => x.key.length > 0);
  } catch {
    return [];
  }
}

function safeJsonParseObject(text?: string): Record<string, unknown> {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function sanitizeUserNotes(value?: string) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  // Keep it short and "minor edits only" to avoid prompt injection and runaway changes.
  return text.slice(0, 500);
}

async function enhanceSubjectImageBytes(bytes: Buffer) {
  // Goal: improve identity fidelity by ensuring we upload a reasonably high-res subject reference.
  // This is local compute (no extra model calls).
  try {
    const img = sharp(bytes).rotate();
    const meta = await img.metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (!w || !h) return bytes;

    const minDim = Math.min(w, h);
    // If already decent resolution, keep as-is to avoid unnecessary re-encoding.
    if (minDim >= 1024) return bytes;

    const scale = 1024 / minDim;
    const newW = Math.max(1, Math.round(w * scale));
    const newH = Math.max(1, Math.round(h * scale));
    return await img.resize(newW, newH, { fit: 'fill' }).png().toBuffer();
  } catch {
    return bytes;
  }
}

function hasPolygonLabel(polygons: any[], label: string) {
  const target = label.trim().toLowerCase();
  return polygons.some(
    (p) =>
      String(p?.label ?? '')
        .trim()
        .toLowerCase() === target,
  );
}

function normalizePolygons(
  polygons: any[],
): Array<{ label: string; points: Array<{ xPct: number; yPct: number }> }> {
  const out: Array<{
    label: string;
    points: Array<{ xPct: number; yPct: number }>;
  }> = [];
  for (const raw of polygons ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    const label = normalizePolygonLabel(raw.label);
    const points = Array.isArray(raw.points) ? raw.points : [];
    if (!label || points.length < 3) continue;
    out.push({ label, points });
  }
  return out;
}

function normalizePolygonLabel(value: unknown) {
  const s = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!s) return '';
  // Common aliases to reduce footguns.
  if (
    s === 'background image' ||
    s === 'background photo' ||
    s === 'bg' ||
    s === 'background_scene'
  ) {
    return 'background';
  }
  if (
    s === 'main subject' ||
    s === 'subject' ||
    s === 'foreground' ||
    s === 'fg' ||
    s === 'person'
  ) {
    return 'main';
  }
  // Allow either "text" (meaning all text) or "text:<key>" for keyed regions.
  if (s === 'text') return 'text';
  if (s.startsWith('text:')) return s;
  return s;
}

async function readImageDimensionsOrThrow(absPath: string) {
  const meta = await sharp(absPath).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) {
    throw new BadRequestException(
      `Failed to read image dimensions for mask generation (${absPath})`,
    );
  }
  return { width, height };
}

function extractTwoLineText(
  template: any,
  texts: Array<{ key: string; value: string }>,
): [string, string] {
  const config = template?.config ?? {};
  const fields = Array.isArray(config?.formSchema?.textFields)
    ? (config.formSchema.textFields as any[])
    : Array.isArray(config?.textRegions)
      ? (config.textRegions as any[]).map((r) => ({ key: r?.key }))
      : [];

  const keys = fields.map((f) => String(f?.key ?? '').trim()).filter(Boolean);

  const byKey = new Map(
    texts.map((t) => [String(t.key ?? '').trim(), String(t.value ?? '')]),
  );

  const line1Key = keys[0] ?? texts[0]?.key ?? '';
  const line2Key = keys[1] ?? texts[1]?.key ?? '';

  const line1 = String(byKey.get(line1Key) ?? texts[0]?.value ?? '').trimEnd();
  const line2 = String(byKey.get(line2Key) ?? texts[1]?.value ?? '').trimEnd();

  return [line1, line2];
}

function buildAutoTextPolygonFromAnalysis(
  template: any,
  _polygons: Array<{
    label: string;
    points: Array<{ xPct: number; yPct: number }>;
  }>,
) {
  const block = template?.reconstructionSpec?.textRegions?.block;
  const centered = Boolean(block?.centered);
  const widthPct = Number(block?.widthPct);
  const topPct = Number(block?.topPct);
  const bottomPct = Number(block?.bottomPct);

  const hasExtents =
    Number.isFinite(widthPct) &&
    widthPct > 0 &&
    widthPct <= 100 &&
    Number.isFinite(topPct) &&
    Number.isFinite(bottomPct) &&
    topPct >= 0 &&
    bottomPct <= 100 &&
    topPct < bottomPct;

  // Fallback: a conservative top block that covers typical thumbnail text.
  const pad = 2;
  // IMPORTANT: Use analysis-provided centering. Many thumbnails have a top-left banner (not centered).
  const leftPct = hasExtents ? (centered ? (100 - widthPct) / 2 : 2) : 2;
  const rightPct = hasExtents
    ? (centered ? 100 - leftPct : leftPct + widthPct)
    : 98;
  const y0 = hasExtents ? topPct : 2;
  const y1 = hasExtents ? bottomPct : 55;

  const x0 = clampPct(leftPct - pad);
  const x1 = clampPct(rightPct + pad);
  const yy0 = clampPct(y0 - pad);
  const yy1 = clampPct(y1 + pad);

  return {
    label: 'text:auto',
    points: [
      { xPct: x0, yPct: yy0 },
      { xPct: x1, yPct: yy0 },
      { xPct: x1, yPct: yy1 },
      { xPct: x0, yPct: yy1 },
    ],
  };
}

function clampPct(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}
