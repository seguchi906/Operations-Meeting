"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type MeetingStatus = "準備中" | "資料準備中" | "確定済み";

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
  topic: string;
  detail: string;
  due: string;
};

const initialMeetings: Meeting[] = [
  { id: "m-0727", date: "2026-07-27", status: "準備中" },
  { id: "m-0720", date: "2026-07-20", status: "資料準備中" },
  { id: "m-0713", date: "2026-07-13", status: "確定済み" },
];

const initialAgenda: AgendaItem[] = [
  {
    id: "agenda-1",
    department: "技術1課",
    name: "橋本",
    initials: "橋",
    topic: "案件進捗と今週の懸念事項",
    detail: "東地区水路更新設計｜実施工程：2026年5月20日｜提出者：橋本さん",
    due: "7月24日まで",
  },
  {
    id: "agenda-2",
    department: "技術2課",
    name: "大久保",
    initials: "久",
    topic: "受注見込みとリソース調整",
    detail: "南部幹線道路予備設計｜見込み時期：2026年8月｜応援要員：1名",
    due: "7月24日まで",
  },
  {
    id: "agenda-3",
    department: "執行役員",
    name: "稲口",
    initials: "稲",
    topic: "経営会議からの共有事項",
    detail: "下期計画の重点方針｜安全パトロール｜採用進捗の共有",
    due: "7月25日まで",
  },
];

const aiTranscriptSeed =
  "橋本：東地区水路更新設計は、現地協議を終え、今週中に修正版を提出予定です。懸念していた測量データの不足は追加確認で解消しました。\n\n大久保：南部幹線道路予備設計は8月の受注見込みです。着手時期が既存案件と重なるため、技術1課から1名の応援を相談したいです。\n\n稲口：下期は品質レビューの早期化を重点方針とします。各課でチェック日を工程表に明記してください。";

const originalTranscriptSeed =
  "橋本さん：えーと東地区の水路更新ですが、現地協議は終わっています。今週中には修正版を出す予定です。測量データの不足も、追加で確認して解消しています。\n\n大久保さん：南部幹線道路は8月に受注の見込みです。ほかの案件と着手が重なりそうなので、技術1課から一人お願いできるか相談したいです。";

const minutesDraftSeed =
  "【決定事項】\n・東地区水路更新設計の修正版を7月31日までに提出する。\n・南部幹線道路予備設計には、技術1課から1名を応援配置する方向で調整する。\n・下期案件は品質チェック日を工程表へ明記する。\n\n【継続確認】\n・応援配置する担当者は、両課長が7月29日までに決定する。";

const finalMinutesSeed =
  "1. 東地区水路更新設計\n現地協議および測量データの追加確認は完了。橋本さんが修正版を7月31日までに提出する。\n\n2. 南部幹線道路予備設計\n8月の受注を想定し、技術1課から1名の応援配置を検討する。担当者は橋本課長・大久保課長が7月29日までに決定する。\n\n3. 下期の品質管理\n全案件の工程表に品質チェック日を明記し、レビューを前倒しする。";

