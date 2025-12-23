/* eslint-disable
  @typescript-eslint/no-unsafe-assignment,
  @typescript-eslint/no-unsafe-member-access,
  @typescript-eslint/no-unsafe-call,
  @typescript-eslint/no-unsafe-argument
*/
// This file intentionally consumes untyped JSON from Template.config / reconstructionSpec.
import type { Template } from '@prisma/client';

export function buildGenerationPrompt(args: {
  template: Template;
  reconstructionPrompt: string | null;
  subjectSlotIds: string[];
  texts: Array<{ key: string; value: string }>;
  customizations?: Record<string, unknown>;
  userNotes?: string | null;
}) {
  const {
    template,
    reconstructionPrompt,
    subjectSlotIds,
    texts,
    customizations,
    userNotes,
  } = args;
  const isSpecial = Boolean((template as any).isSpecial);

  const config = template.config as any;
  const slots = Array.isArray(config?.subjectSlots) ? config.subjectSlots : [];
  const regions = Array.isArray(config?.textRegions) ? config.textRegions : [];
  const formSchema = config?.formSchema;

  const slotLabelById = new Map<string, string>();
  for (const s of slots) {
    const id = String(s?.id ?? '').trim();
    if (!id) continue;
    const label = String(s?.label ?? '').trim();
    slotLabelById.set(id, label || id);
  }

  const inputImagesSection = isSpecial
    ? buildSpecialInputImagesSection({ subjectSlotIds, slotLabelById })
    : buildStandardInputImagesSection({ subjectSlotIds, slotLabelById });

  const subjectOverrideSection = isSpecial
    ? null
    : subjectSlotIds.length > 0
      ? [
          'SUBJECT OVERRIDE (HIGHEST PRIORITY):',
          '- The template description may describe the original template people (hair, face, clothing, sunglasses, etc.).',
          '- IGNORE those appearance descriptions for any slot that has a replacement image.',
          '- The ONLY source of identity/appearance for replaced subjects is the corresponding replacement image.',
          '- Do NOT blend template features into the replacement. Do NOT "recreate" the template person.',
          '- Do NOT generate a new person; use only the provided replacement people.',
          '',
          'SLOT-TO-IMAGE MATCH (MANDATORY):',
          ...subjectSlotIds.map((slotId, i) => {
            const label = slotLabelById.get(slotId) ?? slotId;
            return `- slotId=${slotId} (${label}) MUST match Image #${i + 2}. If it resembles the template person, the output is WRONG.`;
          }),
        ].join('\n')
      : null;

  const subjectSection = isSpecial
    ? buildSpecialSubjectSection({ slots, subjectSlotIds, slotLabelById })
    : buildStandardSubjectSection({ slots, subjectSlotIds });

  const regionMeta = regions.map((r: any, i: number) => ({
    index: i + 1,
    key: String(r?.key ?? '').trim() || `text_${i + 1}`,
    label: String(r?.label ?? '').trim() || `Text ${i + 1}`,
  }));
  const textByKey = new Map(texts.map((t) => [t.key, t.value]));
  const analyzedTextLayout = coerceAnalyzedTextLayout(
    (template as any).reconstructionSpec?.textRegions,
  );

  const defaultTextByKey = new Map<string, string>();
  const schemaTextFields = Array.isArray(formSchema?.textFields)
    ? formSchema.textFields
    : [];
  const textStyleByKey = new Map<
    string,
    { fillColor?: string; gradient?: string; innerBorder?: boolean }
  >();
  for (const t of schemaTextFields) {
    const key = String(t?.key ?? '').trim();
    const def = String(t?.defaultValue ?? '').trim();
    if (key && def) defaultTextByKey.set(key, def);
    const style = t?.style;
    if (key && style && typeof style === 'object') {
      const fillColor =
        typeof style?.fillColor === 'string' ? style.fillColor : undefined;
      const gradient =
        typeof style?.gradient === 'string' ? style.gradient : undefined;
      const innerBorder =
        typeof style?.innerBorder === 'boolean' ? style.innerBorder : undefined;
      if (fillColor || gradient || typeof innerBorder === 'boolean') {
        textStyleByKey.set(key, { fillColor, gradient, innerBorder });
      }
    }
  }

  // The analysis-driven reconstruction prompt often includes the *literal template words*
  // (e.g. "PIERS") and may even say text must remain unchanged. That conflicts with user text.
  // We rewrite the base prompt by swapping template default words with user-provided words.
  const rewrittenBase = rewriteTemplateTextInPrompt({
    prompt:
      reconstructionPrompt?.trim() ||
      `Recreate the template image exactly (templateId=${template.id}).`,
    regionMeta,
    defaultTextByKey,
    textByKey,
    texts,
  });

  const wantsAlternatingTextColors = Boolean(
    rewrittenBase.match(
      /alternating\s+(white\s*\/\s*red|red\s*\/\s*white|white.*red|red.*white)/i,
    ),
  );
  const alternatingLineHint = wantsAlternatingTextColors
    ? [
        'COLOR RULE (IMPORTANT):',
        '- Preserve the template’s alternating text fill colors.',
        '- Unless the template clearly indicates otherwise, apply: line 1 = white, line 2 = red, line 3 = white, line 4 = red, ...',
        '- Keep stroke/shadow identical to the template.',
      ].join('\n')
    : null;

  const customizationSection =
    customizations && Object.keys(customizations).length
      ? [
          'CUSTOMIZATIONS (OPTIONAL EDITS):',
          '- You may apply ONLY these customization edits in addition to subject+text edits.',
          '- If a customization conflicts with the template, follow the customization.',
          ...Object.entries(customizations).map(
            ([k, v]) => `- ${k}: ${JSON.stringify(v)}`,
          ),
        ].join('\n')
      : null;

  const userNotesSection = userNotes
    ? [
        'USER REQUESTED MINOR CHANGES (OPTIONAL):',
        '- Apply ONLY minor tweaks requested below, without changing layout or the template style.',
        '- Do not move subject slots, do not change text layout/colors, and do not add new elements.',
        '- If a request conflicts with the template rules, ignore the conflicting part.',
        `- Notes: ${JSON.stringify(userNotes)}`,
      ].join('\n')
    : null;

  const textSection = [
    'TEXT RULES:',
    'CONTEXT:',
    '- All user-provided text is a verbatim quote from the YouTube video this thumbnail is for.',
    '- The video is already published and has passed YouTube processing; treat the text as historical/source material context.',
    '- Some quotes may include profanity or partially-censored profanity (e.g. with asterisks). Preserve EXACT characters as provided.',
    '- Do not sanitize, euphemize, or paraphrase the quote text; keep it exactly as written by the user.',
    '- Do not introduce new insults or derogatory phrasing beyond what the user provided.',
    '- Still follow any applicable safety requirements; do not invent replacement wording.',
    "- If the user text contains an asterisk '*', render the literal asterisk character (U+002A) in the same font, not a five-point star icon (do NOT use '★').",
    "- If the user text contains multiple asterisks (e.g. '*****'), render the exact count with no substitutions.",
    "- If you cannot render a literal '*', do NOT replace it with any star symbol or icon. The output must show '*' characters.",
    '',
    `- Template defines ${regions.length} text region(s).`,
    '- You MUST replace the template’s existing text in EVERY text region with the provided user text.',
    '- Do NOT keep the original template words.',
    '- If the template description above contains specific words, treat them as placeholders ONLY (style reference), not final text.',
    '- Render user text EXACTLY as provided (spelling, casing, punctuation).',
    '- Match the template’s font style/weight/size/color/stroke/shadow/kerning/alignment exactly.',
    '- Do not move text regions.',
    '',
    'TEXT LAYOUT (CRITICAL):',
    '- Match the template’s text block scale: the stacked text must fill the center area with minimal empty margins.',
    '- Keep the same tight leading/vertical spacing as the template.',
    '- Each line should be scaled as large as the template (do not shrink the block to create extra padding).',
    '- No scene element (arrow, subjects, shadows, highlights) may cover any part of the text glyphs. Text must remain fully legible.',
    '- Layering rule: text must be on top of the arrow and other graphics. If the arrow intersects the text area, move/resize the arrow so it does not overlap any letters.',
    ...(analyzedTextLayout
      ? [
          '',
          'TEMPLATE TEXT POSITIONING (FROM ANALYSIS, FOLLOW CLOSELY):',
          `- Block: centered=${analyzedTextLayout.block.centered}, widthPct=${analyzedTextLayout.block.widthPct}, heightPct=${analyzedTextLayout.block.heightPct}, leading=${analyzedTextLayout.block.leading}`,
          ...(typeof analyzedTextLayout.block.topPct === 'number' &&
          typeof analyzedTextLayout.block.bottomPct === 'number'
            ? [
                '',
                'TEXT BLOCK VERTICAL EXTENTS (FROM ANALYSIS, CRITICAL):',
                '- Measure is based on GLYPHS ONLY (ignore shadow/glow).',
                `- Target: topmost glyph bound at ~${analyzedTextLayout.block.topPct}% of canvas height.`,
                `- Target: bottommost glyph bound at ~${analyzedTextLayout.block.bottomPct}% of canvas height.`,
                '- PRIORITY: match vertical extents (top/bottom) over fitting line width.',
                "- If the user text is shorter (e.g. 'WP', 'OFF!!!'), DO NOT shrink font size. Allow extra horizontal whitespace instead.",
                '- Keep top and bottom margins within ±2% of canvas height compared to the template.',
                '- Do NOT vertically shrink the text block to create extra empty space.',
                '- If there is any ambiguity, push the bottom line DOWN to match the target bottomPct (do not leave extra padding).',
                ...(analyzedTextLayout.block.bottomPct >= 96
                  ? [
                      '- This template is near full-height: the bottom of the last line should be essentially flush with the bottom edge (0–1% margin).',
                    ]
                  : []),
              ]
            : []),
          ...analyzedTextLayout.regions.map(
            (r) =>
              `- Line ${r.index}: fillColor=${r.fillColor}; position=${r.position}; size=${r.relativeSize}; notes=${r.notes}`,
          ),
          '',
          'COLOR OVERRIDE:',
          '- If analysis provides a fillColor per line, you MUST use that fill color for that line (no exceptions).',
          "- Do NOT 'harmonize' colors across lines; preserve the per-line scheme exactly.",
        ]
      : []),
    ...(alternatingLineHint ? ['', alternatingLineHint] : []),
    '',
    'TEXT REGION MAPPING (MANDATORY, IN ORDER):',
    ...regionMeta.map((r) => {
      const v = textByKey.get(r.key) ?? '';
      const analyzed = analyzedTextLayout?.regions.find(
        (x) => x.index === r.index,
      );
      const style = textStyleByKey.get(r.key);
      const fillColor = style?.fillColor ?? analyzed?.fillColor;
      const gradient = style?.gradient;
      const innerBorder =
        typeof style?.innerBorder === 'boolean'
          ? String(style.innerBorder)
          : null;
      const styleBits = [
        fillColor ? `fillColor=${fillColor}` : null,
        gradient ? `gradient=${gradient}` : null,
        innerBorder ? `innerBorder=${innerBorder}` : null,
      ].filter(Boolean);
      const styleHint = styleBits.length ? `, ${styleBits.join(', ')}` : '';
      return `- Region #${r.index} (${r.label}, key=${r.key}${styleHint}): ${JSON.stringify(v)}`;
    }),
    '',
    'FINAL CHECK:',
    '- The final image MUST visibly contain all provided text strings in their regions.',
    "- If the user provided '*', the output must contain '*' characters (not stars) with the exact count.",
    '- Ensure the arrow does not overlap or obscure any text.',
  ].join('\n');

  const globalConstraints = [
    'GLOBAL HARD CONSTRAINTS:',
    '- Apply HDR lighting and HDR-style micro-contrast consistently across the entire image (subjects, text, and background).',
    ...(isSpecial
      ? [
          '- This is a SPECIAL TEMPLATE: background may be replaced ONLY if the background slot image is provided.',
          '- All non-background overlays (text, arrow, frames, UI boxes, borders, glow/stroke effects) must remain identical to the template.',
        ]
      : [
          '- Background remains identical unless explicitly editable (assume NOT editable).',
        ]),
    '- No creative reinterpretation. No style drift. No additional elements.',
    '- Edits must be surgical and deterministic.',
  ].join('\n');

  return [
    ...(subjectOverrideSection ? [subjectOverrideSection, ''] : []),
    rewrittenBase,
    '',
    inputImagesSection,
    '',
    subjectSection,
    '',
    ...(customizationSection ? [customizationSection, ''] : []),
    ...(userNotesSection ? [userNotesSection, ''] : []),
    textSection,
    '',
    globalConstraints,
  ].join('\n');
}

