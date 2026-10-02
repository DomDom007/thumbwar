// Thumbwar: compare two thumbnails at real YouTube sizes, measure what makes them readable, and run a blind vote.
import { useEffect, useState } from "react";
import { idbGet, idbSet, shrinkImage } from "./lib/idb";
import { useStored } from "./lib/store";
import { Section, Stat, Stats } from "./ui/kit";

const T = "thumbwar";
type Metrics = { brightness: number; contrast: number; colorful: number; clutter: number };
const SIZES = [{ name: "Home feed", w: 360 }, { name: "Mobile", w: 246 }, { name: "Up next sidebar", w: 168 }];

function makeSample(label: string, bg: string, fg: string, big: boolean) {
  const c = document.createElement("canvas"); c.width = 1280; c.height = 720;
  const x = c.getContext("2d")!;
  x.fillStyle = bg; x.fillRect(0, 0, 1280, 720);
  for (let i = 0; i < (big ? 3 : 30); i++) { x.fillStyle = big ? fg + "55" : `hsl(${i * 37} 50% 60% / .5)`; x.beginPath(); x.arc(Math.random() * 1280, Math.random() * 720, big ? 260 : 60, 0, 7); x.fill(); }
  x.fillStyle = fg; x.font = `${big ? 190 : 70}px Gloock, Georgia, serif`; x.textAlign = "center"; x.fillText(label, 640, big ? 430 : 380);
  return c.toDataURL("image/jpeg", 0.8);
}

function measure(src: string): Promise<Metrics> {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const w = 160, h = 90, c = document.createElement("canvas"); c.width = w; c.height = h;
      const x = c.getContext("2d")!; x.drawImage(img, 0, 0, w, h);
      const d = x.getImageData(0, 0, w, h).data;
      const L: number[] = []; let rg = 0, yb = 0, rg2 = 0, yb2 = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        L.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
        const a = r - g, bb = (r + g) / 2 - b; rg += a; yb += bb; rg2 += a * a; yb2 += bb * bb;
      }
      const n = L.length, mean = L.reduce((a, b) => a + b, 0) / n;
      const sd = Math.sqrt(L.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
      const mrg = rg / n, myb = yb / n;
      const colorful = Math.sqrt(rg2 / n - mrg ** 2 + (yb2 / n - myb ** 2)) + 0.3 * Math.sqrt(mrg ** 2 + myb ** 2);
      let edges = 0;
      for (let yy = 1; yy < h - 1; yy++) for (let xx = 1; xx < w - 1; xx++) { const i = yy * w + xx; if (Math.abs(L[i] - L[i + 1]) + Math.abs(L[i] - L[i + w]) > 60) edges++; }
      res({ brightness: mean / 2.55, contrast: sd / 1.28, colorful: Math.min(100, colorful), clutter: (edges / ((w - 2) * (h - 2))) * 100 });
    };
    img.src = src;
  });
}

const wilson = (k: number, n: number) => { if (!n) return [0, 1]; const p = k / n, z = 1.96, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; };

