export type TemplateFormSubjectSlot = {
  id: string;
  label: string;
  required: boolean;
  helpText?: string;
};

export type TemplateFormTextField = {
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
};

export type TemplateFormCustomization =
  | {
      id: string;
      label: string;
      helpText?: string;
      kind: "toggle";
      defaultValue?: boolean;
      onInstruction?: string;
    }
  | {
      id: string;
      label: string;
      helpText?: string;
      kind: "select";
      defaultValue?: string;
      options: Array<{ value: string; label: string; instruction?: string }>;
    };

export type TemplateFormSchemaV1 = {
  version: 1;
  subjectSlots: TemplateFormSubjectSlot[];
  textFields: TemplateFormTextField[];
  customizations?: TemplateFormCustomization[];
  tips?: string[];
};

type TemplateConfigLike = {
  subjectSlots?: Array<{ id?: unknown; label?: unknown; behavior?: unknown }>;
  textRegions?: Array<{ id?: unknown; label?: unknown; key?: unknown; required?: unknown }>;
};

export function deriveFormSchemaFromTemplateConfig(config: TemplateConfigLike): TemplateFormSchemaV1 {
  const subjectSlots = Array.isArray(config?.subjectSlots) ? config.subjectSlots : [];
  const textRegions = Array.isArray(config?.textRegions) ? config.textRegions : [];

  return {
    version: 1,
    subjectSlots: subjectSlots
      .map((s) => {
        const id = String(s?.id ?? "").trim();
        if (!id) return null;
        const label = String(s?.label ?? "").trim() || id;
        const behavior = String(s?.behavior ?? "replace");
        const required = behavior !== "optional";
        return { id, label, required } satisfies TemplateFormSubjectSlot;
      })
      .filter(Boolean) as TemplateFormSubjectSlot[],
    textFields: textRegions
      .map((t) => {
        const key = String(t?.key ?? "").trim();
        if (!key) return null;
        const label = String(t?.label ?? "").trim() || key;
        const required = Boolean(t?.required);
        const placeholder = `Enter ${label}`;
        return { key, label, required, placeholder } satisfies TemplateFormTextField;
      })
      .filter(Boolean) as TemplateFormTextField[],
  };
}

export function coerceFormSchemaForTemplate(
  config: TemplateConfigLike,
  formSchema: unknown,
): TemplateFormSchemaV1 {
  // If anything looks off, fall back to a deterministic schema derived from config.
  const derived = deriveFormSchemaFromTemplateConfig(config);
  if (!formSchema || typeof formSchema !== "object") return derived;

  const version = (formSchema as any).version;
  if (version !== 1) return derived;

  const incomingSlots = Array.isArray((formSchema as any).subjectSlots)
    ? ((formSchema as any).subjectSlots as any[])
    : [];
  const incomingTexts = Array.isArray((formSchema as any).textFields)
    ? ((formSchema as any).textFields as any[])
    : [];

  // Keep IDs/keys consistent with config; merge in human-friendly label/helpText by index.
  const subjectSlots = derived.subjectSlots.map((s, i) => {
    const src = incomingSlots[i] ?? {};
    const label = String(src?.label ?? "").trim() || s.label;
    const helpText = typeof src?.helpText === "string" ? src.helpText : undefined;
    return { ...s, label, helpText };
  });

  const textFields = derived.textFields.map((t, i) => {
    const src = incomingTexts[i] ?? {};
    const label = String(src?.label ?? "").trim() || t.label;
    const helpText = typeof src?.helpText === "string" ? src.helpText : undefined;
    const placeholder = typeof src?.placeholder === "string" ? src.placeholder : t.placeholder;
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
    return { ...t, label, helpText, placeholder, defaultValue, ...(hasStyle ? { style } : {}) };
  });

  const tipsRaw = (formSchema as any).tips;
  const tips =
    Array.isArray(tipsRaw) && tipsRaw.every((x: any) => typeof x === "string")
      ? (tipsRaw as string[])
      : undefined;

  const customizations = coerceCustomizations((formSchema as any).customizations);

  return {
    version: 1,
    subjectSlots,
    textFields,
    ...(customizations?.length ? { customizations } : {}),
    ...(tips ? { tips } : {}),
  };
}

function coerceCustomizations(value: unknown): TemplateFormCustomization[] | null {
  if (!Array.isArray(value)) return null;
  const out: TemplateFormCustomization[] = [];

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
      const onInstruction =
        typeof (raw as any).onInstruction === "string" ? (raw as any).onInstruction : undefined;
      out.push({ id, label, helpText, kind: "toggle", defaultValue, onInstruction });
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
          const instruction = typeof o?.instruction === "string" ? o.instruction : undefined;
          return { value, label, instruction };
        })
        .filter(Boolean) as Array<{ value: string; label: string; instruction?: string }>;
      if (!options.length) continue;
      const defaultValue =
        typeof (raw as any).defaultValue === "string" ? (raw as any).defaultValue : undefined;
      out.push({ id, label, helpText, kind: "select", options, defaultValue });
      continue;
    }
  }

  return out;
}