export function buildSpecialBackgroundPassPrompt(args: {
  template: Template;
  userNotes?: string | null;
}) {
  const { template, userNotes } = args;
  const notes = userNotes?.trim() ? userNotes.trim() : null;
  return [
    'SPECIAL TEMPLATE — BACKGROUND REPLACEMENT (MASKED):',
    '- You will ONLY modify pixels where the mask is fully transparent (alpha=0).',
    '- Use Image #2 (background upload) to replace the entire BACKGROUND layer inside the masked region.',
    '- If the background upload contains people, preserve their natural appearance; do not add violence, weapons, injury, or any explicit content.',
    '- Preserve everything outside the mask EXACTLY (text styling/placement, arrow, borders, glow/stroke effects, and all overlays).',
    '- Maintain the template’s overall background feel including the orange gradient overlay if present.',
    ...(notes ? ['', `USER NOTES (MINOR ONLY): ${JSON.stringify(notes)}`] : []),
    '',
    `TemplateId=${template.id}`,
  ].join('\n');
}

export function buildSpecialMainPassPrompt(args: {
  template: Template;
  userNotes?: string | null;
}) {
  const { template, userNotes } = args;
  const notes = userNotes?.trim() ? userNotes.trim() : null;
  return [
    'SPECIAL TEMPLATE — MAIN SUBJECT REPLACEMENT (MASKED):',
    '- You will ONLY modify pixels where the mask is fully transparent (alpha=0).',
    '- Use Image #2 (main subject upload) as the ONLY source of identity/appearance for the main subject inside the masked region.',
    '- Remove the original template main subject entirely (no leftover face/hair/hands).',
    '- Make the main subject significantly larger and more prominent within the masked region: zoom in, with the head taking up the majority of the available space (natural proportions).',
    '- Preserve EVERYTHING outside the mask exactly, including whatever text is already present.',
    ...(notes ? ['', `USER NOTES (MINOR ONLY): ${JSON.stringify(notes)}`] : []),
    '',
    `TemplateId=${template.id}`,
  ].join('\n');
}

