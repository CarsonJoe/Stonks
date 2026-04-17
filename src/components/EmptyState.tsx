interface EmptyStateProps {
  title: string;
  copy: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ title, copy, actionLabel, onAction }: EmptyStateProps) {
  return (
    <section className="empty-state">
      <div className="empty-state__copy">
        <strong>{title}</strong>
        <p>{copy}</p>
      </div>
      {actionLabel && onAction ? (
        <button className="button button--primary" type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </section>
  );
}
