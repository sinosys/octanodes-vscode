// 일감 상세 웹뷰 패널 — 본문·단계·댓글 표시 + 댓글/편집.
// 패널은 issueId 당 하나만 유지(reveal), 데이터는 열 때마다 재조회.
// 편집(상태·우선순위·담당자·마감일)은 네이티브 QuickPick/InputBox 로, 제목·본문은 웹뷰 인라인으로.

import * as vscode from "vscode";
import { getWebOrigin, type Session } from "./auth";
import type { Comment, Issue, IssuePriority, IssueStatus } from "./types";

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

const STATUS_CHOICES: { label: string; value: IssueStatus }[] = [
  { label: "$(circle-outline) 열림", value: "open" },
  { label: "$(sync) 진행중", value: "in_progress" },
  { label: "$(check) 확인대기 (resolved)", value: "resolved" },
  { label: "$(pass-filled) 종료 (closed)", value: "closed" },
  { label: "$(circle-slash) 반려 (rejected)", value: "rejected" },
];
const PRIORITY_CHOICES: { label: string; value: IssuePriority }[] = [
  { label: "낮음", value: "low" },
  { label: "보통", value: "medium" },
  { label: "높음", value: "high" },
  { label: "긴급", value: "urgent" },
];

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
      switch (msg?.type) {
        case "addComment":
          await this.handleAddComment(issueId, msg.body);
          break;
        case "save":
          await this.handleSave(issueId, msg.title, msg.description);
          break;
        case "editStatus":
          await this.handleEditStatus(issueId);
          break;
        case "editPriority":
          await this.handleEditPriority(issueId);
          break;
        case "editAssignee":
          await this.handleEditAssignee(issueId);
          break;
        case "editDue":
          await this.handleEditDue(issueId);
          break;
        case "openBrowser":
          await this.handleOpenBrowser(issueId);
          return; // 재렌더 불필요
        case "refresh":
          break;
        default:
          return;
      }
      await this.render(panel, issueId);
    });

    await this.render(panel, issueId);
  }

  private async withApi<T>(fn: (api: NonNullable<Awaited<ReturnType<Session["getApi"]>>>) => Promise<T>): Promise<T | undefined> {
    const api = await this.session.getApi();
    if (!api) {
      vscode.window.showWarningMessage("먼저 로그인하세요.");
      return undefined;
    }
    try {
      return await fn(api);
    } catch (e) {
      vscode.window.showErrorMessage((e as Error).message);
      return undefined;
    }
  }

  private async handleAddComment(issueId: number, body: string): Promise<void> {
    const text = (body ?? "").trim();
    if (!text) return;
    const ok = await this.withApi((api) => api.addComment(issueId, text));
    if (ok) {
      vscode.window.showInformationMessage("댓글을 추가했습니다.");
      this.onChanged();
    }
  }

  private async handleSave(issueId: number, title: string, description: string): Promise<void> {
    const t = (title ?? "").trim();
    if (!t) {
      vscode.window.showWarningMessage("제목은 비울 수 없습니다.");
      return;
    }
    const ok = await this.withApi((api) => api.updateIssue(issueId, { title: t, description: description ?? "" }));
    if (ok) {
      vscode.window.showInformationMessage("일감을 수정했습니다.");
      this.onChanged();
    }
  }

  private async handleEditStatus(issueId: number): Promise<void> {
    const pick = await vscode.window.showQuickPick(STATUS_CHOICES, { title: `#${issueId} 상태 변경` });
    if (!pick) return;
    const ok = await this.withApi((api) => api.setStatus(issueId, pick.value));
    if (ok) {
      vscode.window.showInformationMessage(`상태를 '${STATUS_LABEL[pick.value]}' 로 변경했습니다.`);
      this.onChanged();
    }
  }

  private async handleEditPriority(issueId: number): Promise<void> {
    const pick = await vscode.window.showQuickPick(PRIORITY_CHOICES, { title: `#${issueId} 우선순위 변경` });
    if (!pick) return;
    const ok = await this.withApi((api) => api.updateIssue(issueId, { priority: pick.value }));
    if (ok) {
      vscode.window.showInformationMessage(`우선순위를 '${PRIORITY_LABEL[pick.value]}' 로 변경했습니다.`);
      this.onChanged();
    }
  }

  private async handleEditAssignee(issueId: number): Promise<void> {
    const ops = await this.withApi((api) => api.listOperators());
    if (!ops) return;
    const pick = await vscode.window.showQuickPick(
      ops.map((o) => ({
        label: o.name,
        description: [o.department, o.position].filter(Boolean).join(" · "),
        value: o.id,
      })),
      { title: `#${issueId} 담당자 지정`, matchOnDescription: true },
    );
    if (!pick) return;
    const ok = await this.withApi((api) => api.updateIssue(issueId, { assignee_id: pick.value }));
    if (ok) {
      vscode.window.showInformationMessage(`담당자를 '${pick.label}' 로 지정했습니다.`);
      this.onChanged();
    }
  }

  private async handleEditDue(issueId: number): Promise<void> {
    const val = await vscode.window.showInputBox({
      title: `#${issueId} 마감일`,
      prompt: "yyyy-MM-dd 형식",
      placeHolder: "2026-07-31",
      validateInput: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? undefined : "yyyy-MM-dd 형식으로 입력하세요."),
    });
    if (!val) return;
    const ok = await this.withApi((api) => api.updateIssue(issueId, { due_date: val.trim() }));
    if (ok) {
      vscode.window.showInformationMessage(`마감일을 ${val.trim()} 로 설정했습니다.`);
      this.onChanged();
    }
  }

  private async handleOpenBrowser(issueId: number): Promise<void> {
    const me = await this.session.getMe();
    const origin = getWebOrigin();
    const url = me?.company_slug
      ? `${origin}/${me.company_slug}/issues?highlight=${issueId}`
      : `${origin}/issues?highlight=${issueId}`;
    await vscode.env.openExternal(vscode.Uri.parse(url));
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

  const rawTitle = escapeHtml(issue.title);
  const rawDesc = escapeHtml(issue.description ?? "");

  const body = `
    <div class="toolbar">
      <button class="tbtn" data-act="editStatus">상태</button>
      <button class="tbtn" data-act="editPriority">우선순위</button>
      <button class="tbtn" data-act="editAssignee">담당자</button>
      <button class="tbtn" data-act="editDue">마감일</button>
      <button class="tbtn" data-act="edit">✎ 제목·본문</button>
      <button class="tbtn" data-act="openBrowser">↗ 브라우저</button>
      <button class="tbtn" data-act="refresh">⟳ 새로고침</button>
    </div>

    <div id="view">
      <h1>#${issue.id} ${rawTitle}</h1>
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
    </div>

    <div id="edit" style="display:none">
      <h3>제목·본문 수정</h3>
      <input id="etitle" value="${rawTitle}" />
      <textarea id="edesc" rows="8">${rawDesc}</textarea>
      <div class="row">
        <button id="save">저장</button>
        <button id="cancel" class="secondary">취소</button>
      </div>
      <p class="muted">제목·본문은 작성자 본인만 수정할 수 있습니다.</p>
    </div>

    <h3>댓글 (${comments.length})</h3>
    <div class="comments">${commentHtml}</div>
    <div class="addbox">
      <textarea id="c" rows="3" placeholder="댓글 입력 (@이름#id 로 멘션)"></textarea>
      <button id="send">댓글 추가</button>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const post = (m) => vscode.postMessage(m);

      document.querySelectorAll('.tbtn').forEach((b) => {
        b.addEventListener('click', () => {
          const act = b.getAttribute('data-act');
          if (act === 'edit') { toggleEdit(true); return; }
          post({ type: act });
        });
      });

      function toggleEdit(on) {
        document.getElementById('view').style.display = on ? 'none' : '';
        document.getElementById('edit').style.display = on ? '' : 'none';
      }
      document.getElementById('cancel').addEventListener('click', () => toggleEdit(false));
      document.getElementById('save').addEventListener('click', () => {
        post({ type: 'save', title: document.getElementById('etitle').value, description: document.getElementById('edesc').value });
      });

      document.getElementById('send').addEventListener('click', () => {
        const el = document.getElementById('c');
        if (el.value.trim()) { post({ type: 'addComment', body: el.value }); el.value = ''; }
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
    .toolbar { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
    .tbtn { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 0.75rem; }
    .tbtn:hover { background: var(--vscode-button-secondaryHoverBackground); }
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
    .row { display: flex; gap: 6px; margin-top: 6px; }
    #edit input, #edit textarea, .addbox textarea { width: 100%; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; padding: 6px; font-family: inherit; margin-bottom: 6px; }
    .addbox { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 5px 14px; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    #send { align-self: flex-end; }
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