export function buildSpecialChangeTextPrompt(args: {
  template: Template;
  line1: string;
  line2: string;
  userNotes?: string | null;
}) {
  const { template, line1, line2, userNotes } = args;
  const notes = userNotes?.trim() ? userNotes.trim() : null;
  return [
    'Change the text to the following while keeping EVERYTHING ELSE identical:',
    '- Do not change any pixels except the text glyphs themselves.',
    '- Preserve the exact font style, stroke, shadow, gradients, kerning, and placement.',
    '- Do not add/remove any shapes, panels, boxes, or background fills.',
    '',
    'New text:',
    String(line1 ?? ''),
    String(line2 ?? ''),
    ...(notes ? ['', `USER NOTES (MINOR ONLY): ${JSON.stringify(notes)}`] : []),
    '',
    `TemplateId=${template.id}`,
  ].join('\n');
}

function buildStandardInputImagesSection(args: {
  subjectSlotIds: string[];
  slotLabelById: Map<string, string>;
}) {
  const { subjectSlotIds, slotLabelById } = args;
  return [
    'INPUT IMAGES (ORDER IS IMPORTANT):',
    '- Image #1 is the template image (base canvas).',
    ...(subjectSlotIds.length
      ? subjectSlotIds.map((slotId, i) => {
          const label = slotLabelById.get(slotId) ?? slotId;
          // The OpenAI Images API does not let us label each image part, so we must do it in text.
          return `- Image #${i + 2} is the replacement subject for slotId=${slotId} (${label}).`;
        })
      : ['- No subject replacement images were provided.']),
    '',
    'CRITICAL:',
    '- You MUST replace ONLY the subjects in the provided slot IDs using their corresponding replacement images.',
    '- Do NOT keep the original template person(s) in those slots.',
    '- Template faces are placeholders. When replacement images are provided, the original template people must be completely removed.',
    '- All other pixels must remain identical to the template unless required to composite the new subject cleanly.',
  ].join('\n');
}

