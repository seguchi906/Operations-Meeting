"use client";

import { useEffect, useMemo, useState } from "react";
import { Calculator, ChevronDown, ChevronUp, PencilLine, RotateCcw, TableProperties } from "lucide-react";

type SectionKey = "division1Group1" | "division1Group2" | "division1Group3" | "division2" | "river" | "road" | "development";
type SectionValues = Record<SectionKey, number>;
type PlanMetric = "allocation" | "earned" | "outsourcing";
type PlanCategory = "division1" | "division2" | "specialist";
type PlanInputs = Record<PlanMetric, Record<PlanCategory, number>>;
type Project = { id?: string; number?: string; startDate?: string; allocationSection1?: number | null; allocationSection2?: number | null; allocationSection3?: number | null; allocationSections?: Record<string, number | null>; outsourcingAmount?: number | null; outsourcingSections?: Record<string, number | null> };
type ProgressProject = { id?: string; number?: string; weeklyProgress?: (number | null)[]; wp?: (number | null)[] };

const KEYS: SectionKey[] = ["division1Group1", "division1Group2", "division1Group3", "division2", "river", "road", "development"];
const EMPTY: SectionValues = { division1Group1: 0, division1Group2: 0, division1Group3: 0, division2: 0, river: 0, road: 0, development: 0 };
const PLAN_ALLOCATION: SectionValues = { division1Group1: 72_500, division1Group2: 72_500, division1Group3: 72_500, division2: 174_000, river: 29_000, road: 29_000, development: 43_500 };
const PLAN_EARNED: SectionValues = { division1Group1: 50_000, division1Group2: 50_000, division1Group3: 50_000, division2: 120_000, river: 20_000, road: 20_000, development: 30_000 };
const PLAN_OUTSOURCING: SectionValues = { division1Group1: 15_000, division1Group2: 15_000, division1Group3: 15_000, division2: 36_000, river: 6_000, road: 6_000, development: 15_000 };
const STORAGE_KEY = "earned-value-dashboard-48-plan-inputs";
const TECHNICAL_EXPENSE = 130_000;
const COMPANY_EXPENSE = 84_000;
const WEEK_LABELS = ["7/3", "7/10", "7/17", "7/24", "7/31", "8/7", "8/14", "8/21", "8/28", "9/4", "9/11", "9/18", "9/25", "10/2", "10/9", "10/16", "10/23", "10/30", "11/6", "11/13", "11/20", "11/27", "12/4", "12/11", "12/18", "12/25", "1/1", "1/8", "1/15", "1/22", "1/29", "2/5", "2/12", "2/19", "2/26", "3/5", "3/12", "3/19", "3/26", "4/2", "4/9", "4/16", "4/23", "4/30", "5/7", "5/14", "5/21", "5/28", "6/4", "6/11", "6/18", "6/25"];
const WEEK_DATES = WEEK_LABELS.map((label) => { const [month, day] = label.split("/").map(Number); return new Date(month >= 7 ? 2026 : 2027, month - 1, day); });

const DEFAULT_INPUTS: PlanInputs = {
  allocation: { division1: 217_500, division2: 174_000, specialist: 101_500 },
  earned: { division1: 150_000, division2: 120_000, specialist: 70_000 },
  outsourcing: { division1: 45_000, division2: 36_000, specialist: 27_000 },
};

const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : 0;
const sum = (values: SectionValues) => KEYS.reduce((total, key) => total + values[key], 0);
const format = (value: number) => Math.round(value).toLocaleString("ja-JP");

function sections(project: Project, outsourcing = false): SectionValues {
  const source = outsourcing ? project.outsourcingSections : project.allocationSections;
  if (source) return { division1Group1: finite(source["1課1係"]), division1Group2: finite(source["1課2係"]), division1Group3: finite(source["1課3係"]), division2: finite(source["2課"]), river: finite(source["河川"]), road: finite(source["道路"]), development: finite(source["開発・点検"]) + finite(source["管理"]) };
  const base = { ...EMPTY, division1Group1: finite(project.allocationSection1), division2: finite(project.allocationSection2), development: finite(project.allocationSection3) };
  if (!outsourcing) return base;
  const result = { ...EMPTY }, total = sum(base), amount = finite(project.outsourcingAmount);
  if (total > 0) KEYS.forEach((key) => { result[key] = amount * base[key] / total; });
  return result;
}

