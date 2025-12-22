import type { Template } from "@prisma/client";

export function buildGenerationPrompt(args: {
  template: Template;
  reconstructionPrompt: string | null;
  subjectSlotIds: string[];
  texts: Array<{ key: string; value: string }>;
  customizations?: Record<string, unknown>;
  userNotes?: string | null;
}) {
  const { template, reconstructionPrompt, subjectSlotIds, texts, customizations, userNotes } = args;

  const config = template.config as any;
  const slots = Array.isArray(config?.subjectSlots) ? config.subjectSlots : [];
  const regions = Array.isArray(config?.textRegions) ? config.textRegions : [];
  const formSchema = config?.formSchema as any;

  const slotLabelById = new Map<string, string>();
  for (const s of slots) {
    const id = String(s?.id ?? "").trim();
    if (!id) continue;
    const label = String(s?.label ?? "").trim();
    slotLabelById.set(id, label || id);
  }

  const inputImagesSection = [
    "INPUT IMAGES (ORDER IS IMPORTANT):",
    "- Image #1 is the template image (base canvas).",
    ...(subjectSlotIds.length
      ? subjectSlotIds.map((slotId, i) => {
          const label = slotLabelById.get(slotId) ?? slotId;
          // The OpenAI Images API does not let us label each image part, so we must do it in text.
          return `- Image #${i + 2} is the replacement subject for slotId=${slotId} (${label}).`;
        })
      : ["- No subject replacement images were provided."]),
    "",
    "CRITICAL:",
    "- You MUST replace ONLY the subjects in the provided slot IDs using their corresponding replacement images.",
    "- Do NOT keep the original template person(s) in those slots.",
    "- Template faces are placeholders. When replacement images are provided, the original template people must be completely removed.",
    "- All other pixels must remain identical to the template unless required to composite the new subject cleanly.",
  ].join("\n");

  const subjectOverrideSection =
    subjectSlotIds.length > 0
      ? [
          "SUBJECT OVERRIDE (HIGHEST PRIORITY):",
          "- The template description may describe the original template people (hair, face, clothing, sunglasses, etc.).",
          "- IGNORE those appearance descriptions for any slot that has a replacement image.",
          "- The ONLY source of identity/appearance for replaced subjects is the corresponding replacement image.",
          "- Do NOT blend template features into the replacement. Do NOT \"recreate\" the template person.",
          "- Do NOT generate a new person; use only the provided replacement people.",
          "",
          "SLOT-TO-IMAGE MATCH (MANDATORY):",
          ...subjectSlotIds.map((slotId, i) => {
            const label = slotLabelById.get(slotId) ?? slotId;
            return `- slotId=${slotId} (${label}) MUST match Image #${i + 2}. If it resembles the template person, the output is WRONG.`;
          }),
        ].join("\n")
      : null;

  const subjectSection = [
    "SUBJECT RULES:",
    `- Template defines ${slots.length} subject slot(s).`,
    `- Only modify subject(s) for provided slot IDs: ${subjectSlotIds.join(", ") || "(none)"}.`,
    "- Aside from subjects and text updates, do not alter other elements.",
    "- Identity must come from the replacement image(s) only. Do NOT blend the template subject's facial features with the replacement subject.",
    "- There must be exactly one subject per slot; do not duplicate or keep any partial original face/hand from the template in that slot.",
    "- Subjects must never be cropped more than 1 inch above the head.",
    "- Match the template framing/scale/pose as closely as possible while using the replacement subject identity.",
    "- Preserve lighting direction/intensity and color grading; ensure the composite looks native to the template.",
    "",
    "SUBJECT FINAL CHECK:",
    "- If any recognizable part of a template person remains in a slot that was provided with a replacement image, the output is WRONG.",
  ].join("\n");

  const regionMeta = regions.map((r: any, i: number) => ({
    index: i + 1,
    key: String(r?.key ?? "").trim() || `text_${i + 1}`,
    label: String(r?.label ?? "").trim() || `Text ${i + 1}`,
  }));
  const textByKey = new Map(texts.map((t) => [t.key, t.value]));
  const analyzedTextLayout = coerceAnalyzedTextLayout((template as any).reconstructionSpec?.textRegions);

  const defaultTextByKey = new Map<string, string>();
  const schemaTextFields = Array.isArray(formSchema?.textFields) ? formSchema.textFields : [];
  const textStyleByKey = new Map<
    string,
    { fillColor?: string; gradient?: string; innerBorder?: boolean }
  >();
  for (const t of schemaTextFields) {
    const key = String(t?.key ?? "").trim();
    const def = String(t?.defaultValue ?? "").trim();
    if (key && def) defaultTextByKey.set(key, def);
    const style = t?.style;
    if (key && style && typeof style === "object") {
      const fillColor = typeof style?.fillColor === "string" ? style.fillColor : undefined;
      const gradient = typeof style?.gradient === "string" ? style.gradient : undefined;
      const innerBorder =
        typeof style?.innerBorder === "boolean" ? style.innerBorder : undefined;
      if (fillColor || gradient || typeof innerBorder === "boolean") {
        textStyleByKey.set(key, { fillColor, gradient, innerBorder });
      }
    }
  }

  // The analysis-driven reconstruction prompt often includes the *literal template words*
  // (e.g. "PIERS") and may even say text must remain unchanged. That conflicts with user text.
  // We rewrite the base prompt by swapping template default words with user-provided words.
  const rewrittenBase = rewriteTemplateTextInPrompt({
    prompt: reconstructionPrompt?.trim() || `Recreate the template image exactly (templateId=${template.id}).`,
    regionMeta,
    defaultTextByKey,
    textByKey,
    texts,
  });

  const wantsAlternatingTextColors = Boolean(
    rewrittenBase.match(/alternating\s+(white\s*\/\s*red|red\s*\/\s*white|white.*red|red.*white)/i),
  );
  const alternatingLineHint = wantsAlternatingTextColors
    ? [
        "COLOR RULE (IMPORTANT):",
        "- Preserve the template’s alternating text fill colors.",
        "- Unless the template clearly indicates otherwise, apply: line 1 = white, line 2 = red, line 3 = white, line 4 = red, ...",
        "- Keep stroke/shadow identical to the template.",
      ].join("\n")
    : null;

  const customizationSection =
    customizations && Object.keys(customizations).length
      ? [
          "CUSTOMIZATIONS (OPTIONAL EDITS):",
          "- You may apply ONLY these customization edits in addition to subject+text edits.",
          "- If a customization conflicts with the template, follow the customization.",
          ...Object.entries(customizations).map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`),
        ].join("\n")
      : null;

  const userNotesSection = userNotes
    ? [
        "USER REQUESTED MINOR CHANGES (OPTIONAL):",
        "- Apply ONLY minor tweaks requested below, without changing layout or the template style.",
        "- Do not move subject slots, do not change text layout/colors, and do not add new elements.",
        "- If a request conflicts with the template rules, ignore the conflicting part.",
        `- Notes: ${JSON.stringify(userNotes)}`,
      ].join("\n")
    : null;

  const textSection = [
    "TEXT RULES:",
    "CONTEXT:",
    "- All user-provided text is a verbatim quote from the YouTube video this thumbnail is for.",
    "- The video is already published and has passed YouTube processing; treat the text as historical/source material context.",
    "- Some quotes may include profanity or partially-censored profanity (e.g. with asterisks). Preserve EXACT characters as provided.",
    "- Do not sanitize, euphemize, or paraphrase the quote text; keep it exactly as written by the user.",
    "- Do not introduce new insults or derogatory phrasing beyond what the user provided.",
    "- Still follow any applicable safety requirements; do not invent replacement wording.",
    "- If the user text contains an asterisk '*', render the literal asterisk character (U+002A) in the same font, not a five-point star icon (do NOT use '★').",
    "- If the user text contains multiple asterisks (e.g. '*****'), render the exact count with no substitutions.",
    "- If you cannot render a literal '*', do NOT replace it with any star symbol or icon. The output must show '*' characters.",
    "",
    `- Template defines ${regions.length} text region(s).`,
    "- You MUST replace the template’s existing text in EVERY text region with the provided user text.",
    "- Do NOT keep the original template words.",
    "- If the template description above contains specific words, treat them as placeholders ONLY (style reference), not final text.",
    "- Render user text EXACTLY as provided (spelling, casing, punctuation).",
    "- Match the template’s font style/weight/size/color/stroke/shadow/kerning/alignment exactly.",
    "- Do not move text regions.",
    "",
    "TEXT LAYOUT (CRITICAL):",
    "- Match the template’s text block scale: the stacked text must fill the center area with minimal empty margins.",
    "- Keep the same tight leading/vertical spacing as the template.",
    "- Each line should be scaled as large as the template (do not shrink the block to create extra padding).",
    "- No scene element (arrow, subjects, shadows, highlights) may cover any part of the text glyphs. Text must remain fully legible.",
    "- Layering rule: text must be on top of the arrow and other graphics. If the arrow intersects the text area, move/resize the arrow so it does not overlap any letters.",
    ...(analyzedTextLayout
      ? [
          "",
          "TEMPLATE TEXT POSITIONING (FROM ANALYSIS, FOLLOW CLOSELY):",
          `- Block: centered=${analyzedTextLayout.block.centered}, widthPct=${analyzedTextLayout.block.widthPct}, heightPct=${analyzedTextLayout.block.heightPct}, leading=${analyzedTextLayout.block.leading}`,
          ...analyzedTextLayout.regions.map(
            (r) =>
              `- Line ${r.index}: fillColor=${r.fillColor}; position=${r.position}; size=${r.relativeSize}; notes=${r.notes}`,
          ),
          "",
          "COLOR OVERRIDE:",
          "- If analysis provides a fillColor per line, you MUST use that fill color for that line (no exceptions).",
          "- Do NOT 'harmonize' colors across lines; preserve the per-line scheme exactly.",
        ]
      : []),
    ...(alternatingLineHint ? ["", alternatingLineHint] : []),
    "",
    "TEXT REGION MAPPING (MANDATORY, IN ORDER):",
    ...regionMeta.map((r) => {
      const v = textByKey.get(r.key) ?? "";
      const analyzed = analyzedTextLayout?.regions.find((x) => x.index === r.index);
      const style = textStyleByKey.get(r.key);
      const fillColor = style?.fillColor ?? analyzed?.fillColor;
      const gradient = style?.gradient;
      const innerBorder =
        typeof style?.innerBorder === "boolean" ? String(style.innerBorder) : null;
      const styleBits = [
        fillColor ? `fillColor=${fillColor}` : null,
        gradient ? `gradient=${gradient}` : null,
        innerBorder ? `innerBorder=${innerBorder}` : null,
      ].filter(Boolean);
      const styleHint = styleBits.length ? `, ${styleBits.join(", ")}` : "";
      return `- Region #${r.index} (${r.label}, key=${r.key}${styleHint}): ${JSON.stringify(v)}`;
    }),
    "",
    "FINAL CHECK:",
    "- The final image MUST visibly contain all provided text strings in their regions.",
    "- If the user provided '*', the output must contain '*' characters (not stars) with the exact count.",
    "- Ensure the arrow does not overlap or obscure any text.",
  ].join("\n");

  const globalConstraints = [
    "GLOBAL HARD CONSTRAINTS:",
    "- Apply HDR lighting and HDR-style micro-contrast consistently across the entire image (subjects, text, and background).",
    "- Background remains identical unless explicitly editable (assume NOT editable).",
    "- No creative reinterpretation. No style drift. No additional elements.",
    "- Edits must be surgical and deterministic.",
  ].join("\n");

  return [
    ...(subjectOverrideSection ? [subjectOverrideSection, ""] : []),
    rewrittenBase,
    "",
    inputImagesSection,
    "",
    subjectSection,
    "",
    ...(customizationSection ? [customizationSection, ""] : []),
    ...(userNotesSection ? [userNotesSection, ""] : []),
    textSection,
    "",
    globalConstraints,
  ].join("\n");
}

