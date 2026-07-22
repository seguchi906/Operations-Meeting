"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PanelRightClose, PanelRightOpen, Trash2 } from "lucide-react";
import { deleteMeetingBundleAction, generateAiSuggestionsAction, generateMinutesAction, formatTranscriptAction, generateMeetingMaterialAction, getLowRemainingBudgetsAction, getOverdueIncompleteProjectsAction, getOverdueOutsourcingContractsAction, getProgressRiskReportAction, listStoredMeetingsAction, loadMeetingBundleAction, saveMeetingBundleAction } from "./actions";
import { generateMeetingMaterialClient, generateMinutesClient, formatTranscriptClient } from "./gemini-client";
import { deleteMeetingBundleClient, saveMeetingBundleClient, loadMeetingBundleClient, listStoredMeetingsClient } from "./neon-client";
import type { LowRemainingBudgetItem, OverdueIncompleteItem, OverdueOutsourcingItem, ProgressRiskReport } from "./risk-types";
import type { MeetingBundle } from "./meeting-types";

// ─── 会議資料パーサー & レンダラー ─────────────────────────────────────
type AgendaEntry = {
  subcategory: string;
  items: { content: string; writer: string }[];
};

type MeetingSection = {
  title: string;          // 大分類タイトル (## で始まる行)
  entries: AgendaEntry[];
};

const SECTION_THEMES = [
  {
    key: "業績",
    icon: "📈",
    badgeClass: "mat-badge mat-badge-perf",
    headerClass: "mat-section-header mat-header-perf",
    sectionClass: "mat-section mat-section-perf",
    label: "業績",
  },
  {
    key: "業務遂行",
    icon: "⚙️",
    badgeClass: "mat-badge mat-badge-ops",
    headerClass: "mat-section-header mat-header-ops",
    sectionClass: "mat-section mat-section-ops",
    label: "業務遂行",
  },
  {
    key: "組織運営",
    icon: "👥",
    badgeClass: "mat-badge mat-badge-org",
    headerClass: "mat-section-header mat-header-org",
    sectionClass: "mat-section mat-section-org",
    label: "組織運営",
  },
];

function getTheme(title: string) {
  return (
    SECTION_THEMES.find((t) => title.includes(t.key)) ?? SECTION_THEMES[0]
  );
}

