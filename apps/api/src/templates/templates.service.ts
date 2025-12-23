import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_USER_ID } from '../bootstrap/bootstrap.constants';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateConfigDto } from './dto/update-template-config.dto';
import { CopyTemplateDto } from './dto/copy-template.dto';
import { asPrismaJson } from '../prisma/prisma-json';
import { StorageService } from '../storage/storage.service';
import { TemplateAnalysisService } from '../template-analysis/template-analysis.service';
import {
  coerceFormSchemaForTemplate,
  deriveFormSchemaFromTemplateConfig,
} from './template-form-schema';

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly analysis: TemplateAnalysisService,
  ) {}

  async listByClient(clientId: string) {
    await this.assertClientOwned(clientId);
    return this.prisma.template.findMany({
      where: { clientId, archivedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async create(clientId: string, dto: CreateTemplateDto) {
    await this.assertClientOwned(clientId);
    return this.prisma.template.create({
      data: {
        clientId,
        name: dto.name,
        imageUrl: dto.imageUrl,
        isSpecial: Boolean(dto.isSpecial),
        config: asPrismaJson(dto.config),
        outputSize: dto.outputSize,
      },
    });
  }

  async getById(id: string) {
    const template = await this.prisma.template.findFirst({
      where: { id, client: { userId: DEFAULT_USER_ID } },
    });
    if (!template) throw new NotFoundException('Template not found');
    return await this.normalizeSpecialTemplateIfNeeded(template);
  }

  async updateConfig(id: string, dto: UpdateTemplateConfigDto) {
    const template = await this.getById(id);
    const existingConfig = template.config ?? {};
    const preservedFormSchema = existingConfig?.formSchema;
    const preservedPolygons = existingConfig?.polygons;
    const nextConfigRaw = {
      ...dto,
      polygons: dto.polygons ?? preservedPolygons,
      ...(template.isSpecial
        ? {
            // Special templates always use exactly two fixed slots.
            subjectSlots: [
              {
                id: 'background',
                label: 'Background image',
                behavior: 'replace',
              },
              { id: 'main', label: 'Main subject', behavior: 'replace' },
            ],
          }
        : null),
    };
    const nextFormSchema =
      preservedFormSchema ??
      deriveFormSchemaFromTemplateConfig(nextConfigRaw as any);
    const coercedFormSchema = coerceFormSchemaForTemplate(
      nextConfigRaw as any,
      nextFormSchema,
    );
    const nextConfig = {
      ...nextConfigRaw,
      formSchema: applySpecialFormSchemaOverrides(
        coercedFormSchema,
        template.isSpecial,
      ),
    };
    return this.prisma.template.update({
      where: { id: template.id },
      data: {
        config: asPrismaJson(nextConfig),
        outputSize: dto.outputSize,
      },
    });
  }

  async copy(templateId: string, dto: CopyTemplateDto) {
    const source = await this.getById(templateId);
    await this.assertClientOwned(dto.targetClientId);

    const reconstructionSpec =
      source.reconstructionSpec === null
        ? undefined
        : asPrismaJson(source.reconstructionSpec);

    return this.prisma.template.create({
      data: {
        clientId: dto.targetClientId,
        name: dto.name ?? `${source.name} (Copy)`,
        imageUrl: source.imageUrl,
        isSpecial: source.isSpecial,
        config: asPrismaJson(source.config),
        reconstructionPrompt: source.reconstructionPrompt,
        reconstructionSpec,
        outputSize: source.outputSize,
      },
    });
  }

  async archive(id: string) {
    const template = await this.getById(id);
    return this.prisma.template.update({
      where: { id: template.id },
      data: { archivedAt: new Date() },
    });
  }

  async rebuildInputsFromReconstructionSpec(id: string) {
    const template = await this.getById(id);
    const existingConfig = template.config ?? {};
    const derivedConfig = deriveConfigFromReconstructionSpec(
      template.reconstructionSpec,
      template.outputSize,
    );
    const nextConfig = applySpecialTemplateOverrides(
      derivedConfig,
      template.isSpecial,
    );
    const formSchema = coerceFormSchemaForTemplate(
      nextConfig,
      existingConfig?.formSchema,
    );
    const nextFormSchema = applySpecialFormSchemaOverrides(
      formSchema,
      template.isSpecial,
    );
    const preservedPolygons = existingConfig?.polygons;

    return this.prisma.template.update({
      where: { id: template.id },
      data: {
        config: asPrismaJson({
          ...nextConfig,
          ...(preservedPolygons ? { polygons: preservedPolygons } : null),
          formSchema: nextFormSchema,
        }),
      },
    });
  }

  async reanalyze(id: string) {
    const template = await this.getById(id);
    if (!template.imageUrl)
      throw new BadRequestException('Template has no image yet');

    // Safety: if analysis isn't configured, don't overwrite working templates with placeholders.
    if (!process.env.OPENAI_API_KEY) {
      throw new BadRequestException(
        'OPENAI_API_KEY is not set; cannot re-analyze template',
      );
    }

    const absPath = this.storagePathFromUrl(template.imageUrl);
    const bytes = await readFile(absPath);
    const mime = guessMimeFromFileName(absPath) ?? 'image/jpeg';
    const dataUrl = `data:${mime};base64,${bytes.toString('base64')}`;

    const analysis = await this.analysis.analyzeTemplateImage(dataUrl);

    const derivedConfig = deriveConfigFromReconstructionSpec(
      analysis.reconstructionSpec,
      template.outputSize,
    );
    const nextConfig = applySpecialTemplateOverrides(
      derivedConfig,
      template.isSpecial,
    );
    const formSchema = coerceFormSchemaForTemplate(
      nextConfig,
      (analysis as any).formSchema,
    );
    const nextFormSchema = applySpecialFormSchemaOverrides(
      formSchema,
      template.isSpecial,
    );
    const existingConfig = template.config ?? {};
    const preservedPolygons = existingConfig?.polygons;

    return this.prisma.template.update({
      where: { id: template.id },
      data: {
        reconstructionPrompt: analysis.reconstructionPrompt,
        reconstructionSpec: asPrismaJson(analysis.reconstructionSpec),
        config: asPrismaJson({
          ...nextConfig,
          ...(preservedPolygons ? { polygons: preservedPolygons } : null),
          formSchema: nextFormSchema,
        }),
      },
    });
  }

  private storagePathFromUrl(urlPath: string) {
    // urlPath looks like: /storage/templates/<file>
    const clean = urlPath.replace(/^\/storage\//, '');
    return `${process.cwd()}/storage/${clean}`;
  }

  async uploadAndAnalyze(
    clientId: string,
    input: {
      name?: string;
      isSpecial?: boolean;
      originalName: string;
      bytes: Buffer;
    },
  ) {
    await this.assertClientOwned(clientId);

    const client = await this.prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { defaults: true },
    });

    const defaultOutputSize =
      (client.defaults as any)?.outputSize ?? ('1536x1080' as const);

    // Draft template created immediately (so the UI can show progress/state)
    const template = await this.prisma.template.create({
      data: {
        clientId,
        name: input.name?.trim() || 'New Template',
        isSpecial: Boolean(input.isSpecial),
        config: asPrismaJson({
          subjectSlots: [],
          textRegions: [],
          outputSize: defaultOutputSize,
        }),
        outputSize: defaultOutputSize,
      },
    });

    const saved = await this.storage.saveTemplateImage(
      template.id,
      input.originalName,
      input.bytes,
    );

    const base64 = input.bytes.toString('base64');
    const mime = guessMimeFromFileName(input.originalName) ?? 'image/png';
    const dataUrl = `data:${mime};base64,${base64}`;

    const analysis = await this.analysis.analyzeTemplateImage(dataUrl);

    const derivedConfig = deriveConfigFromReconstructionSpec(
      analysis.reconstructionSpec,
      defaultOutputSize,
    );
    const nextConfig = applySpecialTemplateOverrides(
      derivedConfig,
      template.isSpecial,
    );
    const formSchema = coerceFormSchemaForTemplate(
      nextConfig,
      (analysis as any).formSchema,
    );
    const nextFormSchema = applySpecialFormSchemaOverrides(
      formSchema,
      template.isSpecial,
    );

    return this.prisma.template.update({
      where: { id: template.id },
      data: {
        imageUrl: saved.urlPath,
        reconstructionPrompt: analysis.reconstructionPrompt,
        reconstructionSpec: asPrismaJson(analysis.reconstructionSpec),
        // If the user hasn't configured anything yet, auto-populate minimal inputs
        // so the Generate screen can immediately show text fields.
        config: asPrismaJson({ ...nextConfig, formSchema: nextFormSchema }),
        outputSize: defaultOutputSize,
      },
    });
  }

  private async assertClientOwned(clientId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, userId: DEFAULT_USER_ID },
      select: { id: true },
    });
    if (!client) throw new NotFoundException('Client not found');
  }

  private async normalizeSpecialTemplateIfNeeded(template: any) {
    if (!template?.isSpecial) return template;

    const cfg = template.config ?? {};
    const slots = Array.isArray(cfg?.subjectSlots) ? cfg.subjectSlots : [];
    const ids = slots
      .map((s: any) => String(s?.id ?? '').trim())
      .filter(Boolean);
    const isAlready =
      ids.length === 2 && ids[0] === 'background' && ids[1] === 'main';
    if (isAlready) return template;

    const outputSize = String(
      cfg?.outputSize ?? template.outputSize ?? '1536x1080',
    );
    const textRegions = Array.isArray(cfg?.textRegions) ? cfg.textRegions : [];
    const nextConfigBase = applySpecialTemplateOverrides(
      { subjectSlots: slots, textRegions, outputSize },
      true,
    );
    const coercedFormSchema = coerceFormSchemaForTemplate(
      nextConfigBase,
      cfg?.formSchema,
    );
    const nextFormSchema = applySpecialFormSchemaOverrides(
      coercedFormSchema,
      true,
    );
    const nextConfig = {
      ...cfg,
      ...nextConfigBase,
      formSchema: nextFormSchema,
    };

    return await this.prisma.template.update({
      where: { id: template.id },
      data: { config: asPrismaJson(nextConfig) },
    });
  }
}

