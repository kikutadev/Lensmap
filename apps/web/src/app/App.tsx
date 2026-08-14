import { lazy, Suspense } from "react";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpenText, Library, LoaderCircle, Search } from "lucide-react";
import { ResizableThreePane } from "./ResizableThreePane";
import {
  fetchBookIndexStatus,
  fetchBookOutline,
  fetchBooks,
  fetchCodexStatus,
  importBook,
  searchBook,
  startBookIndex,
  startCodexChatGptLogin,
} from "../lib/api";
import { useReaderStore } from "../store/reader-store";
import { useSourceDraftStore } from "../store/source-draft-store";

const DeepDivePanel = lazy(() => import("../features/chat/DeepDivePanel").then((module) => ({ default: module.DeepDivePanel })));
const PdfReader = lazy(() => import("../features/pdf-reader/PdfReader").then((module) => ({ default: module.PdfReader })));

function LoadingPane({ label }: { label: string }) {
  return <div className="flex h-full items-center justify-center text-sm text-slate-400">{label}</div>;
}

function StatusBadge() {
  const codex = useQuery({
    queryKey: ["codex-status"],
    queryFn: ({ signal }) => fetchCodexStatus(signal),
    refetchInterval: 60_000,
  });
  const login = useMutation({
    mutationFn: startCodexChatGptLogin,
    onSuccess: ({ authUrl }) => {
      window.open(authUrl, "_blank", "noopener,noreferrer");
    },
  });

  if (codex.isLoading) {
    return <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500 shadow-sm">Codex確認中</span>;
  }
  if (codex.isError || !codex.data?.available) {
    return <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-700">Codex未検出</span>;
  }
  if (!codex.data.ready) {
    return <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs text-red-700">Codex起動失敗</span>;
  }
  if (!codex.data.account) {
    return (
      <button
        className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 disabled:opacity-50"
        disabled={login.isPending}
        onClick={() => login.mutate()}
      >
        ChatGPTでログイン
      </button>
    );
  }

  const accountLabel = codex.data.account.type === "chatgpt"
    ? `Codex · ${codex.data.account.planType}`
    : `Codex · ${codex.data.account.type}`;
  const defaultModel = codex.data.models.find((model) => model.isDefault)?.displayName;
  return (
    <span
      className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700 shadow-sm"
      title={defaultModel ? `既定モデル: ${defaultModel}` : undefined}
    >
      {accountLabel}
    </span>
  );
}

