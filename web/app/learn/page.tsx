"use client";

import Link from "next/link";
import Mermaid from "@/components/mermaid";
import Tooltip from "@/components/tooltip";

const ARCH = `flowchart LR
  U["🧑 User"] --> W["Next.js UI<br/>Sources · Chat · Studio"]
  W -->|"chat"| R["Retriever<br/>FastAPI"]
  W -->|"upload"| I["Ingestion<br/>FastAPI"]
  R --> Q[("Qdrant<br/>vectors")]
  I --> Q
  R --> G[("networkx<br/>graph")]
  R --> DB[("SQLite<br/>chats")]
  R -. "models" .-> OR{{"OpenRouter"}}
  I -. "models" .-> OR
  R -. "TTS" .-> DG{{"Deepgram"}}`;

const INGEST = `flowchart TD
  A["Upload file"] --> B{"File type?"}
  B -->|"document"| C["Docling parse"]
  B -->|"image"| D["Vision caption"]
  B -->|"PDF"| E["PyMuPDF render pages"]
  C --> F["Chunk<br/>chosen strategy"]
  D --> G["Embed via OpenRouter"]
  E --> G
  F --> G
  G --> H[("Qdrant index")]`;

const QUERY = `flowchart TD
  Q["User question"] --> IMG{"Image attached?"}
  IMG -->|"yes"| VC["Vision caption + OCR<br/>→ merge into query"]
  IMG -->|"no"| GR
  VC --> GR{"Relevance gate"}
  GR -->|"off-topic"| X["Refuse politely"]
  GR -->|"in scope"| EM["Embed query"]
  EM --> RT["Retrieve<br/>semantic · hybrid · HyDE · GraphRAG"]
  RT --> RR["Rerank (optional)"]
  RR --> PR["Grounded prompt<br/>injection-hardened"]
  PR --> LLM["LLM streams answer"]
  LLM --> CI["Answer + citations"]`;

const E2E = `flowchart LR
  subgraph ING["① Ingestion (once per document)"]
    direction TB
    UP["Upload file"] --> PA["Parse<br/>Docling · Vision · PyMuPDF"]
    PA --> CH["Chunk<br/>chosen strategy"]
    CH --> EB["Embed<br/>OpenRouter"]
  end
  EB --> VDB[("Qdrant<br/>vectors + metadata")]
  PA -. "entities" .-> KG[("networkx<br/>graph")]

  subgraph QRY["② Question (every chat)"]
    direction TB
    UQ["User question<br/>(+ optional image)"] --> VN["Vision caption + OCR<br/>if image attached"]
    VN --> RG{"Relevance<br/>gate"}
    RG -->|"off-topic"| RF["Refuse — no LLM call"]
    RG -->|"in scope"| QE["Embed question"]
    QE --> RET["Retrieve top-k"]
    RET --> RNK["Rerank (optional)"]
    RNK --> GP["Grounded + injection-<br/>hardened prompt"]
    GP --> ANS["LLM streams<br/>cited answer"]
  end
  VDB --> RET
  KG -. "GraphRAG" .-> RET
  ANS --> SAVE[("SQLite<br/>chat history")]
  SAVE -. "follow-up condensed<br/>with history" .-> UQ`;

const ARCH_LEGEND = [
  ["Next.js UI", "The web app you're using: a 3-panel workspace — Sources (documents), Chat, and Studio (create/inspect tools)."],
  ["Retriever", "The 'brain' service. It runs the chat pipeline (relevance gate → retrieve → prompt → LLM → citations), all the inspect APIs, and handles login + roles (viewer/editor/admin)."],
  ["Ingestion", "The service that reads uploaded files, splits them, turns them into vectors, and stores them so they're searchable."],
  ["Qdrant", "A vector database. It stores each passage as a list of numbers and finds the closest ones to a question — very fast."],
  ["networkx graph", "An in-memory knowledge graph of entities and how they relate, extracted from your docs. Powers GraphRAG + the graph view."],
  ["SQLite", "A tiny local database file that remembers your chats, generated study material, and workspace settings."],
  ["OpenRouter", "One API gateway to many AI models — we use it for the answer LLM, image understanding (vision), text embeddings, and reranking."],
  ["Deepgram", "A text-to-speech service that voices the Audio Overview podcast (two hosts)."],
];

