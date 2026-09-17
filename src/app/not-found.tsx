import Link from "next/link";

import { PanelFrame } from "@/components/panel/PanelFrame";
import { buttonVariants } from "@/components/ui/button";

export const NOT_FOUND_TEXT = "This chatroom or page doesn't exist. It may have been removed.";

/**
 * Shown for `notFound()` from `/room/<id>` and for any URL no route matches
 * (chunk 12). The panel chrome on an empty page, with the one way forward.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="flex w-96 max-w-full flex-col">
        <PanelFrame
          title="Not found"
          footer={
            <Link href="/" className={buttonVariants()}>
              Open the map
            </Link>
          }
        >
          <p className="text-muted-foreground">{NOT_FOUND_TEXT}</p>
        </PanelFrame>
      </div>
    </main>
  );
}