function buildSpecialInputImagesSection(args: {
  subjectSlotIds: string[];
  slotLabelById: Map<string, string>;
}) {
  const { subjectSlotIds, slotLabelById } = args;
  const orderLines =
    subjectSlotIds.length > 0
      ? subjectSlotIds.map((slotId, i) => {
          const label = slotLabelById.get(slotId) ?? slotId;
          return `- Image #${i + 2} is the replacement image for slotId=${slotId} (${label}).`;
        })
      : ['- No replacement images were provided.'];

  return [
    'SPECIAL TEMPLATE MODE:',
    '- This template uses exactly one MAIN SUBJECT image plus one BACKGROUND image (when provided).',
    '- IMPORTANT: In special templates, everything that is NOT the MAIN SUBJECT counts as BACKGROUND (scene + any other people/objects).',
    '',
    'INPUT IMAGES (ORDER IS IMPORTANT):',
    '- Image #1 is the template image (base canvas).',
    ...orderLines,
    '',
    'CRITICAL:',
    '- Only apply edits for the provided slot IDs.',
    '- If a BACKGROUND image is provided, replace the entire background (scene + any non-main people/objects) using that image, while keeping overlays identical and maintaining the gradient background(which is typically orange) that covers the entire thumbnail.',
    '- If a MAIN SUBJECT image is provided, replace ONLY the foreground main subject using that image.',
  ].join('\n');
}

