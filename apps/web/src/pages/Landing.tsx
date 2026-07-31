import { useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { RiskDial } from "../components/RiskDial.js";
import { RecommendationBadge } from "../components/RecommendationBadge.js";
import { SignalBadge } from "../components/SignalBadge.js";

const NAV_LINKS = [
  { href: "#product", label: "Product" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#faq", label: "FAQ" },
];

const PILLARS = [
  {
    title: "Upload a batch",
    body:
      "Drop in a JSON array of graded work units — task, rubric, model output, and the human grade. No pipeline to wire up.",
  },
  {
    title: "Watch it regrade live",
    body:
      "An agent re-grades every item against the same rubric in real time, streaming its reasoning and tool calls as they happen.",
  },
  {
    title: "Get a verdict, not just a score",
    body:
      "Every item lands in Clear, Spot Check, or Re-Review — with the exact signal that tripped it, so reviewers know where to look first.",
  },
];

const SIGNALS = [
  { key: "consistency", label: "Consistency", body: "Flags scores that drift from how similar items were graded." },
  { key: "coverage", label: "Coverage", body: "Flags rubric criteria the human grade never addressed." },
  { key: "cohort", label: "Cohort", body: "Flags a grader scoring out of line with their peers on the same batch." },
  { key: "regrade", label: "Agent Re-grade", body: "Flags a meaningful gap between the human score and the agent's independent pass." },
];

const STEPS = [
  { n: "01", title: "Upload", body: "Drag in a batch of graded work units, or point Quorum at an export from your grading tool." },
  { n: "02", title: "Regrade", body: "An agent works the rubric independently, with tool access, and streams its progress live." },
  { n: "03", title: "Review", body: "Flagged items surface in a verdict queue with a risk score and the evidence behind it." },
];

const FAQS = [
  {
    q: "What does Quorum need from me?",
    a: "A JSON array of work units, each with an id, domain, task, rubric, model output, human grade, and grader id. That's it — Quorum handles ingestion, regrading, and verdicts from there.",
  },
  {
    q: "How is the risk score calculated?",
    a: "Risk combines the signals that fired on an item — consistency, coverage, cohort drift, and the agent's independent regrade — into a single 0–100 score, shown live as items are processed.",
  },
  {
    q: "Can I see why an item was flagged?",
    a: "Yes. Every flagged item's detail view shows the agent's re-grade reasoning and the tool calls it made, side by side with the original human grade.",
  },
  {
    q: "Does this replace human graders?",
    a: "No — Quorum is a QA layer on top of your existing grading process. It re-checks work your graders already scored and tells you which of it deserves a second look.",
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-gray-200 py-5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="pressable w-full flex items-center justify-between text-left gap-4"
      >
        <span className="text-sm font-medium text-gray-900">{q}</span>
        <span
          className={`shrink-0 text-gray-400 transition-transform duration-200 ease-out ${open ? "rotate-45" : ""}`}
        >
          +
        </span>
      </button>
      <div
        className={`grid transition-all duration-200 ease-out ${open ? "grid-rows-[1fr] opacity-100 mt-3" : "grid-rows-[0fr] opacity-0"}`}
        style={{ display: "grid" }}
      >
        <div className="overflow-hidden">
          <p className="text-sm text-gray-500 leading-relaxed">{a}</p>
        </div>
      </div>
    </div>
  );
}

function MockVerdictCard() {
  return (
    <div className="animate-fade-up rounded-xl border border-gray-200 bg-white shadow-popover p-5 max-w-md w-full">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-mono text-gray-400">batch_2f8a91</span>
        <span className="text-xs px-2 py-1 rounded-full bg-quorum-50 text-quorum-700">Live</span>
      </div>
      <div className="flex items-start gap-4">
        <RiskDial risk={0.78} size={48} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <RecommendationBadge recommendation="re_review" />
            <span className="text-xs text-gray-500 uppercase tracking-wide">Support QA</span>
            <span className="text-xs text-gray-400 ml-auto">7/10</span>
          </div>
          <p className="text-sm text-gray-700 truncate">Refund eligibility — ticket #48213</p>
          <div className="mt-2 space-y-1">
            <SignalBadge signalKey="consistency" fired evidence="Scored 3pts above similar tickets in this cohort" />
            <SignalBadge signalKey="regrade" fired evidence="Agent independently scored 4/10" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function Landing() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <nav className="sticky top-0 z-10 bg-white/80 backdrop-blur-sm border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-8">
          <span className="font-bold text-quorum-700 text-lg">Quorum</span>
          <div className="hidden sm:flex items-center gap-1">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="pressable text-sm px-3 py-1.5 rounded-full text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors duration-150 ease-out"
              >
                {l.label}
              </a>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link
              to="/login"
              className="pressable text-sm px-3 py-1.5 rounded-full text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors duration-150 ease-out"
            >
              Sign in
            </Link>
            <Link
              to="/signup"
              className="pressable text-sm px-4 py-1.5 rounded-full bg-quorum-600 text-white font-medium hover:bg-quorum-700 transition-colors duration-150 ease-out"
            >
              Get started
            </Link>
          </div>
        </div>
      </nav>

      <header className="max-w-6xl mx-auto px-6 pt-20 pb-16 grid lg:grid-cols-2 gap-12 items-center">
        <div className="animate-fade-up">
          <span className="inline-block text-xs font-semibold text-quorum-700 bg-quorum-50 px-3 py-1 rounded-full mb-5">
            Expert Grade QA
          </span>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.1] mb-5">
            Catch bad grades before they ship.
          </h1>
          <p className="text-lg text-gray-500 leading-relaxed mb-8 max-w-lg">
            Quorum re-grades every human-scored item with an independent agent, flags the ones
            that don't add up, and tells your team exactly which ones need a second look.
          </p>
          <div className="flex items-center gap-3">
            <Link
              to="/signup"
              className="pressable px-5 py-2.5 rounded-md bg-quorum-600 text-white text-sm font-medium hover:bg-quorum-700 transition-colors duration-150 ease-out"
            >
              Get started free
            </Link>
            <Link
              to="/login"
              className="pressable px-5 py-2.5 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:border-gray-400 transition-colors duration-150 ease-out"
            >
              Sign in
            </Link>
          </div>
        </div>
        <div className="flex justify-center lg:justify-end">
          <MockVerdictCard />
        </div>
      </header>

      <section className="border-y border-gray-200 bg-gray-50">
        <div className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
          {[
            ["4", "independent signals"],
            ["Live", "regrade streaming"],
            ["3", "verdict tiers"],
            ["1", "audit trail per item"],
          ].map(([n, label]) => (
            <div key={label}>
              <p className="text-2xl font-bold text-quorum-700">{n}</p>
              <p className="text-xs text-gray-500 mt-1">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="product" className="max-w-6xl mx-auto px-6 py-24">
        <div className="max-w-xl mb-14">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
            One pipeline, from raw batch to verdict.
          </h2>
          <p className="text-gray-500 leading-relaxed">
            No dashboards to configure. Upload your data and Quorum runs the rest of the pipeline
            for you.
          </p>
        </div>
        <div className="grid sm:grid-cols-3 gap-8">
          {PILLARS.map((p, i) => (
            <div key={p.title} className="stagger-item" style={{ "--stagger-index": i } as CSSProperties}>
              <div className="h-9 w-9 rounded-lg bg-quorum-50 text-quorum-700 flex items-center justify-center font-semibold mb-4">
                {i + 1}
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">{p.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-gray-50 border-y border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <div className="max-w-xl mb-14">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
              Four signals decide every verdict.
            </h2>
            <p className="text-gray-500 leading-relaxed">
              Each work unit is checked against the same rubric from four angles. Any signal that
              fires shows up as evidence in the verdict queue.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {SIGNALS.map((s, i) => (
              <div
                key={s.key}
                className="stagger-item card-interactive p-5 rounded-lg border border-gray-200 bg-white"
                style={{ "--stagger-index": i } as CSSProperties}
              >
                <h3 className="font-semibold text-gray-900 mb-1">{s.label}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="max-w-6xl mx-auto px-6 py-24">
        <div className="max-w-xl mb-14">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">How it works</h2>
          <p className="text-gray-500 leading-relaxed">Three steps, no setup.</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-8">
          {STEPS.map((s, i) => (
            <div key={s.n} className="stagger-item" style={{ "--stagger-index": i } as CSSProperties}>
              <p className="text-sm font-mono text-quorum-400 mb-2">{s.n}</p>
              <h3 className="font-semibold text-gray-900 mb-2">{s.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="faq" className="bg-gray-50 border-y border-gray-200">
        <div className="max-w-3xl mx-auto px-6 py-24">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-8">
            Frequently asked questions
          </h2>
          <div>
            {FAQS.map((f) => (
              <FaqItem key={f.q} q={f.q} a={f.a} />
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-24 text-center">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
          Give your grading pipeline a second opinion.
        </h2>
        <p className="text-gray-500 mb-8 max-w-lg mx-auto">
          Upload your first batch in minutes — no setup, no integration required.
        </p>
        <Link
          to="/signup"
          className="pressable inline-block px-6 py-3 rounded-md bg-quorum-600 text-white text-sm font-medium hover:bg-quorum-700 transition-colors duration-150 ease-out"
        >
          Get started free
        </Link>
      </section>

      <footer className="border-t border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <span className="font-bold text-quorum-700">Quorum</span>
            <span className="text-sm text-gray-400 ml-2">Expert Grade QA</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-gray-500">
            <Link to="/login" className="pressable hover:text-gray-900 transition-colors duration-150 ease-out">
              Sign in
            </Link>
            <Link to="/signup" className="pressable hover:text-gray-900 transition-colors duration-150 ease-out">
              Create account
            </Link>
          </div>
          <p className="text-xs text-gray-400">© 2026 Quorum</p>
        </div>
      </footer>
    </div>
  );
}
