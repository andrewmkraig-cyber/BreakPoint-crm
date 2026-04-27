"use client";

import { signIn } from "next-auth/react";
import { BrandMark } from "@/components/brand-mark";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-muted via-white to-brand-tint p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-white p-10 shadow-sm">
        <div className="mb-8 flex flex-col items-center gap-4">
          <BrandMark withTag />
          <div className="text-center">
            <h1 className="font-serif text-2xl font-semibold text-ink">Welcome back</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in with your BreakPoint Talent Google account.
            </p>
          </div>
        </div>
        <button
          onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-brand px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark"
        >
          <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden>
            <path fill="#fff" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.4 2.4 30 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.8 6c1.9-5.6 7-9.8 13.6-9.8z" />
            <path fill="#fff" d="M46.5 24.5c0-1.6-.2-3.2-.4-4.7H24v9h12.7c-.5 3-2.2 5.6-4.7 7.3l7.3 5.7c4.3-4 6.7-9.9 6.7-17.3z" />
            <path fill="#fff" d="M10.4 28.7c-.5-1.4-.8-2.9-.8-4.5s.3-3.1.8-4.5l-7.8-6A24 24 0 000 24c0 3.9.9 7.6 2.6 10.8l7.8-6z" />
            <path fill="#fff" d="M24 48c6.5 0 12-2.1 16-5.8l-7.3-5.7c-2 1.4-4.7 2.3-8.7 2.3-6.5 0-12-4.4-14-10.3l-7.8 6C6.5 42.6 14.6 48 24 48z" />
          </svg>
          Continue with Google
        </button>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Access is restricted to @breakpointtalent.com accounts.
        </p>
      </div>
    </div>
  );
}