function buildStandardSubjectSection(args: {
  slots: any[];
  subjectSlotIds: string[];
}) {
  const { slots, subjectSlotIds } = args;
  return [
    'SUBJECT RULES:',
    `- Template defines ${slots.length} subject slot(s).`,
    `- Only modify subject(s) for provided slot IDs: ${subjectSlotIds.join(', ') || '(none)'}.`,
    '- Aside from subjects and text updates, do not alter other elements.',
    "- Identity must come from the replacement image(s) only. Do NOT blend the template subject's facial features with the replacement subject.",
    '- There must be exactly one subject per slot; do not duplicate or keep any partial original face/hand from the template in that slot.',
    '- Subjects must never be cropped more than 1 inch above the head.',
    '- Match the template framing/scale/pose as closely as possible while using the replacement subject identity.',
    '- Preserve lighting direction/intensity and color grading; ensure the composite looks native to the template.',
    '',
    'SUBJECT FINAL CHECK:',
    '- If any recognizable part of a template person remains in a slot that was provided with a replacement image, the output is WRONG.',
  ].join('\n');
}

function buildSpecialSubjectSection(args: {
  slots: any[];
  subjectSlotIds: string[];
  slotLabelById: Map<string, string>;
}) {
  const { slots, subjectSlotIds, slotLabelById } = args;
  const backgroundSlotId =
    subjectSlotIds.find((id) => id === 'background') ?? null;
  const mainSlotId =
    subjectSlotIds.find((id) => id === 'main') ??
    subjectSlotIds.find((id) => id !== backgroundSlotId) ??
    null;

  const backgroundLabel = backgroundSlotId
    ? (slotLabelById.get(backgroundSlotId) ?? backgroundSlotId)
    : null;
  const mainLabel = mainSlotId
    ? (slotLabelById.get(mainSlotId) ?? mainSlotId)
    : null;

  return [
    'SPECIAL TEMPLATE SUBJECT/BACKGROUND RULES:',
    `- Template defines ${slots.length} slot(s).`,
    `- Only modify provided slot IDs: ${subjectSlotIds.join(', ') || '(none)'}.`,
    '- Treat the template as having TWO editable layers: BACKGROUND (everything except overlays + main subject) and MAIN SUBJECT (foreground).',
    '- Everyone/everything in the template that is NOT the MAIN SUBJECT is part of the BACKGROUND.',
    '- Keep overlays identical: text styling/placement, arrows, borders, UI boxes, glow/stroke effects, shadows, and any graphic elements must match the template.',
    '',
    ...(backgroundSlotId
      ? [
          'BACKGROUND REPLACEMENT:',
          `- slotId=${backgroundSlotId} (${backgroundLabel}) is the BACKGROUND image.`,
          '- Replace the entire background using that image: scenery + any non-main people/objects from the template background must be removed/replaced.',
          '- If the template contains multiple other faces/people (e.g. a grid of participants), those are NOT subjects in special mode; they are BACKGROUND and must be replaced when a background image is provided.',
          '- Keep all overlays identical and on top (text/arrow/frames/glow/strokes).',
          '- Do not change the MAIN SUBJECT unless the main subject slot is also provided.',
          '',
        ]
      : []),
    ...(mainSlotId
      ? [
          'MAIN SUBJECT REPLACEMENT:',
          `- slotId=${mainSlotId} (${mainLabel}) is the MAIN SUBJECT image.`,
          '- Replace only the main subject using that image. Remove the original template subject entirely.',
          '- Use the provided main subject image as the ONLY source of identity/appearance. Do not blend template facial features.',
          '- Keep framing/scale/pose as close to the template as possible.',
          '- Subjects must never be cropped more than 1 inch above the head.',
          '- Match lighting direction/intensity and color grading so the composite looks native.',
          '',
        ]
      : []),
    'FINAL CHECK:',
    '- If any recognizable part of the original template subject remains when a main subject replacement was provided, the output is WRONG.',
  ].join('\n');
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
    const user = (textByKey.get(r.key) ?? '').trim();
    if (!def || !user) continue;
    out = replaceAllLoose(out, def, user);
  }

  // Fallback: if keys didn't match but we have same-length arrays, replace by index.
  if (texts.length && regionMeta.length) {
    const n = Math.min(texts.length, regionMeta.length);
    for (let i = 0; i < n; i++) {
      const r = regionMeta[i];
      const def = defaultTextByKey.get(r.key);
      const user = String(texts[i]?.value ?? '').trim();
      if (!def || !user) continue;
      out = replaceAllLoose(out, def, user);
    }
  }

  return out;
}

