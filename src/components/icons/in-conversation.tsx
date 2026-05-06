import * as React from "react";

type InConversationProps = React.SVGProps<SVGSVGElement> & {
  size?: number;
  accent?: string;
};

export function InConversation({
  size = 20,
  accent = "#5A9642",
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
      {/* Chat bubble */}
      <path
        d="M 8 14 Q 8 6 16 6 L 44 6 Q 52 6 52 14 L 52 36 Q 52 44 44 44 L 24 44 L 16 52 L 18 44 Q 8 44 8 36 Z"
        fill="#FAF8F3"
        stroke="currentColor"
        strokeWidth="4"
      />
      {/* Left figure — ink (you) */}
      <circle cx="24" cy="22" r="4.4" fill="currentColor" />
      <ellipse cx="24" cy="33" rx="5.6" ry="6.2" fill="currentColor" />
      {/* Right figure — green (Ace) */}
      <circle cx="36" cy="22" r="4.4" fill={accent} />
      <ellipse cx="36" cy="33" rx="5.6" ry="6.2" fill={accent} />
    </svg>
  );
}