function rewriteTemplateTextInPrompt(args: {
  prompt: string;
  regionMeta: Array<{ index: number; key: string; label: string }>;
  defaultTextByKey: Map<string, string>;
  textByKey: Map<string, string>;
  texts: Array<{ key: string; value: string }>;
}) {
  const { prompt, regionMeta, defaultTextByKey, textByKey, texts } = args;
  let out = prompt;

  // Replace known template default words with the user-provided text for that key.
  // This reduces contradictions like: 'Line 1: "PIERS"' while user typed "WP".
  for (const r of regionMeta) {
    const def = defaultTextByKey.get(r.key);
    const user = (textByKey.get(r.key) ?? "").trim();
    if (!def || !user) continue;
    out = replaceAllLoose(out, def, user);
  }

  // Fallback: if keys didn't match but we have same-length arrays, replace by index.
  if (texts.length && regionMeta.length) {
    const n = Math.min(texts.length, regionMeta.length);
    for (let i = 0; i < n; i++) {
      const r = regionMeta[i]!;
      const def = defaultTextByKey.get(r.key);
      const user = String(texts[i]?.value ?? "").trim();
      if (!def || !user) continue;
      out = replaceAllLoose(out, def, user);
    }
  }

  return out;
}

function replaceAllLoose(haystack: string, needle: string, replacement: string) {
  // Replace both quoted and unquoted occurrences. Keep it simple and deterministic.
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = new RegExp(`(\"${escaped}\"|\\b${escaped}\\b)`, "g");
  return haystack.replace(rx, (m) => (m.startsWith("\"") ? JSON.stringify(replacement) : replacement));
}

