export type Client = {
  id: string;
  name: string;
  defaults: any;
};

export type ClientDefaults = {
  outputSize: "1536x1080" | "1280x720" | "1024x1024" | "1024x1536";
  format: "png" | "jpeg" | "webp";
  quality: "low" | "medium" | "high";
  inputFidelity: "low" | "high";
};

export async function createClient(args: {
  name: string;
  defaults: ClientDefaults;
  timezone?: string;
  primaryColor?: string;
}): Promise<Client> {
  return apiPostJson("/clients", args);
}

export async function updateClient(
  clientId: string,
  args: Partial<{
    name: string;
    defaults: ClientDefaults;
    timezone?: string;
    primaryColor?: string;
  }>,
): Promise<Client> {
  return apiPutJson(`/clients/${clientId}`, args);
}

export type Template = {
  id: string;
  clientId: string;
  name: string;
  imageUrl: string | null;
  reconstructionPrompt: string | null;
  reconstructionSpec: unknown | null;
  outputSize: string;
  config: any;
  updatedAt: string;
};

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export async function apiPostJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export async function apiPutJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export async function uploadTemplate(
  clientId: string,
  name: string,
  file: File,
): Promise<Template> {
  const form = new FormData();
  form.append("name", name);
  form.append("image", file);

  const res = await fetch(`${API_URL}/clients/${clientId}/templates/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return (await res.json()) as Template;
}

export type Generation = {
  id: string;
  clientId: string;
  templateId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  outputUrl: string | null;
  createdAt: string;
};

export async function createGeneration(args: {
  clientId: string;
  templateId: string;
  subjectSlotIds: string[];
  subjectFiles: File[];
  texts: Array<{ key: string; value: string }>;
  format?: "png" | "jpeg" | "webp";
  customizations?: Record<string, unknown>;
  userNotes?: string;
}): Promise<Generation> {
  const form = new FormData();
  form.append("templateId", args.templateId);
  form.append("subjectSlotIdsJson", JSON.stringify(args.subjectSlotIds));
  form.append("textsJson", JSON.stringify(args.texts));
  if (args.format) form.append("format", args.format);
  if (args.customizations && Object.keys(args.customizations).length) {
    form.append("customizationsJson", JSON.stringify(args.customizations));
  }
  if (args.userNotes) {
    form.append("userNotes", args.userNotes);
  }
  for (const f of args.subjectFiles) {
    form.append("subjectImages", f);
  }

  const res = await fetch(`${API_URL}/clients/${args.clientId}/generations`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`Generate failed: ${res.status}`);
  return (await res.json()) as Generation;
}

export async function deleteTemplate(templateId: string): Promise<Template> {
  return apiDelete(`/templates/${templateId}`);
}

export async function reanalyzeTemplate(templateId: string): Promise<Template> {
  return apiPostJson(`/templates/${templateId}/reanalyze`, {});
}


