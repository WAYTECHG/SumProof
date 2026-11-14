import { ChevronRight } from "lucide-react";
import Link from "next/link";

export function Card({
  title,
  icon,
  action,
  children,
  className = "",
  bodyClassName = "",
}: {
  title?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`min-w-0 rounded-[22px] border border-line bg-surface-solid p-4 shadow-card sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3.5 flex items-center gap-2.5">
          {icon && <span className="text-mocha">{icon}</span>}
          {title && <h2 className="text-[16px] font-bold text-ink">{title}</h2>}
          {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** Gradient page header, like the lead banner in the reference design. */
export function Banner({
  crumbs,
  title,
  pills,
  meta,
  right,
  children,
}: {
  crumbs: { label: string; href?: string }[];
  title: React.ReactNode;
  pills?: React.ReactNode;
  meta?: React.ReactNode;
  right?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="banner mb-5 rounded-[22px] p-5 shadow-card sm:p-6">
      <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-ink">
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight size={14} className="text-ink/50" />}
            {c.href ? (
              <Link href={c.href} className="hover:underline">
                {c.label}
              </Link>
            ) : (
              <span>{c.label}</span>
            )}
          </span>
        ))}
      </nav>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-[24px] font-extrabold tracking-tight text-ink [text-wrap:balance] sm:text-[28px]">{title}</h1>
        {pills && <div className="flex flex-wrap items-center gap-2">{pills}</div>}
        {right && <div className="ml-auto flex flex-wrap items-center gap-2">{right}</div>}
      </div>
      {meta && <div className="mt-2 text-[13.5px] text-ink">{meta}</div>}
      {children}
    </div>
  );
}

const PILL_TONES = {
  dark: "bg-ink text-bg",
  light: "bg-surface-solid text-ink border border-line",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  info: "bg-info-soft text-info",
  mocha: "mocha-grad text-white",
} as const;

export function Pill({ tone = "light", children, className = "" }: { tone?: keyof typeof PILL_TONES; children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold whitespace-nowrap ${PILL_TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function Stat({ label, before, after, note }: { label: string; before: string; after: string; note?: string }) {
  return (
    <div className="rounded-[20px] border border-line bg-surface-solid p-4 shadow-card">
      <p className="text-[12.5px] font-semibold tracking-wide text-muted uppercase">{label}</p>
      <p className="tabular mt-2 flex items-baseline gap-2 text-ink">
        <span className="text-[17px] text-muted line-through decoration-1">{before}</span>
        <span className="text-[13px] text-muted">→</span>
        <span className="text-[30px] leading-none font-extrabold text-mocha-deep">{after}</span>
      </p>
      {note && <p className="mt-2 text-[12.5px] text-muted">{note}</p>}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-xl border border-line bg-sunken p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${
            value === o.value ? "bg-surface-solid text-mocha-deep shadow-card" : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Button({
  children,
  onClick,
  tone = "light",
  href,
  disabled,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tone?: "dark" | "light" | "mocha";
  href?: string;
  disabled?: boolean;
  className?: string;
}) {
  const styles = {
    dark: "bg-ink text-bg hover:opacity-90",
    light: "bg-surface-solid text-ink border border-line hover:border-mocha",
    mocha: "mocha-grad text-white hover:opacity-95",
  }[tone];
  const cls = `inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[14px] font-semibold shadow-card transition disabled:opacity-50 ${styles} ${className}`;
  if (href) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}
