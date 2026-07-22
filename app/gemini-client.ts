"use client";

import { GoogleGenAI } from "@google/genai";

// Prompt templates are imported as raw strings via Vite's ?raw suffix
import meetingMaterialPromptTemplate from "../prompts/meeting-material.md?raw";
import minutesPromptTemplate from "../prompts/minutes.md?raw";
import formatTranscriptPromptTemplate from "../prompts/format-transcript.md?raw";
import ritaGuidance from "../prompts/rita-guidance.md?raw";

function fillPrompt(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (prompt, [key, value]) => prompt.replaceAll(`{{${key}}}`, value),
    template,
  );
}

function getApiKey(): string | undefined {
  // Vite exposes VITE_ prefixed env vars to client-side code
  return (
    (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_GEMINI_API_KEY) ||
    undefined
  );
}

// ---------------------------------------------------------------------------
// Meeting Material
// ---------------------------------------------------------------------------

function buildFallbackMeetingMaterial(agendaItems: { department: string; name: string; detail: string }[]) {
  const sections: string[] = [];

  for (const item of agendaItems) {
    if (item.detail.trim()) {
      sections.push(`■ ${item.department}（${item.name}）\n${item.detail.trim()}`);
    }
  }

  const meetingMaterial = sections.length > 0
    ? `【運営会議 資料】\n\n${sections.join("\n\n")}`
    : "【運営会議 資料】\n\n（議題の共有内容が入力されていません）";

  const aiSuggestions = agendaItems
    .filter((item) => item.detail.trim())
    .map((item) => `・${item.name}（${item.department}）: 共有内容の進捗確認および次のアクションプラン策定を推奨します。`)
    .join("\n") || "（AI提案を生成するには議題の共有内容を入力してください）";

  return { meetingMaterial, aiSuggestions };
}

export async function generateMeetingMaterialClient(
  agendaItems: { department: string; name: string; detail: string }[]
): Promise<{ meetingMaterial: string; aiSuggestions: string }> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn("VITE_GEMINI_API_KEY is not set – using fallback meeting material generator");
    return buildFallbackMeetingMaterial(agendaItems);
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = fillPrompt(meetingMaterialPromptTemplate, {
    AGENDA_ITEMS_JSON: JSON.stringify(agendaItems, null, 2),
    RITA_GUIDANCE: ritaGuidance,
  });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });

    const text = response.text || "{}";
    const parsed = JSON.parse(text);

    return {
      meetingMaterial: parsed.meetingMaterial || buildFallbackMeetingMaterial(agendaItems).meetingMaterial,
      aiSuggestions: parsed.aiSuggestions || buildFallbackMeetingMaterial(agendaItems).aiSuggestions,
    };
  } catch (error: any) {
    console.error("Gemini API Error (client generateMeetingMaterial):", error);
    return buildFallbackMeetingMaterial(agendaItems);
  }
}

// ---------------------------------------------------------------------------
// Minutes
// ---------------------------------------------------------------------------

export async function generateMinutesClient(transcript: string, agenda: string): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn("VITE_GEMINI_API_KEY is not set – using fallback minutes generator");
    return buildFallbackMinutes(transcript, agenda);
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = fillPrompt(minutesPromptTemplate, {
    AGENDA: agenda || "なし",
    TRANSCRIPT: transcript || "なし",
  });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    if (response.text) return response.text;
  } catch (error: any) {
    console.error("Gemini API Error (client generateMinutes):", error);
  }

  return buildFallbackMinutes(transcript, agenda);
}

function buildFallbackMinutes(transcript: string, agenda: string): string {
  const dateStr = new Date().toLocaleDateString("ja-JP");
  return `【運営会議 議事録】（${dateStr}）

■ 議題・報告事項
${agenda || "・特記事項なし"}

■ 会議での主な発言・協議内容
${transcript || "・発言の記録なし"}

■ 決定事項・今後のアクション
・議題の内容に基づき、各担当者が業務を推進する。
・次回会議にて進捗を報告する。`;
}

// ---------------------------------------------------------------------------
// Transcript Formatting
// ---------------------------------------------------------------------------

export async function formatTranscriptClient(originalTranscript: string): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn("VITE_GEMINI_API_KEY is not set – using fallback transcript formatter");
    return buildFallbackTranscript(originalTranscript);
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = fillPrompt(formatTranscriptPromptTemplate, {
    ORIGINAL_TRANSCRIPT: originalTranscript || "なし",
  });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    if (response.text) return response.text;
  } catch (error: any) {
    console.error("Gemini API Error (client formatTranscript):", error);
  }

  return buildFallbackTranscript(originalTranscript);
}

function buildFallbackTranscript(originalTranscript: string): string {
  const lines = originalTranscript.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return "（発言内容なし）";
  return lines.map((line, idx) => `・[発言 ${idx + 1}] ${line.trim()}`).join("\n");
}
