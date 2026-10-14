import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-4 text-center">
      <div>
        <p className="text-primary text-sm font-medium">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          We couldn&apos;t find that page
        </h1>
        <p className="text-muted-foreground mt-2">
          It may have moved, or you may not have access to it.
        </p>
        <Button className="mt-6" asChild>
          <Link href="/">Back home</Link>
        </Button>
      </div>
    </div>
  );
}
