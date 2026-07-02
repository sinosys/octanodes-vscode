// 상태바 아이템 + 자동 새로고침(폴링) + 변경 감지 토스트.
// 폴링 주기: 설정 octanodes.refreshInterval(초, 0=끔).

import * as vscode from "vscode";
import type { Session } from "./auth";
import type { IssuesProvider } from "./tree";
import type { Issue } from "./types";

function isActive(i: Issue): boolean {
  return i.status !== "closed" && i.status !== "rejected";
}

export class StatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private timer: ReturnType<typeof setInterval> | undefined;
  private snapshot: Map<number, string> | null = null;
  private disposables: vscode.Disposable[] = [];

  constructor(private session: Session, private provider: IssuesProvider) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = "workbench.view.extension.octanodes";
    this.disposables.push(this.item);

    // 트리 변경(수동 새로고침 등) 시 카운트 즉시 반영.
    this.disposables.push(provider.onDidChangeTreeData(() => void this.render()));

    // 로그인/로그아웃 시 즉시 재조회(스냅샷 리셋 후 시드).
    this.disposables.push(
      session.onDidChange(() => {
        this.snapshot = null;
        void this.tick();
      }),
    );

    // 폴링 주기 설정이 바뀌면 타이머 재설정.
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("octanodes.refreshInterval")) this.restart();
      }),
    );

    this.restart();
  }

  private intervalMs(): number {
    const sec = vscode.workspace.getConfiguration("octanodes").get<number>("refreshInterval", 120);
    return sec > 0 ? sec * 1000 : 0;
  }

  private restart(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    void this.tick(); // 즉시 1회 (스냅샷 시드)
    const ms = this.intervalMs();
    if (ms > 0) this.timer = setInterval(() => void this.tick(), ms);
  }

  /** 폴링 1회: 재조회 → 변경 감지 → 스냅샷 갱신. */
  private async tick(): Promise<void> {
    if (!(await this.session.isLoggedIn())) {
      this.snapshot = null;
      this.item.hide();
      return;
    }
    const issues = await this.provider.reload();
    if (this.snapshot) this.notifyChanges(this.snapshot, issues);
    this.snapshot = new Map(issues.map((i) => [i.id, i.status]));
    // render 는 reload → onDidChangeTreeData 경유로 호출됨.
  }

  /** 네트워크 없이 현재 목록으로 상태바 텍스트만 갱신. */
  private async render(): Promise<void> {
    if (!(await this.session.isLoggedIn())) {
      this.item.hide();
      return;
    }
    const active = this.provider.issues.filter(isActive).length;
    this.item.text = `$(checklist) ${active}`;
    this.item.tooltip = `OctaNodes 미완료 일감 ${active}건 · 클릭하여 열기`;
    this.item.show();
  }

  private notifyChanges(prev: Map<number, string>, cur: Issue[]): void {
    const added = cur.filter((i) => !prev.has(i.id) && isActive(i));
    const changed = cur.filter((i) => prev.has(i.id) && prev.get(i.id) !== i.status);

    if (added.length === 1) {
      const i = added[0];
      vscode.window.showInformationMessage(`새 일감: #${i.id} ${i.title}`, "열기").then((a) => {
        if (a) vscode.commands.executeCommand("octanodes.openIssue", i.id);
      });
    } else if (added.length > 1) {
      vscode.window.showInformationMessage(`새 일감 ${added.length}건이 할당되었습니다.`);
    }

    if (changed.length === 1) {
      const i = changed[0];
      vscode.window.showInformationMessage(`#${i.id} 상태가 변경되었습니다: ${i.title}`, "열기").then((a) => {
        if (a) vscode.commands.executeCommand("octanodes.openIssue", i.id);
      });
    } else if (changed.length > 1) {
      vscode.window.showInformationMessage(`일감 ${changed.length}건의 상태가 변경되었습니다.`);
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.disposables.forEach((d) => d.dispose());
  }
}
