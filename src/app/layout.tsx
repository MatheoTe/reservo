import "./globals.css";

import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: { default: "Reservo - Scheduling for service businesses", template: "%s · Reservo" },
  description: "Online booking, calendars and payments for clinics, salons and studios.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfd" },
    { media: "(prefers-color-scheme: dark)", color: "#16161c" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans">
        {children}
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
