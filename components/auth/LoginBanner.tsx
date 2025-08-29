"use client";

import { useAuth } from "@/lib/auth-context";

export default function LoginBanner({ onClose }: { onClose?: () => void }) {
  const { signInWithGoogle, loading } = useAuth();
  return (
    <div className="w-full max-w-3xl rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 shadow-xl">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-neutral-200">
          Sign in to use Flux Multi. Google login required.
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => signInWithGoogle()}
            disabled={loading}
            className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-neutral-200 disabled:opacity-50"
          >
            Continue with Google
          </button>
          <button
            type="button"
            onClick={() => onClose?.()}
            className="rounded-md border border-neutral-700 px-2.5 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}


