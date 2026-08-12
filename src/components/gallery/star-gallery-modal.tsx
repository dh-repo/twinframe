import { useEffect, useState, useMemo } from "react";
import { Search, X, Sparkles, User, ShieldCheck } from "lucide-react";
import { loadCelebrityEmbeddings, type CelebrityEmbedding } from "@/lib/face/embeddings";
import { catalogFor } from "@/lib/celebrities/catalog";

interface StarGalleryModalProps {
  open: boolean;
  onClose: () => void;
}

export function StarGalleryModal({ open, onClose }: StarGalleryModalProps) {
  const [celebrities, setCelebrities] = useState<CelebrityEmbedding[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("All");

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    setLoading(true);
    loadCelebrityEmbeddings()
      .then((data) => {
        if (!mounted) return;
        // Deduplicate by ID
        const uniqueMap = new Map<string, CelebrityEmbedding>();
        for (const c of data) {
          if (!uniqueMap.has(c.id)) uniqueMap.set(c.id, c);
        }
        setCelebrities(Array.from(uniqueMap.values()));
      })
      .catch((err) => {
        console.error("Failed to load celebrity gallery", err);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [open]);

  const categories = ["All", "Actor", "Artist", "Athlete", "Model", "Public figure"];

  const filteredCelebs = useMemo(() => {
    const term = search.trim().toLowerCase();
    return celebrities.filter((c) => {
      const matchSearch = !term || c.name.toLowerCase().includes(term) || c.id.toLowerCase().includes(term);
      const cat = catalogFor(c.id).knownFor;
      const matchCat = category === "All" || cat === category;
      return matchSearch && matchCat;
    });
  }, [celebrities, search, category]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 animate-fade-up">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-md transition-opacity"
        onClick={onClose}
        aria-hidden
      />

      {/* Modal Card */}
      <div className="relative z-10 flex h-[90dvh] max-h-[850px] w-full max-w-4xl flex-col overflow-hidden rounded-2xl sm:rounded-3xl border border-white/15 bg-[#121420]/95 text-white shadow-2xl backdrop-blur-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 sm:px-6 py-4 sm:py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-indigo-400/30 bg-gradient-to-b from-indigo-500/20 to-purple-600/20 text-indigo-400">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-xl font-bold tracking-tight text-white">
                Twinframe Star Index
              </h2>
              <p className="text-xs text-white/60">
                {celebrities.length > 0 ? `${celebrities.length} On-Device FaceNet Embeddings` : "Loading gallery..."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition-colors hover:bg-white/10 hover:text-white touch-target-min"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Filter Controls */}
        <div className="space-y-3 border-b border-white/10 bg-white/[0.02] px-4 sm:px-6 py-3.5 sm:py-4">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <input
              type="text"
              placeholder="Search star by name (e.g., Leonardo DiCaprio, Zendaya)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-2xl border border-white/15 bg-white/5 py-2.5 pl-10 pr-4 text-sm text-white placeholder-white/40 outline-none transition-all focus:border-indigo-500/60 focus:bg-white/10 focus:ring-1 focus:ring-indigo-500/50"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/40 hover:text-white"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-all shrink-0 ${
                  category === cat
                    ? "bg-white text-black font-semibold shadow-md"
                    : "border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Grid Content */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-white/10">
          {loading ? (
            <div className="flex h-64 flex-col items-center justify-center space-y-3 text-white/50">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
              <p className="text-sm">Loading 1,000+ FaceNet embeddings...</p>
            </div>
          ) : filteredCelebs.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center space-y-2 text-white/50">
              <User className="h-10 w-10 stroke-1 text-white/30" />
              <p className="text-sm font-medium">No celebrity stars found matching "{search}"</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {filteredCelebs.map((celeb) => {
                const meta = catalogFor(celeb.id);
                const photoSrc = celeb.path192 || celeb.path;
                return (
                  <div
                    key={celeb.id}
                    className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-2.5 transition-all hover:border-indigo-400/40 hover:bg-white/10 hover:shadow-lg hover:shadow-indigo-500/10"
                  >
                    <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-neutral-900">
                      <img
                        src={photoSrc}
                        alt={celeb.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = celeb.path;
                        }}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                    </div>
                    <div className="mt-2 text-left">
                      <p className="truncate text-xs font-semibold text-white group-hover:text-indigo-200">
                        {celeb.name}
                      </p>
                      <p className="text-[11px] text-white/50">{meta.knownFor}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer info bar */}
        <div className="flex items-center justify-between border-t border-white/10 bg-black/40 px-6 py-3 text-xs text-white/50">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> 100% On-device Local Indexing
          </span>
          <span>Showing {filteredCelebs.length} stars</span>
        </div>
      </div>
    </div>
  );
}
