/** Client-side helpers for the Retriever viz APIs (read-only, no secrets). */
const RETRIEVER = process.env.NEXT_PUBLIC_RETRIEVER_URL ?? "http://localhost:8100";

// ── Auth (self-contained JWT + RBAC) ──
export type Role = "viewer" | "editor" | "admin";
export interface AuthUser { id: string; username: string; role: Role }

export async function authConfig(): Promise<{ enabled: boolean }> {
  try {
    const res = await fetch(`${RETRIEVER}/auth/config`);
    return res.ok ? res.json() : { enabled: false };
  } catch { return { enabled: false }; }
}

export async function authLogin(username: string, password: string): Promise<{ token: string; user: AuthUser }> {
  const res = await fetch(`${RETRIEVER}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "login failed");
  return res.json();
}

export async function authMe(): Promise<AuthUser> {
  const res = await fetch(`${RETRIEVER}/auth/me`);
  if (!res.ok) throw new Error("not authenticated");
  return (await res.json()).user;
}

export async function listUsers(): Promise<AuthUser[]> {
  const res = await fetch(`${RETRIEVER}/auth/users`);
  if (!res.ok) throw new Error(`users ${res.status}`);
  return (await res.json()).users;
}

export async function createUser(username: string, password: string, role: Role): Promise<void> {
  const res = await fetch(`${RETRIEVER}/auth/users`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, role }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "create failed");
}

export async function updateUserRole(id: string, role: Role): Promise<void> {
  await fetch(`${RETRIEVER}/auth/users/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
}

export async function deleteUser(id: string): Promise<void> {
  await fetch(`${RETRIEVER}/auth/users/${id}`, { method: "DELETE" });
}

export interface Chunk {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
}

export async function fetchChunks(collection: string, limit = 100): Promise<Chunk[]> {
  const res = await fetch(`${RETRIEVER}/chunks?collection=${encodeURIComponent(collection)}&limit=${limit}`);
  if (!res.ok) throw new Error(`chunks ${res.status}`);
  return (await res.json()).chunks;
}

export interface UmapPoint {
  id: string;
  content: string;
  source: string;
  is_query: boolean;
  x: number;
  y: number;
}

export async function fetchUmap(collection: string, query = ""): Promise<UmapPoint[]> {
  const q = query ? `&query=${encodeURIComponent(query)}` : "";
  const res = await fetch(`${RETRIEVER}/embeddings/umap?collection=${encodeURIComponent(collection)}${q}`);
  if (!res.ok) throw new Error(`umap ${res.status}`);
  return (await res.json()).points;
}

export type Strategy = "semantic" | "hybrid" | "hyde" | "graphrag";

export async function comparePlayground(
  collection: string,
  query: string,
  strategies: Strategy[],
  topK = 5,
  rerank = false,
) {
  const res = await fetch(`${RETRIEVER}/playground/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ collection, query, strategies, top_k: topK, rerank }),
  });
  if (!res.ok) throw new Error(`compare ${res.status}`);
  return res.json();
}

export async function generateStudy(collection: string, tool: string, count: number, topic = "") {
  const res = await fetch(`${RETRIEVER}/study`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ collection, tool, count, topic }),
  });
  if (!res.ok) throw new Error(`study ${res.status}`);
  return res.json();
}

export interface DocItem {
  source: string;
  type: string;
  chunks: number;
  pages: number;
  image_url: string | null;
  ingested_at: string | null;
}

export async function listDocuments(collection: string): Promise<DocItem[]> {
  const res = await fetch(`${RETRIEVER}/documents?collection=${encodeURIComponent(collection)}`);
  if (!res.ok) throw new Error(`documents ${res.status}`);
  return (await res.json()).documents;
}

export async function deleteDocument(collection: string, source: string) {
  await fetch(`${RETRIEVER}/documents?collection=${encodeURIComponent(collection)}&source=${encodeURIComponent(source)}`, {
    method: "DELETE",
  });
}

export interface DocView {
  source: string;
  type: "text" | "image" | "pdf" | null;
  image_url: string | null;
  pages: { page: number; image_url: string }[];
  text: string;
  chunks: number;
}

export async function fetchDocument(collection: string, source: string): Promise<DocView> {
  const res = await fetch(`${RETRIEVER}/document?collection=${encodeURIComponent(collection)}&source=${encodeURIComponent(source)}`);
  if (!res.ok) throw new Error(`document ${res.status}`);
  return res.json();
}

export async function fetchSuggestions(collection: string): Promise<string[]> {
  const res = await fetch(`${RETRIEVER}/suggestions?collection=${encodeURIComponent(collection)}`);
  if (!res.ok) return [];
  return (await res.json()).suggestions ?? [];
}

// ── evaluation ──────────────────────────────────────────────────────
export interface EvalItem { id: string; question: string; expected: string }

export async function evalGenerate(collection: string, count = 6) {
  const res = await fetch(`${RETRIEVER}/eval/generate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ collection, count }),
  });
  if (!res.ok) throw new Error(`generate ${res.status}`);
  return res.json();
}
export async function listEvalItems(collection: string): Promise<EvalItem[]> {
  const res = await fetch(`${RETRIEVER}/eval/items?collection=${encodeURIComponent(collection)}`);
  return (await res.json()).items;
}
export async function addEvalItem(collection: string, question: string, expected = "") {
  await fetch(`${RETRIEVER}/eval/items`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ collection, question, expected }),
  });
}
export async function deleteEvalItem(id: string) {
  await fetch(`${RETRIEVER}/eval/items/${id}`, { method: "DELETE" });
}
export async function evalRun(collection: string, strategy: string, rerank: boolean) {
  const res = await fetch(`${RETRIEVER}/eval/run`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ collection, strategy, rerank }),
  });
  if (!res.ok) throw new Error(`run ${res.status}`);
  return res.json();
}
export async function listEvalRuns(collection: string) {
  const res = await fetch(`${RETRIEVER}/eval/runs?collection=${encodeURIComponent(collection)}`);
  return (await res.json()).runs;
}

