// "내 일감" 트리뷰 — 프로젝트별 그룹 → 일감.
// 상태 필터(전체/open/in_progress/resolved/closed) 지원.

import * as vscode from "vscode";
import type { Session } from "./auth";
import type { Issue, IssueStatus } from "./types";

export type StatusFilter = "all" | IssueStatus;

const STATUS_ICON: Record<string, string> = {
  open: "circle-outline",
  in_progress: "sync",
  resolved: "check",
  closed: "pass-filled",
  rejected: "circle-slash",
};

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

class ProjectNode extends vscode.TreeItem {
  constructor(public readonly projectName: string, count: number) {
    super(projectName, vscode.TreeItemCollapsibleState.Expanded);
    this.description = `${count}`;
    this.iconPath = new vscode.ThemeIcon("folder");
    this.contextValue = "project";
  }
}

export class IssueNode extends vscode.TreeItem {
  constructor(public readonly issue: Issue) {
    super(issue.title, vscode.TreeItemCollapsibleState.None);
    const status = issue.status;
    this.iconPath = new vscode.ThemeIcon(STATUS_ICON[status] || "circle-outline");
    const bits = [`#${issue.id}`, STATUS_LABEL[status] || status];
    if (issue.priority && issue.priority !== "medium") bits.push(PRIORITY_LABEL[issue.priority] || issue.priority);
    if (issue.comment_count) bits.push(`💬${issue.comment_count}`);
    this.description = bits.join(" · ");
    this.tooltip = new vscode.MarkdownString(
      `**#${issue.id} ${issue.title}**\n\n` +
        `- 프로젝트: ${issue.project_name ?? "-"}\n` +
        `- 상태: ${STATUS_LABEL[status] || status}\n` +
        `- 우선순위: ${PRIORITY_LABEL[issue.priority] || issue.priority}\n` +
        `- 담당자: ${issue.assignee_name ?? "-"}\n` +
        (issue.due_date ? `- 마감: ${issue.due_date}\n` : ""),
    );
    this.contextValue = "issue";
    this.command = {
      command: "octanodes.openIssue",
      title: "상세 열기",
      arguments: [issue.id],
    };
  }
}

type Node = ProjectNode | IssueNode;

export class IssuesProvider implements vscode.TreeDataProvider<Node> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private issues: Issue[] = [];
  private loaded = false;
  private error: string | undefined;
  filter: StatusFilter = "all";

  constructor(private session: Session) {
    session.onDidChange(() => {
      this.loaded = false;
      this.refresh();
    });
  }

  refresh(): void {
    this.loaded = false;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(el: Node): vscode.TreeItem {
    return el;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.error = undefined;
    const api = await this.session.getApi();
    if (!api) {
      this.issues = [];
      this.loaded = true;
      return;
    }
    try {
      // 필터에 closed/resolved 가 포함될 수 있으니 항상 완료 포함으로 받아 클라이언트에서 필터.
      this.issues = await api.listMyIssues({ includeClosed: true });
    } catch (e) {
      this.error = (e as Error).message;
      this.issues = [];
    }
    this.loaded = true;
  }

  private filtered(): Issue[] {
    if (this.filter === "all") return this.issues;
    return this.issues.filter((i) => i.status === this.filter);
  }

  async getChildren(el?: Node): Promise<Node[]> {
    if (!el) {
      await this.ensureLoaded();
      if (this.error) {
        const item = new vscode.TreeItem(`오류: ${this.error}`, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("error");
        return [item as Node];
      }
      // 프로젝트별 그룹
      const list = this.filtered();
      const groups = new Map<string, Issue[]>();
      for (const i of list) {
        const key = i.project_name ?? "(프로젝트 미지정)";
        let arr = groups.get(key);
        if (!arr) {
          arr = [];
          groups.set(key, arr);
        }
        arr.push(i);
      }
      const projectNodes = [...groups.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], "ko"))
        .map(([name, items]) => new ProjectNode(name, items.length));
      return projectNodes;
    }
    if (el instanceof ProjectNode) {
      return this.filtered()
        .filter((i) => (i.project_name ?? "(프로젝트 미지정)") === el.projectName)
        .sort((a, b) => b.id - a.id)
        .map((i) => new IssueNode(i));
    }
    return [];
  }
}
