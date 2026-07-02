// OctaNodes VSCode 확장 진입점.
// 명령 등록 + 트리뷰 + 상세 웹뷰 + 상태바 배선. AI 미사용, REST API 직접 호출.

import * as vscode from "vscode";
import { Session } from "./auth";
import { IssueDetailPanels } from "./detail";
import { StatusBar } from "./statusbar";
import { Grouping, IssueNode, IssuesProvider, StatusFilter } from "./tree";
import type { IssuePriority, IssueStatus, Project } from "./types";

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

export function activate(context: vscode.ExtensionContext) {
  const session = new Session(context.secrets);
  const tree = new IssuesProvider(session, context.globalState);
  const details = new IssueDetailPanels(session, () => tree.refresh());

  session.syncContext();

  const treeView = vscode.window.createTreeView("octanodes.issues", { treeDataProvider: tree });
  context.subscriptions.push(treeView);
  context.subscriptions.push(new StatusBar(session, tree));

  const reg = (id: string, fn: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg("octanodes.login", async () => {
    const name = await session.login();
    if (name) {
      vscode.window.showInformationMessage(`OctaNodes 에 로그인했습니다: ${name}`);
      tree.refresh();
    }
  });

  reg("octanodes.logout", async () => {
    await session.logout();
    vscode.window.showInformationMessage("OctaNodes 에서 로그아웃했습니다.");
  });

  reg("octanodes.refresh", () => tree.reload());

  reg("octanodes.openIssue", (issueId: number) => details.open(issueId));

  reg("octanodes.setFilter", async () => {
    const mark = (v: StatusFilter) => (tree.filter === v ? "$(check) " : "");
    const pick = await vscode.window.showQuickPick(
      [
        { label: `${mark("active")}미완료만 (종료 제외)`, value: "active" as StatusFilter },
        { label: `${mark("all")}전체`, value: "all" as StatusFilter },
        { label: `${mark("open")}열림`, value: "open" as StatusFilter },
        { label: `${mark("in_progress")}진행중`, value: "in_progress" as StatusFilter },
        { label: `${mark("resolved")}확인대기`, value: "resolved" as StatusFilter },
        { label: `${mark("closed")}종료`, value: "closed" as StatusFilter },
      ],
      { title: "상태 필터", placeHolder: "표시할 일감 상태" },
    );
    if (pick) {
      await tree.setFilter(pick.value);
      treeView.message = pick.value === "active" ? undefined : `필터: ${pick.label.replace("$(check) ", "")}`;
    }
  });

  reg("octanodes.setGrouping", async () => {
    const mark = (v: Grouping) => (tree.grouping === v ? "$(check) " : "");
    const pick = await vscode.window.showQuickPick(
      [
        { label: `${mark("project")}프로젝트별`, value: "project" as Grouping },
        { label: `${mark("status")}상태별`, value: "status" as Grouping },
        { label: `${mark("priority")}우선순위별`, value: "priority" as Grouping },
      ],
      { title: "그룹 기준", placeHolder: "일감을 어떻게 묶을지" },
    );
    if (pick) await tree.setGrouping(pick.value);
  });

  reg("octanodes.search", () => runSearch(session, details));

  reg("octanodes.changeStatus", async (node?: IssueNode) => {
    const issue = node?.issue;
    if (!issue) {
      vscode.window.showWarningMessage("트리에서 일감을 선택한 뒤 실행하세요.");
      return;
    }
    const api = await session.getApi();
    if (!api) {
      vscode.window.showWarningMessage("먼저 로그인하세요.");
      return;
    }
    const pick = await vscode.window.showQuickPick(STATUS_CHOICES, {
      title: `#${issue.id} 상태 변경`,
      placeHolder: `현재: ${issue.status}`,
    });
    if (!pick) return;
    try {
      await api.setStatus(issue.id, pick.value);
      vscode.window.showInformationMessage(`#${issue.id} 상태를 '${pick.value}' 로 변경했습니다.`);
      tree.reload();
    } catch (e) {
      vscode.window.showErrorMessage(`상태 변경 실패: ${(e as Error).message}`);
    }
  });

  reg("octanodes.addComment", async (node?: IssueNode) => {
    const issue = node?.issue;
    if (!issue) {
      vscode.window.showWarningMessage("트리에서 일감을 선택한 뒤 실행하세요.");
      return;
    }
    const api = await session.getApi();
    if (!api) {
      vscode.window.showWarningMessage("먼저 로그인하세요.");
      return;
    }
    const body = await vscode.window.showInputBox({
      title: `#${issue.id} 댓글 추가`,
      prompt: "댓글 내용 (@이름#id 로 멘션)",
      ignoreFocusOut: true,
    });
    if (!body || !body.trim()) return;
    try {
      await api.addComment(issue.id, body.trim());
      vscode.window.showInformationMessage("댓글을 추가했습니다.");
    } catch (e) {
      vscode.window.showErrorMessage(`댓글 추가 실패: ${(e as Error).message}`);
    }
  });

  reg("octanodes.createIssue", async () => {
    const api = await session.getApi();
    if (!api) {
      vscode.window.showWarningMessage("먼저 로그인하세요.");
      return;
    }

    let projects: Project[];
    try {
      projects = await api.listProjects();
    } catch (e) {
      vscode.window.showErrorMessage(`프로젝트 목록 조회 실패: ${(e as Error).message}`);
      return;
    }
    if (projects.length === 0) {
      vscode.window.showWarningMessage("참여 중인 프로젝트가 없습니다.");
      return;
    }

    const proj = await vscode.window.showQuickPick(
      projects.map((p) => ({ label: p.name, description: p.customer_name, value: p.id })),
      { title: "일감 등록 · 프로젝트 선택" },
    );
    if (!proj) return;

    const title = await vscode.window.showInputBox({
      title: "일감 등록 · 제목",
      prompt: "일감 제목",
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim() ? undefined : "제목을 입력하세요."),
    });
    if (!title || !title.trim()) return;

    const description = await vscode.window.showInputBox({
      title: "일감 등록 · 본문 (선택)",
      prompt: "본문 — 비워도 됩니다",
      ignoreFocusOut: true,
    });

    const pri = await vscode.window.showQuickPick(PRIORITY_CHOICES, {
      title: "일감 등록 · 우선순위",
      placeHolder: "기본 보통",
    });

    try {
      const created = await api.createIssue({
        project_id: proj.value,
        title: title.trim(),
        description: description?.trim() || undefined,
        priority: pri?.value ?? "medium",
      });
      vscode.window.showInformationMessage(`일감 #${created.id} 을 등록했습니다.`);
      tree.reload();
      details.open(created.id);
    } catch (e) {
      vscode.window.showErrorMessage(`일감 등록 실패: ${(e as Error).message}`);
    }
  });
}

