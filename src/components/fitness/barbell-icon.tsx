import type { SVGProps } from "react";

export function BarbellIcon({
  strokeWidth = 1.8,
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M3 10.5v3" />
      <path d="M6 8.5v7" />
      <path d="M9 11.5h6" />
      <path d="M18 8.5v7" />
      <path d="M21 10.5v3" />
      <path d="M4.5 12h15" />
    </svg>
  );
}
