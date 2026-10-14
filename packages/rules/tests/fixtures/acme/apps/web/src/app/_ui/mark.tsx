export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} fill="none" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="4" />
      <rect x="12" y="12" width="16" height="16" rx="3" stroke="var(--pop, #06707e)" strokeWidth="4" />
    </svg>
  );
}