/** 라이브 검색 QuickPick — 입력할 때마다 /issues/search 호출(디바운스). */
async function runSearch(session: Session, details: IssueDetailPanels): Promise<void> {
  const api = await session.getApi();
  if (!api) {
    vscode.window.showWarningMessage("먼저 로그인하세요.");
    return;
  }

  const STATUS_LABEL: Record<string, string> = {
    open: "열림", in_progress: "진행중", resolved: "확인대기", closed: "종료", rejected: "반려",
  };

  const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { issueId?: number }>();
  qp.title = "일감 검색";
  qp.placeholder = "제목 또는 #번호로 검색";
  qp.matchOnDescription = true;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;

  const doSearch = (q: string) => {
    const mySeq = ++seq;
    qp.busy = true;
    api
      .search(q)
      .then((items) => {
        if (mySeq !== seq) return; // 오래된 응답 무시
        qp.items = items.map((i) => ({
          label: `#${i.id} ${i.title}`,
          description: [i.project_name, STATUS_LABEL[i.status] || i.status].filter(Boolean).join(" · "),
          issueId: i.id,
        }));
      })
      .catch((e) => {
        if (mySeq === seq) qp.items = [{ label: `오류: ${(e as Error).message}` }];
      })
      .finally(() => {
        if (mySeq === seq) qp.busy = false;
      });
  };

  qp.onDidChangeValue((v) => {
    if (timer) clearTimeout(timer);
    const q = v.trim();
    if (!q) {
      qp.items = [];
      return;
    }
    timer = setTimeout(() => doSearch(q), 250);
  });

  qp.onDidAccept(() => {
    const sel = qp.selectedItems[0];
    if (sel?.issueId != null) {
      details.open(sel.issueId);
      qp.hide();
    }
  });

  qp.onDidHide(() => {
    if (timer) clearTimeout(timer);
    qp.dispose();
  });

  qp.show();
}

export function deactivate() {}