function coerceAnalyzedTextLayout(value: unknown): {
  block: { centered: boolean; widthPct: number; heightPct: number; leading: string };
  regions: Array<{
    index: number;
    position: string;
    relativeSize: string;
    fillColor: string;
    notes: string;
  }>;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const block = (value as any).block;
  const regions = (value as any).regions;
  if (!block || typeof block !== "object" || !Array.isArray(regions)) return null;

  const centered = Boolean((block as any).centered);
  const widthPct = Number((block as any).widthPct);
  const heightPct = Number((block as any).heightPct);
  const leading = String((block as any).leading ?? "").trim();
  if (!Number.isFinite(widthPct) || !Number.isFinite(heightPct) || !leading) return null;

  const outRegions = regions
    .map((r: any) => {
      const index = Number(r?.index);
      const position = String(r?.position ?? "").trim();
      const relativeSize = String(r?.relativeSize ?? "").trim();
      const fillColor = String(r?.fillColor ?? "").trim();
      const notes = String(r?.notes ?? "").trim();
      if (!Number.isFinite(index) || index <= 0) return null;
      if (!position || !relativeSize || !fillColor) return null;
      return { index, position, relativeSize, fillColor, notes };
    })
    .filter(Boolean) as Array<{
    index: number;
    position: string;
    relativeSize: string;
    fillColor: string;
    notes: string;
  }>;

  if (!outRegions.length) return null;

  return {
    block: { centered, widthPct, heightPct, leading },
    regions: outRegions,
  };
}


