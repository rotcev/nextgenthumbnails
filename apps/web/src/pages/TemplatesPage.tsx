import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { apiGet, deleteTemplate, type Client, type Template, uploadTemplate } from "../lib/api";
import { Button } from "../components/Button";
import { Skeleton } from "../components/Skeleton";
import { ClientsModal } from "../components/ClientsModal";
import { ImageDropzone } from "../components/ImageDropzone";

export function TemplatesPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const clientsQuery = useQuery({
    queryKey: ["clients"],
    queryFn: () => apiGet<Client[]>("/clients"),
  });

  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const clientId = selectedClientId || clientsQuery.data?.[0]?.id || "";

  const templatesQuery = useQuery({
    queryKey: ["templates", clientId],
    queryFn: () => apiGet<Template[]>(`/clients/${clientId}/templates`),
    enabled: Boolean(clientId),
  });

  const selectedClient = useMemo(
    () => clientsQuery.data?.find((c) => c.id === clientId),
    [clientsQuery.data, clientId],
  );

  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isClientsOpen, setIsClientsOpen] = useState(false);
  const uploadMutation = useMutation({
    mutationFn: async ({ name, file, isSpecial }: { name: string; file: File; isSpecial: boolean }) => {
      if (!clientId) throw new Error("No client selected");
      return uploadTemplate(clientId, name, file, { isSpecial });
    },
    onSuccess: async () => {
      setIsUploadOpen(false);
      await qc.invalidateQueries({ queryKey: ["templates", clientId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (templateId: string) => {
      if (!templateId) throw new Error("Missing templateId");
      return deleteTemplate(templateId);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["templates", clientId] });
    },
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Templates</h1>
          <p className="mt-1 text-sm text-white/60">
            Pick a template. Advanced configuration is available but optional.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button className="bg-white/5 hover:bg-white/10" onClick={() => setIsClientsOpen(true)}>
            Clients
          </Button>
          <Button onClick={() => setIsUploadOpen(true)}>+ New template</Button>
        </div>
      </header>

      <div className="mt-6 flex items-center gap-3">
        <div className="text-sm text-white/60">Client</div>
        {clientsQuery.isLoading ? (
          <Skeleton className="h-10 w-64" />
        ) : (
          <select
            className="h-10 w-64 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white outline-none focus:border-white/20"
            value={clientId}
            onChange={(e) => setSelectedClientId(e.target.value)}
          >
            {(clientsQuery.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        {selectedClient ? (
          <div className="text-xs text-white/40">ID: {selectedClient.id}</div>
        ) : null}
      </div>

      <section className="mt-6">
        {templatesQuery.isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <Skeleton className="h-40 w-full" />
                <Skeleton className="mt-4 h-4 w-3/4" />
                <Skeleton className="mt-2 h-4 w-1/2" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {(templatesQuery.data ?? []).map((t) => (
              <div key={t.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="aspect-video overflow-hidden rounded-xl bg-black/30">
                  {t.imageUrl ? (
                    <img
                      className="h-full w-full object-cover"
                      src={`${import.meta.env.VITE_API_URL ?? "http://localhost:3000"}${t.imageUrl}`}
                      alt={t.name}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-white/40">
                      No image yet
                    </div>
                  )}
                </div>
                <div className="mt-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-semibold">{t.name}</div>
                      {t.isSpecial ? (
                        <div className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
                          Special
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-white/50">
                      {t.reconstructionPrompt ? "Analyzed" : "Needs analysis"}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Link
                      className="text-xs text-white/70 hover:text-white transition"
                      to={`/templates/${t.id}/advanced`}
                    >
                      Advanced
                    </Link>
                    <button
                      type="button"
                      className="text-xs text-red-300/80 hover:text-red-200 transition disabled:opacity-40"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        const ok = window.confirm(
                          `Delete “${t.name}”? This will remove it from your template list.`,
                        );
                        if (!ok) return;
                        deleteMutation.mutate(t.id);
                      }}
                      aria-label={`Delete template ${t.name}`}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="mt-4">
                  <Button
                    className="w-full"
                    onClick={() => nav(`/generate/${t.id}`)}
                  >
                    Use template
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {isUploadOpen ? (
        <UploadModal
          onClose={() => setIsUploadOpen(false)}
          onSubmit={(name, file, isSpecial) => uploadMutation.mutate({ name, file, isSpecial })}
          isLoading={uploadMutation.isPending}
          error={uploadMutation.error ? String(uploadMutation.error) : null}
        />
      ) : null}

      <ClientsModal
        isOpen={isClientsOpen}
        onClose={() => setIsClientsOpen(false)}
        selectedClientId={clientId}
        onSelectClientId={(id) => setSelectedClientId(id)}
      />
    </div>
  );
}

function UploadModal({
  onClose,
  onSubmit,
  isLoading,
  error,
}: {
  onClose: () => void;
  onSubmit: (name: string, file: File, isSpecial: boolean) => void;
  isLoading: boolean;
  error: string | null;
}) {
  const [name, setName] = useState("New Template");
  const [file, setFile] = useState<File | null>(null);
  const [isSpecial, setIsSpecial] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-neutral-950 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold">New template</div>
            <div className="mt-1 text-xs text-white/60">
              Upload an image. We’ll analyze it for reconstruction details.
            </div>
          </div>
          <button
            className="text-white/60 hover:text-white transition"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 grid gap-3">
          <label className="grid gap-1">
            <div className="text-xs text-white/60">Name</div>
            <input
              className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm outline-none focus:border-white/20"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <label className="grid gap-1">
            <div className="text-xs text-white/60">Template image</div>
            <ImageDropzone
              value={file}
              onChange={setFile}
              accept="image/png,image/jpeg,image/webp"
              placeholder="Drag & drop a template image, or click to browse"
            />
          </label>

          <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
            <input
              className="mt-1"
              type="checkbox"
              checked={isSpecial}
              onChange={(e) => setIsSpecial(e.target.checked)}
            />
            <div className="grid gap-1">
              <div className="text-sm font-medium text-white/90">Special template</div>
              <div className="text-xs text-white/60">
                Uses one <span className="text-white/80">background</span> image + one{" "}
                <span className="text-white/80">main subject</span> image + text.
              </div>
            </div>
          </label>

          {error ? <div className="text-xs text-red-300">{error}</div> : null}
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <Button className="bg-white/5 hover:bg-white/10" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            isLoading={isLoading}
            onClick={() => {
              if (!file) return;
              onSubmit(name.trim() || "New Template", file, isSpecial);
            }}
          >
            Upload & analyze
          </Button>
        </div>
      </div>
    </div>
  );
}


