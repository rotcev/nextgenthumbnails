import { Injectable } from "@nestjs/common";
import OpenAI from "openai";
import sharp from "sharp";

type TemplateReconstructionResult = {
  reconstructionPrompt: string;
  reconstructionSpec: Record<string, unknown>;
  formSchema?: {
    version: 1;
    subjectSlots: Array<{
      label: string;
      helpText?: string;
    }>;
    textFields: Array<{
      label: string;
      helpText?: string;
      placeholder?: string;
      defaultValue?: string;
      style?: {
        fillColor?: string;
        gradient?: string;
        innerBorder?: boolean;
      };
    }>;
    customizations?: Array<{
      id: string;
      label: string;
      helpText?: string;
      kind: "toggle" | "select";
      defaultValue?: boolean | string;
      // For kind="select"
      options?: Array<{ value: string; label: string; instruction?: string }>;
      // For kind="toggle"
      onInstruction?: string;
    }>;
    tips?: string[];
  };
};

@Injectable()
export class TemplateAnalysisService {
  private readonly openai?: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    this.openai = apiKey ? new OpenAI({ apiKey }) : undefined;
  }

  async analyzeTemplateImage(imageBase64DataUrl: string): Promise<TemplateReconstructionResult> {
    // If no key is configured, we still create a deterministic placeholder so the rest of the
    // app can be exercised without runtime crashes.
    if (!this.openai) {
      return {
        reconstructionPrompt:
          "RECONSTRUCTION_PLACEHOLDER: Configure OPENAI_API_KEY to enable template analysis.",
        reconstructionSpec: {
          note: "OPENAI_API_KEY not set; analysis skipped",
        },
        formSchema: {
          version: 1,
          subjectSlots: [],
          textFields: [],
          tips: ["Configure OPENAI_API_KEY to enable automatic template analysis."],
        },
      };
    }

    const instruction = [
      "You are generating a RECONSTRUCTION PROMPT for high-fidelity template cloning.",
      "The template image is ground truth. Do not be creative.",
      "Output MUST be valid JSON only, with keys:",
      `- "reconstructionPrompt": string`,
      `- "reconstructionSpec": object`,
      `- "formSchema": object`,
      "",
      "reconstructionPrompt requirements:",
      "- Describe exact composition, camera angle, lens look, lighting (HDR), background, color grading, depth of field.",
      "- Describe exact typography and text placement: font style, weight, size, color, stroke/shadow, alignment, spacing, casing.",
      "- Identify fixed visual elements that must not change.",
      "- Be explicit about text block sizing: the stacked text should fill the center area similarly to the template (minimal empty margins).",
      "",
      "reconstructionSpec should include structured details if you can infer them:",
      "- subjectSlots: { count: number, placements?: string[] }",
      "- textRegions: { count: number, regions: [{ index:number, position:string, relativeSize:string, fillColor:string, notes?:string }], block: { centered:boolean, widthPct:number, heightPct:number, topPct:number, bottomPct:number, leading:string } }",
      "- For textRegions.block.topPct and textRegions.block.bottomPct:",
      "  - Measure based on GLYPHS ONLY (ignore drop shadow/glow/outline softness).",
      "  - topPct is the y-position of the topmost visible glyph bound as a % of canvas height (0..100).",
      "  - bottomPct is the y-position of the bottommost visible glyph bound as a % of canvas height (0..100).",
      "  - Constraints: 0 <= topPct < bottomPct <= 100.",
      "  - Consistency: heightPct should be approximately (bottomPct - topPct).",
      "- fixedElements (list of elements that must remain identical)",
      "- editableHints (what areas usually contain subjects/text)",
      "",
      "formSchema requirements (grandma-simple):",
      "- Provide human-friendly labels and short helpText only. Do NOT include bounding boxes.",
      "- formSchema.version must be 1.",
      "- formSchema.subjectSlots: array length should match inferred subject slot count; each item has:",
      '  - "label": string (e.g. "Left subject", "Right subject")',
      '  - "helpText": optional string (1 short sentence)',
      "- formSchema.textFields: array length should match inferred text region count; each item has:",
      '  - "label": string (e.g. "Title", "Line 2")',
      '  - "placeholder": optional string',
      '  - "helpText": optional string (1 short sentence)',
      '  - "defaultValue": optional string',
      '  - "style": optional object with { fillColor?: string, gradient?: string, innerBorder?: boolean }',
      "- If you can infer per-line fill color (e.g. alternating white/red), set style.fillColor as a hex string for each line.",
      "- If a line uses a vertical white/gray gradient, set style.gradient to a short description (e.g. \"white-to-light-gray vertical\").",
      "- If a line has a thin white inner border/inset, set style.innerBorder=true.",
      "",
      "Customizations (optional):",
      "- If the template has obvious adjustable elements, include formSchema.customizations (max 5).",
      "- Keep customizations extremely simple for non-technical users:",
      '  - kind="toggle": { id, label, helpText?, defaultValue?: boolean, onInstruction?: string }',
      '  - kind="select": { id, label, helpText?, defaultValue?: string, options: [{ value, label, instruction? }] }',
      "- Examples: arrowDirection (left/right), arrowVisible (toggle), handGesture (select).",
      "- formSchema.tips: optional array of short strings (max 3).",
    ].join("\n");

    const res = await this.openai.responses.create({
      model: "gpt-5-mini",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: instruction },
            { type: "input_image", image_url: imageBase64DataUrl, detail: "high" },
          ],
        },
      ],
    });

    const text = res.output_text?.trim() ?? "";
    const parsed = safeJsonParse<TemplateReconstructionResult>(text);

    if (!parsed?.reconstructionPrompt || !parsed?.reconstructionSpec) {
      // Last-resort: keep the raw text to avoid losing information.
      return {
        reconstructionPrompt: text || "Failed to parse reconstruction JSON from model.",
        reconstructionSpec: { parseError: true, raw: text },
      };
    }

    // The model’s numeric % extents can be rough. Refine the text block vertical extents from pixels
    // so prompt constraints match the true template geometry.
    try {
      const refined = await refineReconstructionSpecTextBlockExtentsFromPixels({
        imageBase64DataUrl,
        reconstructionSpec: parsed.reconstructionSpec,
      });
      parsed.reconstructionSpec = refined;
    } catch {
      // Best-effort only; never fail analysis due to refinement.
    }

    return parsed;
  }
}

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    // Attempt to salvage JSON if the model wrapped it.
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(text.slice(first, last + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function refineReconstructionSpecTextBlockExtentsFromPixels(args: {
  imageBase64DataUrl: string;
  reconstructionSpec: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const { imageBase64DataUrl, reconstructionSpec } = args;

  const textRegions = (reconstructionSpec as any)?.textRegions;
  const block = textRegions?.block;
  const regions = textRegions?.regions;
  if (!textRegions || typeof textRegions !== "object") return reconstructionSpec;
  if (!block || typeof block !== "object") return reconstructionSpec;
  if (!Array.isArray(regions) || regions.length === 0) return reconstructionSpec;

  const bytes = decodeDataUrlBase64(imageBase64DataUrl);
  if (!bytes) return reconstructionSpec;

  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (!width || !height || !channels || channels < 3) return reconstructionSpec;

  const widthPct = toFiniteNumber(block?.widthPct);
  // Default to a reasonable center region if analysis didn't provide widthPct.
  const leftPct =
    typeof widthPct === "number" && widthPct > 0 && widthPct <= 100 ? (100 - widthPct) / 2 : 20;
  const rightPct =
    typeof widthPct === "number" && widthPct > 0 && widthPct <= 100
      ? 100 - leftPct
      : 80;

  // Heuristic: exclude the far right of the block to avoid the red arrow affecting extents.
  const x0 = clampInt(Math.floor((leftPct / 100) * width), 0, width - 1);
  const x1Raw = clampInt(Math.ceil((rightPct / 100) * width), x0 + 1, width);
  const x1 = clampInt(Math.floor(x1Raw - (x1Raw - x0) * 0.15), x0 + 1, width);

  const topColorHex = String(regions?.[0]?.fillColor ?? "").trim();
  const bottomColorHex = String(regions?.[regions.length - 1]?.fillColor ?? "").trim();
  const topColor = parseHexColor(topColorHex);
  const bottomColor = parseHexColor(bottomColorHex);

  const topY = topColor
    ? findFirstMatchingRow({
        data,
        width,
        height,
        channels,
        x0,
        x1,
        direction: "top",
        target: topColor,
      })
    : null;
  const bottomY = bottomColor
    ? findFirstMatchingRow({
        data,
        width,
        height,
        channels,
        x0,
        x1,
        direction: "bottom",
        target: bottomColor,
      })
    : null;

  if (topY === null || bottomY === null || !(topY >= 0 && bottomY > topY)) {
    return reconstructionSpec;
  }

  const topPct = round1((topY / height) * 100);
  const bottomPct = round1((bottomY / height) * 100);
  const heightPct = round1(bottomPct - topPct);

  return {
    ...reconstructionSpec,
    textRegions: {
      ...textRegions,
      block: {
        ...block,
        topPct,
        bottomPct,
        heightPct,
      },
    },
  };
}

function decodeDataUrlBase64(dataUrl: string): Buffer | null {
  const text = String(dataUrl ?? "").trim();
  const comma = text.indexOf(",");
  if (comma < 0) return null;
  const b64 = text.slice(comma + 1);
  if (!b64) return null;
  try {
    return Buffer.from(b64, "base64");
  } catch {
    return null;
  }
}

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampInt(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n | 0));
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const s = hex.trim();
  const m = s.match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return null;
  const v = m[1]!;
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  if (![r, g, b].every((x) => Number.isFinite(x))) return null;
  return { r, g, b };
}

function findFirstMatchingRow(args: {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
  x0: number;
  x1: number;
  direction: "top" | "bottom";
  target: { r: number; g: number; b: number };
}): number | null {
  const { data, width, height, channels, x0, x1, direction, target } = args;
  const rowStride = width * channels;
  const scanWidth = Math.max(1, x1 - x0);

  // Require a small density to avoid noise and isolated pixels.
  const minHitPct = 0.006; // 0.6% of scanned pixels
  const minHits = Math.max(20, Math.floor(scanWidth * minHitPct));

  const yStart = direction === "top" ? 0 : height - 1;
  const yEnd = direction === "top" ? height : -1;
  const yStep = direction === "top" ? 1 : -1;

  for (let y = yStart; y !== yEnd; y += yStep) {
    const baseY = y * rowStride;
    let hits = 0;
    for (let x = x0; x < x1; x++) {
      const idx = baseY + x * channels;
      const r = data[idx] ?? 0;
      const g = data[idx + 1] ?? 0;
      const b = data[idx + 2] ?? 0;
      if (isNearFillColor({ r, g, b }, target)) hits++;
      if (hits >= minHits) return y;
    }
  }
  return null;
}

function isNearFillColor(
  px: { r: number; g: number; b: number },
  target: { r: number; g: number; b: number },
) {
  // Special-case common template fills (white/red) to reduce JPEG drift sensitivity.
  const isTargetWhite = target.r >= 245 && target.g >= 245 && target.b >= 245;
  if (isTargetWhite) return px.r >= 210 && px.g >= 210 && px.b >= 210;

  const isTargetRed = target.r >= 200 && target.g <= 80 && target.b <= 80;
  if (isTargetRed) return px.r >= 150 && px.g <= 120 && px.b <= 120 && px.r - Math.max(px.g, px.b) >= 40;

  // Generic RGB distance (Manhattan) with a loose threshold to handle compression.
  const dist = Math.abs(px.r - target.r) + Math.abs(px.g - target.g) + Math.abs(px.b - target.b);
  return dist <= 160;
}


