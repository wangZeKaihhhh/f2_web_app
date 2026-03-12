import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface PanelMetric {
  label: string;
  value: string;
  hint?: string;
}

interface PanelHeroProps {
  eyebrow: string;
  title: string;
  description?: string;
  metrics: PanelMetric[];
  actions?: ReactNode;
  notes?: ReactNode;
}

interface SectionCardProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

type StatusTone =
  | "neutral"
  | "running"
  | "success"
  | "danger";

interface StatusBadgeProps {
  children: ReactNode;
  tone?: StatusTone;
  className?: string;
}

const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  neutral: "status-badge-neutral",
  running: "status-badge-running",
  success: "status-badge-success",
  danger: "status-badge-danger",
};

export function PanelHero({
  eyebrow,
  title,
  description,
  metrics,
  actions,
  notes,
}: PanelHeroProps) {
  return (
    <section className="panel-hero shell-panel surface-card">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18.5rem] xl:items-start">
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="section-title">{eyebrow}</p>
            <h2 className="section-heading text-ink">{title}</h2>
            {description ? (
              <p className="section-copy text-sm md:text-base">{description}</p>
            ) : null}
          </div>

          {notes ? <div className="flex flex-wrap gap-2">{notes}</div> : null}

          {actions ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">{actions}</div>
          ) : null}
        </div>

        {metrics.length > 0 ? (
          <div className="data-shell p-4">
            <div className="space-y-4">
              {metrics.map((metric) => (
                <div
                  key={metric.label}
                  className="border-b border-border/40 pb-3 last:border-b-0 last:pb-0"
                >
                  <div className="flex items-end justify-between gap-3">
                    <p className="subtle-label">{metric.label}</p>
                    <p className="font-mono text-2xl font-semibold tracking-tight text-ink">
                      {metric.value}
                    </p>
                  </div>
                  {metric.hint ? (
                    <p className="mt-2 text-xs leading-5 text-slate">{metric.hint}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
}: SectionCardProps) {
  return (
    <section className={cn("section-card shell-panel surface-soft", className)}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <p className="section-title">{title}</p>
          {description ? (
            <p className="max-w-3xl text-sm text-slate">{description}</p>
          ) : null}
        </div>

        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>

      <div className="mt-5">{children}</div>
    </section>
  );
}

export function StatusBadge({
  children,
  tone = "neutral",
  className,
}: StatusBadgeProps) {
  return (
    <span className={cn("status-badge", STATUS_TONE_CLASS[tone], className)}>
      {children}
    </span>
  );
}
