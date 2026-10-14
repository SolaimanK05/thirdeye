import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./cx";

type Props = {
  title: ReactNode;
  heading?: "h2" | "h3";
  meta?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  summaryClassName?: string;
  titleClassName?: string;
  children: ReactNode;
};

export function Disclosure({
  title,
  heading: Heading = "h2",
  meta,
  defaultOpen = true,
  className,
  summaryClassName,
  titleClassName,
  children,
}: Props) {
  return (
    <details open={defaultOpen} className={className}>
      <summary
        className={cx(
          "flex min-h-9 cursor-pointer list-none select-none items-center gap-2 text-ink-3 transition-colors duration-120 ease-out hover-fine:text-ink-2 [&::-webkit-details-marker]:hidden",
          summaryClassName,
        )}
      >
        <Heading className={cx("text-label", titleClassName)}>{title}</Heading>
        {meta}
        <ChevronDown
          size={14}
          aria-hidden="true"
          className="-rotate-90 ml-auto shrink-0 text-ink-3 transition-transform duration-120 ease-out [[open]>summary>&]:rotate-0"
        />
      </summary>
      {children}
    </details>
  );
}
