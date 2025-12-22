import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, createClient, updateClient, type Client, type ClientDefaults } from "../lib/api";
import { Button } from "./Button";
import { Skeleton } from "./Skeleton";

export function ClientsModal({
  isOpen,
  onClose,
  selectedClientId,
  onSelectClientId,
}: {
  isOpen: boolean;
  onClose: () => void;
  selectedClientId: string;
  onSelectClientId: (id: string) => void;
}) {
  const qc = useQueryClient();
  const clientsQuery = useQuery({
    queryKey: ["clients"],
    queryFn: () => apiGet<Client[]>("/clients"),
    enabled: isOpen,
  });

  const selected = useMemo(
    () => clientsQuery.data?.find((c) => c.id === selectedClientId) ?? null,
    [clientsQuery.data, selectedClientId],
  );

  const [isCreateMode, setIsCreateMode] = useState(false);

  return isOpen ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-3xl rounded-2xl border border-white/10 bg-neutral-950 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 p-5">
          <div>
            <div className="text-sm font-semibold">Clients</div>
            <div className="mt-1 text-xs text-white/60">
              Create and configure clients here.
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

        <div className="grid grid-cols-1 gap-0 md:grid-cols-[280px_1fr]">
          <div className="border-b border-white/10 p-4 md:border-b-0 md:border-r md:border-white/10">
            <div className="flex items-center justify-between">
              <div className="text-xs text-white/60">Your clients</div>
              <button
                className="text-xs text-white/70 hover:text-white transition"
                onClick={() => setIsCreateMode(true)}
              >
                + New
              </button>
            </div>

            <div className="mt-3 grid gap-2">
              {clientsQuery.isLoading ? (
                <>
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </>
              ) : (
                (clientsQuery.data ?? []).map((c) => (
                  <button
                    key={c.id}
                    className={[
                      "flex h-10 items-center justify-between rounded-xl border px-3 text-left text-sm transition",
                      c.id === selectedClientId
                        ? "border-white/20 bg-white/10"
                        : "border-white/10 bg-white/5 hover:bg-white/10",
                    ].join(" ")}
                    onClick={() => {
                      onSelectClientId(c.id);
                      setIsCreateMode(false);
                    }}
                  >
                    <span className="truncate">{c.name}</span>
                    <span className="text-[10px] text-white/40">Edit</span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="p-4">
            {isCreateMode ? (
              <CreateClientPanel
                onDone={async (newId) => {
                  await qc.invalidateQueries({ queryKey: ["clients"] });
                  onSelectClientId(newId);
                  setIsCreateMode(false);
                }}
              />
            ) : selected ? (
              <EditClientPanel
                key={selected.id}
                client={selected}
                onSaved={async () => {
                  await qc.invalidateQueries({ queryKey: ["clients"] });
                }}
              />
            ) : (
              <div className="text-sm text-white/60">Select a client to edit.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  ) : null;
}

function CreateClientPanel({ onDone }: { onDone: (newId: string) => void }) {
  const createMutation = useMutation({
    mutationFn: async (args: { name: string; defaults: ClientDefaults }) => createClient(args),
    onSuccess: (c) => onDone(c.id),
  });

  const [name, setName] = useState("");
  const [defaults, setDefaults] = useState<ClientDefaults>({
    outputSize: "1536x1080",
    format: "png",
    quality: "high",
    inputFidelity: "high",
  });

  return (
    <div className="grid gap-4">
      <div>
        <div className="text-sm font-semibold">New client</div>
        <div className="mt-1 text-xs text-white/60">Just a name and defaults.</div>
      </div>

      <label className="grid gap-1">
        <div className="text-xs text-white/60">Client name</div>
        <input
          className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm outline-none focus:border-white/20"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="AcmeCo"
        />
      </label>

      <DefaultsEditor defaults={defaults} onChange={setDefaults} />

      {createMutation.error ? (
        <div className="text-xs text-red-300">{String(createMutation.error)}</div>
      ) : null}

      <div className="flex justify-end">
        <Button
          isLoading={createMutation.isPending}
          disabled={!name.trim()}
          onClick={() => createMutation.mutate({ name: name.trim(), defaults })}
        >
          Create client
        </Button>
      </div>
    </div>
  );
}

function EditClientPanel({ client, onSaved }: { client: Client; onSaved: () => void }) {
  const saveMutation = useMutation({
    mutationFn: async (args: { name: string; defaults: ClientDefaults }) =>
      updateClient(client.id, args),
    onSuccess: () => onSaved(),
  });

  const [name, setName] = useState(client.name);
  const [defaults, setDefaults] = useState<ClientDefaults>(() => ({
    outputSize: client.defaults?.outputSize ?? "1536x1080",
    format: client.defaults?.format ?? "png",
    quality: client.defaults?.quality ?? "high",
    inputFidelity: client.defaults?.inputFidelity ?? "high",
  }));

  return (
    <div className="grid gap-4">
      <div>
        <div className="text-sm font-semibold">Edit client</div>
        <div className="mt-1 text-xs text-white/60">{client.id}</div>
      </div>

      <label className="grid gap-1">
        <div className="text-xs text-white/60">Client name</div>
        <input
          className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm outline-none focus:border-white/20"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <DefaultsEditor defaults={defaults} onChange={setDefaults} />

      {saveMutation.error ? (
        <div className="text-xs text-red-300">{String(saveMutation.error)}</div>
      ) : null}

      <div className="flex justify-end">
        <Button
          isLoading={saveMutation.isPending}
          disabled={!name.trim()}
          onClick={() => saveMutation.mutate({ name: name.trim(), defaults })}
        >
          Save changes
        </Button>
      </div>
    </div>
  );
}

function DefaultsEditor({
  defaults,
  onChange,
}: {
  defaults: ClientDefaults;
  onChange: (d: ClientDefaults) => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-xs font-semibold text-white/80">Defaults</div>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <FieldSelect
          label="Output size"
          value={defaults.outputSize}
          onChange={(v) => onChange({ ...defaults, outputSize: v as ClientDefaults["outputSize"] })}
          options={[
            { value: "1536x1080", label: "1536×1080 (default)" },
            { value: "1280x720", label: "1280×720" },
            { value: "1024x1024", label: "1024×1024" },
            { value: "1024x1536", label: "1024×1536" },
          ]}
        />
        <FieldSelect
          label="Format"
          value={defaults.format}
          onChange={(v) => onChange({ ...defaults, format: v as ClientDefaults["format"] })}
          options={[
            { value: "png", label: "PNG" },
            { value: "jpeg", label: "JPEG" },
            { value: "webp", label: "WebP" },
          ]}
        />
        <FieldSelect
          label="Quality"
          value={defaults.quality}
          onChange={(v) => onChange({ ...defaults, quality: v as ClientDefaults["quality"] })}
          options={[
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
          ]}
        />
        <FieldSelect
          label="Input fidelity"
          value={defaults.inputFidelity}
          onChange={(v) =>
            onChange({ ...defaults, inputFidelity: v as ClientDefaults["inputFidelity"] })
          }
          options={[
            { value: "high", label: "High (recommended)" },
            { value: "low", label: "Low" },
          ]}
        />
      </div>
    </div>
  );
}

function FieldSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="grid gap-1">
      <div className="text-xs text-white/60">{label}</div>
      <select
        className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm outline-none focus:border-white/20"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}


