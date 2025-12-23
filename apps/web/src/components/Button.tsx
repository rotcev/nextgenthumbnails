import { type ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  isLoading?: boolean;
};

export function Button({ className, isLoading, disabled, children, ...rest }: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || isLoading}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white",
        "hover:bg-white/15 active:bg-white/20",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "transition",
        className ?? "",
      ].join(" ")}
    >
      {isLoading ? <Spinner /> : null}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span
      className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
      aria-label="Loading"
    />
  );
}



