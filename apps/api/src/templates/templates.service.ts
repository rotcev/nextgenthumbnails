import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { PrismaService } from "../prisma/prisma.service";
import { DEFAULT_USER_ID } from "../bootstrap/bootstrap.constants";
import { CreateTemplateDto } from "./dto/create-template.dto";
import { UpdateTemplateConfigDto } from "./dto/update-template-config.dto";
import { CopyTemplateDto } from "./dto/copy-template.dto";
import { asPrismaJson } from "../prisma/prisma-json";
import { StorageService } from "../storage/storage.service";
import { TemplateAnalysisService } from "../template-analysis/template-analysis.service";
import { coerceFormSchemaForTemplate, deriveFormSchemaFromTemplateConfig } from "./template-form-schema";

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
      orderBy: { updatedAt: "desc" },
    });
  }

  async create(clientId: string, dto: CreateTemplateDto) {
    await this.assertClientOwned(clientId);
    return this.prisma.template.create({
      data: {
        clientId,
        name: dto.name,
        imageUrl: dto.imageUrl,
        config: asPrismaJson(dto.config),
        outputSize: dto.outputSize,
      },
    });
  }

  async getById(id: string) {
    const template = await this.prisma.template.findFirst({
      where: { id, client: { userId: DEFAULT_USER_ID } },
    });
    if (!template) throw new NotFoundException("Template not found");
    return template;
  }

  async updateConfig(id: string, dto: UpdateTemplateConfigDto) {
    const template = await this.getById(id);
    const existingConfig = (template.config as any) ?? {};
    const preservedFormSchema = existingConfig?.formSchema;
    const nextConfig = {
      ...dto,
      formSchema:
        preservedFormSchema ?? deriveFormSchemaFromTemplateConfig(dto as any),
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
      source.reconstructionSpec === null ? undefined : asPrismaJson(source.reconstructionSpec);

    return this.prisma.template.create({
      data: {
        clientId: dto.targetClientId,
        name: dto.name ?? `${source.name} (Copy)`,
        imageUrl: source.imageUrl,
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
    const existingConfig = (template.config as any) ?? {};
    const derivedConfig = deriveConfigFromReconstructionSpec(template.reconstructionSpec, template.outputSize);
    const formSchema = coerceFormSchemaForTemplate(derivedConfig, existingConfig?.formSchema);

    return this.prisma.template.update({
      where: { id: template.id },
      data: { config: asPrismaJson({ ...derivedConfig, formSchema }) },
    });
  }

  async reanalyze(id: string) {
    const template = await this.getById(id);
    if (!template.imageUrl) throw new BadRequestException("Template has no image yet");

    // Safety: if analysis isn't configured, don't overwrite working templates with placeholders.
    if (!process.env.OPENAI_API_KEY) {
      throw new BadRequestException("OPENAI_API_KEY is not set; cannot re-analyze template");
    }

    const absPath = this.storagePathFromUrl(template.imageUrl);
    const bytes = await readFile(absPath);
    const mime = guessMimeFromFileName(absPath) ?? "image/jpeg";
    const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;

    const analysis = await this.analysis.analyzeTemplateImage(dataUrl);

    const derivedConfig = deriveConfigFromReconstructionSpec(
      analysis.reconstructionSpec,
      template.outputSize,
    );
    const formSchema = coerceFormSchemaForTemplate(derivedConfig, (analysis as any).formSchema);

    return this.prisma.template.update({
      where: { id: template.id },
      data: {
        reconstructionPrompt: analysis.reconstructionPrompt,
        reconstructionSpec: asPrismaJson(analysis.reconstructionSpec),
        config: asPrismaJson({ ...derivedConfig, formSchema }),
      },
    });
  }

  private storagePathFromUrl(urlPath: string) {
    // urlPath looks like: /storage/templates/<file>
    const clean = urlPath.replace(/^\/storage\//, "");
    return `${process.cwd()}/storage/${clean}`;
  }

  async uploadAndAnalyze(
    clientId: string,
    input: { name?: string; originalName: string; bytes: Buffer },
  ) {
    await this.assertClientOwned(clientId);

    const client = await this.prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { defaults: true },
    });

    const defaultOutputSize =
      (client.defaults as any)?.outputSize ?? ("1536x1080" as const);

    // Draft template created immediately (so the UI can show progress/state)
    const template = await this.prisma.template.create({
      data: {
        clientId,
        name: input.name?.trim() || "New Template",
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

    const base64 = input.bytes.toString("base64");
    const mime =
      guessMimeFromFileName(input.originalName) ?? "image/png";
    const dataUrl = `data:${mime};base64,${base64}`;

    const analysis = await this.analysis.analyzeTemplateImage(dataUrl);

    const derivedConfig = deriveConfigFromReconstructionSpec(
      analysis.reconstructionSpec,
      defaultOutputSize,
    );
    const formSchema = coerceFormSchemaForTemplate(derivedConfig, (analysis as any).formSchema);

    return this.prisma.template.update({
      where: { id: template.id },
      data: {
        imageUrl: saved.urlPath,
        reconstructionPrompt: analysis.reconstructionPrompt,
        reconstructionSpec: asPrismaJson(analysis.reconstructionSpec),
        // If the user hasn't configured anything yet, auto-populate minimal inputs
        // so the Generate screen can immediately show text fields.
        config: asPrismaJson({ ...derivedConfig, formSchema }),
        outputSize: defaultOutputSize,
      },
    });
  }

  private async assertClientOwned(clientId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, userId: DEFAULT_USER_ID },
      select: { id: true },
    });
    if (!client) throw new NotFoundException("Client not found");
  }
}

function guessMimeFromFileName(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return null;
}

function deriveConfigFromReconstructionSpec(spec: any, outputSize: string) {
  const subjectCount = inferCount(spec?.subjectSlots);
  const textCount = inferCount(spec?.textRegions);

  const subjectSlots = Array.from({ length: subjectCount }).map((_, i) => ({
    id: `slot_${i + 1}`,
    label: subjectCount === 2 ? (i === 0 ? "Left subject" : "Right subject") : `Subject ${i + 1}`,
    behavior: "replace",
  }));

  const textRegions = Array.from({ length: textCount }).map((_, i) => ({
    id: `text_${i + 1}`,
    // Default labels should be unopinionated; most thumbnail templates read as stacked text lines.
    label: `Text ${i + 1}`,
    // Keep the key stable for backwards compatibility with existing templates.
    key: i === 0 ? "title" : `text_${i + 1}`,
    required: true,
  }));

  return {
    subjectSlots,
    textRegions,
    outputSize,
  };
}

function inferCount(value: unknown) {
  // Support multiple shapes from analysis:
  // - { count: number }
  // - [{ count: number }, ...]
  // - ["slot description", ...]
  // - [{ position: "...", font: "..." }, ...]
  if (!value) return 0;
  if (typeof value === "object" && !Array.isArray(value)) {
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