export async function getAnalytics(collection: string) {
  const res = await fetch(`${RETRIEVER}/analytics?collection=${encodeURIComponent(collection)}`);
  if (!res.ok) throw new Error(`analytics ${res.status}`);
  return res.json();
}
export async function sendFeedback(collection: string, conversationId: string, rating: number, question: string) {
  await fetch(`${RETRIEVER}/feedback`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ collection, conversation_id: conversationId, rating, question }),
  });
}

export async function generateAudio(collection: string, topic = "") {
  const res = await fetch(`${RETRIEVER}/audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ collection, topic }),
  });
  if (!res.ok) throw new Error(`audio ${res.status}`);
  return res.json();
}

export interface StudyArtifact {
  id: string;
  tool: string;
  topic: string;
  created_at: string;
}

export async function listStudyArtifacts(collection: string): Promise<StudyArtifact[]> {
  const res = await fetch(`${RETRIEVER}/study/artifacts?collection=${encodeURIComponent(collection)}`);
  if (!res.ok) throw new Error(`artifacts ${res.status}`);
  return (await res.json()).artifacts;
}

export async function getStudyArtifact(id: string) {
  const res = await fetch(`${RETRIEVER}/study/artifacts/${id}`);
  if (!res.ok) throw new Error(`artifact ${res.status}`);
  return res.json(); // {tool, topic, payload, created_at}
}

export async function deleteStudyArtifact(id: string) {
  await fetch(`${RETRIEVER}/study/artifacts/${id}`, { method: "DELETE" });
}

export async function buildGraph(collection: string) {
  const res = await fetch(`${RETRIEVER}/graph/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ collection }),
  });
  if (!res.ok) throw new Error(`graph build ${res.status}`);
  return res.json();
}

export async function fetchGraph(collection: string) {
  const res = await fetch(`${RETRIEVER}/graph?collection=${encodeURIComponent(collection)}`);
  if (!res.ok) throw new Error(`graph ${res.status}`);
  return res.json();
}

// ── workspaces ──────────────────────────────────────────────────────
export interface Workspace {
  collection: string;
  name: string;
  chunks: number;
  exists: boolean;
}

export async function listWorkspaces(): Promise<Workspace[]> {
  const res = await fetch(`${RETRIEVER}/workspaces`);
  if (!res.ok) throw new Error(`workspaces ${res.status}`);
  return (await res.json()).workspaces;
}

export async function createWorkspace(collection: string, name: string) {
  const res = await fetch(`${RETRIEVER}/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ collection, name }),
  });
  if (!res.ok) throw new Error(`create ${res.status}`);
  return res.json();
}

export async function deleteWorkspace(collection: string) {
  const res = await fetch(`${RETRIEVER}/workspaces/${encodeURIComponent(collection)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`delete ${res.status}`);
  return res.json();
}

// ── conversations (chat history) ────────────────────────────────────
export interface Conversation {
  id: string;
  title: string;
  created_at: string;
}

export async function listConversations(collection: string): Promise<Conversation[]> {
  const res = await fetch(`${RETRIEVER}/conversations?collection=${encodeURIComponent(collection)}`);
  if (!res.ok) throw new Error(`conversations ${res.status}`);
  return (await res.json()).conversations;
}

export async function getConversation(id: string) {
  const res = await fetch(`${RETRIEVER}/conversations/${id}`);
  if (!res.ok) throw new Error(`conversation ${res.status}`);
  return (await res.json()).messages;
}

export async function deleteConversation(id: string) {
  await fetch(`${RETRIEVER}/conversations/${id}`, { method: "DELETE" });
}

// ── visual citations (multimodal) ───────────────────────────────────
const INGESTION = process.env.NEXT_PUBLIC_INGESTION_URL ?? "http://localhost:8101";

export function mediaUrl(path: string): string {
  return path.startsWith("http") ? path : `${INGESTION}${path}`;
}

export interface McpResource { uri: string; name: string; mimeType?: string; description?: string }

/** Parse a header line like `Authorization=Bearer sk-123` → { Authorization: "Bearer sk-123" }. */
export function parseHeader(line: string): Record<string, string> {
  const t = line.trim();
  if (!t) return {};
  const i = t.indexOf("=");
  if (i === -1) return { Authorization: t }; // bare token → Authorization
  return { [t.slice(0, i).trim()]: t.slice(i + 1).trim() };
}

export async function mcpList(url: string, transport: string, headers: Record<string, string>): Promise<{ resources?: McpResource[]; error?: string }> {
  const res = await fetch(`${INGESTION}/mcp/list`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, transport, headers }),
  });
  return res.json();
}
export const mcpIngestUrl = `${INGESTION}/mcp/ingest/stream`;

export interface BBox {
  bbox: [number, number, number, number]; // x,y,w,h fractions 0-1
  explanation: string;
}

export async function visualCite(imageUrl: string, query: string): Promise<BBox> {
  const res = await fetch(`${INGESTION}/visual-cite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_url: imageUrl, query }),
  });
  if (!res.ok) throw new Error(`visual-cite ${res.status}`);
  return res.json();
}