function add(target: SectionValues, source: SectionValues, factor = 1) { KEYS.forEach((key) => { target[key] += source[key] * factor; }); }
function thousands(values: SectionValues) { return Object.fromEntries(KEYS.map((key) => [key, Math.round(values[key] / 1000)])) as SectionValues; }
function weekIndex(date: Date) { if (date < WEEK_DATES[0]) return -1; for (let i = WEEK_DATES.length - 1; i >= 0; i--) if (date >= WEEK_DATES[i]) return i; return -1; }
function normalize(values?: (number | null)[]) { const result = Array.isArray(values) ? [...values] : []; if (result.length === 51) result.splice(26, 0, null); return result; }
function progressAt(values: (number | null)[], index: number) { for (let i = Math.min(index, values.length - 1); i >= 0; i--) if (values[i] !== null) return values[i] ?? 0; return 0; }
function distribute(total: number, defaults: number[]) { const base = defaults.reduce((a, b) => a + b, 0); let used = 0; return defaults.map((value, index) => index === defaults.length - 1 ? total - used : (used += Math.round(total * value / base), Math.round(total * value / base))); }
function inputSections(input: PlanInputs[PlanMetric], defaults: SectionValues): SectionValues { const d1 = distribute(input.division1, [defaults.division1Group1, defaults.division1Group2, defaults.division1Group3]); const sp = distribute(input.specialist, [defaults.river, defaults.road, defaults.development]); return { division1Group1: d1[0], division1Group2: d1[1], division1Group3: d1[2], division2: input.division2, river: sp[0], road: sp[1], development: sp[2] }; }

