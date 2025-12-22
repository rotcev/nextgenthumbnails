import { Injectable } from "@nestjs/common";
import OpenAI from "openai";

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
      "- textRegions: { count: number, regions: [{ index:number, position:string, relativeSize:string, fillColor:string, notes?:string }], block: { centered:boolean, widthPct:number, heightPct:number, leading:string } }",
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


