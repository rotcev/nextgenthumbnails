import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { apiGet, apiPutJson, reanalyzeTemplate, type Template } from "../lib/api";
import { Button } from "../components/Button";
import { Skeleton } from "../components/Skeleton";

type Slot = { id: string; label?: string; behavior: "replace" | "add" | "optional" };
type TextRegion = { id: string; label?: string; key: string; required: boolean };

export function TemplateAdvancedPage() {
  const { templateId } = useParams();
  const qc = useQueryClient();

  const templateQuery = useQuery({
    queryKey: ["template", templateId],
    queryFn: () => apiGet<Template>(`/templates/${templateId}`),
    enabled: Boolean(templateId),
  });

  const initial = templateQuery.data?.config as any;
  const [subjectSlots, setSubjectSlots] = useState<Slot[]>(() => initial?.subjectSlots ?? []);
  const [textRegions, setTextRegions] = useState<TextRegion[]>(() => initial?.textRegions ?? []);
  const [outputSize, setOutputSize] = useState<string>(() => initial?.outputSize ?? "1280x720");

  // Keep local state in sync once when the template initially loads.
  const isHydrated = useMemo(() => Boolean(templateQuery.data), [templateQuery.data]);
  useEffect(() => {
    if (!templateQuery.data) return;
    const cfg = templateQuery.data.config as any;
    setSubjectSlots(cfg?.subjectSlots ?? []);
    setTextRegions(cfg?.textRegions ?? []);
    setOutputSize(cfg?.outputSize ?? templateQuery.data.outputSize ?? "1280x720");
  }, [isHydrated, templateQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!templateId) throw new Error("Missing templateId");
      return apiPutJson(`/templates/${templateId}/config`, {
        subjectSlots,
        textRegions,
        outputSize,
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["template", templateId] });
    },
  });

  const reanalyzeMutation = useMutation({
    mutationFn: async () => {
      if (!templateId) throw new Error("Missing templateId");
      return reanalyzeTemplate(templateId);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["template", templateId] });
    },
  });

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Link className="text-sm text-white/70 hover:text-white transition" to="/templates">
              ← Templates
            </Link>
          </div>
          <h1 className="mt-3 text-xl font-semibold tracking-tight">Advanced configuration</h1>
          <p className="mt-1 text-sm text-white/60">
            Keep it minimal. Only define what the generator is allowed to change.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            className="bg-white/5 hover:bg-white/10"
            isLoading={reanalyzeMutation.isPending}
            disabled={saveMutation.isPending}
            onClick={() => reanalyzeMutation.mutate()}
          >
            Re-analyze
          </Button>
          <Button isLoading={saveMutation.isPending} disabled={reanalyzeMutation.isPending} onClick={() => saveMutation.mutate()}>
            Save
          </Button>
        </div>
      </header>

      {reanalyzeMutation.error ? (
        <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-xs text-red-200">
          {String(reanalyzeMutation.error)}
        </div>
      ) : null}

      {templateQuery.isLoading ? (
        <div className="mt-6 grid gap-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : templateQuery.data ? (
        <div className="mt-6 grid gap-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Template</div>
                <div className="mt-1 text-xs text-white/60">{templateQuery.data.name}</div>
              </div>
              <select
                className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm outline-none focus:border-white/20"
                value={outputSize}
                onChange={(e) => setOutputSize(e.target.value)}
              >
                <option value="1536x1080">1536x1080</option>
                <option value="1280x720">1280x720</option>
                <option value="1024x1024">1024x1024</option>
                <option value="1024x1536">1024x1536</option>
              </select>
            </div>
          </div>

          <Section
            title="Subjects"
            subtitle="Define slots for subject replacement or insertion."
            onAdd={() =>
              setSubjectSlots((prev) => [
                ...prev,
                { id: `slot_${prev.length + 1}`, behavior: "replace" },
              ])
            }
          >
            <div className="grid gap-3">
              {subjectSlots.length === 0 ? (
                <div className="text-sm text-white/60">No subject slots yet.</div>
              ) : (
                subjectSlots.map((s, idx) => (
                  <div
                    key={s.id}
                    className="rounded-xl border border-white/10 bg-black/20 p-3"
                  >
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <label className="grid gap-1">
                        <div className="text-xs text-white/60">Slot id</div>
                        <input
                          className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm outline-none focus:border-white/20"
                          value={s.id}
                          onChange={(e) =>
                            setSubjectSlots((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, id: e.target.value } : x)),
                            )
                          }
                        />
                      </label>
                      <label className="grid gap-1">
                        <div className="text-xs text-white/60">Label (optional)</div>
                        <input
                          className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm outline-none focus:border-white/20"
                          value={s.label ?? ""}
                          onChange={(e) =>
                            setSubjectSlots((prev) =>
                              prev.map((x, i) =>
                                i === idx ? { ...x, label: e.target.value || undefined } : x,
                              ),
                            )
                          }
                        />
                      </label>
                      <label className="grid gap-1">
                        <div className="text-xs text-white/60">Behavior</div>
                        <select
                          className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm outline-none focus:border-white/20"
                          value={s.behavior}
                          onChange={(e) =>
                            setSubjectSlots((prev) =>
                              prev.map((x, i) =>
                                i === idx
                                  ? { ...x, behavior: e.target.value as Slot["behavior"] }
                                  : x,
                              ),
                            )
                          }
                        >
                          <option value="replace">Replace</option>
                          <option value="add">Add</option>
                          <option value="optional">Optional</option>
                        </select>
                      </label>
                    </div>
                    <div className="mt-3 flex justify-end">
                      <button
                        className="text-xs text-white/60 hover:text-white transition"
                        onClick={() => setSubjectSlots((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Section>

          <Section
            title="Text"
            subtitle="Define text regions and the keys the user will fill in."
            onAdd={() =>
              setTextRegions((prev) => [
                ...prev,
                { id: `text_${prev.length + 1}`, key: `text_${prev.length + 1}`, required: true },
              ])
            }
          >
            <div className="grid gap-3">
              {textRegions.length === 0 ? (
                <div className="text-sm text-white/60">No text regions yet.</div>
              ) : (
                textRegions.map((t, idx) => (
                  <div
                    key={t.id}
                    className="rounded-xl border border-white/10 bg-black/20 p-3"
                  >
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                      <label className="grid gap-1">
                        <div className="text-xs text-white/60">Region id</div>
                        <input
                          className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm outline-none focus:border-white/20"
                          value={t.id}
                          onChange={(e) =>
                            setTextRegions((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, id: e.target.value } : x)),
                            )
                          }
                        />
                      </label>
                      <label className="grid gap-1">
                        <div className="text-xs text-white/60">Key</div>
                        <input
                          className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm outline-none focus:border-white/20"
                          value={t.key}
                          onChange={(e) =>
                            setTextRegions((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, key: e.target.value } : x)),
                            )
                          }
                        />
                      </label>
                      <label className="grid gap-1">
                        <div className="text-xs text-white/60">Label (optional)</div>
                        <input
                          className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm outline-none focus:border-white/20"
                          value={t.label ?? ""}
                          onChange={(e) =>
                            setTextRegions((prev) =>
                              prev.map((x, i) =>
                                i === idx ? { ...x, label: e.target.value || undefined } : x,
                              ),
                            )
                          }
                        />
                      </label>
                      <label className="grid gap-1">
                        <div className="text-xs text-white/60">Required</div>
                        <select
                          className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm outline-none focus:border-white/20"
                          value={String(t.required)}
                          onChange={(e) =>
                            setTextRegions((prev) =>
                              prev.map((x, i) =>
                                i === idx ? { ...x, required: e.target.value === "true" } : x,
                              ),
                            )
                          }
                        >
                          <option value="true">Yes</option>
                          <option value="false">No</option>
                        </select>
                      </label>
                    </div>
                    <div className="mt-3 flex justify-end">
                      <button
                        className="text-xs text-white/60 hover:text-white transition"
                        onClick={() => setTextRegions((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Section>
        </div>
      ) : (
        <div className="mt-8 text-sm text-white/60">Template not found.</div>
      )}
    </div>
  );
}

function Section({
  title,
  subtitle,
  onAdd,
  children,
}: {
  title: string;
  subtitle: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <div className="mt-1 text-xs text-white/60">{subtitle}</div>
        </div>
        <Button className="h-10" onClick={onAdd}>
          + Add
        </Button>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}


