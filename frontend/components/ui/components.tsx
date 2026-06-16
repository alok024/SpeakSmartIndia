'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { forwardRef } from 'react';

// ── Design tokens ──────────────────────────────────────────────────
const T = {
  bg:          '#0C0A10',
  surface:     '#141118',
  surface2:    '#1E1A26',
  border:      'rgba(255,255,255,0.07)',
  border2:     'rgba(255,255,255,0.13)',
  orange:      '#F97316',
  orangeDim:   'rgba(249,115,22,0.12)',
  orangeBorder:'rgba(249,115,22,0.25)',
  violet:      '#8B5CF6',
  violetDim:   'rgba(139,92,246,0.12)',
  violetBorder:'rgba(139,92,246,0.25)',
  emerald:     '#10B981',
  emeraldDim:  'rgba(16,185,129,0.12)',
  emeraldBorder:'rgba(16,185,129,0.25)',
  amber:       '#F59E0B',
  amberDim:    'rgba(245,158,11,0.12)',
  amberBorder: 'rgba(245,158,11,0.25)',
  red:         '#EF4444',
  redDim:      'rgba(239,68,68,0.12)',
  redBorder:   'rgba(239,68,68,0.2)',
  text1:       '#F5F3FF',
  text2:       '#9490A8',
  text3:       '#5C5770',
};

// ── Button ────────────────────────────────────────────────────────
//
// variant mapping:
//   primary   → orange→amber gradient  (was blue)
//   secondary → subtle surface + border
//   ghost     → transparent, muted text
//   danger    → red tint
//   upgrade   → violet→purple gradient  (was blue→purple)
//   outline   → border only

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 font-semibold rounded-[10px] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2',
  {
    variants: {
      variant: {
        primary:
          'bg-gradient-to-br from-[#F97316] to-[#F59E0B] hover:brightness-110 text-white focus-visible:ring-[#F97316]/40',
        secondary:
          'bg-white/[0.06] hover:bg-white/[0.10] text-[#F5F3FF] border border-white/[0.13] focus-visible:ring-white/20',
        ghost:
          'hover:bg-white/[0.04] text-[#9490A8] hover:text-[#F5F3FF] focus-visible:ring-white/10',
        danger:
          'bg-[rgba(239,68,68,0.10)] hover:bg-[rgba(239,68,68,0.18)] text-[#EF4444] border border-[rgba(239,68,68,0.2)] focus-visible:ring-red-500/30',
        upgrade:
          'bg-gradient-to-br from-[#8B5CF6] to-[#A855F7] hover:brightness-110 text-white focus-visible:ring-[#8B5CF6]/40',
        outline:
          'border border-white/[0.13] hover:border-white/[0.22] text-[#F5F3FF] hover:bg-white/[0.04] focus-visible:ring-white/10',
      },
      size: {
        sm:   'text-xs px-3 py-2 min-h-[36px]',
        md:   'text-sm px-4 py-2.5 min-h-[44px]',
        lg:   'text-sm px-5 py-3 min-h-[44px]',
        xl:   'text-base px-7 py-3.5 min-h-[48px]',
        icon: 'w-10 h-10 p-0 rounded-lg',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Spinner className="w-4 h-4" />}
      {children}
    </button>
  )
);
Button.displayName = 'Button';

// ── Badge ─────────────────────────────────────────────────────────
//
// Colour system aligned to redesign tokens:
//   accent   → orange (was blue)
//   success  → emerald ✓
//   warn     → amber  ✓
//   danger   → red    ✓
//   purple   → violet (was purple)
//   pro      → orange→violet gradient
//   elite    → violet gradient

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md font-semibold border',
  {
    variants: {
      variant: {
        default: 'bg-white/[0.05] text-[#9490A8] border-white/[0.10]',
        accent:  'bg-[rgba(249,115,22,0.12)] text-[#F97316] border-[rgba(249,115,22,0.25)]',
        success: 'bg-[rgba(16,185,129,0.12)] text-[#10B981] border-[rgba(16,185,129,0.25)]',
        warn:    'bg-[rgba(245,158,11,0.12)] text-[#F59E0B] border-[rgba(245,158,11,0.25)]',
        danger:  'bg-[rgba(239,68,68,0.12)] text-[#EF4444] border-[rgba(239,68,68,0.2)]',
        purple:  'bg-[rgba(139,92,246,0.12)] text-[#8B5CF6] border-[rgba(139,92,246,0.25)]',
        pro:     'bg-gradient-to-r from-[rgba(249,115,22,0.15)] to-[rgba(139,92,246,0.15)] text-[#C4B5FD] border-[rgba(139,92,246,0.3)]',
        elite:   'bg-gradient-to-r from-[rgba(139,92,246,0.2)] to-[rgba(168,85,247,0.2)] text-[#C4B5FD] border-[rgba(139,92,246,0.35)]',
        free:    'bg-white/[0.05] text-[#9490A8] border-white/[0.10]',
      },
      size: {
        sm: 'px-1.5 py-0.5 text-[10px]',
        md: 'px-2 py-0.5 text-[10px]',
        lg: 'px-2.5 py-1 text-xs',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

// ── Card ──────────────────────────────────────────────────────────

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-2xl', className)}
      style={{ background: T.surface, border: `0.5px solid ${T.border}` }}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('px-4 py-3', className)}
      style={{ borderBottom: `0.5px solid ${T.border}` }}
      {...props}
    />
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-4 py-3', className)} {...props} />;
}

// ── Spinner ───────────────────────────────────────────────────────

export function Spinner({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={cn(
        'rounded-full border-2 border-current border-t-transparent animate-spin',
        className ?? 'w-5 h-5'
      )}
    />
  );
}

// ── Input ─────────────────────────────────────────────────────────

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, style, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'w-full px-3 py-2.5 rounded-[10px] text-xs transition-colors disabled:opacity-50 outline-none',
      'placeholder:text-[#5C5770]',
      className
    )}
    style={{
      background:  T.surface2,
      border:      `0.5px solid ${T.border2}`,
      color:       T.text2,
      ...style,
    }}
    onFocus={e  => (e.target.style.borderColor = T.orange)}
    onBlur={e   => (e.target.style.borderColor = T.border2)}
    {...props}
  />
));
Input.displayName = 'Input';