function BookSidebar() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const activeBookId = useReaderStore((state) => state.activeBookId);
  const setActiveBookId = useReaderStore((state) => state.setActiveBookId);
  const setCurrentPage = useReaderStore((state) => state.setCurrentPage);
  const outlineItems = useReaderStore((state) => state.outlineItems);
  const clearSources = useSourceDraftStore((state) => state.clearSources);
  const books = useQuery({
    queryKey: ["books"],
    queryFn: ({ signal }) => fetchBooks(signal),
  });
  const detectedOutline = useQuery({
    queryKey: ["book-outline", activeBookId],
    queryFn: ({ signal }) => fetchBookOutline(activeBookId!, signal),
    enabled: Boolean(activeBookId),
  });
  const indexStatus = useQuery({
    queryKey: ["book-index-status", activeBookId],
    queryFn: ({ signal }) => fetchBookIndexStatus(activeBookId!, signal),
    enabled: Boolean(activeBookId),
    refetchInterval: (query) => query.state.data?.status === "indexing" ? 1_500 : false,
  });
  const search = useQuery({
    queryKey: ["book-search", activeBookId, searchQuery],
    queryFn: ({ signal }) => searchBook(activeBookId!, searchQuery, signal),
    enabled: Boolean(activeBookId && searchQuery.trim()),
  });
  const upload = useMutation({
    mutationFn: importBook,
    onSuccess: async (book) => {
      clearSources();
      setSearchInput("");
      setSearchQuery("");
      setActiveBookId(book.id);
      await queryClient.invalidateQueries({ queryKey: ["books"] });
      void startBookIndex(book.id)
        .then(async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["books"] }),
            queryClient.invalidateQueries({ queryKey: ["book-index-status", book.id] }),
          ]);
        })
        .catch(() => {
          void queryClient.invalidateQueries({ queryKey: ["book-index-status", book.id] });
        });
    },
  });

  const openBook = (bookId: string) => {
    if (bookId !== activeBookId) {
      clearSources();
      setSearchInput("");
      setSearchQuery("");
      setActiveBookId(bookId);
    }
    void startBookIndex(bookId).finally(() => {
      void queryClient.invalidateQueries({ queryKey: ["book-index-status", bookId] });
    });
  };

  const effectiveOutline = outlineItems.length > 0
    ? outlineItems
    : (detectedOutline.data?.items ?? []).map((item) => ({
        id: `detected-${item.id}`,
        title: item.title,
        page: item.pageIndex + 1,
        depth: item.depth,
      }));

  return (
    <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-4">
        <input
          ref={inputRef}
          className="hidden"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) upload.mutate(file);
            event.currentTarget.value = "";
          }}
        />
        <button
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          disabled={upload.isPending}
          onClick={() => inputRef.current?.click()}
        >
          {upload.isPending ? <LoaderCircle className="animate-spin" size={16} /> : <Library size={16} />}
          {upload.isPending ? "PDFを取り込み中" : "PDFを開く"}
        </button>
        {upload.isError ? <p className="mt-2 text-xs text-red-600">{upload.error.message}</p> : null}
      </div>

      {activeBookId ? (
        <div className="border-b border-slate-200 p-3">
          <form
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 focus-within:border-slate-300"
            onSubmit={(event) => {
              event.preventDefault();
              setSearchQuery(searchInput.trim());
            }}
          >
            <Search size={14} className="shrink-0 text-slate-400" />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-slate-400"
              placeholder="この本を検索"
            />
          </form>
          <div className="mt-1.5 flex items-center justify-between gap-2 px-0.5 text-[10px] text-slate-400">
            <span>
              {indexStatus.data?.status === "indexed"
                ? `${indexStatus.data.blockCount.toLocaleString()} blocks indexed`
                : indexStatus.data?.status === "indexing"
                  ? "本文を索引中…"
                  : indexStatus.data?.status === "error"
                    ? "索引エラー"
                    : "索引準備中"}
            </span>
            {indexStatus.data?.pageCount ? <span>{indexStatus.data.pageCount} pages</span> : null}
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {searchQuery && activeBookId ? (
          <div>
            <div className="mb-3 flex items-center justify-between gap-2 px-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Search</span>
              <button
                className="text-[10px] text-slate-500 hover:text-slate-800"
                onClick={() => {
                  setSearchInput("");
                  setSearchQuery("");
                }}
              >Libraryへ戻る</button>
            </div>
            {search.isLoading ? <p className="px-1 text-xs text-slate-400">検索・索引中…</p> : null}
            {search.isError ? <p className="px-1 text-xs leading-5 text-red-600">{search.error.message}</p> : null}
            {search.data?.hits.length === 0 ? <p className="px-1 text-xs text-slate-400">一致する本文がありません。</p> : null}
            <div className="space-y-2">
              {search.data?.hits.map((hit) => (
                <button
                  key={hit.block.id}
                  className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-left hover:bg-slate-50"
                  onClick={() => setCurrentPage(hit.block.pageIndex + 1)}
                >
                  <div className="mb-1 text-[10px] font-semibold text-blue-700">PDF p.{hit.block.pageIndex + 1} · {hit.block.kind}</div>
                  <div className="line-clamp-4 text-[11px] leading-5 text-slate-600">{hit.snippet}</div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {activeBookId ? (
              <div className="mb-5">
                <div className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <BookOpenText size={14} />目次
                </div>
                {effectiveOutline.length > 0 ? (
                  <div className="space-y-0.5">
                    {effectiveOutline.map((item) => (
                      <button
                        key={item.id}
                        className="block w-full truncate rounded-md py-1.5 pr-2 text-left text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                        style={{ paddingLeft: `${8 + Math.min(item.depth, 4) * 12}px` }}
                        title={item.title}
                        onClick={() => setCurrentPage(item.page)}
                      >{item.title}</button>
                    ))}
                  </div>
                ) : <p className="px-2 text-[11px] leading-5 text-slate-400">PDFに目次情報がない場合は本文検索を利用できます。</p>}
              </div>
            ) : null}
            <div className="mb-3 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Library size={14} />Library
            </div>
            {books.isLoading ? <p className="px-1 text-sm text-slate-400">読み込み中…</p> : null}
            {books.data?.length === 0 ? <p className="px-1 text-sm leading-6 text-slate-500">PDFを読み込むと、管理ライブラリに保存されます。</p> : null}
            <div className="space-y-1">
              {books.data?.map((book) => (
                <button key={book.id} onClick={() => openBook(book.id)} className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${activeBookId === book.id ? "bg-slate-900 text-white" : "hover:bg-slate-100 text-slate-700"}`}>
                  <span className="block truncate font-medium">{book.title}</span>
                  <span className={`mt-0.5 block truncate text-xs ${activeBookId === book.id ? "text-slate-300" : "text-slate-400"}`}>{book.fileName}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

function EmptyReader() {
  return (
    <section className="overflow-auto bg-slate-200/70 p-8">
      <div className="mx-auto min-h-[900px] max-w-[760px] rounded-sm bg-white p-14 shadow-xl shadow-slate-300/40">
        <div className="mb-10 text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Reader</div>
        <h1 className="mb-6 text-3xl font-semibold tracking-tight">PDFを選んで読書を開始</h1>
        <div className="space-y-5 text-[15px] leading-8 text-slate-700">
          <p>読み込んだPDFはアプリ管理領域へコピーし、SHA-256 fingerprintで重複を判定します。</p>
          <p className="rounded-md bg-amber-50 px-2 py-1 ring-1 ring-amber-200">本文を選択すると、その範囲を根拠として複数引用を1回の質問へ添付できます。</p>
        </div>
      </div>
    </section>
  );
}

/** Three-pane reading shell backed by managed PDF storage, local retrieval, selectable text, and grounded Codex chat. */
export function App() {
  const activeBookId = useReaderStore((state) => state.activeBookId);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-5">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-950 text-white"><BookOpenText size={17} /></div>
          <div>
            <div className="text-sm font-semibold">Deep Reader</div>
            <div className="text-xs text-slate-500">技術書を、根拠付きの知識に変える</div>
          </div>
        </div>
        <StatusBadge />
      </header>

      <ResizableThreePane
        left={<BookSidebar />}
        center={activeBookId
          ? <Suspense fallback={<LoadingPane label="Readerを読み込み中…" />}><PdfReader bookId={activeBookId} /></Suspense>
          : <EmptyReader />}
        right={<Suspense fallback={<LoadingPane label="Deep Diveを読み込み中…" />}><DeepDivePanel /></Suspense>}
      />
    </div>
  );
}
