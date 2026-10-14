import { ArrowRight } from "lucide-react";

import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * A plain form POST (works without JS). The session is created server-side by
 * /api/demo/sign-in, which only exists when DEMO_MODE=1.
 */
export function DemoSignInButton({
  children = "Try the demo",
  className,
  size,
  variant,
}: Pick<ButtonProps, "children" | "className" | "size" | "variant">) {
  return (
    <form action="/api/demo/sign-in" method="post" className="contents">
      <Button type="submit" size={size} variant={variant} className={className}>
        {children} <ArrowRight />
      </Button>
    </form>
  );
}
