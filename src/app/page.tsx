import { FaMapMarkerAlt } from "react-icons/fa";

import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="flex items-center gap-2 text-3xl font-semibold">
        <FaMapMarkerAlt aria-hidden className="text-red-600" />
        Map Chat
      </h1>
      <p className="text-muted-foreground">
        Scaffold is up. The map arrives in the next plan.
      </p>
      <Button>shadcn/ui button</Button>
    </main>
  );
}
