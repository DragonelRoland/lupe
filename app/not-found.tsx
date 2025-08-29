export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center">
      <div className="text-center text-white/80">
        <h1 className="text-2xl font-semibold">Not Found</h1>
        <p className="mt-2">The page you are looking for does not exist.</p>
        <a href="/" className="mt-4 inline-block rounded bg-white/10 px-3 py-1 text-white hover:bg-white/20">Go home</a>
      </div>
    </main>
  );
}
