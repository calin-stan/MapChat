import type { ReactNode } from "react";
import { FaTimes } from "react-icons/fa";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type PanelFrameProps = {
  title: ReactNode;
  /** Chunk 10's info icon, rendered after the title. */
  titleAdornment?: ReactNode;
  /** When given, a close button renders at the right of the header. */
  onClose?(): void;
  /** The body: `flex-1 min-h-0`; the child provides its own scroll container. */
  children: ReactNode;
  /** Pinned to the bottom, never shrinks. */
  footer?: ReactNode;
};

/**
 * The chrome of the one floating panel (spec §8): a flex column capped by the
 * panel slot's max height. The slot is `flex flex-col`, so `min-h-0` on the
 * card lets it shrink to the slot and the body scrolls instead of the page.
 */
export function PanelFrame({ title, titleAdornment, onClose, children, footer }: PanelFrameProps) {
  return (
    <Card className="min-h-0 w-full">
      <CardHeader className="shrink-0">
        <CardTitle className="flex min-w-0 items-center gap-2">
          <span className="truncate">{title}</span>
          {titleAdornment}
        </CardTitle>
        {onClose ? (
          <CardAction>
            <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
              <FaTimes aria-hidden />
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">{children}</CardContent>
      {footer ? <CardFooter className="shrink-0">{footer}</CardFooter> : null}
    </Card>
  );
}
