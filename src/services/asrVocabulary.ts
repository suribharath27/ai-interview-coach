/**
 * Parakeet-style ASR helpers for Groq Whisper.
 * Tuned for this user's stack:
 * HTML/CSS/React/Next.js/JS/TS/React Query +
 * Salesforce Commerce Cloud (B2C, ISML) +
 * ServiceNow (ITSM/ITOM, Glide, Service Portal, Catalogs).
 */

/** Spellings Whisper should prefer. Packed for the ~224-token prompt window. */
export const ASR_VOCAB_CORE = [
  // Web frontend
  "HTML",
  "CSS",
  "JavaScript",
  "TypeScript",
  "React",
  "Next.js",
  "React Query",
  "TanStack Query",
  "hooks",
  "useState",
  "useEffect",
  "useMemo",
  "useCallback",
  "useQuery",
  "useMutation",
  "component",
  "props",
  "JSX",
  "TSX",
  "SSR",
  "SSG",
  "ISR",
  "App Router",
  "Pages Router",
  "server component",
  "client component",
  "hydration",
  "Tailwind",
  "Redux",
  "Zustand",
  "Webpack",
  "Vite",
  "npm",
  "API",
  "REST",
  "GraphQL",
  "fetch",
  "axios",
  "class",
  "classes",
  "function",
  "async",
  "await",
  "Promise",
  "closure",
  "event loop",
  "DOM",
  "accessibility",
  "a11y",
  "responsive",
  "SEO",
  // Salesforce Commerce Cloud / B2C
  "Salesforce",
  "Salesforce Commerce Cloud",
  "Commerce Cloud",
  "SFCC",
  "B2C",
  "B2B",
  "ISML",
  "ISML template",
  "controllers",
  "pipelines",
  "cartridge",
  "Business Manager",
  "OCAPI",
  "SCAPI",
  "storefront",
  "catalog",
  "catalogs",
  "price book",
  "promotion",
  "checkout",
  "basket",
  "dw.system",
  "dw.catalog",
  "SiteGenesis",
  "SFRA",
  // ServiceNow
  "ServiceNow",
  "ITSM",
  "ITOM",
  "CMDB",
  "Glide",
  "GlideRecord",
  "GlideAjax",
  "GlideForm",
  "Glide script",
  "Glide scripts",
  "Business Rule",
  "Client Script",
  "UI Policy",
  "UI Action",
  "Script Include",
  "Service Portal",
  "Service Portals",
  "Widget",
  "Catalog",
  "Catalog Item",
  "Record Producer",
  "Flow Designer",
  "IntegrationHub",
  "integrations",
  "REST Message",
  "SOAP",
  "MID Server",
  "Update Set",
  "Scoped Application",
  "ACL",
  "incident",
  "problem",
  "change",
  "request",
  "SLA",
  "workflow",
  // Light interview glue
  "walk me through",
  "tell me about a time",
  "trade-off",
  "stakeholder",
  "architecture",
  "performance",
  "debugging",
];

/**
 * Fictitious prior transcript — Whisper copies style + spellings from this.
 */
export const ASR_STYLE_SAMPLE =
  "Walk me through a React and Next.js component in TypeScript with React Query. " +
  "How do you structure HTML, CSS, hooks, and server components? " +
  "On Salesforce Commerce Cloud B2C, explain ISML templates, cartridges, OCAPI, and the storefront catalog. " +
  "In ServiceNow ITSM and ITOM, talk about Glide scripts, GlideRecord, Service Portals, Catalog Items, and integrations.";

type Confusion = {
  wrong: RegExp;
  right: string;
};

