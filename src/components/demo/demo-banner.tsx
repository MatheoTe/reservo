import { CodeXml } from "lucide-react";

import { REPO_URL } from "@/server/demo/mode";

/** Thin strip shown on every page in demo mode. */
export function DemoBanner() {
  return (
    <div className="bg-foreground text-background relative z-50 flex items-center justify-center gap-x-3 px-4 py-1.5 text-center text-xs">
      <span>
        <span className="bg-success mr-2 inline-block size-1.5 -translate-y-px rounded-full align-middle" />
        Live demo · fictional data · resets nightly
      </span>
      <a
        href={REPO_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 font-medium underline-offset-4 opacity-80 hover:underline hover:opacity-100"
      >
        <CodeXml className="size-3.5" aria-hidden /> Source
      </a>
    </div>
  );
}
