// 토큰 관리 + API 인스턴스 제공.
// 토큰은 VSCode SecretStorage(OS 키체인)에 저장 — settings/파일에 평문 노출 안 함.

import * as vscode from "vscode";
import { OctaApi } from "./api";

const SECRET_KEY = "octanodes.token";

export function getBaseUrl(): string {
  return vscode.workspace.getConfiguration("octanodes").get<string>("baseUrl") || "https://octanodes.com/api/v1";
}

export class Session {
  private _onDidChange = new vscode.EventEmitter<void>();
  /** 로그인/로그아웃 시 발생. 트리뷰 갱신 등에 구독. */
  readonly onDidChange = this._onDidChange.event;

  constructor(private secrets: vscode.SecretStorage) {}

  async getToken(): Promise<string | undefined> {
    return this.secrets.get(SECRET_KEY);
  }

  async isLoggedIn(): Promise<boolean> {
    return !!(await this.getToken());
  }

  /** 로그인 상태면 API 인스턴스 반환, 아니면 undefined. */
  async getApi(): Promise<OctaApi | undefined> {
    const token = await this.getToken();
    if (!token) return undefined;
    return new OctaApi(getBaseUrl(), token);
  }

  /** 토큰 입력 → 검증(/auth/me) → 저장. 성공 시 사용자 이름 반환. */
  async login(): Promise<string | undefined> {
    const token = await vscode.window.showInputBox({
      title: "OctaNodes 로그인",
      prompt: "개인 액세스 토큰(PAT)을 입력하세요. OctaNodes 웹 → 내 정보 → 보안 탭에서 발급합니다.",
      placeHolder: "sk_octa_...",
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => (v.startsWith("sk_octa_") ? undefined : "sk_octa_ 로 시작하는 토큰이어야 합니다."),
    });
    if (!token) return undefined;

    // 검증
    try {
      const api = new OctaApi(getBaseUrl(), token);
      const me = await api.me();
      await this.secrets.store(SECRET_KEY, token);
      await vscode.commands.executeCommand("setContext", "octanodes.loggedIn", true);
      this._onDidChange.fire();
      return me.name;
    } catch (e) {
      vscode.window.showErrorMessage(`OctaNodes 로그인 실패: ${(e as Error).message}`);
      return undefined;
    }
  }

  async logout(): Promise<void> {
    await this.secrets.delete(SECRET_KEY);
    await vscode.commands.executeCommand("setContext", "octanodes.loggedIn", false);
    this._onDidChange.fire();
  }

  /** 확장 활성화 시 컨텍스트 키 초기화 (welcome 뷰/메뉴 노출 제어용). */
  async syncContext(): Promise<void> {
    await vscode.commands.executeCommand("setContext", "octanodes.loggedIn", await this.isLoggedIn());
  }
}