/** Common Whisper substitutions for this stack. */
const CONFUSIONS: Confusion[] = [
  // Web / React / Next
  { wrong: /\bclause\b/gi, right: "class" },
  { wrong: /\bclauses\b/gi, right: "classes" },
  { wrong: /\bhtml\b/gi, right: "HTML" },
  { wrong: /\bcss\b/gi, right: "CSS" },
  { wrong: /\bjava script\b/gi, right: "JavaScript" },
  { wrong: /\btype script\b/gi, right: "TypeScript" },
  { wrong: /\breact\b/gi, right: "React" },
  { wrong: /\bnext\.?js\b/gi, right: "Next.js" },
  { wrong: /\bnext js\b/gi, right: "Next.js" },
  { wrong: /\bnextjs\b/gi, right: "Next.js" },
  { wrong: /\breact query\b/gi, right: "React Query" },
  { wrong: /\btanstack query\b/gi, right: "TanStack Query" },
  { wrong: /\buse state\b/gi, right: "useState" },
  { wrong: /\buse effect\b/gi, right: "useEffect" },
  { wrong: /\buse memo\b/gi, right: "useMemo" },
  { wrong: /\buse callback\b/gi, right: "useCallback" },
  { wrong: /\buse query\b/gi, right: "useQuery" },
  { wrong: /\buse mutation\b/gi, right: "useMutation" },
  { wrong: /\bapp router\b/gi, right: "App Router" },
  { wrong: /\bpages router\b/gi, right: "Pages Router" },
  { wrong: /\bserver component\b/gi, right: "server component" },
  { wrong: /\bclient component\b/gi, right: "client component" },
  { wrong: /\bgraph ql\b/gi, right: "GraphQL" },
  { wrong: /\brest api\b/gi, right: "REST API" },
  { wrong: /\bjsx\b/gi, right: "JSX" },
  { wrong: /\btsx\b/gi, right: "TSX" },
  { wrong: /\bssr\b/gi, right: "SSR" },
  { wrong: /\bssg\b/gi, right: "SSG" },
  { wrong: /\bisr\b/gi, right: "ISR" },
  { wrong: /\ba11y\b/gi, right: "a11y" },
  { wrong: /\bdom\b/gi, right: "DOM" },
  // Salesforce Commerce Cloud
  { wrong: /\bsales force\b/gi, right: "Salesforce" },
  { wrong: /\bsalesforce\b/gi, right: "Salesforce" },
  { wrong: /\bcommerce cloud\b/gi, right: "Commerce Cloud" },
  { wrong: /\bsalesforce commerce cloud\b/gi, right: "Salesforce Commerce Cloud" },
  { wrong: /\bsfcc\b/gi, right: "SFCC" },
  { wrong: /\bb2c\b/gi, right: "B2C" },
  { wrong: /\bb 2 c\b/gi, right: "B2C" },
  { wrong: /\bbe to see\b/gi, right: "B2C" },
  { wrong: /\bb2b\b/gi, right: "B2B" },
  { wrong: /\bisml\b/gi, right: "ISML" },
  { wrong: /\bi s m l\b/gi, right: "ISML" },
  { wrong: /\bis mail\b/gi, right: "ISML" },
  { wrong: /\bizml\b/gi, right: "ISML" },
  { wrong: /\bocapi\b/gi, right: "OCAPI" },
  { wrong: /\bo c api\b/gi, right: "OCAPI" },
  { wrong: /\bscapi\b/gi, right: "SCAPI" },
  { wrong: /\bsfra\b/gi, right: "SFRA" },
  { wrong: /\bsite genesis\b/gi, right: "SiteGenesis" },
  { wrong: /\bbusiness manager\b/gi, right: "Business Manager" },
  { wrong: /\bstore front\b/gi, right: "storefront" },
  { wrong: /\bprice book\b/gi, right: "price book" },
  // ServiceNow
  { wrong: /\bservice now\b/gi, right: "ServiceNow" },
  { wrong: /\bservicenow\b/gi, right: "ServiceNow" },
  { wrong: /\bitsm\b/gi, right: "ITSM" },
  { wrong: /\bi t s m\b/gi, right: "ITSM" },
  { wrong: /\bitom\b/gi, right: "ITOM" },
  { wrong: /\bi t o m\b/gi, right: "ITOM" },
  { wrong: /\bcmdb\b/gi, right: "CMDB" },
  { wrong: /\bglide record\b/gi, right: "GlideRecord" },
  { wrong: /\bgliderecord\b/gi, right: "GlideRecord" },
  { wrong: /\bglide ajax\b/gi, right: "GlideAjax" },
  { wrong: /\bglide form\b/gi, right: "GlideForm" },
  { wrong: /\bglide scripts\b/gi, right: "Glide scripts" },
  { wrong: /\bglide script\b/gi, right: "Glide script" },
  { wrong: /\bglide\b/gi, right: "Glide" },
  { wrong: /\bbusiness rule\b/gi, right: "Business Rule" },
  { wrong: /\bclient script\b/gi, right: "Client Script" },
  { wrong: /\bui policy\b/gi, right: "UI Policy" },
  { wrong: /\bui action\b/gi, right: "UI Action" },
  { wrong: /\bscript include\b/gi, right: "Script Include" },
  { wrong: /\bservice portals\b/gi, right: "Service Portals" },
  { wrong: /\bservice portal\b/gi, right: "Service Portal" },
  { wrong: /\bcatalog items\b/gi, right: "Catalog Items" },
  { wrong: /\bcatalog item\b/gi, right: "Catalog Item" },
  { wrong: /\bcatalogs\b/gi, right: "catalogs" },
  { wrong: /\brecord producer\b/gi, right: "Record Producer" },
  { wrong: /\bflow designer\b/gi, right: "Flow Designer" },
  { wrong: /\bintegration hub\b/gi, right: "IntegrationHub" },
  { wrong: /\bintegrationhub\b/gi, right: "IntegrationHub" },
  { wrong: /\brest message\b/gi, right: "REST Message" },
  { wrong: /\bmid server\b/gi, right: "MID Server" },
  { wrong: /\bupdate set\b/gi, right: "Update Set" },
  { wrong: /\bscoped application\b/gi, right: "Scoped Application" },
  { wrong: /\bacl\b/gi, right: "ACL" },
  { wrong: /\bsla\b/gi, right: "SLA" },
  { wrong: /\bstake holder\b/gi, right: "stakeholder" },
  { wrong: /\btrade off\b/gi, right: "trade-off" },
];