export default function Thumbwar() {
  const [imgs, setImgs] = useState<[string, string]>(["", ""]);
  const [votes, setVotes] = useStored(T, "votes", [0, 0]);
  const [title, setTitle] = useStored(T, "title", "I tried running a pottery shop for 30 days");
  const [m, setM] = useState<(Metrics | null)[]>([null, null]);
  const [dark, setDark] = useState(false);
  const [test, setTest] = useState<{ order: number[]; shown: boolean } | null>(null);

  useEffect(() => {
    Promise.all([idbGet(`${T}:a`), idbGet(`${T}:b`)]).then(([a, b]) => {
      setImgs([a || makeSample("30 DAYS", "#151933", "#FFE800", true), b || makeSample("my pottery shop experiment, day by day", "#e8e0d0", "#555", false)]);
    });
  }, []);
  useEffect(() => { Promise.all(imgs.map(s => (s ? measure(s) : Promise.resolve(null)))).then(setM); }, [imgs]);

  const upload = async (i: 0 | 1, f?: File) => {
    if (!f) return;
    const src = await shrinkImage(f, 1280, 0.85);
    await idbSet(`${T}:${i ? "b" : "a"}`, src);
    const next: [string, string] = [...imgs] as [string, string]; next[i] = src; setImgs(next); setVotes([0, 0]);
  };
  const total = votes[0] + votes[1];
  const ci = wilson(votes[0], total);
  const verdict = total < 10 ? `Collect at least 10 votes. ${10 - total} to go.` : ci[0] > 0.5 ? "A wins with 95% confidence." : ci[1] < 0.5 ? "B wins with 95% confidence." : "Too close to call. Keep collecting votes.";
  const score = (x: Metrics) => Math.round(Math.min(100, x.contrast) * 0.4 + x.colorful * 0.25 + Math.max(0, 100 - Math.abs(x.brightness - 55) * 2) * 0.15 + Math.max(0, 100 - x.clutter * 4) * 0.2);
  const rows: [string, (x: Metrics) => number, string][] = [
    ["Contrast", x => x.contrast, "Higher reads better at small sizes"],
    ["Colourfulness", x => x.colorful, "Saturated colours stand out in a grey feed"],
    ["Brightness", x => x.brightness, "Around 45 to 65 works on both light and dark mode"],
    ["Clutter", x => x.clutter, "Lower is better. Busy images turn to mush at 168px"],
  ];

  return (
    <div className="stack">
      <div className="grid2">
        {[0, 1].map(i => (
          <Section key={i} title={`Thumbnail ${i ? "B" : "A"}`} aside={<label className="btn small">Upload<input type="file" accept="image/*" hidden onChange={e => upload(i as 0 | 1, e.target.files?.[0])} /></label>}>
            {imgs[i] && <img src={imgs[i]} alt={`Thumbnail ${i ? "B" : "A"}`} style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", borderRadius: 8 }} />}
            {m[i] && <p style={{ marginTop: 10 }}><span className="tw-score">{score(m[i]!)}</span> <span className="note">readability score out of 100</span></p>}
          </Section>
        ))}
      </div>

      <Section title="How they look in the feed" aside={<div className="seg-mini"><button aria-pressed={!dark} onClick={() => setDark(false)}>Light</button><button aria-pressed={dark} onClick={() => setDark(true)}>Dark</button></div>}>
        <label className="field" style={{ marginBottom: 14 }}><span>Video title</span><input id="tw-title" className="input" value={title} onChange={e => setTitle(e.target.value)} /></label>
        <div className="tw-feed" style={{ background: dark ? "#0f0f0f" : "#fff", color: dark ? "#f1f1f1" : "#0f0f0f" }}>
          {SIZES.map(s => (
            <div key={s.w} className="tw-size">
              <p className="tw-label">{s.name} · {s.w}px</p>
              <div className="row" style={{ gap: 16, alignItems: "flex-start" }}>
                {imgs.map((src, i) => src && (
                  <div key={i} style={{ width: s.w }}>
                    <img src={src} alt="" style={{ width: s.w, height: (s.w * 9) / 16, objectFit: "cover", borderRadius: s.w > 200 ? 12 : 8, display: "block" }} />
                    <p style={{ fontSize: s.w > 200 ? 15 : 13, fontWeight: 600, marginTop: 6, lineHeight: 1.3 }}>{i ? "B" : "A"} · {title}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <div className="grid2">
        <Section title="Measurements">
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Measure</th><th className="r">A</th><th className="r">B</th></tr></thead>
            <tbody>{rows.map(([name, f, hint]) => (
              <tr key={name}><td>{name}<br /><span className="note">{hint}</span></td>
                {m.map((x, i) => <td key={i} className="r">{x ? Math.round(f(x)) : "…"}</td>)}</tr>
            ))}</tbody>
          </table></div>
        </Section>

        <Section title="Blind vote" aside={<button className="btn ghost small danger" onClick={() => setVotes([0, 0])}>Reset votes</button>}>
          {!test ? (
            <div className="stack" style={{ gap: 12 }}>
              <p>Hand your phone to friends one by one. Each sees both thumbnails in random order, small, for three seconds, then picks the one they would click.</p>
              <button className="btn primary" onClick={() => { setTest({ order: Math.random() < 0.5 ? [0, 1] : [1, 0], shown: true }); setTimeout(() => setTest(t => t && { ...t, shown: false }), 3000); }}>Start a vote</button>
            </div>
          ) : (
            <div className="stack" style={{ gap: 12 }}>
              <div className="row" style={{ gap: 12 }}>
                {test.order.map((i, k) => (
                  <button key={k} className="tw-pick" onClick={() => { const v = [...votes]; v[i]++; setVotes(v); setTest(null); }}>
                    {test.shown ? <img src={imgs[i]} alt="" /> : <span>Option {k + 1}</span>}
                  </button>
                ))}
              </div>
              <p className="note">{test.shown ? "Look now…" : "Which one would you click? Tap it."}</p>
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <Stats><Stat value={votes[0]} label="Votes for A" /><Stat value={votes[1]} label="Votes for B" /><Stat value={total ? `${Math.round((votes[0] / total) * 100)}%` : "0%"} label="A's share" /></Stats>
            <p style={{ marginTop: 10 }}><span className={"pill " + (total >= 10 && (ci[0] > 0.5 || ci[1] < 0.5) ? "good" : "warn")}>{verdict}</span></p>
          </div>
        </Section>
      </div>
      <style>{`.tw-score{font-family:var(--serif);font-size:40px}.tw-feed{border-radius:12px;padding:18px;display:grid;gap:22px;overflow-x:auto}.tw-label{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.08em;opacity:.6;margin-bottom:8px}
      .tw-pick{flex:1 1 140px;aspect-ratio:16/9;border:2px solid var(--line);border-radius:10px;background:var(--sunk);cursor:pointer;padding:0;overflow:hidden;font-weight:700;font-size:18px;color:var(--ink)}.tw-pick img{width:100%;height:100%;object-fit:cover;display:block}.tw-pick:hover{border-color:var(--accent)}`}</style>
    </div>
  );
}
