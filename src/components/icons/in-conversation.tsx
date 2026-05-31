import * as React from "react";

type InConversationProps = React.SVGProps<SVGSVGElement> & {
  size?: number;
  accent?: string;
};

export function InConversation({
  size = 20,
  // Court Mode tokens, not hardcoded hex: the Ace figure tracks the brand
  // accent and the bubble fill tracks the themed surface so the glyph
  // inverts correctly in dark Courts instead of staying a fixed cream.
  accent = "rgb(var(--court-brand))",
  ...props
}: InConversationProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 60 60"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      {/* Chat bubble — surface token so it flips light/dark with the Court */}
      <path
        d="M 8 14 Q 8 6 16 6 L 44 6 Q 52 6 52 14 L 52 36 Q 52 44 44 44 L 24 44 L 16 52 L 18 44 Q 8 44 8 36 Z"
        fill="rgb(var(--court-surface))"
        stroke="currentColor"
        strokeWidth="4"
      />
      {/* Left figure — ink (you). court-fg, not currentColor, so it stays
          legible against the surface-filled bubble even when the button is
          active (currentColor flips to white there and would vanish). */}
      <circle cx="24" cy="22" r="4.4" fill="rgb(var(--court-fg))" />
      <ellipse cx="24" cy="33" rx="5.6" ry="6.2" fill="rgb(var(--court-fg))" />
      {/* Right figure — green (Ace) */}
      <circle cx="36" cy="22" r="4.4" fill={accent} />
      <ellipse cx="36" cy="33" rx="5.6" ry="6.2" fill={accent} />
    </svg>
  );
}
