import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Button (design spec E5).
 *
 * Primary actions are ink, not gold. Goldcoin's gold cannot carry white text at
 * accessible contrast, and a page of gold buttons reads as a memecoin rather
 * than a bank. The `brand` variant exists solely for the landing hero.
 *
 * The type signature enforces the design's hardest button rule: a disabled
 * button MUST state why it is disabled (acceptance criterion 2). A dead button
 * with no explanation is the most common cause of abandonment in bridge UIs, so
 * `disabled` without `disabledReason` is a compile error.
 */

export const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "font-medium transition-colors",
    "duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
    "active:translate-y-[0.5px]",
    "disabled:pointer-events-none disabled:cursor-not-allowed",
    "disabled:bg-ink-100 disabled:text-ink-400",
  ],
  {
    variants: {
      variant: {
        primary: "bg-ink-950 text-on-inverse hover:bg-ink-900",
        secondary: "border border-ink-300 bg-surface-raised text-ink-900 hover:bg-ink-50",
        tertiary: "text-ink-700 hover:bg-ink-50",
        /*
         * Literal white, and it stays literal in both themes: this label sits
         * on a saturated red that does not invert, so inverting the text with
         * the ink scale would put near-black on it in dark mode.
         */
        danger: "bg-danger-500 text-white hover:bg-danger-700",
        brand: "bg-gold-400 text-on-gold hover:bg-gold-500",
      },
      size: {
        sm: "h-8 rounded-sm px-3 text-body-sm",
        md: "h-10 rounded-md px-4 text-body",
        lg: "h-12 rounded-md px-5 text-body-lg",
        xl: "h-14 rounded-md px-6 text-body-lg",
      },
      fullWidth: {
        true: "w-full",
        false: "",
      },
    },
    defaultVariants: { variant: "secondary", size: "md", fullWidth: false },
  },
);

type ButtonBaseProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "disabled" | "className"
> &
  VariantProps<typeof buttonVariants> & {
    className?: string;
    /** Replaces the label with a spinner without changing the button's width. */
    loading?: boolean;
    children: ReactNode;
  };

type ButtonProps = ButtonBaseProps &
  (
    | { disabled?: false | undefined; disabledReason?: never; reasonPlacement?: never }
    | {
        disabled: true;
        /** Why the action is unavailable. Required — see the note above. */
        disabledReason: string;
        /**
         * Where the reason is rendered.
         *
         * `inline` (the default) prints it beneath the button, which is right
         * for a form's primary action.
         *
         * `accessible` attaches it as the button's description and tooltip
         * without printing it. This exists for dense chrome — a header 64px
         * tall at 360px wide cannot absorb a sentence without breaking the
         * layout. The reason still reaches every user, via assistive
         * technology and on hover; it is never silently dropped.
         */
        reasonPlacement?: "inline" | "accessible";
      }
  );

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant,
    size,
    fullWidth,
    className,
    loading = false,
    disabled,
    disabledReason,
    reasonPlacement = "inline",
    children,
    ...props
  },
  ref,
) {
  const reasonId = useId();
  const isDisabled = disabled === true || loading;

  const button = (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      aria-describedby={disabled === true ? reasonId : undefined}
      title={
        disabled === true && reasonPlacement === "accessible" ? disabledReason : undefined
      }
      {...props}
    >
      {loading ? (
        <>
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          {/*
            Preserve the label's width so the layout does not shift, using
            opacity rather than `visibility: hidden` so the label stays in the
            accessibility tree. The button must keep its name while busy —
            "Working…" alone tells a screen-reader user nothing about what is
            working. `aria-busy` carries the state.
          */}
          <span className="opacity-0">{children}</span>
        </>
      ) : (
        children
      )}
    </button>
  );

  if (disabled !== true) return button;

  // Dense chrome carries the reason accessibly rather than inline; see the
  // `reasonPlacement` documentation above.
  if (reasonPlacement === "accessible") {
    return (
      <>
        {button}
        <span id={reasonId} className="sr-only">
          {disabledReason}
        </span>
      </>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", fullWidth === true && "w-full")}>
      {button}
      <p id={reasonId} className="text-body-sm text-danger-700">
        {disabledReason}
      </p>
    </div>
  );
});
