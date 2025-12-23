import { useMemo, useState } from "react";

type Props = {
  value: File | null;
  onChange: (file: File | null) => void;
  accept?: string;
  disabled?: boolean;
  placeholder?: string;
};

export function ImageDropzone({ value, onChange, accept, disabled, placeholder }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const acceptLabel = useMemo(() => humanizeAccept(accept), [accept]);

  function setFile(next: File | null) {
    setError(null);
    onChange(next);
  }

  function trySetFile(file: File | null) {
    if (!file) {
      setFile(null);
      return;
    }
    if (!isFileAccepted(file, accept)) {
      setError(`Unsupported file type. Allowed: ${acceptLabel}`);
      return;
    }
    setFile(file);
  }

  return (
    <div className="grid gap-2">
      <label
        className={[
          "group relative grid cursor-pointer select-none gap-2 rounded-xl border border-dashed p-3 transition",
          "bg-white/5",
          isDragging ? "border-white/30 bg-white/10" : "border-white/15 hover:border-white/25",
          disabled ? "cursor-not-allowed opacity-50" : "",
        ].join(" ")}
        onDragEnter={(e) => {
          if (disabled) return;
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(true);
        }}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          if (disabled) return;
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(false);
        }}
        onDrop={(e) => {
          if (disabled) return;
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(false);
          trySetFile(e.dataTransfer.files?.[0] ?? null);
        }}
      >
        <input
          className="sr-only"
          type="file"
          accept={accept}
          disabled={disabled}
          onChange={(e) => trySetFile(e.target.files?.[0] ?? null)}
        />

        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1">
            <div className="text-sm font-medium text-white/90">
              {value ? value.name : placeholder ?? "Drag & drop an image, or click to browse"}
            </div>
            <div className="text-xs text-white/50">{acceptLabel}</div>
          </div>

          {value ? (
            <button
              type="button"
              className="text-xs text-white/60 hover:text-white transition"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setFile(null);
              }}
              disabled={disabled}
            >
              Remove
            </button>
          ) : null}
        </div>
      </label>

      {error ? <div className="text-xs text-red-300">{error}</div> : null}
    </div>
  );
}

function humanizeAccept(accept: string | undefined) {
  const raw = (accept ?? "").trim();
  if (!raw) return "Any file";
  if (raw === "image/*") return "Images";
  if (raw.includes("image/png") || raw.includes("image/jpeg") || raw.includes("image/webp")) {
    return "PNG, JPEG, or WebP";
  }
  return raw;
}

function isFileAccepted(file: File, accept: string | undefined) {
  const raw = (accept ?? "").trim();
  if (!raw) return true;

  const tokens = raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.length) return true;

  const fileType = (file.type ?? "").toLowerCase();
  const fileName = (file.name ?? "").toLowerCase();

  for (const tokenRaw of tokens) {
    const token = tokenRaw.toLowerCase();
    if (!token) continue;

    // extension match (".png")
    if (token.startsWith(".")) {
      if (fileName.endsWith(token)) return true;
      continue;
    }

    // mime wildcard ("image/*")
    if (token.endsWith("/*")) {
      const prefix = token.slice(0, token.length - 1); // keep trailing "/"
      if (fileType.startsWith(prefix)) return true;
      continue;
    }

    // exact mime ("image/png")
    if (fileType && fileType === token) return true;
  }

  return false;
}