const INGEST_LEGEND = [
  ["Docling", "Reads PDFs, Word, PowerPoint, CSV, Markdown, etc. and extracts clean text."],
  ["Vision caption", "For images, an AI 'looks' at the picture and writes a description so it can be searched by meaning."],
  ["PyMuPDF", "Renders each PDF page to an image so we can show and highlight the exact page a citation came from."],
  ["Chunk", "Splits a document into small passages. You choose HOW: paragraph-aware, fixed-size, sentence, parent-child, or semantic."],
  ["Embed", "Turns each passage into a vector — a list of numbers that captures its meaning. Similar meaning = similar numbers."],
  ["Qdrant index", "The stored vectors + metadata (source, page, strategy). This is what questions search against."],
];

const QUERY_LEGEND = [
  ["Image attached?", "You can paste/upload a reference image with your question. If you do, a vision model captions + reads text (OCR) from it and merges that into your query so the corpus can be searched. No image = normal text chat."],
  ["Relevance gate", "A guardrail: if your question isn't close to anything in the workspace, we refuse politely BEFORE calling the AI — no off-topic answers."],
  ["Embed query", "The question is turned into a vector too, so it can be compared with the stored passage vectors."],
  ["Retrieve", "Find the most relevant passages. Different strategies exist — semantic, hybrid, HyDE, GraphRAG (see below)."],
  ["Rerank", "An optional sharper second pass that re-sorts the found passages so the best ones come first."],
  ["Grounded prompt", "We hand the AI ONLY the found passages, fenced as untrusted data, and forbid it from following any instructions hidden inside them (anti-prompt-injection)."],
  ["Citations", "Every claim links to the exact source passage — so answers are checkable, not black-box."],
];

const CONCEPTS = [
  ["Chunking", "Documents are too big to search whole, so we split them into passages ('chunks'). Smaller chunks = precise matches; larger = more context. You pick the strategy at upload."],
  ["Chunking strategies", "You choose HOW to split at upload: structure (paragraph/heading-aware, the default) · fixed (equal-size overlapping windows) · sentence (packs whole sentences) · parent-child (embed a small child for a precise match but return its bigger parent for context) · semantic (starts a new chunk where the meaning shifts). Each trades precision vs. context."],
  ["Embeddings", "A model converts text (or images) into vectors — coordinates in 'meaning space'. Things about the same topic end up near each other."],
  ["Contextual retrieval", "Before embedding, we prepend a short doc-level context line to each chunk (Anthropic's technique). A lone table row or a pronoun-heavy passage becomes findable because the chunk now carries WHERE it came from — noticeably better recall."],
  ["Semantic search", "Finds passages by MEANING, not keywords. 'car' can match 'vehicle'. Great for natural questions."],
  ["Hybrid search", "Combines semantic (meaning) with BM25 (exact keywords) and fuses the rankings — best all-round recall."],
  ["HyDE", "Hypothetical Document Embeddings: the AI first drafts a guess answer, then searches with it. Helps vague or short questions."],
  ["Reranking", "A cross-encoder re-scores the top candidates more carefully than the first fast search — boosts precision."],
  ["GraphRAG", "Answers by following a graph of connected concepts ('what depends on X?'), not just matching text."],
  ["Conversational RAG", "Follow-ups like 'what about the second one?' don't retrieve well on their own. We first rewrite them into a standalone question using the chat history, THEN retrieve — so context carries across turns."],
  ["Metadata filtering", "Every chunk stores metadata (source, page, type). You can scope a chat to only selected documents — Qdrant filters by a source index BEFORE searching, so answers come only from what you picked."],
  ["Re-ingest dedup", "Re-uploading a document deletes its old chunks first, so you never accumulate duplicate or stale passages when a source is updated."],
  ["Citations", "Inline [1][2] chips linking each claim to its source passage — click to jump to it. Trust through transparency."],
  ["Visual citations", "For images/PDF pages, the AI highlights the exact region that answers your question with a box."],
  ["Attach an image in chat", "Paste, upload, or drop a reference image with your question. A vision model describes it and reads any text (OCR); that description is merged into your query so the workspace can be searched by it, and the answer model also 'sees' the image. It's semantic match via the description — not a reverse-image lookup. No image → ordinary text chat."],
  ["Guardrails", "Relevance gate (blocks off-topic), injection defense (ignores instructions hidden in documents), and strict grounding (answers only from your sources)."],
  ["Roles & access (RBAC)", "Optional login with three roles. Viewer: read + ask questions + inspect. Editor: also upload, generate study material, build the graph, run evals, and delete. Admin: also manage workspaces and users. The UI hides what your role can't do, and both services enforce it — so a viewer literally can't upload or delete, not just visually."],
  ["Caching", "Repeated questions can skip work: cache the question→vector step, or (semantic cache) return a past answer when a new question is nearly identical — saving cost + latency. NOT used here — we run the full pipeline live so every step stays visible; it's a scale-time optimization, and the trade-off is staleness when documents change."],
];