function replaceAllLoose(
  haystack: string,
  needle: string,
  replacement: string,
) {
  // Replace both quoted and unquoted occurrences. Keep it simple and deterministic.
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`("${escaped}"|\\b${escaped}\\b)`, 'g');
  return haystack.replace(rx, (m) =>
    m.startsWith('"') ? JSON.stringify(replacement) : replacement,
  );
}

function coerceAnalyzedTextLayout(value: unknown): {
  block: {
    centered: boolean;
    widthPct: number;
    heightPct: number;
    topPct?: number;
    bottomPct?: number;
    leading: string;
  };
  regions: Array<{
    index: number;
    position: string;
    relativeSize: string;
    fillColor: string;
    notes: string;
  }>;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const block = (value as any).block;
  const regions = (value as any).regions;
  if (!block || typeof block !== 'object' || !Array.isArray(regions))
    return null;

  const centered = Boolean(block.centered);
  const widthPct = Number(block.widthPct);
  const heightPct = Number(block.heightPct);
  const topPctRaw = block.topPct;
  const bottomPctRaw = block.bottomPct;
  const leading = String(block.leading ?? '').trim();
  if (!Number.isFinite(widthPct) || !Number.isFinite(heightPct) || !leading)
    return null;

  const topPct =
    typeof topPctRaw === 'number' && Number.isFinite(topPctRaw)
      ? topPctRaw
      : undefined;
  const bottomPct =
    typeof bottomPctRaw === 'number' && Number.isFinite(bottomPctRaw)
      ? bottomPctRaw
      : undefined;
  const hasExtents =
    typeof topPct === 'number' &&
    typeof bottomPct === 'number' &&
    topPct >= 0 &&
    bottomPct <= 100 &&
    topPct < bottomPct;

  const outRegions = regions
    .map((r: any) => {
      const index = Number(r?.index);
      const position = String(r?.position ?? '').trim();
      const relativeSize = String(r?.relativeSize ?? '').trim();
      const fillColor = String(r?.fillColor ?? '').trim();
      const notes = String(r?.notes ?? '').trim();
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
    block: {
      centered,
      widthPct,
      heightPct,
      ...(hasExtents ? { topPct, bottomPct } : null),
      leading,
    },
    regions: outRegions,
  };
}
