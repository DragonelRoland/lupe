"use client";

import { Plus, ChevronRight, ChevronLeft, Folder, Pencil, Clock } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";

type Project = {
  id: string;
  name: string;
  canvas_id: string | null;
  created_at?: string;
  updated_at?: string;
};

type Props = {
  selectedProjectId: string | null;
  onSelect: (projectId: string) => void;
};

export default function ProjectsSidebar({ selectedProjectId, onSelect }: Props) {
  const { user } = useAuth();
  const router = useRouter();
  const [expanded, setExpanded] = useState<boolean>(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [creating, setCreating] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState<string>("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const canInteract = useMemo(() => Boolean(user?.id), [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setProjects([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/projects", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data?.projects)) {
          setProjects(data.projects as Project[]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const startRename = (proj: Project) => {
    if (!canInteract) return;
    setEditingId(proj.id);
    setDraftName(proj.name || "Untitled");
  };

  const cancelRename = () => {
    setEditingId(null);
    setDraftName("");
  };

  const commitRename = async () => {
    if (!editingId) return;
    const newName = draftName.trim();
    const idx = projects.findIndex((p) => p.id === editingId);
    if (idx === -1) {
      cancelRename();
      return;
    }
    const prevName = projects[idx]!.name;
    if (!newName || newName === prevName) {
      cancelRename();
      return;
    }
    setSavingId(editingId);
    setProjects((prev) => prev.map((p) => (p.id === editingId ? { ...p, name: newName } : p)));
    try {
      const res = await fetch(`/api/projects/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (!res.ok) {
        // revert on failure
        setProjects((prev) => prev.map((p) => (p.id === editingId ? { ...p, name: prevName } : p)));
      }
    } catch {
      setProjects((prev) => prev.map((p) => (p.id === editingId ? { ...p, name: prevName } : p)));
    } finally {
      setSavingId(null);
      cancelRename();
    }
  };

  const handleCreate = async () => {
    if (!canInteract || creating) return;
    try {
      setCreating(true);
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled" }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const proj: Project | undefined = data?.project;
      if (proj) {
        setProjects((prev) => [proj, ...prev]);
        onSelect(proj.id);
        setExpanded(true);
        // Immediately start rename flow
        setEditingId(proj.id);
        setDraftName(proj.name || "Untitled");
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      data-ui-overlay="true"
      className="fixed left-0 top-20 z-50 select-none"
      style={{ width: expanded ? 260 : 56 }}
    >
      <div className="bg-neutral-900 ring-1 ring-white/10 rounded-r-lg overflow-hidden inline-block">
        <div className="flex items-center justify-between px-2 py-2 border-b border-white/10">
          <button
            className="grid place-items-center size-8 rounded-md bg-white/10 text-white hover:bg-white/20 active:scale-95"
            onClick={() => setExpanded((e) => !e)}
            aria-label={expanded ? "Collapse" : "Expand"}
            disabled={!canInteract}
          >
            {expanded ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {expanded && (
            <div className="flex items-center gap-1">
              <button
                className={`grid place-items-center size-8 rounded-md text-white active:scale-95 ${canInteract ? "bg-white/10 hover:bg-white/20" : "bg-white/5 opacity-50 cursor-not-allowed"}`}
                onClick={() => router.push("/history")}
                aria-label="History"
                disabled={!canInteract}
              >
                <Clock className="h-4 w-4" />
              </button>
              <button
                className={`grid place-items-center size-8 rounded-md text-white active:scale-95 ${canInteract ? "bg-white/10 hover:bg-white/20" : "bg-white/5 opacity-50 cursor-not-allowed"}`}
                onClick={handleCreate}
                aria-label="New project"
                disabled={!canInteract || creating}
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {expanded ? (
          <div className="px-2 py-2 space-y-1">
            {loading && (
              <div className="text-xs text-white/60 px-2 py-1">Loading…</div>
            )}
            {!loading && projects.length === 0 && (
              <div className="text-xs text-white/60 px-2 py-1">No projects yet</div>
            )}
            {projects.map((p) => {
              const active = p.id === selectedProjectId;
              const rowClass = `w-full flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${active ? "bg-white/20" : "hover:bg-white/10"}`;
              if (editingId === p.id) {
                return (
                  <div key={p.id} className={rowClass}>
                    <Folder className="h-4 w-4 text-white/80" />
                    <input
                      ref={inputRef}
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") cancelRename();
                      }}
                      disabled={savingId === p.id}
                      aria-label="Edit project name"
                      className="flex-1 min-w-0 bg-transparent outline-none text-white placeholder-white/60"
                    />
                  </div>
                );
              }
              return (
                <div key={p.id} className="relative group">
                  <button
                    className={rowClass}
                    onDoubleClick={() => startRename(p)}
                    onClick={() => onSelect(p.id)}
                    disabled={!canInteract}
                  >
                    <Folder className="h-4 w-4 text-white/80" />
                    <span className="truncate">{p.name || "Untitled"}</span>
                  </button>
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-white/70 hover:text-white disabled:opacity-30"
                    onClick={(e) => { e.stopPropagation(); startRename(p); }}
                    aria-label="Rename project"
                    disabled={!canInteract}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center py-2 gap-2">
            <button
              className={`grid place-items-center size-8 rounded-md text-white active:scale-95 ${canInteract ? "bg-white/10 hover:bg-white/20" : "bg-white/5 opacity-50 cursor-not-allowed"}`}
              onClick={() => router.push("/history")}
              aria-label="History"
              disabled={!canInteract}
            >
              <Clock className="h-4 w-4" />
            </button>
            <button
              className={`grid place-items-center size-8 rounded-md text-white active:scale-95 ${canInteract ? "bg-white/10 hover:bg-white/20" : "bg-white/5 opacity-50 cursor-not-allowed"}`}
              onClick={handleCreate}
              aria-label="New project"
              disabled={!canInteract || creating}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}


