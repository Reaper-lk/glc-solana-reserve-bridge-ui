"use client";

import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Copy-to-clipboard control (design spec H3).
 *
 * The icon morphs copy -> check and reverts after 1.6s. This is the most-used
 * micro-interaction in the product, so the confirmation is immediate and the
 * change is also announced politely for screen-reader users.
 */
export function CopyButton({
  value,
  label,
  className,
  children,
}: {
  value: string;
  /** Describes what is being copied, e.g. "deposit address". */
  label: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = useCallback(() => {
    void navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1_600);
      })
      .catch(() => {
        // Clipboard access can be denied. Staying silent is correct: the value
        // is always visible on screen and can be selected manually.
        setCopied(false);
      });
  }, [value]);

  const Icon = copied ? Check : Copy;

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm px-2 py-1",
        "text-body-sm text-ink-700 hover:bg-ink-100 transition-colors",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
      {children ?? (copied ? "Copied" : "Copy")}
      <span aria-live="polite" className="sr-only">
        {copied ? `${label} copied to clipboard` : ""}
      </span>
    </button>
  );
}
