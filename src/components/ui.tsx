import React, { type ReactNode } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Inbox,
  Loader2,
  Info,
  ChevronRight,
  Sparkles,
} from 'lucide-react'

// Strict palette tone mappings
// PRIMARY: #243607, SECONDARY: #91696E, DARK: #30280D, NEUTRAL: #BBBEA7
const toneStyles: Record<string, string> = {
  ok: 'bg-[#243607]/10 text-[#243607] border border-[#243607]/25',
  warn: 'bg-[#91696E]/15 text-[#91696E] border border-[#91696E]/30 font-medium',
  bad: 'bg-[#30280D]/10 text-[#30280D] border border-[#30280D]/40 font-semibold',
  mute: 'bg-[#BBBEA7]/30 text-[#30280D]/80 border border-[#BBBEA7]/50',
  primary: 'bg-[#243607] text-[#f2f3ec] border border-[#243607]',
  secondary: 'bg-[#91696E] text-[#f2f3ec] border border-[#91696E]',
  dark: 'bg-[#30280D] text-[#f2f3ec] border border-[#BBBEA7]/20',
}

export interface BadgeProps {
  t?: keyof typeof toneStyles
  children: ReactNode
  className?: string
  dot?: boolean
}

export const Badge = ({ t = 'mute', children, className = '', dot = false }: BadgeProps) => {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] tracking-wide font-medium shadow-sm transition-all ${
        toneStyles[t] || toneStyles.mute
      } ${className}`}
    >
      {dot && (
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            t === 'ok'
              ? 'bg-[#243607]'
              : t === 'warn'
              ? 'bg-[#91696E]'
              : t === 'bad'
              ? 'bg-[#30280D]'
              : 'bg-current opacity-70'
          }`}
        />
      )}
      {children}
    </span>
  )
}

export interface CardProps {
  title?: ReactNode
  sub?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  variant?: 'light' | 'dark' | 'elevated' | 'glass'
  interactive?: boolean
}