function parseMeetingMaterial(md: string): MeetingSection[] {
  const sections: MeetingSection[] = [];
  let currentSection: MeetingSection | null = null;
  let currentEntry: AgendaEntry | null = null;

  for (const rawLine of md.split("\n")) {
    const line = rawLine.trim();

    // ## → 大分類
    if (/^##\s+/.test(line) && !/^###/.test(line)) {
      currentEntry = null;
      currentSection = { title: line.replace(/^##\s+/, ""), entries: [] };
      sections.push(currentSection);
      continue;
    }

    // ### → 小項目
    if (/^###\s+/.test(line)) {
      currentEntry = { subcategory: line.replace(/^###\s+/, ""), items: [] };
      currentSection?.entries.push(currentEntry);
      continue;
    }

    // - [内容]（記入者：〇〇）
    if (/^-\s+/.test(line) && currentEntry) {
      const text = line.replace(/^-\s+/, "");
      // 記入者を抽出
      const writerMatch = text.match(/（記入者：([^）]+)）/);
      const writer = writerMatch ? writerMatch[1] : "";
      const content = text.replace(/（記入者：[^）]+）/, "").trim();
      currentEntry.items.push({ content, writer });
    }
  }

  return sections;
}

function MeetingMaterialView({ markdown }: { markdown: string }) {
  const sections = parseMeetingMaterial(markdown);
  if (sections.length === 0) {
    return <div className="preview-minutes-doc">{markdown}</div>;
  }

  return (
    <div className="mat-root">
      {sections.map((section, si) => {
        const theme = getTheme(section.title);
        return (
          <div key={si} className={theme.sectionClass}>
            <div className={theme.headerClass}>
              <span className="mat-header-icon">{theme.icon}</span>
              <span className="mat-header-title">{section.title}</span>
            </div>
            <div className="mat-entries">
              {section.entries.map((entry, ei) =>
                entry.items.map((item, ii) => (
                  <div key={`${ei}-${ii}`} className="mat-card">
                    <div className="mat-card-top">
                      <span className="mat-card-sub">{entry.subcategory}</span>
                    </div>
                    <p className="mat-card-content">{item.content}</p>
                    {item.writer && (
                      <div className="mat-card-meta">
                        <span className="mat-card-writer">👤 記入者：{item.writer}</span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function inferAdviceTheme(advice: string[]) {
  const text = advice.join(" ");
  const themes: { label: string; keywords: string[] }[] = [
    { label: "課員一人ひとりの成長を支える育成", keywords: ["育成", "成長", "課員", "部下", "指導", "教育", "スキル", "キャリア"] },
    { label: "互いの強みを活かす役割分担と組織連携", keywords: ["役割", "分担", "連携", "協力", "共有", "チーム", "支援", "横断"] },
    { label: "成果と学びを次につなげる計画と振り返り", keywords: ["計画", "振り返", "目標", "進捗", "定期", "レビュー", "改善", "検証"] },
    { label: "誰もが安心して力を発揮できる業務体制", keywords: ["負荷", "人員", "要員", "残業", "稼働", "応援", "不足", "繁忙"] },
    { label: "持続的な価値提供を支える事業採算と収益改善", keywords: ["採算", "収益", "利益", "予算", "原価", "売上", "赤字", "コスト"] },
    { label: "顧客の未来に寄り添う価値提供と案件推進", keywords: ["顧客", "案件", "受注", "提案", "納期", "品質", "営業", "市場"] },
    { label: "問題を抱え込ませない課題の早期把握と支援", keywords: ["課題", "問題", "リスク", "確認", "対策", "懸念", "遅れ", "対応"] },
  ];

  const ranked = themes
    .map((theme, index) => ({
      ...theme,
      index,
      score: theme.keywords.reduce((score, keyword) => score + (text.includes(keyword) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  return ranked[0].score > 0 ? ranked[0].label : "周囲と未来を見据えた次の一歩";
}

function AiSuggestionsView({ markdown }: { markdown: string }) {
  const sections: { title: string; theme: string; advice: string[] }[] = [];
  let current: { title: string; theme: string; advice: string[] } | null = null;

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    const heading = line.match(/^##\s+(.+)/);
    if (heading) {
      current = { title: heading[1], theme: "", advice: [] };
      sections.push(current);
      continue;
    }
    const theme = line.match(/^###\s+テーマ[：:]\s*(.+)/);
    if (theme && current) {
      current.theme = theme[1];
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)/);
    if (bullet && current) current.advice.push(bullet[1]);
  }

  if (!sections.length) return <div className="preview-minutes-doc">{markdown}</div>;

  return (
    <div className="advice-cards">
      {sections.map((section) => {
        const isKumamoto = section.title.includes("熊本");
        const isOkubo = section.title.includes("大久保");
        const person = isKumamoto ? "熊本" : isOkubo ? "大久保" : section.title.includes("瀬口") ? "瀬口" : "AI";
        const role = isKumamoto || isOkubo ? "課長・課内運営" : person === "瀬口" ? "執行役員・事業運営" : "提案";
        const tone = isKumamoto ? "kumamoto" : isOkubo ? "okubo" : "seguchi";
        return (
          <article className={`advice-card tone-${tone}`} key={section.title}>
            <header>
              <span className="advice-avatar">{person.slice(0, 1)}</span>
              <div><strong>{person}さんへのアドバイス</strong><small>{role}</small></div>
              <span className="advice-ai-mark">✦ AI</span>
            </header>
            <div className="advice-theme"><span>THEME</span><strong>{section.theme || inferAdviceTheme(section.advice)}</strong></div>
            <ul>
              {section.advice.slice(0, 4).map((advice, index) => <li key={`${section.title}-${index}`}>{advice}</li>)}
            </ul>
          </article>
        );
      })}
    </div>
  );
}

function ProgressRiskView({ report }: { report: ProgressRiskReport }) {
  return (
    <div className="risk-report">
      <div className="risk-report-summary">
        {report.sectionSummaries.map((summary) => (
          <article key={summary.section} className="risk-summary-card">
            <strong>{summary.section}</strong>
            <span>{summary.totalCount}件</span>
            <div><em className="risk-high">高 {summary.highRiskCount}</em><em className="risk-caution">注意 {summary.cautionCount}</em></div>
          </article>
        ))}
      </div>

      <div className="risk-report-heading">
        <strong>対応が必要な案件</strong>
        <span>{report.items.length}件</span>
      </div>

      {report.items.length ? report.items.map((item) => (
        <article className="risk-item" key={item.businessNumber}>
          <div className="risk-item-title">
            <span className={`risk-level ${item.riskLevel === "高リスク" ? "is-high" : "is-caution"}`}>{item.riskLevel}</span>
            <div><strong>{item.name}</strong><small>{item.businessNumber}{item.sections.length ? ` ・ ${item.sections.join("・")}` : ""}</small></div>
            <b>スコア {item.riskScore}</b>
          </div>
          <div className="risk-progress-grid">
            <div><span>実績</span><strong>{item.actualProgress.toFixed(1)}%</strong></div>
            <div><span>期待</span><strong>{item.expectedProgress.toFixed(1)}%</strong></div>
            <div><span>差</span><strong className={item.gap < -10 ? "is-negative" : ""}>{item.gap > 0 ? "+" : ""}{item.gap.toFixed(1)}pt</strong></div>
          </div>
          <div className="risk-progress-track" aria-label={`実績 ${item.actualProgress.toFixed(1)}%、期待 ${item.expectedProgress.toFixed(1)}%`}>
            <i style={{ width: `${Math.min(100, item.expectedProgress)}%` }} />
            <span style={{ width: `${Math.min(100, item.actualProgress)}%` }} />
          </div>
          <ul>{item.riskFactors.map((factor) => <li key={factor}>{factor}</li>)}</ul>
        </article>
      )) : <div className="risk-clear">高リスク・注意の案件はありません。</div>}
    </div>
  );
}

type MeetingStatus = "準備中" | "確定済み";

type Meeting = {
  id: string;
  date: string;
  status: MeetingStatus;
};

type AgendaItem = {
  id: string;
  department: string;
  name: string;
  initials: string;
  detail: string;
  due: string;
};

const initialMeetings: Meeting[] = [
  { id: "m-0727", date: "2026-07-27", status: "準備中" },
  { id: "m-0720", date: "2026-07-20", status: "準備中" },
  { id: "m-0713", date: "2026-07-13", status: "準備中" },
];

const initialAgenda: AgendaItem[] = [
  {
    id: "agenda-1",
    department: "技術1課",
    name: "熊本",
    initials: "熊",
    detail: "東地区水路更新設計について、現地協議を終え修正版を今週中に提出予定。測量データの不足は追加確認で解消済み。",
    due: "7月24日まで",
  },
  {
    id: "agenda-2",
    department: "技術2課",
    name: "大久保",
    initials: "久",
    detail: "南部幹線道路予備設計の受注見込み。時期は2026年8月。着手が既存案件と重なるため、技術1課から1名の応援を相談したい。",
    due: "7月24日まで",
  },
  {
    id: "agenda-3",
    department: "執行役員",
    name: "瀬口",
    initials: "瀬",
    detail: "下期計画の重点方針として品質レビューの早期化を共有。各課でチェック日を工程表に明記すること。安全パトロールと採用進捗の共有。",
    due: "7月25日まで",
  },
];

const aiTranscriptSeed =
  "熊本：東地区水路更新設計は、現地協議を終え、今週中に修正版を提出予定です。懸念していた測量データの不足は追加確認で解消しました。\n\n大久保：南部幹線道路予備設計は8月の受注見込みです。着手時期が既存案件と重なるため、技術1課から1名の応援を相談したいです。\n\n瀬口：下期は品質レビューの早期化を重点方針とします。各課でチェック日を工程表に明記してください。";

const originalTranscriptSeed =
  "熊本さん：えーと東地区の水路更新ですが、現地協議は終わっています。今週中には修正版を出す予定です。測量データの不足も、追加で確認して解消しています。\n\n大久保さん：南部幹線道路は8月に受注の見込みです。ほかの案件と着手が重なりそうなので、技術1課から一人お願いできるか相談したいです。";

const finalMinutesSeed =
  "1. 東地区水路更新設計\n現地協議および測量データの追加確認は完了。熊本さんが修正版を7月31日までに提出する。\n\n2. 南部幹線道路予備設計\n8月の受注を想定し、技術1課から1名の応援配置を検討する。担当者は熊本課長・大久保課長が7月29日までに決定する。\n\n3. 下期の品質管理\n全案件の工程表に品質チェック日を明記し、レビューを前倒しする。";

function formatMeetingDate(isoDate: string, includeYear = false) {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "日付未設定";
  const [, year, month, day] = match;
  const formatted = `${Number(month)}月${Number(day)}日`;
  return includeYear ? `${year}年${formatted}` : formatted;
}

function formatTimer(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return minutes + ":" + seconds;
}

export default function Home() {
  const [meetings, setMeetings] = useState<Meeting[]>(initialMeetings);
  const [selectedMeetingId, setSelectedMeetingId] = useState("m-0727");
  const [agenda, setAgenda] = useState<AgendaItem[]>(initialAgenda);
  const [activeNav, setActiveNav] = useState("agenda");
  const [transcriptTab, setTranscriptTab] = useState<"ai" | "original">("ai");
  const [previewTab, setPreviewTab] = useState<"material" | "suggestions" | "minutes" | "risk" | "attendance">("material");
  const [aiTranscript, setAiTranscript] = useState(aiTranscriptSeed);
  const [originalTranscript, setOriginalTranscript] = useState(originalTranscriptSeed);
  const [aiDraft, setAiDraft] = useState("");
  const [finalMinutes, setFinalMinutes] = useState(finalMinutesSeed);
  const [agendaDocument, setAgendaDocument] = useState("");
  const [aiSuggestions, setAiSuggestions] = useState("");
  const [riskReport, setRiskReport] = useState<ProgressRiskReport | null>(null);
  const [riskReportError, setRiskReportError] = useState("");
  const [isRiskLoading, setIsRiskLoading] = useState(false);
  const [lowBudgetItems, setLowBudgetItems] = useState<LowRemainingBudgetItem[] | null>(null);
  const [budgetError, setBudgetError] = useState("");
  const [isBudgetLoading, setIsBudgetLoading] = useState(false);
  const [overdueOutsourcingItems, setOverdueOutsourcingItems] = useState<OverdueOutsourcingItem[] | null>(null);
  const [outsourcingError, setOutsourcingError] = useState("");
  const [isOutsourcingLoading, setIsOutsourcingLoading] = useState(false);
  const [overdueIncompleteItems, setOverdueIncompleteItems] = useState<OverdueIncompleteItem[] | null>(null);
  const [overdueIncompleteError, setOverdueIncompleteError] = useState("");
  const [isOverdueIncompleteLoading, setIsOverdueIncompleteLoading] = useState(false);
  const [saveState, setSaveState] = useState("自動保存済み");
  const [toast, setToast] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSuggestionsGenerating, setIsSuggestionsGenerating] = useState(false);
  const [isSuggestionsSaving, setIsSuggestionsSaving] = useState(false);
  const [isEditorCollapsed, setIsEditorCollapsed] = useState(false);
  const [isBundleSaving, setIsBundleSaving] = useState(false);
  const [isResumingEditing, setIsResumingEditing] = useState(false);
  const [savingAgendaId, setSavingAgendaId] = useState<string | null>(null);
  const [isTranscriptSaving, setIsTranscriptSaving] = useState(false);
  const [isMinutesDraftSaving, setIsMinutesDraftSaving] = useState(false);
  const [isMinutesConfirming, setIsMinutesConfirming] = useState(false);
  const [savingBusinessStatus, setSavingBusinessStatus] = useState<"budget" | "outsourcing" | "incomplete" | "risk" | null>(null);
  const [isBundleLoading, setIsBundleLoading] = useState(false);
  const [deletingMeetingId, setDeletingMeetingId] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedMeeting = useMemo(
    () => meetings.find((meeting) => meeting.id === selectedMeetingId) ?? meetings[0],
    [meetings, selectedMeetingId],
  );
  const isMeetingComplete = selectedMeeting.status === "確定済み";

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      setRecordingSeconds((current) => current + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    async function restoreMeetingList() {
      try {
        let storedMeetings;
        try {
          storedMeetings = await listStoredMeetingsAction();
        } catch {
          storedMeetings = await listStoredMeetingsClient();
        }
        setMeetings((current) => {
          const merged = new Map(current.map((meeting) => [meeting.id, meeting]));
          for (const meeting of storedMeetings) merged.set(meeting.id, meeting as Meeting);
          return [...merged.values()].sort((a, b) => b.date.localeCompare(a.date));
        });
      } catch (error) {
        console.info("保存済み会議一覧の読み込みをスキップしました:", error);
      }
    }
    void restoreMeetingList();
  }, []);

function createDefaultEmptyAgenda(): AgendaItem[] {
  return [
    {
      id: "agenda-1",
      department: "技術1課",
      name: "熊本",
      initials: "熊",
      detail: "",
      due: "未設定",
    },
    {
      id: "agenda-2",
      department: "技術2課",
      name: "大久保",
      initials: "久",
      detail: "",
      due: "未設定",
    },
    {
      id: "agenda-3",
      department: "執行役員",
      name: "瀬口",
      initials: "瀬",
      detail: "",
      due: "未設定",
    },
  ];
}

  function resetToEmptyMeeting() {
    setAgenda(createDefaultEmptyAgenda());
    setAgendaDocument("");
    setAiSuggestions("");
    setLowBudgetItems(null);
    setOverdueOutsourcingItems(null);
    setOverdueIncompleteItems(null);
    setRiskReport(null);
    setAiTranscript("");
    setOriginalTranscript("");
    setAiDraft("");
    setFinalMinutes("");
    setLastSavedAt("");
  }

async function saveBundleUnified(bundle: MeetingBundle): Promise<{ updatedAt: string }> {
  try {
    const result = await saveMeetingBundleAction(bundle);
    return { updatedAt: result.updatedAt };
  } catch (serverError) {
    try {
      const result = await saveMeetingBundleClient(bundle);
      return { updatedAt: result.updatedAt };
    } catch (clientError) {
      console.error("Neon database save failed:", { serverError, clientError });
      throw new Error("データベースに保存できませんでした。通信状況を確認して、もう一度お試しください。");
    }
  }
}

async function loadBundleUnified(meetingId: string): Promise<MeetingBundle | null> {
  try {
    return await loadMeetingBundleAction(meetingId);
  } catch (serverError) {
    try {
      return await loadMeetingBundleClient(meetingId);
    } catch (clientError) {
      console.error("Neon database load failed:", { serverError, clientError });
      throw new Error("データベースから会議資料を読み込めませんでした。");
    }
  }
}

async function deleteBundleUnified(meetingId: string) {
  try {
    await deleteMeetingBundleAction(meetingId);
  } catch (serverError) {
    try {
      await deleteMeetingBundleClient(meetingId);
    } catch (clientError) {
      console.error("Neon database delete failed:", { serverError, clientError });
      throw new Error("データベースから会議を削除できませんでした。");
    }
  }
}

  useEffect(() => {
    let cancelled = false;
    async function restoreMeeting() {
      setIsBundleLoading(true);
      try {
        const bundle = await loadBundleUnified(selectedMeetingId);
        if (!cancelled) {
          if (bundle) {
            applyMeetingBundle(bundle);
          } else {
            resetToEmptyMeeting();
          }
        }
      } catch (error) {
        console.error("会議資料の読み込みに失敗しました:", error);
        if (!cancelled) {
          resetToEmptyMeeting();
          setSaveState("読込エラー");
          showToast("データベースから会議資料を読み込めませんでした");
        }
      } finally {
        if (!cancelled) setIsBundleLoading(false);
      }
    }
    void restoreMeeting();
    return () => { cancelled = true; };
  }, [selectedMeetingId]);

  const liveStateRef = useRef({
    selectedMeeting,
    agenda,
    agendaDocument,
    aiSuggestions,
    lowBudgetItems,
    overdueOutsourcingItems,
    overdueIncompleteItems,
    riskReport,
    aiTranscript,
    originalTranscript,
    aiDraft,
    finalMinutes,
  });

  useEffect(() => {
    liveStateRef.current = {
      selectedMeeting,
      agenda,
      agendaDocument,
      aiSuggestions,
      lowBudgetItems,
      overdueOutsourcingItems,
      overdueIncompleteItems,
      riskReport,
      aiTranscript,
      originalTranscript,
      aiDraft,
      finalMinutes,
    };
  });

  function markEditing() {
    setSaveState("保存中…");
    setMeetings((current) => current.map((meeting) => meeting.id === selectedMeetingId
      ? { ...meeting, status: "準備中" }
      : meeting));
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        const bundle = createMeetingBundle("準備中");
        const { updatedAt } = await saveBundleUnified(bundle);
        setLastSavedAt(updatedAt);
        setSaveState("Neonに自動保存済み");
      } catch (error: any) {
        setSaveState("保存エラー");
        showToast(error?.message || "データベースに自動保存できませんでした");
      }
    }, 1200);
  }

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2600);
  }

  function applyMeetingBundle(bundle: MeetingBundle) {
    setMeetings((current) => current.map((meeting) => meeting.id === bundle.meetingId
      ? { ...meeting, date: bundle.meetingDate, status: bundle.status }
      : meeting));
    setAgenda(bundle.agendaItems);
    setAgendaDocument(bundle.meetingMaterial);
    setAiSuggestions(bundle.aiSuggestions);
    setLowBudgetItems(bundle.businessStatus?.lowBudgetItems ?? null);
    setOverdueOutsourcingItems(bundle.businessStatus?.overdueOutsourcingItems ?? null);
    setOverdueIncompleteItems(bundle.businessStatus?.overdueIncompleteItems ?? null);
    setRiskReport(bundle.businessStatus?.riskReport ?? null);
    setAiTranscript(bundle.transcript?.ai ?? "");
    setOriginalTranscript(bundle.transcript?.original ?? "");
    setAiDraft(bundle.minutes?.aiDraft ?? "");
    setFinalMinutes(bundle.minutes?.final ?? "");
    setLastSavedAt(bundle.updatedAt ?? "");
    liveStateRef.current = {
      selectedMeeting,
      agenda: bundle.agendaItems,
      agendaDocument: bundle.meetingMaterial,
      aiSuggestions: bundle.aiSuggestions,
      lowBudgetItems: bundle.businessStatus?.lowBudgetItems ?? null,
      overdueOutsourcingItems: bundle.businessStatus?.overdueOutsourcingItems ?? null,
      overdueIncompleteItems: bundle.businessStatus?.overdueIncompleteItems ?? null,
      riskReport: bundle.businessStatus?.riskReport ?? null,
      aiTranscript: bundle.transcript?.ai ?? "",
      originalTranscript: bundle.transcript?.original ?? "",
      aiDraft: bundle.minutes?.aiDraft ?? "",
      finalMinutes: bundle.minutes?.final ?? "",
    };
  }

  function createMeetingBundle(status: MeetingBundle["status"]): MeetingBundle {
    const live = liveStateRef.current;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(live.selectedMeeting.date)) {
      throw new Error("会議日を設定してから保存してください。");
    }
    return {
      meetingId: live.selectedMeeting.id,
      meetingDate: live.selectedMeeting.date,
      status,
      agendaItems: live.agenda,
      meetingMaterial: live.agendaDocument,
      aiSuggestions: live.aiSuggestions,
      businessStatus: {
        lowBudgetItems: live.lowBudgetItems,
        overdueOutsourcingItems: live.overdueOutsourcingItems,
        overdueIncompleteItems: live.overdueIncompleteItems,
        riskReport: live.riskReport,
      },
      transcript: { ai: live.aiTranscript, original: live.originalTranscript },
      minutes: { aiDraft: live.aiDraft, final: live.finalMinutes },
    };
  }

  async function saveCurrentMeetingBundle() {
    setIsBundleSaving(true);
    setSaveState("保存中…");
    const bundle = createMeetingBundle("確定済み");
    try {
      const { updatedAt } = await saveBundleUnified(bundle);
      setMeetings((current) => current.map((meeting) => meeting.id === selectedMeeting.id
        ? { ...meeting, status: "確定済み" }
        : meeting));
      setLastSavedAt(updatedAt);
      setSaveState("Neonに保存済み");
      showToast(`${formatMeetingDate(selectedMeeting.date)}の会議資料を完了しました`);
    } catch (error: any) {
      setSaveState("保存エラー");
      showToast(error?.message || "会議一式を保存できませんでした");
    } finally {
      setIsBundleSaving(false);
    }
  }

  async function resumeMeetingEditing() {
    setIsResumingEditing(true);
    setSaveState("保存中…");
    const bundle = createMeetingBundle("準備中");
    try {
      const { updatedAt } = await saveBundleUnified(bundle);
      setMeetings((current) => current.map((meeting) => meeting.id === selectedMeeting.id ? { ...meeting, status: "準備中" } : meeting));
      setLastSavedAt(updatedAt);
      setSaveState("Neonに保存済み");
      showToast("編集を再開しました");
    } catch (error: any) {
      setSaveState("保存エラー");
      showToast(error?.message || "編集を再開できませんでした");
    } finally {
      setIsResumingEditing(false);
    }
  }

  async function saveAgendaItem(itemId: string) {
    setSavingAgendaId(itemId);
    setSaveState("保存中…");
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    const bundle = createMeetingBundle("準備中");
    try {
      const { updatedAt } = await saveBundleUnified(bundle);
      setLastSavedAt(updatedAt);
      setSaveState("Neonに保存済み");
      const targetItem = liveStateRef.current.agenda.find((i) => i.id === itemId);
      showToast((targetItem?.department || targetItem?.name || "議題") + "の共有内容を保存しました");
    } catch (error: any) {
      setSaveState("保存エラー");
      showToast(error?.message || "議題の共有内容をデータベースに保存できませんでした");
    } finally {
      setSavingAgendaId(null);
    }
  }

  async function saveTranscript() {
    setIsTranscriptSaving(true);
    setSaveState("保存中…");
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    const bundle = createMeetingBundle("準備中");
    try {
      const { updatedAt } = await saveBundleUnified(bundle);
      setLastSavedAt(updatedAt);
      setSaveState("Neonに保存済み");
      showToast("トランスクリプトを保存しました");
    } catch (error: any) {
      setSaveState("保存エラー");
      showToast(error?.message || "トランスクリプトをデータベースに保存できませんでした");
    } finally {
      setIsTranscriptSaving(false);
    }
  }

  async function saveMinutesDraft() {
    setIsMinutesDraftSaving(true);
    setSaveState("保存中…");
    const bundle = createMeetingBundle("準備中");
    try {
      const { updatedAt } = await saveBundleUnified(bundle);
      setLastSavedAt(updatedAt);
      setSaveState("Neonに保存済み");
      showToast("議事録の下書きを保存しました");
    } catch (error: any) {
      setSaveState("保存エラー");
      showToast(error?.message || "議事録の下書きをデータベースに保存できませんでした");
    } finally {
      setIsMinutesDraftSaving(false);
    }
  }

  async function confirmMinutes() {
    setIsMinutesConfirming(true);
    setPreviewTab("minutes");
    setSaveState("保存中…");
    const bundle = createMeetingBundle("確定済み");
    try {
      const { updatedAt } = await saveBundleUnified(bundle);
      setMeetings((current) => current.map((meeting) => meeting.id === selectedMeeting.id
        ? { ...meeting, status: "確定済み" }
        : meeting));
      setLastSavedAt(updatedAt);
      setSaveState("Neonに保存済み");
      showToast("議事録を確定し、保存しました");
    } catch (error: any) {
      setSaveState("保存エラー");
      showToast(error?.message || "議事録をデータベースに保存できませんでした");
    } finally {
      setIsMinutesConfirming(false);
    }
  }

  async function saveBusinessStatus(kind: "budget" | "outsourcing" | "incomplete" | "risk") {
    setSavingBusinessStatus(kind);
    setSaveState("保存中…");
    const bundle = createMeetingBundle("準備中");
    try {
      const { updatedAt } = await saveBundleUnified(bundle);
      setLastSavedAt(updatedAt);
      setSaveState("Neonに保存済み");
      showToast(kind === "budget" ? "残り予算を保存しました" : kind === "outsourcing" ? "外注契約を保存しました" : kind === "incomplete" ? "期限超過業務を保存しました" : "業務リスク度判定を保存しました");
    } catch (error: any) {
      setSaveState("保存エラー");
      showToast(error?.message || "業務状況を保存できませんでした");
    } finally {
      setSavingBusinessStatus(null);
    }
  }

  function formatSavedTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? "未保存"
      : new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  async function loadRiskReport() {
    setIsRiskLoading(true);
    setRiskReportError("");
    try {
      setRiskReport(await getProgressRiskReportAction());
      markEditing();
    } catch (error: any) {
      setRiskReportError(error?.message || "進捗リスクを取得できませんでした。");
    } finally {
      setIsRiskLoading(false);
    }
  }

  async function loadLowBudgets() {
    setIsBudgetLoading(true);
    setBudgetError("");
    try {
      setLowBudgetItems(await getLowRemainingBudgetsAction());
      markEditing();
    } catch (error: any) {
      setBudgetError(error?.message || "残り予算を取得できませんでした。");
    } finally {
      setIsBudgetLoading(false);
    }
  }

  async function loadOverdueOutsourcing() {
    setIsOutsourcingLoading(true);
    setOutsourcingError("");
    try {
      setOverdueOutsourcingItems(await getOverdueOutsourcingContractsAction());
      markEditing();
    } catch (error: any) {
      setOutsourcingError(error?.message || "外注契約を取得できませんでした。");
    } finally {
      setIsOutsourcingLoading(false);
    }
  }

  async function loadOverdueIncomplete() {
    setIsOverdueIncompleteLoading(true);
    setOverdueIncompleteError("");
    try {
      setOverdueIncompleteItems(await getOverdueIncompleteProjectsAction());
      markEditing();
    } catch (error: any) {
      setOverdueIncompleteError(error?.message || "期限超過業務を取得できませんでした。");
    } finally {
      setIsOverdueIncompleteLoading(false);
    }
  }

  function formatRemainingBudget(value: number) {
    return `${Math.round(value / 10_000).toLocaleString("ja-JP")}万円`;
  }

  function navigateTo(sectionId: string) {
    setActiveNav(sectionId);
    document.getElementById(sectionId)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function updateAgenda(id: string, field: "detail", value: string) {
    setAgenda((current) => {
      const updated = current.map((item) => (item.id === id ? { ...item, [field]: value } : item));
      liveStateRef.current.agenda = updated;
      return updated;
    });
    markEditing();
  }

  function addAgendaItem() {
    const id = "agenda-" + Date.now();
    setAgenda((current) => [
      ...current,
      {
        id,
        department: "共有担当",
        name: "未設定",
        initials: "＋",
        detail: "共有する内容と確認したいことを入力してください",
        due: "期限を設定",
      },
    ]);
    setActiveNav("agenda");
    window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    markEditing();
    showToast("議題を追加しました");
  }

  function addNextMeeting() {
    const nextMeeting: Meeting = {
      id: "m-" + Date.now(),
      date: "",
      status: "準備中",
    };
    setMeetings((current) => [nextMeeting, ...current]);
    resetToEmptyMeeting();
    setSelectedMeetingId(nextMeeting.id);
    setRecording(false);
    setRecordingSeconds(0);
    showToast("日付未設定の会議を追加しました。会議日を選択してください");
  }

  async function deleteMeeting(meeting: Meeting) {
    const label = formatMeetingDate(meeting.date);
    if (!window.confirm(`${label}の会議を削除しますか？\nこの操作は元に戻せません。`)) return;

    setDeletingMeetingId(meeting.id);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    try {
      if (meeting.date) await deleteBundleUnified(meeting.id);

      const remaining = meetings.filter((item) => item.id !== meeting.id);
      const nextMeetings = remaining.length > 0
        ? remaining
        : [{ id: "m-" + Date.now(), date: "", status: "準備中" as const }];
      setMeetings(nextMeetings);

      if (selectedMeetingId === meeting.id) {
        resetToEmptyMeeting();
        setSelectedMeetingId(nextMeetings[0].id);
      }
      showToast(`${label}の会議を削除しました`);
    } catch (error: any) {
      setSaveState("削除エラー");
      showToast(error?.message || "会議を削除できませんでした");
    } finally {
      setDeletingMeetingId(null);
    }
  }

  function updateMeetingDate(newDate: string) {
    setMeetings((current) => current.map((meeting) => {
      if (meeting.id !== selectedMeetingId) return meeting;
      const updatedMeeting = { ...meeting, date: newDate };
      liveStateRef.current.selectedMeeting = updatedMeeting;
      return updatedMeeting;
    }));
    markEditing();
    showToast("会議の日付を更新しました");
  }

  async function generateAgendaDocument() {
    setIsGenerating(true);
    setSaveState("AIが生成中…");
    
    try {
      const payload = liveStateRef.current.agenda.map((item) => ({
        department: item.department,
        name: item.name,
        detail: item.detail,
      }));

      let meetingMaterial = "";
      let generatedSuggestions = "";

      try {
        // Try Server Action first (works in dev mode with server runtime)
        const res = await generateMeetingMaterialAction(payload);
        meetingMaterial = res.meetingMaterial;
        generatedSuggestions = res.aiSuggestions;
      } catch (e) {
        // Server Action unavailable (static hosting) – call Gemini from browser
        console.info("Server Action unavailable, calling Gemini API from client:", e);
        const res = await generateMeetingMaterialClient(payload);
        meetingMaterial = res.meetingMaterial;
        generatedSuggestions = res.aiSuggestions;
      }

      setAgendaDocument(meetingMaterial);
      setAiSuggestions(generatedSuggestions);
      setPreviewTab("material");
      liveStateRef.current.agendaDocument = meetingMaterial;
      liveStateRef.current.aiSuggestions = generatedSuggestions;

      const bundle = createMeetingBundle("準備中");
      const result = await saveBundleUnified(bundle);
      setLastSavedAt(result.updatedAt);
      setSaveState("Neonに保存済み");

      showToast("議題から会議資料とAI提案を生成し、保存しました");
    } catch (error: any) {
      console.error("生成エラー:", error);
      showToast("エラー: " + (error.message || "資料の生成に失敗しました"));
    } finally {
      setIsGenerating(false);
    }
  }

  async function generateFormattedTranscript() {
    if (!liveStateRef.current.originalTranscript.trim()) {
      showToast("原文に入力されたテキストがありません");
      return;
    }
    setIsGenerating(true);
    setSaveState("AIが整形中…");
    try {
      let formatted = "";
      try {
        formatted = await formatTranscriptAction(liveStateRef.current.originalTranscript);
      } catch (e) {
        console.info("Server Action unavailable, calling Gemini API from client:", e);
        formatted = await formatTranscriptClient(liveStateRef.current.originalTranscript);
      }

      setAiTranscript(formatted);
      setTranscriptTab("ai");
      liveStateRef.current.aiTranscript = formatted;

      const bundle = createMeetingBundle("準備中");
      const result = await saveBundleUnified(bundle);
      setLastSavedAt(result.updatedAt);
      setSaveState("Neonに保存済み");

      showToast("原文からAI整形版を生成し、保存しました");
    } catch (error: any) {
      console.error("整形エラー:", error);
      showToast("エラー: " + (error.message || "AI整形の生成に失敗しました"));
    } finally {
      setIsGenerating(false);
    }
  }

  async function regenerateMinutes() {
    setIsGenerating(true);
    setSaveState("AIが整形中…");
    
    const transcriptText = transcriptTab === "ai" ? liveStateRef.current.aiTranscript : liveStateRef.current.originalTranscript;
    const agendaLines = liveStateRef.current.agenda.map((item) => `・${item.name}の議題\n  - ${item.detail}`).join("\n");
    
    try {
      let generatedDraft = "";
      try {
        generatedDraft = await generateMinutesAction(transcriptText, agendaLines);
      } catch (e) {
        console.info("Server Action unavailable, calling Gemini API from client:", e);
        generatedDraft = await generateMinutesClient(transcriptText, agendaLines);
      }

      setAiDraft(generatedDraft);
      setFinalMinutes(generatedDraft);
      setPreviewTab("minutes");
      liveStateRef.current.aiDraft = generatedDraft;
      liveStateRef.current.finalMinutes = generatedDraft;

      const bundle = createMeetingBundle("準備中");
      const result = await saveBundleUnified(bundle);
      setLastSavedAt(result.updatedAt);
      setSaveState("Neonに保存済み");

      showToast("AIで議事録を生成し、保存しました");
    } catch (error: any) {
      console.error("生成エラー:", error);
      showToast("エラー: " + (error.message || "議事録の生成に失敗しました"));
    } finally {
      setIsGenerating(false);
    }
  }

  async function generateAiSuggestions() {
    setIsSuggestionsGenerating(true);
    try {
      const payload = agenda.map((item) => ({
        department: item.department,
        name: item.name,
        detail: item.detail,
      }));
      setAiSuggestions(await generateAiSuggestionsAction(payload));
      markEditing();
      showToast("熊本課長・大久保課長・瀬口執行役員への提案を作成しました");
    } catch (error: any) {
      showToast("エラー: " + (error?.message || "AIからの提案を作成できませんでした"));
    } finally {
      setIsSuggestionsGenerating(false);
    }
  }

  async function saveAiSuggestions() {
    setIsSuggestionsSaving(true);
    setSaveState("保存中…");
    try {
      const result = await saveMeetingBundleAction(createMeetingBundle("準備中"));
      setLastSavedAt(result.updatedAt);
      setSaveState("Neonに保存済み");
      showToast("AIからの提案を保存しました");
    } catch (error: any) {
      setSaveState("保存エラー");
      showToast(error?.message || "AIからの提案を保存できませんでした");
    } finally {
      setIsSuggestionsSaving(false);
    }
  }

  async function confirmMinutes() {
    setIsMinutesConfirming(true);
    setPreviewTab("minutes");
    setSaveState("保存中…");
    try {
      const result = await saveMeetingBundleAction(createMeetingBundle("準備中"));
      setLastSavedAt(result.updatedAt);
      setSaveState("Neonに保存済み");
      showToast("最終議事録の内容を変更せず、中央ペインへ反映しました");
    } catch (error: any) {
      setSaveState("保存エラー");
      showToast(error?.message || "議事録を確定できませんでした");
    } finally {
      setIsMinutesConfirming(false);
    }
  }

  async function copyMinutes() {
    try {
      await navigator.clipboard.writeText(finalMinutes);
      showToast("最終議事録をコピーしました");
    } catch {
      showToast("コピーできませんでした");
    }
  }


  return (
    <main className="app-shell" data-editor-collapsed={isEditorCollapsed}>
      <aside className="meeting-rail" aria-label="会議一覧">


        <div className="rail-heading">
          <span>Operations-Meeting</span>
          <button className="add-button" type="button" onClick={addNextMeeting} aria-label="会議を追加">
            ＋
          </button>
        </div>

        <div className="meeting-list">
          <p className="group-label">今後の会議</p>
          {meetings.slice(0, 2).map((meeting) => (
            <div className="meeting-card-row" key={meeting.id}>
              <button
              type="button"
              className={"meeting-card " + (meeting.id === selectedMeetingId ? "is-selected" : "")}
              onClick={() => {
                setSelectedMeetingId(meeting.id);
                setRecording(false);
                setRecordingSeconds(0);
              }}
            >
              <span className="date-badge">
                <strong>{meeting.date ? Number(meeting.date.slice(5, 7)) : "—"}</strong>
                <small>{meeting.date ? "月" : "未設定"}</small>
              </span>
              <span className="meeting-card-copy">
                <strong>{formatMeetingDate(meeting.date)}</strong>
                <em className={"status-dot " + (meeting.status === "確定済み" ? "is-done" : "")}>
                  {meeting.status === "確定済み" ? "✓ 会議資料完了" : "準備中"}
                </em>
              </span>
              </button>
              <button className="meeting-delete-button" type="button" disabled={deletingMeetingId === meeting.id} onClick={() => void deleteMeeting(meeting)} aria-label={`${formatMeetingDate(meeting.date)}の会議を削除`} title="会議を削除">
                <Trash2 aria-hidden="true" />
              </button>
            </div>
          ))}

          <p className="group-label past-label">過去の会議</p>
          {meetings.slice(2).map((meeting) => (
            <div className="meeting-card-row" key={meeting.id}>
              <button
              type="button"
              className={"meeting-card past " + (meeting.id === selectedMeetingId ? "is-selected" : "")}
              onClick={() => setSelectedMeetingId(meeting.id)}
            >
              <span className="date-badge">
                <strong>{meeting.date ? Number(meeting.date.slice(5, 7)) : "—"}</strong>
                <small>{meeting.date ? "月" : "未設定"}</small>
              </span>
              <span className="meeting-card-copy">
                <strong>{formatMeetingDate(meeting.date)}</strong>
                <em className={"status-dot " + (meeting.status === "確定済み" ? "is-done" : "")}>{meeting.status === "確定済み" ? "✓ 会議資料完了" : "準備中"}</em>
              </span>
              </button>
              <button className="meeting-delete-button" type="button" disabled={deletingMeetingId === meeting.id} onClick={() => void deleteMeeting(meeting)} aria-label={`${formatMeetingDate(meeting.date)}の会議を削除`} title="会議を削除">
                <Trash2 aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>


      </aside>

      <aside className="preview-pane" aria-label="会議内容">
        <header className="preview-header brand-header">
          <div>
            <span className="eyebrow">会議内容</span>
            <strong>{formatMeetingDate(selectedMeeting.date)}</strong>
          </div>
          <button className="icon-button" type="button" aria-label="会議内容の設定">…</button>
        </header>

        <div className="preview-tabs" role="tablist" aria-label="会議内容の表示切り替え">
          <button
            type="button"
            role="tab"
            aria-selected={previewTab === "material"}
            className={previewTab === "material" ? "is-active" : ""}
            onClick={() => setPreviewTab("material")}
          >
            <span aria-hidden="true">▤</span>
            会議資料
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={previewTab === "suggestions"}
            className={previewTab === "suggestions" ? "is-active" : ""}
            onClick={() => setPreviewTab("suggestions")}
          >
            <span aria-hidden="true">✦</span>
            AIからの提案
            {aiSuggestions.trim() && <i aria-label="提案あり" />}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={previewTab === "risk"}
            className={previewTab === "risk" ? "is-active" : ""}
            onClick={() => setPreviewTab("risk")}
          >
            <span aria-hidden="true">▣</span>
            業務状況
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={previewTab === "attendance"}
            className={previewTab === "attendance" ? "is-active" : ""}
            onClick={() => setPreviewTab("attendance")}
          >
            <span aria-hidden="true">◷</span>
            勤務状況
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={previewTab === "minutes"}
            className={previewTab === "minutes" ? "is-active" : ""}
            onClick={() => setPreviewTab("minutes")}
          >
            <span aria-hidden="true">≡</span>
            議事録
          </button>
        </div>

        <div className="preview-scroll">
          <div className={`preview-content ${isMeetingComplete ? "is-complete" : ""}`} inert={isMeetingComplete ? true : undefined}>
          {previewTab === "material" && (
            <section className="preview-tab-panel" role="tabpanel">
              <div className="preview-section-heading"><span>会議資料</span></div>
              {agendaDocument.trim() ? (
                <MeetingMaterialView markdown={agendaDocument} />
              ) : (
                <div className="preview-empty"><span className="preview-empty-icon">📋</span><span>会議資料はまだ作成されていません</span></div>
              )}
            </section>
          )}

          {previewTab === "suggestions" && (
            <section className="preview-tab-panel" role="tabpanel">
              <div className="preview-section-heading">
                <span>AIからの提案</span>
                <div className="business-action-buttons">
                  <button className="suggestions-generate-button" type="button" disabled={isSuggestionsGenerating} onClick={generateAiSuggestions}>
                    {isSuggestionsGenerating ? "作成中…" : "AIからの提案を作成"}
                  </button>
                  <button className="business-save-button" type="button" disabled={isSuggestionsSaving || !aiSuggestions.trim()} onClick={saveAiSuggestions}>
                    {isSuggestionsSaving ? "保存中…" : "保存"}
                  </button>
                </div>
              </div>
              {aiSuggestions.trim() ? (
                <AiSuggestionsView markdown={aiSuggestions} />
              ) : (
                <div className="preview-empty"><span className="preview-empty-icon">💡</span><span>提案はまだありません</span></div>
              )}
            </section>
          )}

          {previewTab === "risk" && (
            <section className="preview-tab-panel" role="tabpanel">
              <div className="business-status-section">
                <div className="preview-section-heading">
                  <div className="budget-heading-copy"><span>残り予算</span><small>50万円未満</small></div>
                  <div className="business-action-buttons">
                    <button
                      className="budget-fetch-button"
                      type="button"
                      disabled={isBudgetLoading}
                      onClick={() => { setLowBudgetItems(null); setBudgetError(""); void loadLowBudgets(); }}
                    >
                      {isBudgetLoading ? "取得中…" : "残り予算を取得"}
                    </button>
                    <button className="business-save-button" type="button" disabled={savingBusinessStatus === "budget" || !lowBudgetItems} onClick={() => saveBusinessStatus("budget")}>
                      {savingBusinessStatus === "budget" ? "保存中…" : "保存"}
                    </button>
                  </div>
                </div>
                {!lowBudgetItems && !isBudgetLoading && !budgetError && <div className="budget-ready">ボタンを押すと、最新の残り予算を取得します。</div>}
                {isBudgetLoading && <div className="budget-loading">残り予算を取得しています…</div>}
                {budgetError && (
                  <div className="budget-error"><span>{budgetError}</span><button type="button" onClick={() => { setBudgetError(""); void loadLowBudgets(); }}>再読み込み</button></div>
                )}
                {lowBudgetItems && (
                  <div className="budget-list">
                    {lowBudgetItems.length ? lowBudgetItems.map((item) => (
                      <article className="budget-item" key={item.businessNumber}>
                        <div><strong>{item.name}</strong><small>{item.businessNumber}</small></div>
                        <b className={item.remainingBudget < 0 ? "is-negative" : ""}>{formatRemainingBudget(item.remainingBudget)}</b>
                      </article>
                    )) : <div className="budget-clear">残り予算が50万円未満の業務はありません。</div>}
                  </div>
                )}
              </div>

              <hr className="preview-divider" />
              <div className="risk-action-header">
                <div><strong>外注契約</strong><span>契約工期を過ぎ、外注成果確認書の受取日が未記載の業務を表示します</span></div>
                <div className="business-action-buttons">
                  <button
                    className="risk-evaluate-button"
                    type="button"
                    disabled={isOutsourcingLoading}
                    onClick={() => { setOverdueOutsourcingItems(null); setOutsourcingError(""); void loadOverdueOutsourcing(); }}
                  >
                    {isOutsourcingLoading ? "取得中…" : "外注契約を取得"}
                  </button>
                  <button className="business-save-button" type="button" disabled={savingBusinessStatus === "outsourcing" || !overdueOutsourcingItems} onClick={() => saveBusinessStatus("outsourcing")}>
                    {savingBusinessStatus === "outsourcing" ? "保存中…" : "保存"}
                  </button>
                </div>
              </div>
              {!overdueOutsourcingItems && !isOutsourcingLoading && !outsourcingError && <div className="budget-ready">ボタンを押すと、工期超過かつ確認書未記載の外注契約を取得します。</div>}
              {isOutsourcingLoading && <div className="budget-loading">外注契約を取得しています…</div>}
              {outsourcingError && <div className="budget-error"><span>{outsourcingError}</span><button type="button" onClick={() => { setOutsourcingError(""); void loadOverdueOutsourcing(); }}>再読み込み</button></div>}
              {overdueOutsourcingItems && (
                <div className="budget-list">
                  {overdueOutsourcingItems.length ? overdueOutsourcingItems.map((item) => (
                    <article className="budget-item outsourcing-item" key={item.id}>
                      <div><strong>{item.name}</strong><small>{item.businessNumber || "業務番号未設定"}</small></div>
                      <div className="outsourcing-detail"><b>{item.vendor}</b><small>工期終了 {item.contractEndDate.replaceAll("-", "/")}</small></div>
                    </article>
                  )) : <div className="budget-clear">工期超過かつ外注成果確認書が未記載の業務はありません。</div>}
                </div>
              )}

              <hr className="preview-divider" />
              <div className="risk-action-header">
                <div><strong>完了目標日未設定</strong><span>工期または完了目標日を過ぎ、進捗が100％未満の業務を表示します</span></div>
                <div className="business-action-buttons">
                  <button className="risk-evaluate-button" type="button" disabled={isOverdueIncompleteLoading} onClick={() => { setOverdueIncompleteItems(null); setOverdueIncompleteError(""); void loadOverdueIncomplete(); }}>
                    {isOverdueIncompleteLoading ? "取得中…" : "期限超過業務を取得"}
                  </button>
                  <button className="business-save-button" type="button" disabled={savingBusinessStatus === "incomplete" || !overdueIncompleteItems} onClick={() => saveBusinessStatus("incomplete")}>
                    {savingBusinessStatus === "incomplete" ? "保存中…" : "保存"}
                  </button>
                </div>
              </div>
              {!overdueIncompleteItems && !isOverdueIncompleteLoading && !overdueIncompleteError && <div className="budget-ready">ボタンを押すと、期限超過かつ未完了の業務を取得します。</div>}
              {isOverdueIncompleteLoading && <div className="budget-loading">工程・進捗データを照合しています…</div>}
              {overdueIncompleteError && <div className="budget-error"><span>{overdueIncompleteError}</span><button type="button" onClick={() => { setOverdueIncompleteError(""); void loadOverdueIncomplete(); }}>再読み込み</button></div>}
              {overdueIncompleteItems && (
                <div className="budget-list">
                  {overdueIncompleteItems.length ? overdueIncompleteItems.map((item) => (
                    <article className="budget-item outsourcing-item" key={item.businessNumber}>
                      <div><strong>{item.name}</strong><small>{item.businessNumber}</small></div>
                      <div className="outsourcing-detail"><b>進捗 {item.actualProgress}%</b><small>期限 {item.deadline.replaceAll("-", "/")}</small></div>
                    </article>
                  )) : <div className="budget-clear">期限を過ぎて進捗100％未満の業務はありません。</div>}
                </div>
              )}

              <hr className="preview-divider" />
              <div className="risk-action-header">
                <div><strong>業務リスク度判定</strong><span>期待進捗率と実績進捗率を比較して判定します</span></div>
                <div className="business-action-buttons">
                  <button
                    className="risk-evaluate-button"
                    type="button"
                    disabled={isRiskLoading}
                    onClick={() => { setRiskReport(null); setRiskReportError(""); void loadRiskReport(); }}
                  >
                    {isRiskLoading ? "評価中…" : "リスク評価"}
                  </button>
                  <button className="business-save-button" type="button" disabled={savingBusinessStatus === "risk" || !riskReport} onClick={() => saveBusinessStatus("risk")}>
                    {savingBusinessStatus === "risk" ? "保存中…" : "保存"}
                  </button>
                </div>
              </div>

              {!riskReport && !isRiskLoading && !riskReportError && (
                <div className="risk-ready"><span aria-hidden="true">△</span><strong>リスク評価を実行してください</strong><p>最新の案件・進捗データを取得し、業務ごとの危険度を算出します。</p></div>
              )}
              {isRiskLoading && <div className="risk-loading"><span /><span /><span />進捗データを分析しています</div>}
              {riskReportError && (
                <div className="risk-error"><strong>進捗リスクを表示できません</strong><span>{riskReportError}</span><button type="button" onClick={() => { setRiskReportError(""); void loadRiskReport(); }}>再実行</button></div>
              )}
              {riskReport && <ProgressRiskView report={riskReport} />}
            </section>
          )}

          {previewTab === "attendance" && (
            <section className="preview-tab-panel" role="tabpanel" aria-label="勤務状況" />
          )}

          {previewTab === "minutes" && (
            <section className="preview-tab-panel preview-minutes-section" role="tabpanel">
              <div className="preview-section-heading"><span>議事録</span></div>
            <div className="preview-minutes-status">
              <span className={"status-badge " + (selectedMeeting.status === "確定済み" ? "is-confirmed" : "is-draft")}>
                {selectedMeeting.status === "確定済み" ? "確定済み" : "ドラフト"}
              </span>
            </div>

            {finalMinutes.trim() ? (
              <div className="preview-minutes-doc">{finalMinutes}</div>
            ) : (
              <div className="preview-empty">
                <span className="preview-empty-icon">📝</span>
                <span>議事録はまだ作成されていません</span>
              </div>
            )}

            <div className="preview-minutes-actions">
              <button className="preview-copy-button" type="button" onClick={copyMinutes}>
                コピー
              </button>
            </div>
            </section>
          )}
          </div>
        </div>
      </aside>

      <section className="editor-pane">


        <div className="editor-scroll">
          <div className={`editor-content ${isMeetingComplete ? "is-complete" : ""}`}>
            <div className="page-heading">
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <button
                  className="pane-toggle-button"
                  type="button"
                  aria-label={isEditorCollapsed ? "編集ペインを開く" : "編集ペインを閉じる"}
                  onClick={() => setIsEditorCollapsed(!isEditorCollapsed)}
                  title={isEditorCollapsed ? "編集ペインを開く" : "編集ペインを閉じる"}
                >
                  {isEditorCollapsed ? <PanelRightOpen aria-hidden="true" /> : <PanelRightClose aria-hidden="true" />}
                </button>
                <h1>会議資料作成</h1>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-secondary)", marginTop: "4px" }}>
                  <input
                    type="date"
                    disabled={isMeetingComplete}
                    value={selectedMeeting.date}
                    onChange={(e) => updateMeetingDate(e.target.value)}
                    style={{
                      background: "transparent",
                      border: "1px solid var(--border)",
                      borderRadius: "4px",
                      padding: "2px 6px",
                      color: "inherit",
                      fontFamily: "inherit",
                      fontSize: "14px",
                      outline: "none"
                    }}
                  />
                </div>
              </div>
              <div className="bundle-save-area">
                <span>{isBundleLoading ? "読込中…" : lastSavedAt ? `${isMeetingComplete ? "完了" : "保存"} ${new Date(lastSavedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : "未保存"}</span>
                {isMeetingComplete ? (
                  <>
                    <button className="bundle-complete-button" type="button" disabled>✓ 会議資料完了済み</button>
                    <button className="resume-editing-button" type="button" disabled={isResumingEditing} onClick={resumeMeetingEditing}>{isResumingEditing ? "再開中…" : "編集を再開"}</button>
                  </>
                ) : (
                  <button className="bundle-save-button" type="button" disabled={isBundleSaving || isBundleLoading} onClick={saveCurrentMeetingBundle}>
                    {isBundleSaving ? "保存中…" : "会議資料完了"}
                  </button>
                )}
              </div>
            </div>

            <section className="workspace-section" id="agenda" inert={isMeetingComplete ? true : undefined}>
              <div className="section-heading">
                <div>
                  <span className="section-index">01</span>
                  <div><h2>議題・担当者</h2><p>各担当者の共有内容を会議前に揃えます</p></div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <button className="text-button" type="button" onClick={addAgendaItem}>
                    ＋ 議題を追加
                  </button>
                  <button className="text-button" type="button" onClick={generateAgendaDocument} disabled={isGenerating}>
                    {isGenerating ? "⏳..." : "✨ AIで会議資料を生成"}
                  </button>
                </div>
              </div>

              <div className="agenda-list">
                {agenda.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "2rem 1rem", border: "1px dashed var(--border)", borderRadius: "8px", background: "var(--surface)" }}>
                    <p style={{ marginBottom: "1rem", color: "var(--text-secondary)" }}>議題・担当者が登録されていません</p>
                    <button className="primary-small-button" type="button" onClick={() => setAgenda(createDefaultEmptyAgenda())}>
                      標準担当者の入力欄を表示する
                    </button>
                  </div>
                ) : (
                  agenda.map((item) => (
                    <article className="agenda-card" key={item.id} id={item.id}>
                      <div className="agenda-owner">
                        <span className="owner-avatar">{item.initials}</span>
                        <span><small>{item.department}</small><strong>{item.name}</strong></span>
                      </div>
                      <div className="agenda-fields">
                        <textarea
                          aria-label={item.department + "の共有内容"}
                          placeholder="共有する内容と確認したいことを入力してください"
                          value={item.detail}
                          onChange={(event) => updateAgenda(item.id, "detail", event.target.value)}
                        />
                        <div className="agenda-meta"><span>提出期限　{item.due}</span><span>担当者に共有済み</span></div>
                      </div>
                      <button
                        className="save-item-button"
                        type="button"
                        disabled={savingAgendaId === item.id}
                        onClick={() => saveAgendaItem(item.id)}
                      >
                        {savingAgendaId === item.id ? "保存中…" : "保存"}
                      </button>
                    </article>
                  ))
                )}
              </div>
            </section>

            <section className="workspace-section transcript-section" id="transcript" inert={isMeetingComplete ? true : undefined}>
              <div className="section-heading">
                <div>
                  <span className="section-index">02</span>
                  <div><h2>トランスクリプト</h2><p>会議中の発言をAIが読みやすく整形します</p></div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <button className="text-button" type="button" onClick={generateFormattedTranscript} disabled={isGenerating}>
                    {isGenerating ? "⏳ 整形中..." : "↻ AIで整形版を生成"}
                  </button>
                  <span className="ai-badge">AI アシスト</span>
                </div>
              </div>

              <div className="transcript-card">
                <div className="segmented-control" role="tablist" aria-label="トランスクリプト表示">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={transcriptTab === "ai"}
                    className={transcriptTab === "ai" ? "is-active" : ""}
                    onClick={() => setTranscriptTab("ai")}
                  >
                    ✦ AI整形版
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={transcriptTab === "original"}
                    className={transcriptTab === "original" ? "is-active" : ""}
                    onClick={() => setTranscriptTab("original")}
                  >
                    原文
                  </button>
                </div>
                <div className="transcript-label">
                  <span>{transcriptTab === "ai" ? "話者と要点を整理済み" : "音声認識の原文"}</span>
                  <span>{transcriptTab === "ai" ? aiTranscript.length : originalTranscript.length}文字</span>
                </div>
                <textarea
                  className="transcript-editor"
                  aria-label="トランスクリプト"
                  value={transcriptTab === "ai" ? aiTranscript : originalTranscript}
                  onChange={(event) => {
                    const val = event.target.value;
                    if (transcriptTab === "ai") {
                      setAiTranscript(val);
                      liveStateRef.current.aiTranscript = val;
                    } else {
                      setOriginalTranscript(val);
                      liveStateRef.current.originalTranscript = val;
                    }
                    markEditing();
                  }}
                />
                <div className="card-actions">
                  <span>最終更新 {formatSavedTime(lastSavedAt)}</span>
                  <button className="primary-small-button" type="button" disabled={isTranscriptSaving} onClick={saveTranscript}>
                    {isTranscriptSaving ? "保存中…" : "保存する"}
                  </button>
                </div>
              </div>
            </section>

            <section className="workspace-section minutes-section" id="minutes" inert={isMeetingComplete ? true : undefined}>
              <div className="section-heading">
                <div>
                  <span className="section-index">03</span>
                  <div><h2>議事録作成</h2><p>トランスクリプトをもとに要約とアクションを整理します</p></div>
                </div>
                <span className="ai-badge">AI 自動生成</span>
              </div>

              <div className="minutes-workspace">
                <div className="minutes-column">
                  <div className="field-heading">
                    <span><strong>AI下書き</strong></span>
                    <button className="text-button" type="button" onClick={regenerateMinutes} disabled={isGenerating}>
                      {isGenerating ? "⏳ 生成中..." : "↻ AIで議事録を生成"}
                    </button>
                  </div>
                  <textarea
                    className="minutes-editor draft-editor"
                    aria-label="AI下書き"
                    readOnly
                    value={aiDraft}
                  />
                </div>

                <div className="flow-arrow" aria-hidden="true">→</div>

                <div className="minutes-column">
                  <div className="field-heading">
                    <span><strong>最終議事録</strong><small className="edited-badge">担当者が編集</small></span>
                    <button className="text-button" type="button" onClick={copyMinutes}>コピー</button>
                  </div>
                  <textarea
                    className="minutes-editor final-editor"
                    aria-label="最終議事録"
                    value={finalMinutes}
                    onChange={(event) => {
                      const val = event.target.value;
                      setFinalMinutes(val);
                      liveStateRef.current.finalMinutes = val;
                      markEditing();
                    }}
                  />
                </div>
              </div>

              <div className="minutes-footer">
                <p><span>✓</span> 決定事項3件・次のアクション2件を抽出しました</p>
                <div>
                  <button className="secondary-button" type="button" disabled={isMinutesDraftSaving} onClick={saveMinutesDraft}>
                    {isMinutesDraftSaving ? "保存中…" : "下書きを保存"}
                  </button>
                  <button className="primary-button" type="button" disabled={isMinutesConfirming} onClick={confirmMinutes}>
                    {isMinutesConfirming ? "確定中…" : "✓ 議事録を確定"}
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </section>

      <div className={"toast " + (toast ? "is-visible" : "")} role="status" aria-live="polite">
        <span>✓</span>{toast}
      </div>
    </main>
  );
}
