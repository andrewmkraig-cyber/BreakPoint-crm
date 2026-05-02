import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

// Renders Claude-generated summaries that may carry markdown syntax —
// `**bold**`, `*italic*`, `- bullets`, `# headers`, links, tables —
// into properly-formatted prose. Replaces PlainProse on tabs where
// the AI prompt emits markdown rather than the plain-text bullet
// format PlainProse was built for (Benefits, Agreements). Tailwind
// arbitrary-variant selectors style each emitted element so the
// rendered block matches the surrounding court-mode palette without
// pulling in @tailwindcss/typography.
export function MarkdownProse({ content, className }: { content: string; className?: string }) {
  return (
    <div
      className={cn(
        "text-sm leading-relaxed text-court-fg",
        "[&_p]:mb-3 [&_p]:text-sm [&_p]:leading-relaxed",
        "[&_strong]:font-bold [&_strong]:text-court-fg",
        "[&_em]:italic",
        "[&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:font-serif [&_h1]:text-base [&_h1]:font-bold [&_h1]:text-court-fg first:[&_h1]:mt-0",
        "[&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:font-serif [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-court-fg first:[&_h2]:mt-0",
        "[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:font-serif [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-court-fg first:[&_h3]:mt-0",
        "[&_h4]:mb-2 [&_h4]:mt-3 [&_h4]:font-semibold [&_h4]:text-court-fg",
        "[&_ul]:mb-3 [&_ul]:list-none [&_ul]:space-y-1.5 [&_ul]:pl-0",
        "[&_ul>li]:flex [&_ul>li]:gap-2 [&_ul>li]:text-sm [&_ul>li]:leading-relaxed [&_ul>li]:text-court-fg",
        "[&_ul>li]:before:mt-[2px] [&_ul>li]:before:select-none [&_ul>li]:before:text-brand-dark [&_ul>li]:before:content-['•']",
        "[&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5",
        "[&_ol>li]:text-sm [&_ol>li]:leading-relaxed [&_ol>li]:text-court-fg",
        "[&_a]:text-court-accent-dark [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:opacity-80",
        "[&_code]:rounded [&_code]:bg-court-border/40 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-court-border [&_blockquote]:pl-3 [&_blockquote]:text-court-fg-muted",
        "[&_hr]:my-4 [&_hr]:border-court-border",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...rest }) => (
            <a
              {...rest}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