function formatMeetingDate(isoDate: string, includeYear = false) {
  const date = new Date(isoDate + "T00:00:00+09:00");
  const formatted = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: includeYear ? "numeric" : undefined,
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
  return includeYear ? formatted : formatted.replace(/\(.+\)/, "");
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
  const [aiTranscript, setAiTranscript] = useState(aiTranscriptSeed);
  const [originalTranscript, setOriginalTranscript] = useState(originalTranscriptSeed);
  const [aiDraft, setAiDraft] = useState(minutesDraftSeed);
  const [finalMinutes, setFinalMinutes] = useState(finalMinutesSeed);
  const [saveState, setSaveState] = useState("自動保存済み");
  const [toast, setToast] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedMeeting = useMemo(
    () => meetings.find((meeting) => meeting.id === selectedMeetingId) ?? meetings[0],
    [meetings, selectedMeetingId],
  );

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

  function markEditing() {
    setSaveState("保存中…");
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => setSaveState("自動保存済み"), 700);
  }

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2600);
  }

  function navigateTo(sectionId: string) {
    setActiveNav(sectionId);
    document.getElementById(sectionId)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function updateAgenda(id: string, field: "topic" | "detail", value: string) {
    setAgenda((current) =>
      current.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    );
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
        topic: "新しい議題",
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
    const latest = meetings.reduce(
      (max, meeting) => (meeting.date > max ? meeting.date : max),
      meetings[0].date,
    );
    const date = new Date(latest + "T00:00:00+09:00");
    date.setDate(date.getDate() + 7);
    const nextIso = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
    const nextMeeting: Meeting = {
      id: "m-" + Date.now(),
      date: nextIso,
      status: "準備中",
    };
    setMeetings((current) => [nextMeeting, ...current]);
    setSelectedMeetingId(nextMeeting.id);
    setRecording(false);
    setRecordingSeconds(0);
    showToast(formatMeetingDate(nextIso) + "の会議を追加しました");
  }

  function regenerateMinutes() {
    const agendaLines = agenda.map((item) => "・" + item.topic).join("\n");
    setAiDraft(
      "【AI再生成：会議要約】\n" +
        formatMeetingDate(selectedMeeting.date, true) +
        "の定例会議では、次の議題を確認しました。\n" +
        agendaLines +
        "\n\n【次のアクション】\n・各担当者は期限までに進捗を更新する。\n・リソース調整の結果を次回会議で報告する。",
    );
    markEditing();
    showToast("トランスクリプトから再生成しました");
  }

  function confirmMinutes() {
    setMeetings((current) =>
      current.map((meeting) =>
        meeting.id === selectedMeeting.id
          ? { ...meeting, status: "確定済み" as MeetingStatus }
          : meeting,
      ),
    );
    setSaveState("確定済み");
    showToast("議事録を確定しました");
  }

  async function copyMinutes() {
    try {
      await navigator.clipboard.writeText(finalMinutes);
      showToast("最終議事録をコピーしました");
    } catch {
      showToast("コピーできませんでした");
    }
  }

  const materials = [
    { id: "agenda", label: "アジェンダ", meta: agenda.length + "件の議題", glyph: "ア" },
    { id: "materials", label: "共有資料", meta: "2ファイル", glyph: "資" },
    { id: "participants", label: "参加者メモ", meta: "3名分", glyph: "人" },
  ];

  const minutesNav = [
    { id: "transcript", label: "トランスクリプト", meta: "AI整形版", glyph: "文" },
    { id: "minutes", label: "議事録ドラフト", meta: saveState, glyph: "議" },
  ];

  return (
    <main className="app-shell">
      <aside className="meeting-rail" aria-label="会議一覧">
        <header className="brand-header">
          <div className="brand-mark" aria-hidden="true">OM</div>
          <div className="brand-copy">
            <strong>定例会議</strong>
            <span>Operations workspace</span>
          </div>
          <button className="icon-button" type="button" aria-label="サイドバーを折りたたむ">
            ‹
          </button>
        </header>

        <div className="rail-heading">
          <span>会議</span>
          <button className="add-button" type="button" onClick={addNextMeeting} aria-label="会議を追加">
            ＋
          </button>
        </div>

        <div className="meeting-list">
          <p className="group-label">今後の会議</p>
          {meetings.slice(0, 2).map((meeting) => (
            <button
              key={meeting.id}
              type="button"
              className={"meeting-card " + (meeting.id === selectedMeetingId ? "is-selected" : "")}
              onClick={() => {
                setSelectedMeetingId(meeting.id);
                setRecording(false);
                setRecordingSeconds(0);
              }}
            >
              <span className="date-badge">
                <strong>{formatMeetingDate(meeting.date).replace(/月.+/, "")}</strong>
                <small>月</small>
              </span>
              <span className="meeting-card-copy">
                <strong>{formatMeetingDate(meeting.date)}</strong>
                <small>週次オペレーション会議</small>
                <em className={"status-dot " + (meeting.status === "資料準備中" ? "is-warning" : "")}>
                  {meeting.status}
                </em>
              </span>
            </button>
          ))}

          <p className="group-label past-label">過去の会議</p>
          {meetings.slice(2).map((meeting) => (
            <button
              key={meeting.id}
              type="button"
              className={"meeting-card past " + (meeting.id === selectedMeetingId ? "is-selected" : "")}
              onClick={() => setSelectedMeetingId(meeting.id)}
            >
              <span className="date-badge">
                <strong>{formatMeetingDate(meeting.date).replace(/月.+/, "")}</strong>
                <small>月</small>
              </span>
              <span className="meeting-card-copy">
                <strong>{formatMeetingDate(meeting.date)}</strong>
                <small>週次オペレーション会議</small>
                <em className="status-dot is-done">{meeting.status}</em>
              </span>
            </button>
          ))}
        </div>

        <div className="rail-profile">
          <span className="profile-avatar">山</span>
          <span><strong>山田 管理者</strong><small>会議オーナー</small></span>
          <button className="icon-button" type="button" aria-label="設定">…</button>
        </div>
      </aside>

      <aside className="document-nav" aria-label="会議ドキュメント">
        <header className="document-header">
          <div>
            <span className="eyebrow">選択中の会議</span>
            <strong>{formatMeetingDate(selectedMeeting.date)}</strong>
          </div>
          <button className="icon-button" type="button" aria-label="会議メニュー">…</button>
        </header>

        <nav className="document-scroll">
          <div className="nav-section-heading">
            <span>会議資料</span>
            <button type="button" aria-label="資料を追加" onClick={addAgendaItem}>＋</button>
          </div>
          <div className="nav-stack">
            {materials.map((item) => (
              <button
                key={item.id}
                type="button"
                className={"document-link " + (activeNav === item.id ? "is-active" : "")}
                onClick={() => navigateTo(item.id === "materials" || item.id === "participants" ? "agenda" : item.id)}
              >
                <span className="document-glyph">{item.glyph}</span>
                <span><strong>{item.label}</strong><small>{item.meta}</small></span>
                <span className="chevron">›</span>
              </button>
            ))}
          </div>

          <div className="nav-section-heading minutes-heading">
            <span>議事録</span>
            <span className="mini-count">2</span>
          </div>
          <div className="nav-stack">
            {minutesNav.map((item) => (
              <button
                key={item.id}
                type="button"
                className={"document-link " + (activeNav === item.id ? "is-active" : "")}
                onClick={() => navigateTo(item.id)}
              >
                <span className="document-glyph">{item.glyph}</span>
                <span><strong>{item.label}</strong><small>{item.meta}</small></span>
                <span className="chevron">›</span>
              </button>
            ))}
          </div>

          <div className="progress-card">
            <div className="progress-card-title"><span>準備状況</span><strong>80%</strong></div>
            <div className="progress-track"><span /></div>
            <p>議題は揃っています。共有資料をあと1件確認してください。</p>
          </div>
        </nav>
      </aside>

      <section className="editor-pane">
        <header className="topbar">
          <div className="breadcrumbs" aria-label="パンくず">
            <span>オペレーション</span><b>›</b><span>週次会議</span><b>›</b>
            <strong>{formatMeetingDate(selectedMeeting.date)}</strong>
          </div>
          <div className="topbar-actions">
            <span className={"save-indicator " + (saveState === "保存中…" ? "is-saving" : "")}>
              <i />{saveState}
            </span>
            <button className="icon-button" type="button" aria-label="ワークスペース設定">⚙</button>
          </div>
        </header>

        <div className="editor-scroll">
          <div className="editor-content">
            <div className="page-heading">
              <div>
                <div className="page-kicker">WEEKLY OPERATIONS</div>
                <h1>会議資料作成</h1>
                <p>{formatMeetingDate(selectedMeeting.date, true)}・第4会議室 / Teams</p>
              </div>
              <button
                className={"record-button " + (recording ? "is-recording" : "")}
                type="button"
                onClick={() => setRecording((current) => !current)}
              >
                <span className="record-dot" />
                {recording ? "記録中 " + formatTimer(recordingSeconds) : "会議を開始"}
              </button>
            </div>

            <section className="workspace-section" id="agenda">
              <div className="section-heading">
                <div>
                  <span className="section-index">01</span>
                  <div><h2>議題・担当者</h2><p>各担当者の共有内容を会議前に揃えます</p></div>
                </div>
                <button className="secondary-button" type="button" onClick={addAgendaItem}>＋ 議題を追加</button>
              </div>

              <div className="agenda-list">
                {agenda.map((item) => (
                  <article className="agenda-card" key={item.id} id={item.id}>
                    <div className="agenda-owner">
                      <span className="owner-avatar">{item.initials}</span>
                      <span><small>{item.department}</small><strong>{item.name}</strong></span>
                    </div>
                    <div className="agenda-fields">
                      <input
                        aria-label={item.department + "の議題"}
                        value={item.topic}
                        onChange={(event) => updateAgenda(item.id, "topic", event.target.value)}
                      />
                      <textarea
                        aria-label={item.department + "の共有内容"}
                        value={item.detail}
                        onChange={(event) => updateAgenda(item.id, "detail", event.target.value)}
                      />
                      <div className="agenda-meta"><span>提出期限　{item.due}</span><span>担当者に共有済み</span></div>
                    </div>
                    <button
                      className="save-item-button"
                      type="button"
                      onClick={() => showToast(item.department + "の議題を保存しました")}
                    >
                      保存
                    </button>
                  </article>
                ))}
              </div>
            </section>

            <section className="workspace-section transcript-section" id="transcript">
              <div className="section-heading">
                <div>
                  <span className="section-index">02</span>
                  <div><h2>トランスクリプト</h2><p>会議中の発言をAIが読みやすく整形します</p></div>
                </div>
                <span className="ai-badge">AI アシスト</span>
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
                    transcriptTab === "ai"
                      ? setAiTranscript(event.target.value)
                      : setOriginalTranscript(event.target.value);
                    markEditing();
                  }}
                />
                <div className="card-actions">
                  <span>最終更新 14:28</span>
                  <button className="primary-small-button" type="button" onClick={() => showToast("トランスクリプトを保存しました")}>
                    保存する
                  </button>
                </div>
              </div>
            </section>

            <section className="workspace-section minutes-section" id="minutes">
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
                    <span><strong>AI下書き</strong><small>内容は自由に修正できます</small></span>
                    <button className="text-button" type="button" onClick={regenerateMinutes}>↻ AIで再生成</button>
                  </div>
                  <textarea
                    className="minutes-editor draft-editor"
                    aria-label="AI下書き"
                    value={aiDraft}
                    onChange={(event) => {
                      setAiDraft(event.target.value);
                      markEditing();
                    }}
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
                      setFinalMinutes(event.target.value);
                      markEditing();
                    }}
                  />
                </div>
              </div>

              <div className="minutes-footer">
                <p><span>✓</span> 決定事項3件・次のアクション2件を抽出しました</p>
                <div>
                  <button className="secondary-button" type="button" onClick={() => showToast("下書きを保存しました")}>
                    下書きを保存
                  </button>
                  <button className="primary-button" type="button" onClick={confirmMinutes}>
                    ✓ 議事録を確定
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
