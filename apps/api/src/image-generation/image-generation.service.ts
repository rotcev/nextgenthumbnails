import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { createReadStream } from 'node:fs';
import { basename, extname } from 'node:path';
import { toFile } from 'openai';

type GenerateArgs = {
  model: 'gpt-image-1.5';
  prompt: string;
  size: string;
  quality: 'low' | 'medium' | 'high';
  inputFidelity: 'low' | 'high';
  templateImageAbsPath: string;
  subjectImageAbsPaths: string[];
  maskImageAbsPath?: string;
  outputFormat: 'png' | 'jpeg' | 'webp';
  moderation: 'low' | 'medium' | 'high';
};

@Injectable()
export class ImageGenerationService {
  private readonly openai?: OpenAI;
  private readonly logger = new Logger(ImageGenerationService.name);

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    this.openai = apiKey ? new OpenAI({ apiKey }) : undefined;
  }

  async generateFromTemplate(args: GenerateArgs): Promise<Buffer> {
    if (!this.openai) {
      throw new Error('OPENAI_API_KEY is not set');
    }

    const startMs = Date.now();
    const imgNames = [
      basename(args.templateImageAbsPath),
      ...args.subjectImageAbsPaths.map((p) => basename(p)),
    ];
    this.logger.log(
      [
        'openai:images.edit:start',
        `model=${args.model}`,
        `size=${args.size}`,
        `quality=${args.quality}`,
        `inputFidelity=${args.inputFidelity}`,
        `outputFormat=${args.outputFormat}`,
        `images=${imgNames.length}(${imgNames.join(',')})`,
        args.maskImageAbsPath ? `mask=${basename(args.maskImageAbsPath)}` : null,
        `promptLen=${args.prompt.length}`,
      ]
        .filter(Boolean)
        .join(' '),
    );

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
    const maskFile = args.maskImageAbsPath
      ? await toFile(
          createReadStream(args.maskImageAbsPath),
          basename(args.maskImageAbsPath),
          {
            type: 'image/png',
          },
        )
      : undefined;

    try {
      const res = await this.openai.images.edit({
        model: args.model,
        image: images as any,
        ...(maskFile ? { mask: maskFile as any } : null),
        prompt: args.prompt,
        size: apiSize(args.size) as any,
        quality: args.quality as any,
        input_fidelity: args.inputFidelity as any,
        output_format: args.outputFormat as any,
      });

      const b64 = (res.data?.[0] as any)?.b64_json as string | undefined;
      if (!b64) {
        throw new Error('OpenAI did not return b64_json image data');
      }

      const out = Buffer.from(b64, 'base64');
      this.logger.log(
        [
          'openai:images.edit:success',
          `bytes=${out.length}`,
          `ms=${Date.now() - startMs}`,
        ].join(' '),
      );
      return out;
    } catch (err: any) {
      const code = String(err?.code ?? err?.error?.code ?? '').trim();
      const requestId = String(
        err?.requestID ??
          err?.error?.requestID ??
          err?.headers?.get?.('x-request-id') ??
          '',
      ).trim();
      const msg = String(err?.error?.message ?? err?.message ?? '').trim();
      this.logger.error(
        [
          'openai:images.edit:error',
          requestId ? `requestId=${requestId}` : null,
          code ? `code=${code}` : null,
          msg ? `message=${msg}` : null,
        ]
          .filter(Boolean)
          .join(' '),
      );
      throw err;
    }
  }
}

function apiSize(target: string) {
  // OpenAI Images API supported sizes (per error message you saw):
  // '1024x1024', '1024x1536', '1536x1024', and 'auto'.
  //
  if (target === '1024x1024') return '1024x1024';
  if (target === '1024x1536') return '1024x1536';
  if (target === '1536x1024') return '1536x1024';

  // For legacy/unknown sizes (e.g. 1280x720), pick a safe supported default.
  // Using 1536x1024 gives better fidelity for thumbnails than 1024x1024.
  return '1536x1024';
}

function mimeFromPath(path: string) {
  const ext = extname(path).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  // Fail closed: OpenAI only accepts these for Images API uploads.
  return 'application/octet-stream';
}
