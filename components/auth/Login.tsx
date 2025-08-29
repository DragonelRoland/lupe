"use client";

import { useAuth } from "@/lib/auth-context";

export default function Login() {
  const { signInWithGoogle, loading } = useAuth();
  return (
    <div className="rounded-lg bg-neutral-900 p-6 shadow-lg border border-neutral-800">
      <h2 className="mb-4 text-lg font-semibold">Sign in</h2>
      <button
        type="button"
        onClick={() => signInWithGoogle()}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-200 disabled:opacity-50"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18"><path fill="#EA4335" d="M12 10.2v3.6h5.1c-.2 1.3-1.5 3.8-5.1 3.8-3.1 0-5.6-2.6-5.6-5.8s2.5-5.8 5.6-5.8c1.8 0 3 .8 3.7 1.5l2.5-2.4C16.9 3.4 14.7 2.5 12 2.5 6.9 2.5 2.8 6.6 2.8 11.7S6.9 20.9 12 20.9c6.4 0 8.9-4.5 8.9-6.8 0-.5-.1-.9-.1-1.2H12z"/><path fill="#34A853" d="M3.7 7.4l3 2.2c.8-1.9 2.5-3.3 4.6-3.3 1.3 0 2.5.5 3.3 1.2l2.5-2.4C15.3 3.4 13.1 2.5 10.4 2.5 7.2 2.5 4.4 4.4 3.7 7.4z"/><path fill="#4A90E2" d="M12 21c2.7 0 4.9-.9 6.5-2.5l-3-2.5c-.9.6-2.1 1-3.5 1-3.6 0-4.9-2.6-5.1-3.8H3.8v2.4C5.4 19.5 8.4 21 12 21z"/><path fill="#FBBC05" d="M20.9 14.1c.2-.5.3-1 .3-1.6 0-.6-.1-1.1-.2-1.6H12v3.2h4.5c-.2 1-.9 1.9-2 2.5l3 2.5c1.7-1.6 2.7-3.9 2.7-5z"/></svg>
        Continue with Google
      </button>
    </div>
  );
}


