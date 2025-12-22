import { Injectable } from "@nestjs/common";
import OpenAI from "openai";
import { createReadStream } from "node:fs";
import { basename, extname } from "node:path";
import { toFile } from "openai";
import sharp from "sharp";

type GenerateArgs = {
  model: "gpt-image-1.5";
  prompt: string;
  size: string;
  quality: "low" | "medium" | "high";
  inputFidelity: "low" | "high";
  templateImageAbsPath: string;
  subjectImageAbsPaths: string[];
  outputFormat: "png" | "jpeg" | "webp";
  moderation: "low" | "medium" | "high";
};

@Injectable()
export class ImageGenerationService {
  private readonly openai?: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    this.openai = apiKey ? new OpenAI({ apiKey }) : undefined;
  }

  async generateFromTemplate(args: GenerateArgs): Promise<Buffer> {
    if (!this.openai) {
      throw new Error("OPENAI_API_KEY is not set");
    }

    // IMPORTANT: Use OpenAI's `toFile` helper so the SDK sends multipart parts with a filename
    // and correct Content-Type. Passing a raw stream can end up as application/octet-stream.
    const templateFile = await toFile(
      createReadStream(args.templateImageAbsPath),
      basename(args.templateImageAbsPath),
      { type: mimeFromPath(args.templateImageAbsPath) },
    );

    const subjectFiles = await Promise.all(
      args.subjectImageAbsPaths.map(async (p) =>
        toFile(createReadStream(p), basename(p), { type: mimeFromPath(p) }),
      ),
    );

    const images = [templateFile, ...subjectFiles];

    const res = await this.openai.images.edit({
      model: args.model,
      image: images as any,
      prompt: args.prompt,
      size: apiSize(args.size) as any,
      quality: args.quality as any,
      input_fidelity: args.inputFidelity as any,
      output_format: args.outputFormat as any,
    });

    const b64 = (res.data?.[0] as any)?.b64_json as string | undefined;
    if (!b64) {
      throw new Error("OpenAI did not return b64_json image data");
    }

    const raw = Buffer.from(b64, "base64");
    return await resizeToTarget(raw, args.size);
  }
}

function apiSize(target: string) {
  // OpenAI Images API supported sizes (per error message you saw):
  // '1024x1024', '1024x1536', '1536x1024', and 'auto'.
  //
  // We ALWAYS want final output 1536x1080; we generate at the closest supported
  // landscape size (1536x1024) then deterministically resize to 1536x1080.
  if (target === "1536x1080") return "1536x1024";

  if (target === "1024x1024") return "1024x1024";
  if (target === "1024x1536") return "1024x1536";
  if (target === "1536x1024") return "1536x1024";

  // For legacy/unknown sizes (e.g. 1280x720), pick a safe supported default.
  // Using 1536x1024 gives better fidelity for thumbnails than 1024x1024.
  return "1536x1024";
}

async function resizeToTarget(bytes: Buffer, target: string) {
  const match = /^(\d+)x(\d+)$/.exec(target);
  if (!match) return bytes;

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return bytes;
  }

  // Deterministic output size. `cover` keeps the image filled; templates should be authored for this.
  // If we need strict no-crop later, we can switch to `contain` with background padding.
  return await sharp(bytes).resize(width, height, { fit: "cover" }).png().toBuffer();
}

function mimeFromPath(path: string) {
  const ext = extname(path).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  // Fail closed: OpenAI only accepts these for Images API uploads.
  return "application/octet-stream";
}


