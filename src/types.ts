// OctaNodes REST API 응답 타입 (필요한 필드만).
// 백엔드 직렬화는 snake_case + null 필드 제거.

export type IssueStatus = "open" | "in_progress" | "resolved" | "closed" | "rejected";
export type IssuePriority = "low" | "medium" | "high" | "urgent";

export interface IssueStep {
  step_label?: string;
  step_code?: string;
  status?: string;
  assignee_name?: string;
}

export interface Issue {
  id: number;
  title: string;
  status: IssueStatus;
  priority: IssuePriority;
  project_id?: number;
  project_name?: string;
  assignee_name?: string;
  assignee_id?: number;
  reporter_name?: string;
  due_date?: string;
  comment_count?: number;
  attachment_count?: number;
  description?: string;
  created_at?: string;
  updated_at?: string;
  steps?: IssueStep[];
}

export interface Comment {
  id: number;
  user_name?: string;
  body: string;
  created_at?: string;
  parent_id?: number;
}

export interface Project {
  id: number;
  name: string;
  status?: string;
  customer_name?: string;
}

export interface Me {
  id: number;
  name: string;
  email?: string;
  company_id?: number;
  company_slug?: string;
  is_operator?: boolean;
  role?: string;
}

export interface Operator {
  id: number;
  name: string;
  position?: string;
  department?: string;
}

export interface SearchItem {
  id: number;
  title: string;
  project_name?: string;
  status: IssueStatus;
}

export interface CreateIssueInput {
  project_id: number;
  title: string;
  description?: string;
  priority?: IssuePriority;
  assignee_id?: number;
  due_date?: string;
}
