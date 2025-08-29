import { notFound } from "next/navigation";
import { headers } from "next/headers";
import CanvasViewer from "@/components/canvas/CanvasViewer";
import type { CanvasElement, ViewState } from "@/components/canvas/types";

async function fetchPublicCanvas(slug: string) {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? (process.env.NEXT_PUBLIC_BASE_URL?.startsWith("http") ? new URL(process.env.NEXT_PUBLIC_BASE_URL).protocol.replace(":", "") : "https");
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? (process.env.NEXT_PUBLIC_BASE_URL ? new URL(process.env.NEXT_PUBLIC_BASE_URL).host : "localhost:3000");
  const baseUrl = `${proto}://${host}`;
  const res = await fetch(`${baseUrl}/api/canvases/public/${slug}`, {
    // Force dynamic fetch; Next will still handle at request time
    cache: "no-store",
    // Ensure this runs on the server
    next: { revalidate: 0 },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data as { id: string; title?: string | null; data: { elements?: CanvasElement[]; viewState?: ViewState } } | null;
}

export default async function PublicCanvasPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const canvas = await fetchPublicCanvas(slug);
  if (!canvas || !canvas.data) {
    notFound();
  }
  const payload = canvas.data || {} as any;
  const elements = Array.isArray(payload.elements) ? (payload.elements as CanvasElement[]) : [];
  const initialView: ViewState = payload.viewState && typeof payload.viewState === "object" ? payload.viewState as ViewState : { zoom: 1, pan: { x: 0, y: 0 } };

  return (
    <main className="relative h-screen w-screen">
      <CanvasViewer elements={elements} initialView={initialView} />
    </main>
  );
}
