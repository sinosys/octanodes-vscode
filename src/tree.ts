// "내 일감" 트리뷰 — 그룹(프로젝트/상태/우선순위) → 일감.
// 상태 필터(전체/미완료/open/…) + 그룹 기준을 globalState 에 영속화.

import * as vscode from "vscode";
import type { Session } from "./auth";
import type { Issue, IssueStatus } from "./types";

// "active" = 미완료만 (종료·반려 제외)
export type StatusFilter = "all" | "active" | IssueStatus;
export type Grouping = "project" | "status" | "priority";

const FILTER_KEY = "octanodes.filter";
const GROUPING_KEY = "octanodes.grouping";

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

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const STATUS_ORDER: Record<string, number> = { open: 0, in_progress: 1, resolved: 2, rejected: 3, closed: 4 };

class GroupNode extends vscode.TreeItem {
  constructor(public readonly key: string, label: string, count: number, icon: string) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.description = `${count}`;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = "group";
  }
}

export class IssueNode extends vscode.TreeItem {
  constructor(public readonly issue: Issue) {
    super(`#${issue.id} ${issue.title}`, vscode.TreeItemCollapsibleState.None);
    const status = issue.status;
    this.iconPath = new vscode.ThemeIcon(STATUS_ICON[status] || "circle-outline");
    const bits = [STATUS_LABEL[status] || status];
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

type Node = GroupNode | IssueNode;

interface GroupMeta {
  key: string;
  label: string;
  icon: string;
  order: number;
}

export class IssuesProvider implements vscode.TreeDataProvider<Node> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _issues: Issue[] = [];
  private loaded = false;
  private error: string | undefined;
  filter: StatusFilter;
  grouping: Grouping;

  constructor(private session: Session, private state: vscode.Memento) {
    this.filter = state.get<StatusFilter>(FILTER_KEY, "active");
    this.grouping = state.get<Grouping>(GROUPING_KEY, "project");
    session.onDidChange(() => {
      this.loaded = false;
      this.refresh();
    });
  }

  /** 현재 로드된 일감(필터 적용 전). 상태바 카운트용. */
  get issues(): Issue[] {
    return this._issues;
  }

  async setFilter(v: StatusFilter): Promise<void> {
    this.filter = v;
    await this.state.update(FILTER_KEY, v);
    this._onDidChangeTreeData.fire();
  }

  async setGrouping(v: Grouping): Promise<void> {
    this.grouping = v;
    await this.state.update(GROUPING_KEY, v);
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    this.loaded = false;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(el: Node): vscode.TreeItem {
    return el;
  }

  private async fetch(): Promise<void> {
    const api = await this.session.getApi();
    if (!api) {
      this._issues = [];
      this.error = undefined;
      this.loaded = true;
      return;
    }
    try {
      // 필터에 closed/resolved 가 포함될 수 있으니 항상 완료 포함으로 받아 클라이언트에서 필터.
      this._issues = await api.listMyIssues({ includeClosed: true });
      this.error = undefined;
    } catch (e) {
      this.error = (e as Error).message;
      // 기존 목록은 유지 — 일시적 오류로 화면이 비지 않도록.
    }
    this.loaded = true;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await this.fetch();
  }

  /** 강제 재조회 후 트리 갱신. 상태바 폴링에서 호출하고 최신 목록을 돌려받는다. */
  async reload(): Promise<Issue[]> {
    await this.fetch();
    this._onDidChangeTreeData.fire();
    return this._issues;
  }

  private filtered(): Issue[] {
    if (this.filter === "all") return this._issues;
    if (this.filter === "active") {
      return this._issues.filter((i) => i.status !== "closed" && i.status !== "rejected");
    }
    return this._issues.filter((i) => i.status === this.filter);
  }

  private groupOf(i: Issue): GroupMeta {
    if (this.grouping === "status") {
      const s = i.status;
      return { key: s, label: STATUS_LABEL[s] || s, icon: STATUS_ICON[s] || "circle-outline", order: STATUS_ORDER[s] ?? 9 };
    }
    if (this.grouping === "priority") {
      const p = i.priority || "medium";
      return { key: p, label: PRIORITY_LABEL[p] || p, icon: "flame", order: PRIORITY_ORDER[p] ?? 9 };
    }
    const name = i.project_name ?? "(프로젝트 미지정)";
    return { key: name, label: name, icon: "folder", order: 0 };
  }

  async getChildren(el?: Node): Promise<Node[]> {
    if (!el) {
      await this.ensureLoaded();
      if (this.error) {
        const item = new vscode.TreeItem(`오류: ${this.error}`, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("error");
        return [item as Node];
      }
      const list = this.filtered();
      const groups = new Map<string, { meta: GroupMeta; items: Issue[] }>();
      for (const i of list) {
        const meta = this.groupOf(i);
        let g = groups.get(meta.key);
        if (!g) {
          g = { meta, items: [] };
          groups.set(meta.key, g);
        }
        g.items.push(i);
      }
      return [...groups.values()]
        .sort((a, b) => a.meta.order - b.meta.order || a.meta.label.localeCompare(b.meta.label, "ko"))
        .map((g) => new GroupNode(g.meta.key, g.meta.label, g.items.length, g.meta.icon));
    }
    if (el instanceof GroupNode) {
      return this.filtered()
        .filter((i) => this.groupOf(i).key === el.key)
        .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) || b.id - a.id)
        .map((i) => new IssueNode(i));
    }
    return [];
  }
}
