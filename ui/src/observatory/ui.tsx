import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

const ICONS = {
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4 4" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3 2.5 20h19L12 3Z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  spark: <path d="m12 3 1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4L12 3Z" />,
  chevron: <path d="m9 18 6-6-6-6" />,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }>(
  function Button({ children, variant = 'secondary', type = 'button', ...props }, ref) {
    return (
      <button ref={ref} type={type} className={`sa-button sa-button--${variant}`} {...props}>
        {children}
      </button>
    );
  },
);

export function Panel({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <section className="sa-panel" aria-label={label}>
      {children}
    </section>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="sa-state">
      <span className="sa-state__icon">
        <Icon name="spark" size={24} />
      </span>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function ErrorState({ title, body, onRetry }: { title: string; body: string; onRetry?: () => void }) {
  return (
    <div className="sa-state sa-state--error" role="alert">
      <span className="sa-state__icon">
        <Icon name="warning" size={24} />
      </span>
      <h3>{title}</h3>
      <p>{body}</p>
      {onRetry && <Button onClick={onRetry}>Retry</Button>}
    </div>
  );
}
