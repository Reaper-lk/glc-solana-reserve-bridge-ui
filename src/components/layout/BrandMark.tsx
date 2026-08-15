/**
 * The Goldcoin mark, drawn on Lucide's 24px grid with a 2px stroke so it sits
 * beside the icon set without looking imported (design spec H1).
 *
 * Gold is used here as brand identity only — never to convey state.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" />
      <path
        d="M15 9.2A3.6 3.6 0 0 0 12 7.6a4.4 4.4 0 0 0 0 8.8 3.6 3.6 0 0 0 3-1.6v-2.2h-3"
        stroke="currentColor"
      />
    </svg>
  );
}
