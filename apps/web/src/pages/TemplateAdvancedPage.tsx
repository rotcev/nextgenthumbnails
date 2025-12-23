import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { apiGet, apiPutJson, reanalyzeTemplate, type Template } from "../lib/api";
import { Button } from "../components/Button";
import { Skeleton } from "../components/Skeleton";

type Slot = { id: string; label?: string; behavior: "replace" | "add" | "optional" };
type TextRegion = { id: string; label?: string; key: string; required: boolean };
type PolygonPoint = { xPct: number; yPct: number };
type TemplatePolygon = { id: string; label: string; color: string; points: PolygonPoint[] };

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
  const [polygons, setPolygons] = useState<TemplatePolygon[]>(() => initial?.polygons ?? []);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [draftPoints, setDraftPoints] = useState<PolygonPoint[]>([]);

  // Keep local state in sync once when the template initially loads.
  const isHydrated = useMemo(() => Boolean(templateQuery.data), [templateQuery.data]);
  useEffect(() => {
    if (!templateQuery.data) return;
    const cfg = templateQuery.data.config as any;
    setSubjectSlots(cfg?.subjectSlots ?? []);
    setTextRegions(cfg?.textRegions ?? []);
    setOutputSize(cfg?.outputSize ?? templateQuery.data.outputSize ?? "1280x720");
    setPolygons(Array.isArray(cfg?.polygons) ? (cfg.polygons as any) : []);
  }, [isHydrated, templateQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!templateId) throw new Error("Missing templateId");
      return apiPutJson(`/templates/${templateId}/config`, {
        subjectSlots,
        textRegions,
        outputSize,
        polygons,
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
            title="Polygons (optional)"
            subtitle="Draw labeled regions to enable mask-based precision (background/main/text)."
            hideAdd
            onAdd={() => {}}
          >
            <div className="grid gap-4">
              <div className="text-xs text-white/60">
                Labels to use for special templates: <span className="text-white/80">background</span>,{" "}
                <span className="text-white/80">main</span>,{" "}
                <span className="text-white/80">text:&lt;key&gt;</span> (e.g.{" "}
                <span className="text-white/80">text:title</span>).
              </div>

              {templateQuery.data.imageUrl ? (
                <div className="grid gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-white/60">
                      {isDrawing ? "Drawing: click + drag like a brush; release to finish and label." : "Not drawing"}
                    </div>
                    <div className="flex items-center gap-3">
                      <Button
                        className="bg-white/5 hover:bg-white/10"
                        onClick={() => {
                          setIsDrawing((v) => !v);
                          setDraftPoints([]);
                        }}
                      >
                        {isDrawing ? "Stop drawing" : "Draw polygon"}
                      </Button>
                      <Button
                        className="bg-white/5 hover:bg-white/10"
                        disabled={!polygons.length && !draftPoints.length}
                        onClick={() => {
                          setDraftPoints([]);
                          setPolygons([]);
                        }}
                      >
                        Clear all
                      </Button>
                    </div>
                  </div>

                  <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black/20">
                    <img
                      ref={imgRef}
                      className="block h-auto w-full select-none"
                      src={`${import.meta.env.VITE_API_URL ?? "http://localhost:3000"}${templateQuery.data.imageUrl}`}
                      alt="Template"
                      onLoad={() => redrawPolygons({ canvas: canvasRef.current, polygons, draftPoints })}
                      draggable={false}
                    />
                    <canvas
                      ref={canvasRef}
                      className={`absolute inset-0 h-full w-full ${isDrawing ? "cursor-crosshair" : "pointer-events-none"}`}
                      onPointerDown={(e) => {
                        if (!isDrawing) return;
                        const pt = canvasPointPctFromEvent(canvasRef.current, e);
                        if (!pt) return;
                        e.currentTarget.setPointerCapture(e.pointerId);
                        setDraftPoints([pt]);
                        redrawPolygons({ canvas: canvasRef.current, polygons, draftPoints: [pt] });
                      }}
                      onPointerMove={(e) => {
                        if (!isDrawing) return;
                        if (!draftPoints.length) return;
                        const pt = canvasPointPctFromEvent(canvasRef.current, e);
                        if (!pt) return;
                        setDraftPoints((prev) => {
                          const next = appendPointWithMinSpacing(prev, pt, 0.35);
                          redrawPolygons({ canvas: canvasRef.current, polygons, draftPoints: next });
                          return next;
                        });
                      }}
                      onPointerUp={(e) => {
                        if (!isDrawing) return;
                        if (!draftPoints.length) return;
                        const canvas = canvasRef.current;
                        try {
                          e.currentTarget.releasePointerCapture(e.pointerId);
                        } catch {
                          // ignore
                        }
                        finalizeDraftPolygon({
                          draftPoints,
                          existingPolygons: polygons,
                          setPolygons,
                          setDraftPoints,
                          canvas,
                        });
                      }}
                    />
                  </div>

                  {polygons.length ? (
                    <div className="grid gap-2">
                      {polygons.map((p) => (
                        <div key={p.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
                          <div
                            className="h-4 w-4 rounded"
                            style={{ backgroundColor: p.color }}
                            aria-label={`Polygon color ${p.color}`}
                          />
                          <input
                            className="h-9 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 text-sm outline-none focus:border-white/20"
                            value={p.label}
                            onChange={(e) =>
                              setPolygons((prev) =>
                                prev.map((x) => (x.id === p.id ? { ...x, label: e.target.value } : x)),
                              )
                            }
                          />
                          <button
                            className="text-xs text-white/60 hover:text-white transition"
                            onClick={() => setPolygons((prev) => prev.filter((x) => x.id !== p.id))}
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-white/60">No polygons yet.</div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-white/60">Upload a template image first.</div>
              )}
            </div>
          </Section>

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
  hideAdd,
  addLabel,
  children,
}: {
  title: string;
  subtitle: string;
  onAdd: () => void;
  hideAdd?: boolean;
  addLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <div className="mt-1 text-xs text-white/60">{subtitle}</div>
        </div>
        {hideAdd ? null : (
          <Button className="h-10" onClick={onAdd}>
            {addLabel ?? "+ Add"}
          </Button>
        )}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function canvasPointPctFromEvent(canvas: HTMLCanvasElement | null, e: React.PointerEvent) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const xPct = (x / rect.width) * 100;
  const yPct = (y / rect.height) * 100;
  if (!Number.isFinite(xPct) || !Number.isFinite(yPct)) return null;
  return { xPct: clampPct(xPct), yPct: clampPct(yPct) } satisfies PolygonPoint;
}

function clampPct(n: number) {
  return Math.max(0, Math.min(100, n));
}

function redrawPolygons(args: {
  canvas: HTMLCanvasElement | null;
  polygons: TemplatePolygon[];
  draftPoints: PolygonPoint[];
}) {
  const { canvas, polygons, draftPoints } = args;
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, w, h);

  for (const p of polygons) {
    drawPath({
      ctx,
      w,
      h,
      points: p.points,
      closed: true,
      stroke: p.color,
      fill: `${p.color}33`,
      lineWidth: 3,
    });
  }

  if (draftPoints.length) {
    drawPath({
      ctx,
      w,
      h,
      points: draftPoints,
      closed: false,
      stroke: "#ffffff",
      fill: null,
      lineWidth: 4,
    });
  }
}

function drawPath(args: {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  points: PolygonPoint[];
  closed: boolean;
  stroke: string;
  fill: string | null;
  lineWidth: number;
}) {
  const { ctx, w, h, points, closed, stroke, fill, lineWidth } = args;
  if (points.length < 2) return;
  ctx.beginPath();
  const first = points[0]!;
  ctx.moveTo((first.xPct / 100) * w, (first.yPct / 100) * h);
  for (const pt of points.slice(1)) {
    ctx.lineTo((pt.xPct / 100) * w, (pt.yPct / 100) * h);
  }
  if (closed) ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
}

function finalizeDraftPolygon(args: {
  draftPoints: PolygonPoint[];
  existingPolygons: TemplatePolygon[];
  setPolygons: React.Dispatch<React.SetStateAction<TemplatePolygon[]>>;
  setDraftPoints: React.Dispatch<React.SetStateAction<PolygonPoint[]>>;
  canvas: HTMLCanvasElement | null;
}) {
  const { draftPoints, existingPolygons, setPolygons, setDraftPoints, canvas } = args;
  if (draftPoints.length < 10) return;
  const simplified = simplifyPolyline(draftPoints, 0.45);
  if (simplified.length < 3) return;
  const label = window.prompt(
    "Polygon label (examples: background, main, text:title):",
    "background",
  );
  if (!label?.trim()) {
    setDraftPoints([]);
    redrawPolygons({ canvas, polygons: existingPolygons, draftPoints: [] });
    return;
  }
  const color = pickNextPolygonColor(existingPolygons);
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
  const poly: TemplatePolygon = {
    id,
    label: label.trim(),
    color,
    points: closePolygon(simplified),
  };
  setPolygons((prev) => [...prev, poly]);
  setDraftPoints([]);
  redrawPolygons({ canvas, polygons: [...existingPolygons, poly], draftPoints: [] });
}

function closePolygon(points: PolygonPoint[]) {
  if (points.length < 3) return points;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const dist = Math.hypot(first.xPct - last.xPct, first.yPct - last.yPct);
  return dist <= 0.5 ? points : [...points, first];
}

function appendPointWithMinSpacing(points: PolygonPoint[], next: PolygonPoint, minDistPct: number) {
  const last = points[points.length - 1];
  if (!last) return [next];
  const dist = Math.hypot(last.xPct - next.xPct, last.yPct - next.yPct);
  if (dist < minDistPct) return points;
  return [...points, next];
}

function simplifyPolyline(points: PolygonPoint[], minDistPct: number) {
  // Simple deterministic downsampling for a more “brush-like” feel and fewer points.
  const out: PolygonPoint[] = [];
  for (const p of points) {
    if (!out.length) {
      out.push(p);
      continue;
    }
    const last = out[out.length - 1]!;
    const dist = Math.hypot(last.xPct - p.xPct, last.yPct - p.yPct);
    if (dist >= minDistPct) out.push(p);
  }
  return out;
}

function pickNextPolygonColor(existing: TemplatePolygon[]) {
  const palette = [
    "#22c55e",
    "#3b82f6",
    "#f59e0b",
    "#ef4444",
    "#a855f7",
    "#06b6d4",
    "#e11d48",
    "#84cc16",
  ];
  const used = new Set(existing.map((p) => p.color.toLowerCase()));
  const next = palette.find((c) => !used.has(c.toLowerCase()));
  return next ?? `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}`;
}


