import { cn } from "@/lib/utils";
import { ButtonHTMLAttributes, forwardRef } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "apply" | "schedule";
  size?: "sm" | "md" | "lg";
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center font-semibold transition rounded-full shadow-sm disabled:opacity-60 disabled:cursor-not-allowed",
          {
            "border border-emerald-400 bg-emerald-200 text-emerald-900 hover:bg-emerald-300":
              variant === "primary",
            "bg-court-surface-subtle text-court-fg border border-court-border hover:bg-court-surface":
              variant === "secondary",
            "bg-red-50 text-red-600 border border-red-200 hover:bg-red-100":
              variant === "danger",
            "bg-transparent text-court-fg-muted hover:text-court-fg hover:bg-court-surface-subtle":
              variant === "ghost",
            "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100":
              variant === "apply",
            "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100":
              variant === "schedule",
          },
          {
            "px-3 py-1.5 text-xs gap-1.5": size === "sm",
            "px-4 py-2 text-sm gap-2": size === "md",
            "px-5 py-2.5 text-sm gap-2": size === "lg",
          },
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
export { Button };