export const Card = ({
  title,
  sub,
  action,
  children,
  className = '',
  variant = 'light',
  interactive = false,
}: CardProps) => {
  const isDark = variant === 'dark'

  return (
    <section
      className={`relative rounded-xl overflow-hidden transition-all duration-200 ${
        isDark
          ? 'spatial-card-dark'
          : 'bg-white/90 border border-[#30280D]/10 shadow-spatial hover:shadow-spatial-md'
      } ${interactive ? 'hover:-translate-y-0.5 cursor-pointer' : ''} ${className}`}
    >
      {(title || action) && (
        <div
          className={`flex items-center justify-between px-5 py-3.5 border-b ${
            isDark ? 'border-[#BBBEA7]/15 bg-black/20' : 'border-[#30280D]/06 bg-[#f2f3ec]/40'
          }`}
        >
          <div>
            {typeof title === 'string' ? (
              <h2
                className={`font-semibold tracking-tight text-sm md:text-base ${
                  isDark ? 'text-[#f2f3ec]' : 'text-[#30280D]'
                }`}
              >
                {title}
              </h2>
            ) : (
              title
            )}
            {sub && (
              <p
                className={`text-xs mt-0.5 ${
                  isDark ? 'text-[#BBBEA7]' : 'text-[#30280D]/70'
                }`}
              >
                {sub}
              </p>
            )}
          </div>
          {action && <div className="flex items-center gap-2">{action}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  )
}

export interface PageHeadProps {
  title: string
  sub?: string
  badge?: ReactNode
  actions?: ReactNode
}

export const PageHead = ({ title, sub, badge, actions }: PageHeadProps) => {
  return (
    <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div>
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-bold tracking-tight text-[#30280D] md:text-3xl">
            {title}
          </h1>
          {badge}
        </div>
        {sub && <p className="mt-1 text-sm text-[#30280D]/75 max-w-2xl">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  )
}

export interface TableProps {
  head: string[]
  rows: ReactNode[][]
  emptyText?: string
  className?: string
}

export const Table = ({
  head,
  rows,
  emptyText = 'No data available in this view.',
  className = '',
}: TableProps) => {
  if (rows.length === 0) {
    return <State kind="empty" text={emptyText} />
  }

  return (
    <div className={`overflow-x-auto rounded-lg border border-[#30280D]/10 ${className}`}>
      <table className="w-full text-left text-sm border-collapse">
        <thead>
          <tr className="border-b border-[#30280D]/10 bg-[#f2f3ec]/70 text-[#30280D]/70 text-xs font-semibold uppercase tracking-wider">
            {head.map((h, i) => (
              <th key={i} className="px-4 py-3 first:pl-5 last:pr-5">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#30280D]/06 bg-white/70">
          {rows.map((row, rIdx) => (
            <tr
              key={rIdx}
              className="hover:bg-[#243607]/[0.03] transition-colors group"
            >
              {row.map((cell, cIdx) => (
                <td
                  key={cIdx}
                  className="px-4 py-3.5 first:pl-5 last:pr-5 text-[#30280D] font-normal text-xs md:text-sm"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export interface StateProps {
  kind: 'loading' | 'empty' | 'error' | 'success' | 'info'
  text: string
  sub?: string
  action?: ReactNode
}

export const State = ({ kind, text, sub, action }: StateProps) => {
  const Icon = {
    loading: Loader2,
    empty: Inbox,
    error: AlertTriangle,
    success: CheckCircle2,
    info: Info,
  }[kind]

  const styleMap = {
    loading: 'text-[#243607] bg-[#243607]/05 border-[#243607]/15',
    empty: 'text-[#30280D]/70 bg-[#BBBEA7]/15 border-[#30280D]/10',
    error: 'text-[#91696E] bg-[#91696E]/10 border-[#91696E]/25',
    success: 'text-[#243607] bg-[#243607]/10 border-[#243607]/25',
    info: 'text-[#30280D] bg-[#BBBEA7]/20 border-[#30280D]/15',
  }[kind]

  return (
    <div
      className={`flex items-start gap-3 rounded-lg border p-4 text-sm shadow-sm transition-all ${styleMap}`}
    >
      <Icon
        size={18}
        className={`shrink-0 mt-0.5 ${kind === 'loading' ? 'animate-spin' : ''}`}
      />
      <div className="flex-1">
        <div className="font-semibold">{text}</div>
        {sub && <p className="mt-0.5 text-xs opacity-85 leading-relaxed">{sub}</p>}
        {action && <div className="mt-2.5">{action}</div>}
      </div>
    </div>
  )
}

export const Placeholder = ({ text = 'Prototype' }: { text?: string }) => (
  <Badge t="warn">{text}</Badge>
)

export interface MetricCardProps {
  label: string
  value: ReactNode
  sub?: string
  trend?: string
  trendType?: 'positive' | 'negative' | 'neutral'
  icon?: ReactNode
  onClick?: () => void
  active?: boolean
}

export const MetricCard = ({
  label,
  value,
  sub,
  trend,
  trendType = 'neutral',
  icon,
  onClick,
  active = false,
}: MetricCardProps) => {
  return (
    <div
      onClick={onClick}
      className={`group relative rounded-xl p-4.5 border transition-all duration-200 ${
        active
          ? 'bg-[#243607] text-[#f2f3ec] border-[#243607] shadow-spatial-md -translate-y-1'
          : 'bg-white/85 text-[#30280D] border-[#30280D]/10 shadow-spatial hover:shadow-spatial-md hover:-translate-y-0.5 hover:border-[#243607]/30'
      } ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={`text-xs font-medium uppercase tracking-wider ${
            active ? 'text-[#BBBEA7]' : 'text-[#30280D]/65'
          }`}
        >
          {label}
        </span>
        {icon && (
          <div
            className={`p-1.5 rounded-lg ${
              active
                ? 'bg-[#f2f3ec]/15 text-[#f2f3ec]'
                : 'bg-[#243607]/08 text-[#243607] group-hover:bg-[#243607]/15'
            } transition-colors`}
          >
            {icon}
          </div>
        )}
      </div>

      <div className="mt-2.5 flex items-baseline gap-2">
        <div
          className={`text-2xl md:text-3xl font-bold tracking-tight ${
            active ? 'text-white' : 'text-[#30280D]'
          }`}
        >
          {value}
        </div>
        {trend && (
          <span
            className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
              trendType === 'positive'
                ? active
                  ? 'bg-white/20 text-white'
                  : 'bg-[#243607]/15 text-[#243607]'
                : trendType === 'negative'
                ? active
                  ? 'bg-[#91696E] text-white'
                  : 'bg-[#91696E]/20 text-[#91696E]'
                : 'text-[#30280D]/50'
            }`}
          >
            {trend}
          </span>
        )}
      </div>

      {sub && (
        <div
          className={`mt-1 text-xs truncate ${
            active ? 'text-[#BBBEA7]' : 'text-[#30280D]/60'
          }`}
        >
          {sub}
        </div>
      )}
    </div>
  )
}

export interface SpatialButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'dark' | 'outline' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  icon?: ReactNode
}

export const SpatialButton = ({
  variant = 'primary',
  size = 'md',
  icon,
  children,
  className = '',
  disabled,
  ...props
}: SpatialButtonProps) => {
  const sizeStyles = {
    sm: 'px-2.5 py-1 text-xs font-medium gap-1.5',
    md: 'px-4 py-2 text-sm font-medium gap-2',
    lg: 'px-5 py-2.5 text-base font-semibold gap-2.5',
  }[size]

  const variantStyles = {
    primary:
      'bg-[#243607] text-white hover:bg-[#182404] active:translate-y-0.5 shadow-sm border border-[#243607]',
    secondary:
      'bg-[#91696E] text-white hover:bg-[#765257] active:translate-y-0.5 shadow-sm border border-[#91696E]',
    dark:
      'bg-[#30280D] text-[#f2f3ec] hover:bg-[#201a08] active:translate-y-0.5 shadow-sm border border-[#BBBEA7]/30',
    outline:
      'bg-white/70 text-[#30280D] border border-[#30280D]/20 hover:bg-[#f2f3ec] hover:border-[#243607]/50 active:translate-y-0.5',
    ghost:
      'bg-transparent text-[#30280D] hover:bg-[#30280D]/06 active:bg-[#30280D]/10',
  }[variant]

  return (
    <button
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-lg transition-all duration-150 select-none disabled:opacity-40 disabled:cursor-not-allowed ${sizeStyles} ${variantStyles} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  )
}
