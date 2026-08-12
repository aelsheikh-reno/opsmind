import PizZip from "pizzip";

export type Replacement = { original: string; placeholder: string };
type RunData = { rPr: string; text: string };

function xmlEncode(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function mergeRuns(runs: RunData[]): RunData[] {
  const out: RunData[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && last.rPr === r.rPr) last.text += r.text;
    else out.push({ ...r });
  }
  return out;
}

function rebuildPara(pPr: string, runs: RunData[]): string {
  const runsXml = runs
    .map((r) => `<w:r>${r.rPr}<w:t xml:space="preserve">${xmlEncode(r.text)}</w:t></w:r>`)
    .join("");
  return `<w:p>${pPr}${runsXml}</w:p>`;
}

function applyReplacementsToXml(xml: string, replacements: Replacement[]): string {
  return xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (para) => {
    const pPr = para.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? "";

    const rawRuns: RunData[] = [];
    const runRe = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
    let rm: RegExpExecArray | null;
    while ((rm = runRe.exec(para)) !== null) {
      const rXml = rm[0];
      rawRuns.push({
        rPr: rXml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? "",
        text: rXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/)?.[1] ?? "",
      });
    }
    if (rawRuns.length === 0) return para;

    let runs = mergeRuns(rawRuns);
    let changed = false;

    for (const repl of replacements) {
      if (!repl.original) continue;

      // Pass 1: fits inside a single run
      let done = false;
      for (const run of runs) {
        if (run.text.includes(repl.original)) {
          run.text = run.text.split(repl.original).join(repl.placeholder);
          changed = true;
          done = true;
        }
      }
      if (done) continue;

      // Pass 2: spans multiple runs — offset-based surgical replacement
      const concat = runs.map((r) => r.text).join("");
      let pos = concat.indexOf(repl.original);
      while (pos !== -1) {
        const end = pos + repl.original.length;
        const offsets: number[] = [];
        let off = 0;
        for (const r of runs) { offsets.push(off); off += r.text.length; }

        const newRuns: RunData[] = [];
        for (let i = 0; i < runs.length; i++) {
          const rs = offsets[i];
          const re = rs + runs[i].text.length;
          if (re <= pos || rs >= end) {
            newRuns.push(runs[i]);
          } else {
            const before = runs[i].text.slice(0, Math.max(0, pos - rs));
            const after  = runs[i].text.slice(Math.max(0, end - rs));
            if (before) newRuns.push({ rPr: runs[i].rPr, text: before });
            if (rs <= pos) newRuns.push({ rPr: runs[i].rPr, text: repl.placeholder });
            if (after)  newRuns.push({ rPr: runs[i].rPr, text: after });
          }
        }
        runs = newRuns;
        changed = true;
        pos = runs.map((r) => r.text).join("").indexOf(repl.original);
      }
    }

    return changed ? rebuildPara(pPr, runs) : para;
  });
}

const XML_PARTS = [
  "word/document.xml",
  "word/header1.xml", "word/header2.xml", "word/header3.xml",
  "word/footer1.xml", "word/footer2.xml", "word/footer3.xml",
];

export function applyReplacementsToDocx(buffer: Buffer, replacements: Replacement[]): Buffer {
  const zip = new PizZip(buffer);
  for (const part of XML_PARTS) {
    const entry = zip.file(part);
    if (!entry) continue;
    zip.file(part, applyReplacementsToXml(entry.asText(), replacements));
  }
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}