export default function EarnedValueOverview() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [progress, setProgress] = useState<ProgressProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [inputs, setInputs] = useState<PlanInputs>(DEFAULT_INPUTS);

  useEffect(() => { try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) setInputs(JSON.parse(saved)); } catch {} }, []);
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs)); }, [inputs]);
  useEffect(() => { let active = true; Promise.all([
    fetch("https://overall-project-schedule-48.netlify.app/api/projects-data", { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(); return r.json(); }),
    fetch("https://progress-dashboard-48.netlify.app/api/projects", { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(); return r.json(); }),
  ]).then(([projectData, progressData]) => { if (!active) return; setProjects(Array.isArray(projectData) ? projectData : projectData.projects ?? []); setProgress(Array.isArray(progressData) ? progressData : []); }).catch(() => active && setError("出来高データを取得できませんでした。時間をおいて再読み込みしてください。" )).finally(() => active && setLoading(false)); return () => { active = false; }; }, []);

  const calculated = useMemo(() => {
    const current = { allocation: { ...EMPTY }, earned: { ...EMPTY }, outsourcing: { ...EMPTY } };
    const uncontracted = { ...EMPTY };
    const today = new Date(), index = weekIndex(today), effective = WEEK_DATES[Math.max(0, index)], allocationDate = today < WEEK_DATES.at(-1)! ? today : WEEK_DATES.at(-1)!;
    const map = new Map(progress.map((item) => [String(item.number ?? item.id ?? "").trim(), normalize(item.weeklyProgress ?? item.wp)]));
    projects.forEach((project) => {
      if (!String(project.number ?? "").trim()) { add(uncontracted, sections(project)); return; }
      add(current.outsourcing, sections(project, true));
      if (index < 0 || !project.startDate) return;
      const start = new Date(project.startDate), projectSections = sections(project);
      if (start <= allocationDate) add(current.allocation, projectSections);
      if (start <= effective) add(current.earned, projectSections, progressAt(map.get(String(project.number ?? project.id ?? "").trim()) ?? [], index) / 100);
    });
    return { allocation: thousands(current.allocation), earned: thousands(current.earned), outsourcing: thousands(current.outsourcing), uncontracted: thousands(uncontracted) };
  }, [projects, progress]);

  const plans = { allocation: inputSections(inputs.allocation, PLAN_ALLOCATION), earned: inputSections(inputs.earned, PLAN_EARNED), outsourcing: inputSections(inputs.outsourcing, PLAN_OUTSOURCING) };
  const currentEarned = sum(calculated.earned), currentOutsourcing = sum(calculated.outsourcing), remaining = currentEarned - TECHNICAL_EXPENSE - COMPANY_EXPENSE - currentOutsourcing;
  const update = (metric: PlanMetric, category: PlanCategory, value: string) => setInputs((old) => ({ ...old, [metric]: { ...old[metric], [category]: Math.max(0, Math.round(Number(value) || 0)) } }));

  if (loading) return <div className="ev-loading">一覧表とチェックを読み込んでいます…</div>;
  if (error) return <div className="ev-error">{error}</div>;
  return <section className="ev-overview" aria-label="出来高一覧と収支チェック">
    <div className="ev-card ev-table-card">
      <header className="ev-card-header"><div><h3><TableProperties size={15} />一覧表</h3><p>計画値は「計画値を入力」から編集できます。入力値はこのブラウザへ自動保存されます。</p></div><div className="ev-header-actions"><button type="button" onClick={() => setEditorOpen(!editorOpen)} aria-expanded={editorOpen}><PencilLine size={14} />計画値を入力{editorOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button><span>単位：千円</span></div></header>
      {editorOpen && <div className="ev-plan-editor"><div className="ev-editor-title"><div><strong>計画値の入力</strong><small>各項目の1課・2課・専門の合計額を千円単位で入力してください。</small></div><button type="button" onClick={() => setInputs(structuredClone(DEFAULT_INPUTS))}><RotateCcw size={13} />初期値に戻す</button></div><div className="ev-editor-grid"><i />{(["division1", "division2", "specialist"] as PlanCategory[]).map((c) => <b key={c}>{{ division1: "1課", division2: "2課", specialist: "専門" }[c]}</b>)}{(["allocation", "earned", "outsourcing"] as PlanMetric[]).map((m) => <div className="ev-editor-row" key={m}><b>{{ allocation: "配分額", earned: "出来高", outsourcing: "外注費" }[m]}</b>{(["division1", "division2", "specialist"] as PlanCategory[]).map((c) => <label key={c}><input type="number" min="0" step="1000" value={inputs[m][c]} onChange={(e) => update(m, c, e.target.value)} aria-label={`${m}-${c} 計画値`} /><span>千円</span></label>)}</div>)}</div></div>}
      <div className="ev-table-scroll"><table><thead><tr><th colSpan={2} rowSpan={2}></th><th rowSpan={2}>技術部</th><th className="ev-blue" colSpan={3}>1課</th><th className="ev-yellow" rowSpan={2}>2課</th><th className="ev-green" colSpan={3}>専門</th></tr><tr><th className="ev-blue">1課1係</th><th className="ev-blue">1課2係</th><th className="ev-blue">1課3係</th><th className="ev-green">河川</th><th className="ev-green">道路</th><th className="ev-green">開発・点検</th></tr></thead><tbody><Rows label="配分額" plan={plans.allocation} actual={calculated.allocation} uncontracted={calculated.uncontracted} /><Rows label="出来高" plan={plans.earned} actual={calculated.earned} /><Rows label="外注費" plan={plans.outsourcing} actual={calculated.outsourcing} /></tbody></table></div>
    </div>
    <div className="ev-card"><header className="ev-card-header"><div><h3><Calculator size={15} />チェック</h3><p>現時点の出来高から経費と外注費を差し引いた概算です。</p></div><strong className={remaining < 0 ? "ev-alert" : "ev-ok"}>{remaining < 0 ? "要確認" : "収支内"}</strong></header><dl className="ev-check-grid">{[["出来高", currentEarned], ["技術部経費", TECHNICAL_EXPENSE], ["会社経費", COMPANY_EXPENSE], ["外注費", currentOutsourcing], ["残り", remaining]].map(([label, value]) => <div key={label} className={label === "残り" ? remaining < 0 ? "is-negative" : "is-positive" : ""}><dt>{label}</dt><dd>{format(Number(value))}<small>千円</small></dd></div>)}</dl></div>
  </section>;
}

function Cells({ values }: { values: SectionValues }) { return <><td className="ev-total">{format(sum(values))}</td>{KEYS.map((key) => <td key={key} className={key.startsWith("division1") ? "ev-blue" : key === "division2" ? "ev-yellow" : "ev-green"}>{format(values[key])}</td>)}</>; }
function Rows({ label, plan, actual, uncontracted }: { label: string; plan: SectionValues; actual: SectionValues; uncontracted?: SectionValues }) { return <><tr><th rowSpan={uncontracted ? 3 : 2}>{label}</th><th>計画</th><Cells values={plan} /></tr><tr><th>現時点</th><Cells values={actual} /></tr>{uncontracted && <tr><th>未契約</th><Cells values={uncontracted} /></tr>}</>; }
