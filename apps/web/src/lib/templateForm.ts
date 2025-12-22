import type { Template } from "./api";

export type TemplateFormSchema = {
  version: 1;
  subjectSlots: Array<{
    id: string;
    label: string;
    required: boolean;
    helpText?: string;
  }>;
  textFields: Array<{
    key: string;
    label: string;
    required: boolean;
    placeholder?: string;
    helpText?: string;
    defaultValue?: string;
    style?: {
      fillColor?: string;
      gradient?: string;
      innerBorder?: boolean;
    };
  }>;
  customizations?: Array<
    | {
        id: string;
        label: string;
        helpText?: string;
        kind: "toggle";
        defaultValue?: boolean;
      }
    | {
        id: string;
        label: string;
        helpText?: string;
        kind: "select";
        defaultValue?: string;
        options: Array<{ value: string; label: string }>;
      }
  >;
  tips?: string[];
};

export function getTemplateFormSchema(template: Template | null): TemplateFormSchema {
  const cfg = (template?.config as any) ?? {};
  const embedded = cfg?.formSchema;
  const fromConfig = deriveFormSchemaFromConfig(cfg);

  if (!embedded || typeof embedded !== "object") return fromConfig;
  if ((embedded as any).version !== 1) return fromConfig;

  // Keep IDs/keys stable from config; merge labels/help by index.
  const incomingSlots = Array.isArray((embedded as any).subjectSlots)
    ? ((embedded as any).subjectSlots as any[])
    : [];
  const incomingTexts = Array.isArray((embedded as any).textFields)
    ? ((embedded as any).textFields as any[])
    : [];

  const subjectSlots = fromConfig.subjectSlots.map((s, i) => {
    const src = incomingSlots[i] ?? {};
    const label = String(src?.label ?? "").trim() || s.label;
    const helpText = typeof src?.helpText === "string" ? src.helpText : undefined;
    return { ...s, label, helpText };
  });

  const textFields = fromConfig.textFields.map((t, i) => {
    const src = incomingTexts[i] ?? {};
    const label = normalizeTextLabel(t.key, String(src?.label ?? "").trim() || t.label);
    const placeholder = typeof src?.placeholder === "string" ? src.placeholder : t.placeholder;
    const helpText = typeof src?.helpText === "string" ? src.helpText : undefined;
    const defaultValue = typeof src?.defaultValue === "string" ? src.defaultValue : undefined;
    const styleRaw = src?.style;
    const style =
      styleRaw && typeof styleRaw === "object"
        ? {
            fillColor: typeof styleRaw?.fillColor === "string" ? styleRaw.fillColor : undefined,
            gradient: typeof styleRaw?.gradient === "string" ? styleRaw.gradient : undefined,
            innerBorder:
              typeof styleRaw?.innerBorder === "boolean" ? styleRaw.innerBorder : undefined,
          }
        : undefined;
    const hasStyle = Boolean(
      style && (style.fillColor || style.gradient || typeof style.innerBorder === "boolean"),
    );
    return {
      ...t,
      label,
      placeholder: normalizePlaceholder(label, placeholder),
      helpText,
      defaultValue,
      ...(hasStyle ? { style } : {}),
    };
  });

  const tipsRaw = (embedded as any).tips;
  const tips =
    Array.isArray(tipsRaw) && tipsRaw.every((x: any) => typeof x === "string")
      ? (tipsRaw as string[])
      : undefined;

  const customizations = coerceCustomizations((embedded as any).customizations);

  return {
    version: 1,
    subjectSlots,
    textFields,
    ...(customizations?.length ? { customizations } : {}),
    ...(tips ? { tips } : {}),
  };
}

function deriveFormSchemaFromConfig(cfg: any): TemplateFormSchema {
  const subjectSlots = Array.isArray(cfg?.subjectSlots) ? cfg.subjectSlots : [];
  const textRegions = Array.isArray(cfg?.textRegions) ? cfg.textRegions : [];

  return {
    version: 1,
    subjectSlots: subjectSlots
      .map((s: any) => {
        const id = String(s?.id ?? "").trim();
        if (!id) return null;
        const label = String(s?.label ?? "").trim() || id;
        const required = String(s?.behavior ?? "replace") !== "optional";
        return { id, label, required };
      })
      .filter(Boolean),
    textFields: textRegions
      .map((t: any) => {
        const key = String(t?.key ?? "").trim();
        if (!key) return null;
        const label = normalizeTextLabel(key, String(t?.label ?? "").trim() || key);
        const required = Boolean(t?.required);
        const placeholder = normalizePlaceholder(label, `Enter ${label}`);
        return { key, label, required, placeholder };
      })
      .filter(Boolean),
  } as TemplateFormSchema;
}

function coerceCustomizations(value: unknown): TemplateFormSchema["customizations"] | null {
  if (!Array.isArray(value)) return null;
  const out: any[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const id = String((raw as any).id ?? "").trim();
    const label = String((raw as any).label ?? "").trim();
    const kind = String((raw as any).kind ?? "").trim();
    if (!id || !label) continue;
    const helpText = typeof (raw as any).helpText === "string" ? (raw as any).helpText : undefined;

    if (kind === "toggle") {
      const defaultValue =
        typeof (raw as any).defaultValue === "boolean" ? (raw as any).defaultValue : undefined;
      out.push({ id, label, helpText, kind: "toggle", defaultValue });
      continue;
    }

    if (kind === "select") {
      const optionsRaw = (raw as any).options;
      if (!Array.isArray(optionsRaw) || optionsRaw.length === 0) continue;
      const options = optionsRaw
        .map((o: any) => {
          const value = String(o?.value ?? "").trim();
          const label = String(o?.label ?? "").trim();
          if (!value || !label) return null;
          return { value, label };
        })
        .filter(Boolean);
      if (!options.length) continue;
      const defaultValue =
        typeof (raw as any).defaultValue === "string" ? (raw as any).defaultValue : undefined;
      out.push({ id, label, helpText, kind: "select", options, defaultValue });
      continue;
    }
  }
  return out;
}

function normalizeTextLabel(key: string, label: string) {
  // Avoid “Title” terminology for stacked thumbnail text; show Text 1 instead.
  if (key === "title" && label.toLowerCase() === "title") return "Text 1";
  return label;
}

function normalizePlaceholder(label: string, placeholder: string | undefined) {
  if (!placeholder) return placeholder;
  // If the placeholder is “Enter Title” but we display “Text 1”, keep them consistent.
  if (label === "Text 1" && placeholder.toLowerCase() === "enter title") return "Enter Text 1";
  return placeholder;
}