// ── Textarea ──────────────────────────────────────────────────────

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, style, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'w-full px-3 py-2.5 rounded-[10px] text-xs transition-colors disabled:opacity-50 outline-none resize-none',
      'placeholder:text-[#5C5770]',
      className
    )}
    style={{
      background: T.surface2,
      border:     `0.5px solid ${T.border2}`,
      color:      T.text2,
      ...style,
    }}
    onFocus={e  => (e.target.style.borderColor = T.orange)}
    onBlur={e   => (e.target.style.borderColor = T.border2)}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

// ── ScoreBadge ────────────────────────────────────────────────────

export function ScoreBadge({ score, className }: { score: number; className?: string }) {
  const variant = score >= 7 ? 'success' : score >= 4 ? 'warn' : 'danger';
  return (
    <Badge variant={variant} size="lg" className={cn('font-bold tabular-nums', className)}>
      {score}/10
    </Badge>
  );
}

// ── ProgressBar ───────────────────────────────────────────────────

export function ProgressBar({
  value,
  max = 100,
  className,
  barClassName,
  style,
}: {
  value:        number;
  max?:         number;
  className?:   string;
  barClassName?: string;
  style?:       React.CSSProperties;
}) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div
      className={cn('h-[5px] rounded-full overflow-hidden', className)}
      style={{ background: 'rgba(255,255,255,0.05)' }}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-700 ease-out', barClassName)}
        style={{ width: `${pct}%`, background: T.orange, ...style }}
      />
    </div>
  );
}

// ── SectionLabel ──────────────────────────────────────────────────

export function SectionLabel({
  children,
  className,
}: {
  children:  React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'block text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1.5',
        className
      )}
      style={{ color: T.text3 }}
    >
      {children}
    </span>
  );
}

// ── ChipGroup ─────────────────────────────────────────────────────

export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options:   { label: string; value: T; icon?: string }[];
  value:     T;
  onChange:  (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className="px-3 py-2 rounded-full text-xs font-medium border transition-all min-h-[36px]"
            style={{
              background:   active ? T.orangeDim            : 'rgba(255,255,255,0.03)',
              borderColor:  active ? 'rgba(249,115,22,0.4)' : T.border,
              color:        active ? T.orange               : T.text2,
            }}
          >
            {opt.icon && <span className="mr-1">{opt.icon}</span>}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ── EmptyState ────────────────────────────────────────────────────

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon:         string;
  title:        string;
  description?: string;
  action?:      React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
      <span className="text-4xl">{icon}</span>
      <p className="font-semibold" style={{ color: T.text1 }}>{title}</p>
      {description && (
        <p className="text-sm max-w-xs" style={{ color: T.text2 }}>{description}</p>
      )}
      {action}
    </div>
  );
}

// ── ScoreRing ─────────────────────────────────────────────────────
// New in redesign — circular readiness indicator

export function ScoreRing({
  score,
  label = 'Job Ready',
  size = 70,
}: {
  score:  number;
  label?: string;
  size?:  number;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-full flex-shrink-0"
      style={{
        width:      size,
        height:     size,
        border:     `3px solid ${T.orangeBorder}`,
        background: 'rgba(249,115,22,0.05)',
      }}
    >
      <span className="font-bold" style={{ fontSize: size * 0.29, color: T.orange, lineHeight: 1 }}>
        {score}
      </span>
      <span style={{ fontSize: size * 0.115, color: T.text3, letterSpacing: '0.05em' }}>
        {label}
      </span>
    </div>
  );
}

// ── UpgradeStrip ──────────────────────────────────────────────────
// New in redesign — inline upgrade CTA banner

export function UpgradeStrip({
  title   = "🚀 You're improving!",
  subtitle = 'Unlock unlimited sessions to keep your momentum.',
  cta     = 'Upgrade → ₹299/mo',
  onClick,
}: {
  title?:    string;
  subtitle?: string;
  cta?:      string;
  onClick?:  () => void;
}) {
  return (
    <div
      className="flex items-center justify-between gap-4 flex-wrap rounded-xl px-4 py-3 border"
      style={{
        background:  'linear-gradient(135deg, rgba(249,115,22,0.10), rgba(139,92,246,0.10))',
        borderColor: T.orangeBorder,
      }}
    >
      <div>
        <div className="text-sm font-semibold" style={{ color: T.text1 }}>{title}</div>
        <div className="text-xs"             style={{ color: T.text2 }}>{subtitle}</div>
      </div>
      <button
        onClick={onClick}
        className="text-xs font-bold text-white px-4 py-2 rounded-lg border-none whitespace-nowrap transition-opacity hover:opacity-90"
        style={{ background: `linear-gradient(135deg, ${T.orange}, ${T.amber})` }}
      >
        {cta}
      </button>
    </div>
  );
}
