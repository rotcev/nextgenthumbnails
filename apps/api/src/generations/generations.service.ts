import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { DEFAULT_USER_ID } from "../bootstrap/bootstrap.constants";
import { CreateGenerationDto } from "./dto/create-generation.dto";
import { asPrismaJson } from "../prisma/prisma-json";
import { StorageService } from "../storage/storage.service";
import { ImageGenerationService } from "../image-generation/image-generation.service";
import { buildGenerationPrompt } from "./generations.prompt";
import sharp from "sharp";

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
      orderBy: { createdAt: "desc" },
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
    if (!template) throw new NotFoundException("Template not found");

    if (!template.imageUrl) throw new BadRequestException("Template has no image yet");

    const subjectSlotIds = safeJsonParseStringArray(dto.subjectSlotIdsJson);
    const texts = safeJsonParseTexts(dto.textsJson);
    const customizations = safeJsonParseObject(dto.customizationsJson);
    const userNotes = sanitizeUserNotes(dto.userNotes);

    const templateConfig = (template.config as any) ?? {};
    const knownSlotIds = new Set<string>(
      Array.isArray(templateConfig?.subjectSlots)
        ? templateConfig.subjectSlots.map((s: any) => String(s?.id ?? "").trim()).filter(Boolean)
        : [],
    );
    const requiredSlotIds = new Set<string>(
      Array.isArray(templateConfig?.formSchema?.subjectSlots)
        ? templateConfig.formSchema.subjectSlots
            .filter((s: any) => Boolean(s?.required))
            .map((s: any) => String(s?.id ?? "").trim())
            .filter(Boolean)
        : [],
    );
    const knownTextKeys = new Set<string>(
      Array.isArray(templateConfig?.formSchema?.textFields)
        ? templateConfig.formSchema.textFields
            .map((t: any) => String(t?.key ?? "").trim())
            .filter(Boolean)
        : Array.isArray(templateConfig?.textRegions)
          ? templateConfig.textRegions
              .map((t: any) => String(t?.key ?? "").trim())
              .filter(Boolean)
          : [],
    );
    const requiredTextKeys = new Set<string>(
      Array.isArray(templateConfig?.formSchema?.textFields)
        ? templateConfig.formSchema.textFields
            .filter((t: any) => Boolean(t?.required))
            .map((t: any) => String(t?.key ?? "").trim())
            .filter(Boolean)
        : [],
    );

    const allowedCustomizationIds = new Set<string>(
      Array.isArray(templateConfig?.formSchema?.customizations)
        ? templateConfig.formSchema.customizations
            .map((c: any) => String(c?.id ?? "").trim())
            .filter(Boolean)
        : [],
    );

    const seen = new Set<string>();
    const dup = subjectSlotIds.find((id) => (seen.has(id) ? true : (seen.add(id), false)));
    if (dup) throw new BadRequestException(`Duplicate subject slot ID: ${dup}`);

    const unknownSlot = subjectSlotIds.find((id) => !knownSlotIds.has(id));
    if (unknownSlot) {
      throw new BadRequestException(`Unknown subject slot ID: ${unknownSlot}`);
    }

    if (subjectSlotIds.length !== subjectImages.length) {
      throw new BadRequestException(
        "subjectSlotIdsJson length must match number of uploaded subjectImages",
      );
    }

    const missingSlots = [...requiredSlotIds].filter((id) => !subjectSlotIds.includes(id));
    if (missingSlots.length) {
      throw new BadRequestException(
        `Missing required subject uploads: ${missingSlots.join(", ")}`,
      );
    }

    const incomingTextByKey = new Map(texts.map((t) => [t.key, (t.value ?? "").trim()]));
    const unknownText = texts.find((t) => !knownTextKeys.has(t.key));
    if (unknownText) {
      throw new BadRequestException(`Unknown text key: ${unknownText.key}`);
    }
    const missingText = [...requiredTextKeys].filter((k) => !(incomingTextByKey.get(k) ?? "").trim());
    if (missingText.length) {
      throw new BadRequestException(`Missing required text: ${missingText.join(", ")}`);
    }

    const unknownCustomization = Object.keys(customizations).find(
      (id) => !allowedCustomizationIds.has(id),
    );
    if (unknownCustomization) {
      throw new BadRequestException(`Unknown customization: ${unknownCustomization}`);
    }

    const generation = await this.prisma.generation.create({
      data: {
        clientId,
        templateId: template.id,
        status: "running",
        promptPayload: asPrismaJson({
          templateId: template.id,
          subjectSlotIds,
          texts,
          customizations,
          userNotes,
          format: dto.format ?? "png",
        }),
      },
    });

    try {
      const templateAbsPath = resolveStorageAbsPath(template.imageUrl);
      await readFile(templateAbsPath); // fail fast if missing

      const subjectAbsPaths: string[] = [];
      for (let i = 0; i < subjectImages.length; i++) {
        const slotId = subjectSlotIds[i]!;
        const file = subjectImages[i]!;
        const enhancedBytes = await enhanceSubjectImageBytes(file.buffer);
        const saved = await this.storage.saveTempSubjectImage(
          generation.id,
          slotId,
          // We may re-encode/upscale, so use a stable name for extension choice.
          "subject.png",
          enhancedBytes,
        );
        subjectAbsPaths.push(saved.absPath);
      }

      const prompt = buildGenerationPrompt({
        template,
        reconstructionPrompt: template.reconstructionPrompt,
        subjectSlotIds,
        texts,
        customizations,
        userNotes,
      });

      const bytes = await this.images.generateFromTemplate({
        model: "gpt-image-1.5",
        prompt,
        // Product requirement: final output must always be 1536x1080.
        // We generate at a supported size and then resize deterministically.
        size: "1536x1080",
        quality: "high",
        inputFidelity: "high",
        templateImageAbsPath: templateAbsPath,
        subjectImageAbsPaths: subjectAbsPaths,
        outputFormat: dto.format ?? "png",
        moderation: 'low',
      });

      const saved = await this.storage.saveGenerationImage(generation.id, bytes);

      return await this.prisma.generation.update({
        where: { id: generation.id },
        data: { status: "succeeded", outputUrl: saved.urlPath },
      });
    } catch (err) {
      await this.prisma.generation.update({
        where: { id: generation.id },
        data: { status: "failed" },
      });
      throw err;
    }
  }

  private async assertClientOwned(clientId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, userId: DEFAULT_USER_ID },
      select: { id: true },
    });
    if (!client) throw new NotFoundException("Client not found");
  }
}

function resolveStorageAbsPath(urlPath: string) {
  // urlPath looks like: /storage/templates/<file>
  const clean = urlPath.replace(/^\/storage\//, "");
  return join(process.cwd(), "storage", clean);
}

function safeJsonParseStringArray(text: string): string[] {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function safeJsonParseTexts(text: string): Array<{ key: string; value: string }> {
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => ({
        key: String(x?.key ?? ""),
        value: String(x?.value ?? ""),
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
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function sanitizeUserNotes(value?: string) {
  const text = String(value ?? "").trim();
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
    return await img.resize(newW, newH, { fit: "fill" }).png().toBuffer();
  } catch {
    return bytes;
  }
}


