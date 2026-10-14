export function EyeMark({ className }: { className?: string }) {
  return (
    <svg
      width="26"
      height="16"
      viewBox="0 0 26 16"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M1.5 8 C6 1.6, 20 1.6, 24.5 8 C20 14.4, 6 14.4, 1.5 8 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle
        cx="13"
        cy="8"
        r="3.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="13" cy="8" r="1.4" fill="currentColor" />
    </svg>
  );
}