function Legend({ items }: { items: string[][] }) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {items.map(([term, desc]) => (
        <Tooltip key={term} content={desc}>
          <span className="chip cursor-help border-line text-ash hover:border-amber/60 hover:text-amber">{term}</span>
        </Tooltip>
      ))}
    </div>
  );
}

function Section({ n, title, blurb, code, legend }: { n: string; title: string; blurb: string; code: string; legend: string[][] }) {
  return (
    <section className="mb-14">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="font-mono text-sm text-amber">{n}</span>
        <h2 className="font-display text-xl text-sand">{title}</h2>
      </div>
      <p className="mb-4 max-w-2xl text-sm text-ash">{blurb}</p>
      <Mermaid code={code} />
      <p className="mt-3 text-xs text-faint">Hover any tag to learn what it does:</p>
      <Legend items={legend} />
    </section>
  );
}

export default function Learn() {
  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-10">
      <p className="eyebrow mb-2">Learn</p>
      <h1 className="font-display text-3xl text-sand">How CC-RAGOS works</h1>
      <p className="mt-2 max-w-2xl text-ash">
        A guided tour of the whole system — from uploading a document to getting a cited, grounded answer.
        Everything is <span className="text-amber">explainable</span>: hover the tags to see plain-language
        explanations, and each diagram mirrors what actually runs.
      </p>

      <div className="my-8 h-px bg-line" />

      <Section n="01" title="The big picture" code={ARCH} legend={ARCH_LEGEND}
        blurb="The app talks to two backend services. Ingestion turns your files into searchable vectors; the Retriever answers questions from them. “models” = the LLM, vision, embeddings and reranking — all reached through OpenRouter (and Deepgram for audio)." />

      <Section n="02" title="How a document gets in (ingestion)" code={INGEST} legend={INGEST_LEGEND}
        blurb="When you upload, the file is parsed, split into passages, turned into vectors, and stored. Images are described by a vision model; PDFs are rendered page-by-page so citations can point to the exact page." />

      <Section n="03" title="How a question gets answered (retrieval + guardrails)" code={QUERY} legend={QUERY_LEGEND}
        blurb="If you attach an image, a vision model captions + reads it and folds that into your question. Then every question passes a relevance guardrail; if it's in scope, we embed it, retrieve the best passages (optionally rerank), build a grounded + injection-hardened prompt, and stream a cited answer. If it's off-topic, we refuse before spending an AI call." />

      <section className="mb-14">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="font-mono text-sm text-amber">04</span>
          <h2 className="font-display text-xl text-sand">End-to-end — the whole journey</h2>
        </div>
        <p className="mb-4 max-w-2xl text-sm text-ash">
          The two halves joined up. <span className="text-amber">① Ingestion</span> runs once per document
          and fills the vector store (and graph). <span className="text-amber">② Question</span> runs on every
          chat, reading from that store. Chat history feeds back in so follow-ups (&ldquo;what about that?&rdquo;)
          are condensed into standalone questions before retrieval.
        </p>
        <Mermaid code={E2E} />
      </section>

      <section className="mb-14">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="font-mono text-sm text-amber">05</span>
          <h2 className="font-display text-xl text-sand">Key concepts</h2>
        </div>
        <p className="mb-4 max-w-2xl text-sm text-ash">The ideas behind modern RAG, in plain terms.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {CONCEPTS.map(([term, desc]) => (
            <div key={term} className="rounded-xl border border-line bg-surface p-4">
              <h3 className="mb-1 font-display text-sand">{term}</h3>
              <p className="text-sm text-ash">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-amber/25 bg-amber/[0.06] p-6">
        <h2 className="mb-1 font-display text-xl text-sand">See it live</h2>
        <p className="mb-4 text-sm text-ash">Each step above has a hands-on view in the app.</p>
        <div className="flex flex-wrap gap-2">
          <Link href="/documents" className="btn">1 · Upload &amp; watch the pipeline</Link>
          <Link href="/explorer" className="btn">2 · Inspect chunks</Link>
          <Link href="/embeddings" className="btn">3 · See the meaning map</Link>
          <Link href="/playground" className="btn">4 · Compare retrieval</Link>
          <Link href="/graph" className="btn">5 · Knowledge graph</Link>
          <Link href="/" className="btn-accent">Ask a question →</Link>
        </div>
      </section>
    </div>
  );
}
