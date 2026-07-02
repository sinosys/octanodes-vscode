// OctaNodes REST API 클라이언트.
// mcp-server/src/index.ts 의 api() 헬퍼를 확장용으로 옮겨온 것.
// 인증: 개인 액세스 토큰(PAT, sk_octa_...) 을 Bearer 로 전송.

import type { Comment, CreateIssueInput, Issue, IssueStatus, Me, Operator, Project, SearchItem } from "./types";

export class ApiError extends Error {
  constructor(public status: number, public detail: string) {
    super(`OctaNodes API 오류 (${status}): ${detail}`);
    this.name = "ApiError";
  }
}

export class OctaApi {
  constructor(
    private baseUrl: string,
    private token: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await res.text();
    let json: any = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        /* 비 JSON 응답 */
      }
    }

    if (!res.ok) {
      const detail = json?.detail || json?.title || text || res.statusText;
      throw new ApiError(res.status, detail);
    }
    return json as T;
  }

  /** 토큰 유효성 확인 겸 내 정보 조회. 로그인 검증에 사용. */
  me(): Promise<Me> {
    return this.request<Me>("GET", "/auth/me");
  }

  listMyIssues(opts: { includeClosed?: boolean } = {}): Promise<Issue[]> {
    const qs = new URLSearchParams();
    if (opts.includeClosed) qs.set("include_closed", "true");
    const q = qs.toString();
    return this.request<Issue[]>("GET", `/issues/assigned/me${q ? `?${q}` : ""}`);
  }

  getIssue(id: number): Promise<Issue> {
    return this.request<Issue>("GET", `/issues/${id}`);
  }

  getComments(id: number): Promise<Comment[]> {
    return this.request<Comment[]>("GET", `/issues/${id}/comments`);
  }

  updateIssue(id: number, fields: Partial<Pick<Issue, "status" | "priority" | "assignee_id" | "title" | "description" | "due_date">>): Promise<Issue> {
    return this.request<Issue>("PATCH", `/issues/${id}`, fields);
  }

  setStatus(id: number, status: IssueStatus): Promise<Issue> {
    return this.updateIssue(id, { status });
  }

  addComment(id: number, body: string, parentId?: number): Promise<Comment> {
    return this.request<Comment>("POST", `/issues/${id}/comments`, { body, parent_id: parentId });
  }

  createIssue(input: CreateIssueInput): Promise<Issue> {
    return this.request<Issue>("POST", "/issues", {
      ...input,
      priority: input.priority ?? "medium",
    });
  }

  listProjects(): Promise<Project[]> {
    return this.request<Project[]>("GET", "/my-projects");
  }

  /** 운영사 회원 목록 — 담당자 지정 드롭다운에 사용. */
  listOperators(): Promise<Operator[]> {
    return this.request<Operator[]>("GET", "/users/operators");
  }

  /** 전사 일감 키워드 검색 (제목·#번호). */
  search(q: string, limit = 20): Promise<SearchItem[]> {
    const qs = new URLSearchParams({ q, limit: String(limit) });
    return this.request<SearchItem[]>("GET", `/issues/search?${qs.toString()}`);
  }
}
