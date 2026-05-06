import * as React from "react";

type StrungProps = React.SVGProps<SVGSVGElement> & {
  size?: number;
  accent?: string;
};

export function Strung({
  size = 20,
  accent = "#5A9642",
  ...props
}: StrungProps) {
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
      <ellipse cx="30" cy="26" rx="18" ry="20" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <line x1="14" y1="20" x2="46" y2="20" stroke="currentColor" strokeWidth="1" />
      <line x1="13" y1="26" x2="47" y2="26" stroke="currentColor" strokeWidth="1" />
      <line x1="14" y1="32" x2="46" y2="32" stroke="currentColor" strokeWidth="1" />
      <line x1="22" y1="8" x2="22" y2="44" stroke="currentColor" strokeWidth="1" />
      <line x1="30" y1="6" x2="30" y2="46" stroke="currentColor" strokeWidth="1" />
      <line x1="38" y1="8" x2="38" y2="44" stroke="currentColor" strokeWidth="1" />
      <path d="M 27 46 L 30 56 L 33 46 Z" fill="currentColor" />
      <circle cx="30" cy="26" r="5" fill={accent} />
    </svg>
  );
}
