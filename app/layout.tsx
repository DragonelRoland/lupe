import "./globals.css";
import type { ReactNode } from "react";
import { PostHogProvider } from "../components/PostHogProvider";
import { AuthProvider } from "@/lib/auth-context";

export const metadata = {
  title: "Canvas",
  description: "Grid canvas playground",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Preconnect to Fal CDN to reduce connection setup latency */}
        <link rel="preconnect" href="https://v3.fal.media" />
      </head>
      <body
        className="min-h-screen bg-neutral-950 text-neutral-100 antialiased"
        suppressHydrationWarning
      >
        <PostHogProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </PostHogProvider>
      </body>
    </html>
  );
}