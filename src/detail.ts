// 일감 상세 웹뷰 패널 — 본문·단계·댓글 표시 + 댓글 추가.
// 패널은 issueId 당 하나만 유지(reveal), 데이터는 열 때마다 재조회.

import * as vscode from "vscode";
import type { Session } from "./auth";
import type { Comment, Issue } from "./types";

const STATUS_LABEL: Record<string, string> = {
  open: "열림",
  in_progress: "진행중",
  resolved: "확인대기",
  closed: "종료",
  rejected: "반려",
};
const PRIORITY_LABEL: Record<string, string> = {
  low: "낮음",
  medium: "보통",
  high: "높음",
  urgent: "긴급",
};

export class IssueDetailPanels {
  private panels = new Map<number, vscode.WebviewPanel>();

  constructor(private session: Session, private onChanged: () => void) {}

  async open(issueId: number): Promise<void> {
    const existing = this.panels.get(issueId);
    if (existing) {
      existing.reveal();
      await this.render(existing, issueId);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "octanodes.issueDetail",
      `일감 #${issueId}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panels.set(issueId, panel);
    panel.onDidDispose(() => this.panels.delete(issueId));

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg?.type === "addComment") {
        await this.handleAddComment(issueId, msg.body);
        await this.render(panel, issueId);
      } else if (msg?.type === "refresh") {
        await this.render(panel, issueId);
      }
    });

    await this.render(panel, issueId);
  }

  private async handleAddComment(issueId: number, body: string): Promise<void> {
    const text = (body ?? "").trim();
    if (!text) return;
    const api = await this.session.getApi();
    if (!api) return;
    try {
      await api.addComment(issueId, text);
      vscode.window.showInformationMessage("댓글을 추가했습니다.");
      this.onChanged();
    } catch (e) {
      vscode.window.showErrorMessage(`댓글 추가 실패: ${(e as Error).message}`);
    }
  }

  private async render(panel: vscode.WebviewPanel, issueId: number): Promise<void> {
    const api = await this.session.getApi();
    if (!api) {
      panel.webview.html = wrap(`<p>로그인이 필요합니다.</p>`);
      return;
    }
    try {
      const issue = await api.getIssue(issueId);
      let comments: Comment[] = [];
      try {
        comments = await api.getComments(issueId);
      } catch {
        /* 댓글 조회 실패는 무시 */
      }
      panel.title = `#${issue.id} ${issue.title}`;
      panel.webview.html = renderIssue(issue, comments);
    } catch (e) {
      panel.webview.html = wrap(`<p class="err">불러오기 실패: ${escapeHtml((e as Error).message)}</p>`);
    }
  }
}

function renderIssue(issue: Issue, comments: Comment[]): string {
  const nonce = makeNonce();
  const steps = (issue.steps ?? [])
    .map((s) => {
      const label = escapeHtml(s.step_label || s.step_code || "");
      const who = s.assignee_name ? ` · ${escapeHtml(s.assignee_name)}` : "";
      const st = STATUS_LABEL[s.status || ""] || s.status || "";
      return `<span class="step">${label} <em>${escapeHtml(st)}${who}</em></span>`;
    })
    .join("");

  const commentHtml =
    comments.length === 0
      ? `<p class="muted">댓글 없음</p>`
      : comments
          .map(
            (c) => `
      <div class="comment${c.parent_id ? " reply" : ""}">
        <div class="chead"><b>${escapeHtml(c.user_name ?? "?")}</b> <span class="muted">${escapeHtml(c.created_at ?? "")}</span></div>
        <div class="cbody">${escapeHtml(c.body ?? "").replace(/\n/g, "<br>")}</div>
      </div>`,
          )
          .join("");

  const body = `
    <h1>#${issue.id} ${escapeHtml(issue.title)}</h1>
    <div class="meta">
      <span class="badge">${escapeHtml(STATUS_LABEL[issue.status] || issue.status)}</span>
      <span class="badge pri-${escapeHtml(issue.priority)}">${escapeHtml(PRIORITY_LABEL[issue.priority] || issue.priority)}</span>
      <span>${escapeHtml(issue.project_name ?? "")}</span>
      <span class="muted">담당 ${escapeHtml(issue.assignee_name ?? "-")} · 요청 ${escapeHtml(issue.reporter_name ?? "-")}</span>
      ${issue.due_date ? `<span class="muted">마감 ${escapeHtml(issue.due_date)}</span>` : ""}
    </div>
    ${steps ? `<div class="steps">${steps}</div>` : ""}
    <h3>본문</h3>
    <div class="desc">${issue.description ? issue.description : '<span class="muted">(내용 없음)</span>'}</div>
    <h3>댓글 (${comments.length})</h3>
    <div class="comments">${commentHtml}</div>
    <div class="addbox">
      <textarea id="c" rows="3" placeholder="댓글 입력 (@이름#id 로 멘션)"></textarea>
      <button id="send">댓글 추가</button>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      document.getElementById('send').addEventListener('click', () => {
        const el = document.getElementById('c');
        const body = el.value;
        if (body.trim()) { vscode.postMessage({ type: 'addComment', body }); el.value = ''; }
      });
    </script>`;
  return wrap(body, nonce);
}

function wrap(inner: string, nonce?: string): string {
  // description 이 리치 HTML 이라 태그는 렌더하되, script/inline handler 는 nonce CSP 로 차단.
  const scriptSrc = nonce ? `'nonce-${nonce}'` : "'none'";
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src ${scriptSrc};">
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px 18px; font-size: 13px; }
    h1 { font-size: 1.25rem; margin: 0 0 8px; }
    h3 { margin: 18px 0 6px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; }
    .muted { color: var(--vscode-descriptionForeground); }
    .err { color: var(--vscode-errorForeground); }
    .badge { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 4px; padding: 1px 8px; font-size: 0.75rem; }
    .pri-high, .pri-urgent { background: var(--vscode-inputValidation-warningBackground); }
    .steps { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; }
    .step { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 2px 8px; font-size: 0.75rem; }
    .step em { color: var(--vscode-descriptionForeground); font-style: normal; }
    .desc { white-space: pre-wrap; line-height: 1.5; }
    .comment { border-left: 3px solid var(--vscode-panel-border); padding: 4px 10px; margin: 8px 0; }
    .comment.reply { margin-left: 24px; }
    .chead { font-size: 0.8rem; margin-bottom: 2px; }
    .cbody { line-height: 1.5; }
    .addbox { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
    textarea { width: 100%; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; padding: 6px; font-family: inherit; }
    button { align-self: flex-end; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 5px 14px; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
  </style></head><body>${inner}</body></html>`;
}

function makeNonce(): string {
  let s = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 24; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
