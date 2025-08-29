"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import ProjectsSidebar from "@/components/projects/ProjectsSidebar";
import AssetCard from "@/components/history/AssetCard";
import NoPageZoom from "@/components/system/NoPageZoom";
import { User, Plus, ChevronDown } from "lucide-react";

type Asset = {
  id: string;
  kind: "image" | "video";
  output_url: string;
  width?: number;
  height?: number;
  duration_seconds?: number;
  model_id: string;
  canvas_id?: string;
  prompt: string;
  created_at: string;
};

type HistoryResponse = {
  items: Asset[];
  next_cursor?: string;
};

type Project = {
  id: string;
  name: string;
  canvas_id: string | null;
  created_at?: string;
  updated_at?: string;
};

export default function HistoryPage() {
  const { user, loading, signInWithGoogle, signOut } = useAuth();
  const router = useRouter();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [targetProjectId, setTargetProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [addingToCanvas, setAddingToCanvas] = useState(false);

  const fetchAssets = async (cursor?: string, append = false) => {
    if (!user) return;
    
    try {
      setLoadingAssets(true);
      setError(null);
      
      const params = new URLSearchParams({ limit: "60" });
      if (cursor) params.set("cursor", cursor);
      
      const res = await fetch(`/api/assets?${params}`, { cache: "no-store" });
      
      if (res.status === 401) {
        setError("Please sign in to view your history");
        return;
      }
      
      if (!res.ok) {
        setError("Failed to load assets");
        return;
      }
      
      const data: HistoryResponse = await res.json();
      
      if (append) {
        setAssets(prev => [...prev, ...data.items]);
      } else {
        setAssets(data.items);
      }
      
      setNextCursor(data.next_cursor || null);
      setHasMore(!!data.next_cursor);
    } catch (err) {
      console.error("Failed to fetch assets:", err);
      setError("Failed to load assets");
    } finally {
      setLoadingAssets(false);
    }
  };

  const loadMore = () => {
    if (nextCursor && !loadingAssets) {
      fetchAssets(nextCursor, true);
    }
  };

  // Initial load
  useEffect(() => {
    if (user && !loading) {
      fetchAssets();
    }
  }, [user, loading]);

  // Reset when user changes
  useEffect(() => {
    if (!user) {
      setAssets([]);
      setNextCursor(null);
      setHasMore(true);
      setError(null);
      setSelectedAssetIds(new Set());
    }
  }, [user]);

  // Load current project ID from localStorage
  useEffect(() => {
    const key = "lupe:selected-project-id";
    const existing = localStorage.getItem(key);
    if (existing) setTargetProjectId(existing);
  }, []);

  // Fetch projects for canvas picker
  useEffect(() => {
    if (!user?.id) {
      setProjects([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoadingProjects(true);
        const res = await fetch("/api/projects", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data?.projects)) {
          setProjects(data.projects as Project[]);
        }
      } finally {
        if (!cancelled) setLoadingProjects(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // Set default target project when projects load
  useEffect(() => {
    if (!targetProjectId && projects.length > 0) {
      setTargetProjectId(projects[0]!.id);
    }
  }, [projects, targetProjectId]);

  const createNewProject = async () => {
    if (!user?.id || creatingProject) return;
    try {
      setCreatingProject(true);
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled" }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const proj: Project | undefined = data?.project;
      if (proj) {
        setProjects(prev => [proj, ...prev]);
        setTargetProjectId(proj.id);
        setShowProjectPicker(false);
      }
    } finally {
      setCreatingProject(false);
    }
  };

  const toggleAssetSelection = (assetId: string) => {
    setSelectedAssetIds(prev => {
      const next = new Set(prev);
      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedAssetIds(new Set());
  };

  const addToCanvas = async () => {
    if (!targetProjectId || selectedAssetIds.size === 0 || addingToCanvas) return;
    
    const selectedAssets = assets.filter(asset => selectedAssetIds.has(asset.id));
    if (selectedAssets.length === 0) return;

    try {
      setAddingToCanvas(true);

      // Prepare the payload for the canvas
      const items = selectedAssets.map(asset => ({
        kind: asset.kind,
        url: asset.output_url,
        width: asset.width,
        height: asset.height,
        prompt: asset.prompt
      }));

      const columns = Math.min(3, Math.ceil(Math.sqrt(items.length)));
      const batchId = `history-add-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      
      const payload = {
        projectId: targetProjectId,
        layout: { columns },
        items,
        batchId
      };

      // Store in sessionStorage for the canvas page to pick up
      sessionStorage.setItem("lupe:pending-add", JSON.stringify(payload));
      
      // Ensure the target project is selected
      localStorage.setItem("lupe:selected-project-id", targetProjectId);
      
      // Navigate to canvas
      router.push("/");
    } finally {
      // Reset after a delay to prevent rapid clicks
      setTimeout(() => setAddingToCanvas(false), 1000);
    }
  };

  // Close profile popover and project picker on outside click / Esc
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target.closest('[data-profile-menu]')) {
        setShowProfile(false);
      }
      if (!target.closest('[data-project-picker]')) {
        setShowProjectPicker(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowProfile(false);
        setShowProjectPicker(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  if (loading) {
    return (
      <main className="relative h-screen w-screen bg-neutral-950">
        <NoPageZoom />
        <div className="flex items-center justify-center h-full">
          <div className="text-neutral-400">Loading...</div>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="relative h-screen w-screen bg-neutral-950">
        <NoPageZoom />
        <div className="flex items-center justify-center h-full">
          <div className="max-w-md text-center space-y-4">
            <h1 className="text-2xl font-semibold text-white">History</h1>
            <p className="text-neutral-400">
              Sign in to view your generated assets
            </p>
            <button
              onClick={() => signInWithGoogle()}
              className="rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-200"
            >
              Continue with Google
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="relative h-screen w-screen bg-neutral-950">
      <NoPageZoom />
      <ProjectsSidebar selectedProjectId={null} onSelect={() => {}} />
      
      {/* Header */}
      <div className="fixed right-4 top-4 z-50">
        <div className="flex items-center gap-2">
          <div data-profile-menu className="relative">
            <button
              onClick={() => setShowProfile(v => !v)}
              aria-haspopup="menu"
              aria-expanded={showProfile}
              aria-label="Account"
              className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700"
              title="Account"
            >
              <User className="h-4 w-4" />
            </button>
            {showProfile && (
              <div className="absolute right-0 mt-2 w-44 rounded-md bg-neutral-900 p-2 text-sm text-neutral-100 ring-1 ring-white/10 shadow-lg">
                <button
                  onClick={() => signOut()}
                  className="w-full rounded-sm bg-neutral-800 px-3 py-1.5 text-left hover:bg-neutral-700"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="pl-16 pr-4 pt-20 pb-8 h-full overflow-y-auto">
        <div className="max-w-7xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-semibold text-white mb-2">History</h1>
            <p className="text-neutral-400">Your generated images and videos</p>
          </div>

          {error && (
            <div className="mb-6 rounded-md bg-red-900/20 border border-red-500/20 px-4 py-3 text-red-200">
              {error}
            </div>
          )}

          {loadingAssets && assets.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <div className="text-neutral-400">Loading assets...</div>
            </div>
          )}

          {!loadingAssets && assets.length === 0 && !error && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center space-y-2">
                <div className="text-neutral-400">No assets yet</div>
                <div className="text-sm text-neutral-500">
                  Generate some images or videos to see them here
                </div>
              </div>
            </div>
          )}

          {assets.length > 0 && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 mb-8">
                {assets.map(asset => (
                  <AssetCard 
                    key={asset.id} 
                    asset={asset} 
                    selected={selectedAssetIds.has(asset.id)}
                    onToggleSelect={() => toggleAssetSelection(asset.id)}
                  />
                ))}
              </div>

              {hasMore && (
                <div className="flex justify-center">
                  <button
                    onClick={loadMore}
                    disabled={loadingAssets}
                    className="rounded-md bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed px-6 py-2 text-sm font-medium text-white transition-colors"
                  >
                    {loadingAssets ? "Loading..." : "Load more"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Sticky Action Bar */}
      {selectedAssetIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50">
          <div className="bg-neutral-900 rounded-lg px-6 py-3 ring-1 ring-white/20 shadow-lg flex items-center gap-4">
            <span className="text-sm text-neutral-300">
              {selectedAssetIds.size} selected
            </span>
            
            {/* Canvas Picker */}
            <div className="relative" data-project-picker>
              <button
                onClick={() => setShowProjectPicker(!showProjectPicker)}
                className="flex items-center gap-2 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded-md text-sm text-white transition-colors"
                disabled={loadingProjects}
              >
                <span className="truncate max-w-32">
                  {targetProjectId 
                    ? projects.find(p => p.id === targetProjectId)?.name || "Unknown"
                    : "Select canvas"
                  }
                </span>
                <ChevronDown className="h-3 w-3" />
              </button>
              
              {showProjectPicker && (
                <div className="absolute bottom-full mb-2 left-0 w-64 bg-neutral-800 rounded-lg ring-1 ring-white/20 shadow-lg max-h-48 overflow-y-auto">
                  <div className="p-2 space-y-1">
                    {projects.map(project => (
                      <button
                        key={project.id}
                        onClick={() => {
                          setTargetProjectId(project.id);
                          setShowProjectPicker(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                          targetProjectId === project.id 
                            ? "bg-sky-600 text-white" 
                            : "text-neutral-300 hover:bg-neutral-700"
                        }`}
                      >
                        <div className="truncate">{project.name || "Untitled"}</div>
                      </button>
                    ))}
                    <hr className="border-neutral-600 my-1" />
                    <button
                      onClick={createNewProject}
                      disabled={creatingProject}
                      className="w-full text-left px-3 py-2 rounded-md text-sm text-neutral-300 hover:bg-neutral-700 transition-colors disabled:opacity-50"
                    >
                      {creatingProject ? "Creating..." : "+ New canvas"}
                    </button>
                  </div>
                </div>
              )}
            </div>
            
            <button
              onClick={clearSelection}
              className="text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              Clear
            </button>
            <button
              onClick={addToCanvas}
              disabled={!targetProjectId || addingToCanvas}
              className="flex items-center gap-2 bg-white text-neutral-900 px-4 py-2 rounded-md text-sm font-medium hover:bg-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Plus className="h-4 w-4" />
              {addingToCanvas ? "Adding..." : `Add to canvas (${selectedAssetIds.size})`}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
