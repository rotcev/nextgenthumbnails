export type BrandColorHex = `#${string}`;

export type ClientDefaults = {
  outputSize: "1536x1080" | "1280x720" | "1024x1024" | "1024x1536";
  format: "png" | "jpeg" | "webp";
  quality: "low" | "medium" | "high";
  inputFidelity: "low" | "high";
};

export type Client = {
  id: string;
  name: string;
  timezone?: string;
  primaryColor?: BrandColorHex;
  defaults: ClientDefaults;
  createdAt: string;
  updatedAt: string;
};

export type TemplateSubjectSlotConfig = {
  id: string;
  label?: string;
  behavior: "replace" | "add" | "optional";
};

export type TemplateTextRegionConfig = {
  id: string;
  label?: string;
  key: string;
  required: boolean;
};

export type TemplateConfig = {
  subjectSlots: TemplateSubjectSlotConfig[];
  textRegions: TemplateTextRegionConfig[];
  outputSize: ClientDefaults["outputSize"];
};


