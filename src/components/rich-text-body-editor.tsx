"use client";

import { forwardRef, useEffect, useImperativeHandle } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { cn } from "@/lib/utils";

// Tiptap-backed body editor used by the submittal composer (and any other
// composer that opts in via EmailComposer.richTextBody). Keystrokes Cmd/Ctrl+B
// and Cmd/Ctrl+U come free with StarterKit + Underline — no custom handler
// needed. The editor emits HTML on every change so the parent can stash the
// rendered <strong>/<u>/<p>/<br> structure directly into the Gmail message,
// which is what makes bold/underline show up in the recipient's inbox.
//
// Why Tiptap over a plain contentEditable: we need a predictable serialization
// (editor.getHTML()) and selection-preserving commands for the merge-field
// insert ("Insert Field" must splice a token at the caret without wrecking
// existing formatting). ProseMirror's doc model handles both cleanly; raw
// contentEditable + execCommand is deprecated and buggy across browsers.

export type RichTextBodyEditorHandle = {
  // Inserts plain text at the current selection. Used by the EmailComposer's
  // "Insert Field" dropdown so merge tokens like [CandidateFirstName] land
  // at the caret instead of being appended to the end.
  insertPlainText: (text: string) => void;
  // Replaces the entire editor content with HTML. Used after Claude generation
  // and template application, which produce full-body HTML.
  setHtml: (html: string) => void;
  // Pulls the current HTML snapshot. The parent already receives HTML via
  // onChange on every keystroke; this is a pull-model fallback if needed.
  getHtml: () => string;
};

type Props = {
  initialHtml: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  // Autosaved subject+body state outside the editor may restore a value that's
  // different from `initialHtml`. When `value` changes externally (e.g. after
  // a template pick or Claude generation rewrote state), the editor content is
  // re-synced to it. Without this sync Tiptap clings to its own internal doc
  // and template picks appear to "do nothing."
  value?: string;
};

export const RichTextBodyEditor = forwardRef<RichTextBodyEditorHandle, Props>(
  function RichTextBodyEditor({ initialHtml, onChange, placeholder, className, value }, ref) {
    const editor = useEditor({
      extensions: [
        // history, bold, italic, strike, paragraph, bulletList, etc. all come from StarterKit
        StarterKit.configure({
          // Drop the heading menu — submittals use inline bold only, and
          // allowing h1/h2/h3 would let recruiters accidentally create huge
          // headers in an otherwise paragraph-oriented email body.
          heading: false,
          // Code/codeblock aren't relevant for email bodies either.
          code: false,
          codeBlock: false,
          horizontalRule: false,
        }),
        Underline,
      ],
      content: initialHtml,
      onUpdate: ({ editor }) => {
        onChange(editor.getHTML());
      },
      editorProps: {
        attributes: {
          class: cn(
            "min-h-[280px] w-full resize-vertical whitespace-pre-wrap rounded-lg border border-court-border bg-court-surface px-3 py-2 font-sans text-sm leading-relaxed text-court-fg outline-none",
            "focus:border-brand focus:ring-2 focus:ring-brand/20",
            "prose prose-sm max-w-none prose-p:my-2 prose-strong:font-semibold",
            className,
          ),
          ...(placeholder ? { "data-placeholder": placeholder } : {}),
        },
      },
      // SSR-safe: immediatelyRender: false prevents a hydration mismatch when
      // the initialHtml is empty and the client-rendered editor wraps it in
      // a ProseMirror-managed <p></p> that the server HTML didn't have.
      immediatelyRender: false,
    });

    // When an external force replaces `value` (template apply / Claude), push
    // it into the editor. Guard with a getHTML equality check so typing in the
    // editor (which also triggers parent re-renders via onUpdate) doesn't cause
    // a feedback loop of setContent calls.
    useEffect(() => {
      if (!editor || value === undefined) return;
      if (editor.getHTML() === value) return;
      editor.commands.setContent(value, false);
    }, [editor, value]);

    useImperativeHandle(
      ref,
      () => ({
        insertPlainText(text: string) {
          editor?.chain().focus().insertContent(text).run();
        },
        setHtml(html: string) {
          editor?.commands.setContent(html, true);
        },
        getHtml() {
          return editor?.getHTML() ?? "";
        },
      }),
      [editor],
    );

    return <EditorContent editor={editor} />;
  },
);