export function buildAsrPrompt(options: {
  companyName?: string;
  description?: string;
  language?: string;
  recentTranscript?: string;
  extraTerms?: string[];
}): string {
  const company = (options.companyName || "").trim();
  const desc = (options.description || "").trim().slice(0, 160);
  const extra = (options.extraTerms || [])
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 30);
  const recent = (options.recentTranscript || "").trim().slice(-280);

  const vocab = [...ASR_VOCAB_CORE, ...extra, company].filter(Boolean);
  const parts = [
    ASR_STYLE_SAMPLE,
    vocab.join(", "),
    desc ? `This interview is about ${desc}.` : "",
    company ? `The company is ${company}.` : "",
    recent || "",
  ].filter(Boolean);

  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 800);
}

/** Pull stack proper nouns from session text for the prompt. */
export function extractSessionAsrTerms(
  ...blobs: Array<string | undefined>
): string[] {
  const text = blobs.filter(Boolean).join(" ");
  if (!text.trim()) return [];
  const matches =
    text.match(
      /\b(?:[A-Z][A-Za-z0-9+.#-]{1,28}|HTML|CSS|React|Next\.?js|TypeScript|JavaScript|React Query|TanStack|Salesforce|Commerce Cloud|SFCC|B2C|ISML|OCAPI|SCAPI|SFRA|ServiceNow|ITSM|ITOM|CMDB|GlideRecord|GlideAjax|Service Portal|Catalog|IntegrationHub|GraphQL|Redux|Zustand|Tailwind|Vite)\b/g
    ) || [];
  return [...new Set(matches)].slice(0, 28);
}

/** Fix common Whisper mishears after transcription. */
export function correctAsrText(
  text: string,
  _context: { forceTechnical?: boolean; recentText?: string } = {}
): string {
  const raw = text.trim();
  if (!raw) return raw;

  let out = raw;
  for (const rule of CONFUSIONS) {
    out = out.replace(rule.wrong, rule.right);
  }
  return out.replace(/\s+/g, " ").trim();
}

export function languageToWhisperCode(language?: string): string {
  const l = (language || "english").trim().toLowerCase();
  if (l.startsWith("en")) return "en";
  if (l.startsWith("hi") || l.includes("hindi")) return "hi";
  if (l.startsWith("es") || l.includes("spanish")) return "es";
  if (l.startsWith("fr") || l.includes("french")) return "fr";
  if (l.startsWith("de") || l.includes("german")) return "de";
  if (l.startsWith("pt") || l.includes("portuguese")) return "pt";
  return "en";
}