function guessMimeFromFileName(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return null;
}

function deriveConfigFromReconstructionSpec(spec: any, outputSize: string) {
  const subjectCount = inferCount(spec?.subjectSlots);
  const textCount = inferCount(spec?.textRegions);

  const subjectSlots = Array.from({ length: subjectCount }).map((_, i) => ({
    id: `slot_${i + 1}`,
    label:
      subjectCount === 2
        ? i === 0
          ? 'Left subject'
          : 'Right subject'
        : `Subject ${i + 1}`,
    behavior: 'replace',
  }));

  const textRegions = Array.from({ length: textCount }).map((_, i) => ({
    id: `text_${i + 1}`,
    // Default labels should be unopinionated; most thumbnail templates read as stacked text lines.
    label: `Text ${i + 1}`,
    // Keep the key stable for backwards compatibility with existing templates.
    key: i === 0 ? 'title' : `text_${i + 1}`,
    required: true,
  }));

  return {
    subjectSlots,
    textRegions,
    outputSize,
  };
}

function applySpecialTemplateOverrides(
  config: { subjectSlots: any[]; textRegions: any[]; outputSize: string },
  isSpecial: boolean,
) {
  if (!isSpecial) return config;
  return {
    ...config,
    // For "special templates", we intentionally ignore analysis-driven subject slot detection.
    // The user provides exactly two images: one background and one main subject.
    subjectSlots: [
      { id: 'background', label: 'Background image', behavior: 'replace' },
      { id: 'main', label: 'Main subject', behavior: 'replace' },
    ],
  };
}

function applySpecialFormSchemaOverrides(formSchema: any, isSpecial: boolean) {
  if (!isSpecial) return formSchema;
  const base = formSchema && typeof formSchema === 'object' ? formSchema : {};
  return {
    ...base,
    version: 1,
    subjectSlots: [
      {
        label: 'Background image',
        helpText: 'Upload the background/scenery to use behind the overlays.',
      },
      {
        label: 'Main subject',
        helpText:
          'Upload the primary person/object to place in the foreground.',
      },
    ],
  };
}

function inferCount(value: unknown) {
  // Support multiple shapes from analysis:
  // - { count: number }
  // - [{ count: number }, ...]
  // - ["slot description", ...]
  // - [{ position: "...", font: "..." }, ...]
  if (!value) return 0;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const c = Number((value as any).count);
    return Number.isFinite(c) && c > 0 ? c : 0;
  }
  if (Array.isArray(value)) {
    const firstCount = Number((value as any)?.[0]?.count);
    if (Number.isFinite(firstCount) && firstCount > 0) return firstCount;
    return value.length;
  }
  return 0;
}
