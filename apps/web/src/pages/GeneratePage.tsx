import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { apiGet, createGeneration, type Template } from "../lib/api";
import { getTemplateFormSchema } from "../lib/templateForm";
import { Button } from "../components/Button";
import { Skeleton } from "../components/Skeleton";
import { ImageDropzone } from "../components/ImageDropzone";

export function GeneratePage() {
  const { templateId } = useParams();
  const templateQuery = useQuery({
    queryKey: ["template", templateId],
    queryFn: () => apiGet<Template>(`/templates/${templateId}`),
    enabled: Boolean(templateId),
  });

  const template = templateQuery.data ?? null;
  const form = useMemo(() => getTemplateFormSchema(template), [template]);

  const [subjectFilesBySlot, setSubjectFilesBySlot] = useState<Record<string, File | null>>({});
  const [textByKey, setTextByKey] = useState<Record<string, string>>({});
  const [customizationById, setCustomizationById] = useState<Record<string, unknown>>({});
  const [userNotes, setUserNotes] = useState<string>("");

  const requiredSlots = useMemo(
    () => form.subjectSlots.filter((s) => s.required),
    [form.subjectSlots],
  );
  const requiredText = useMemo(() => form.textFields.filter((t) => t.required), [form.textFields]);

  const canGenerate = useMemo(() => {
    if (!template) return false;
    for (const s of requiredSlots) {
      if (!subjectFilesBySlot[s.id]) return false;
    }
    for (const t of requiredText) {
      const v = (textByKey[t.key] ?? "").trim();
      if (!v) return false;
    }
    return true;
  }, [template, requiredSlots, requiredText, subjectFilesBySlot, textByKey]);

  const genMutation = useMutation({
    mutationFn: async () => {
      if (!template) throw new Error("Template not loaded");

      const providedSlots = form.subjectSlots
        .map((s) => s.id)
        .filter((id) => Boolean(subjectFilesBySlot[id]));
      const providedFiles = providedSlots.map((id) => subjectFilesBySlot[id]!).filter(Boolean);

      const texts = form.textFields.map((t) => ({
        key: t.key,
        value: (textByKey[t.key] ?? t.defaultValue ?? "").trimEnd(),
      }));

      return createGeneration({
        clientId: template.clientId,
        templateId: template.id,
        subjectSlotIds: providedSlots,
        subjectFiles: providedFiles,
        texts,
        format: "png",
        customizations: customizationById,
        userNotes: userNotes.trim() ? userNotes.trim() : undefined,
      });
    },
  });

  const apiBase = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
  const outputUrl =
    genMutation.data?.outputUrl ? `${apiBase}${genMutation.data.outputUrl}` : null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link className="text-sm text-white/70 hover:text-white transition" to="/templates">
            ← Templates
          </Link>
          <h1 className="mt-3 text-xl font-semibold tracking-tight">Make a thumbnail</h1>
          <p className="mt-1 text-sm text-white/60">
            Upload photos, type text, click Generate.
          </p>
        </div>
        <Button isLoading={genMutation.isPending} disabled={!canGenerate} onClick={() => genMutation.mutate()}>
          Generate thumbnail
        </Button>
      </header>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_420px]">
        <div className="grid gap-4">
          <StepCard step="1" title="Upload photos">
            {templateQuery.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : form.subjectSlots.length === 0 ? (
              <div className="text-sm text-white/60">No subject uploads required.</div>
            ) : (
              <div className="grid gap-3">
                {form.subjectSlots.map((s) => (
                  <div key={s.id} className="grid gap-1">
                    <div className="text-xs text-white/60">
                      {s.label}
                      {s.required ? " *" : ""}
                    </div>
                    {s.helpText ? (
                      <div className="text-xs text-white/45">{s.helpText}</div>
                    ) : null}
                    <ImageDropzone
                      value={subjectFilesBySlot[s.id] ?? null}
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(file) =>
                        setSubjectFilesBySlot((prev) => ({
                          ...prev,
                          [s.id]: file,
                        }))
                      }
                      placeholder="Drag & drop an image, or click to browse"
                    />
                  </div>
                ))}
              </div>
            )}
          </StepCard>

          <StepCard step="2" title="Type text">
            {templateQuery.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : form.textFields.length === 0 ? (
              <div className="text-sm text-white/60">No text inputs required.</div>
            ) : (
              <div className="grid gap-3">
                {form.textFields.map((t) => (
                  <label key={t.key} className="grid gap-1">
                    <div className="text-xs text-white/60">
                      {t.label}
                      {t.required ? " *" : ""}
                    </div>
                    {t.helpText ? (
                      <div className="text-xs text-white/45">{t.helpText}</div>
                    ) : null}
                    <input
                      className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm outline-none focus:border-white/20"
                      placeholder={t.placeholder}
                      value={textByKey[t.key] ?? t.defaultValue ?? ""}
                      onChange={(e) =>
                        setTextByKey((prev) => ({ ...prev, [t.key]: e.target.value }))
                      }
                    />
                  </label>
                ))}
              </div>
            )}
          </StepCard>

          {form.customizations?.length ? (
            <StepCard step="3" title="Options (optional)">
              <div className="grid gap-3">
                {form.customizations.map((c) => (
                  <div key={c.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-xs text-white/60">{c.label}</div>
                    {c.helpText ? <div className="mt-1 text-xs text-white/45">{c.helpText}</div> : null}

                    {c.kind === "toggle" ? (
                      <label className="mt-3 flex items-center gap-3 text-sm">
                        <input
                          type="checkbox"
                          checked={Boolean(customizationById[c.id] ?? c.defaultValue ?? false)}
                          onChange={(e) =>
                            setCustomizationById((prev) => ({ ...prev, [c.id]: e.target.checked }))
                          }
                        />
                        <span className="text-white/80">Enabled</span>
                      </label>
                    ) : (
                      <select
                        className="mt-3 h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white outline-none focus:border-white/20"
                        value={String(customizationById[c.id] ?? c.defaultValue ?? c.options[0]?.value ?? "")}
                        onChange={(e) =>
                          setCustomizationById((prev) => ({ ...prev, [c.id]: e.target.value }))
                        }
                      >
                        {c.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
              </div>
            </StepCard>
          ) : null}

          <StepCard step={form.customizations?.length ? "4" : "3"} title="Minor changes (optional)">
            <div className="text-sm text-white/60">
              Tell the generator any small tweaks you want (e.g. “make the arrow smaller”, “boost contrast”).
              Keep it short.
            </div>
            <textarea
              className="mt-3 min-h-24 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/20"
              placeholder="Minor changes…"
              maxLength={500}
              value={userNotes}
              onChange={(e) => setUserNotes(e.target.value)}
            />
            <div className="mt-2 text-xs text-white/40">{userNotes.length}/500</div>
          </StepCard>

          <StepCard step={form.customizations?.length ? "5" : "4"} title="Generate">
            <div className="text-sm text-white/60">
              When you’re ready, click <span className="text-white">Generate thumbnail</span>.
            </div>
            {form.tips?.length ? (
              <div className="mt-3 grid gap-1 text-xs text-white/45">
                {form.tips.slice(0, 3).map((t, i) => (
                  <div key={i}>Tip: {t}</div>
                ))}
              </div>
            ) : null}
            {genMutation.error ? (
              <div className="mt-3 text-xs text-red-300">{String(genMutation.error)}</div>
            ) : null}
          </StepCard>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-sm font-semibold">Preview</div>
          <div className="mt-3 aspect-video overflow-hidden rounded-xl bg-black/30">
            {genMutation.isPending ? (
              <div className="h-full w-full p-4">
                <Skeleton className="h-full w-full" />
              </div>
            ) : outputUrl ? (
              <img className="h-full w-full object-contain" src={outputUrl} alt="Generated thumbnail" />
            ) : template?.imageUrl ? (
              <img
                className="h-full w-full object-contain opacity-80"
                src={`${apiBase}${template.imageUrl}`}
                alt="Template preview"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-white/40">
                No preview yet
              </div>
            )}
          </div>

          {outputUrl ? (
            <div className="mt-4 flex gap-3">
              <a
                className="inline-flex h-10 flex-1 items-center justify-center rounded-xl bg-white/10 text-sm font-medium text-white hover:bg-white/15 transition"
                href={outputUrl}
                download
              >
                Download
              </a>
              <Button className="h-10" onClick={() => genMutation.reset()}>
                New
              </Button>
            </div>
          ) : (
            <div className="mt-4 text-xs text-white/50">
              {template?.reconstructionPrompt ? "Ready" : "Tip: analyze the template for best fidelity."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StepCard({
  step,
  title,
  children,
}: {
  step: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">
          {step}
        </div>
        <div className="text-sm font-semibold">{title}</div>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}


