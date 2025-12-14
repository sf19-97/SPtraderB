const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface GithubFileResponse {
  path: string;
  branch: string;
  sha: string;
  content: string;
}

export interface GithubSaveRequest {
  repo: string;
  path: string;
  branch: string;
  content: string;
  sha?: string;
  message?: string;
  create_pr?: boolean;
  base_branch?: string;
  pr_title?: string;
  file_type?: 'indicator' | 'signal' | 'strategy';
}

export interface GithubSaveResponse {
  path: string;
  branch: string;
  sha: string;
  commit_sha: string;
  html_url?: string | null;
  pr_url?: string | null;
}

export interface GithubTreeParams {
  repo: string;
  branch?: string;
  path?: string;
}

export interface AppRepo {
  id: string;
  name: string;
  full_name: string;
  default_branch: string;
  root_path: string;
}

export interface BootstrapRequest {
  repo: string;
  branch?: string;
  root_path?: string;
  include_indicator?: boolean;
  include_signal?: boolean;
  include_strategy?: boolean;
}

export interface FileNode {
  name: string;
  path: string;
  type: string;
  children?: FileNode[];
}

async function apiFetch<T>(
  token: string,
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    let message = text || `HTTP ${response.status}`;

    try {
      const parsed = JSON.parse(text);
      if (parsed?.error) {
        message = parsed.error;
      }
    } catch {
      // Ignore parse errors and use raw text
    }

    const error: Error & { status?: number } = new Error(message);
    error.status = response.status;
    throw error;
  }

  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as T;
  }

  return response.json();
}

export const githubApi = {
  getFile: async (
    token: string,
    params: { repo: string; path: string; branch?: string; file_type?: 'indicator' | 'signal' | 'strategy' }
  ): Promise<GithubFileResponse> => {
    const query = new URLSearchParams({
      repo: params.repo,
      path: params.path,
      ...(params.branch ? { branch: params.branch } : {}),
      ...(params.file_type ? { file_type: params.file_type } : {}),
    });

    return apiFetch<GithubFileResponse>(token, `/api/github/file?${query.toString()}`);
  },

  saveFile: async (token: string, payload: GithubSaveRequest): Promise<GithubSaveResponse> => {
    return apiFetch<GithubSaveResponse>(token, '/api/github/file', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  getTree: async (token: string, params: GithubTreeParams): Promise<FileNode[]> => {
    const query = new URLSearchParams({
      repo: params.repo,
      ...(params.branch ? { branch: params.branch } : {}),
      ...(params.path ? { path: params.path } : {}),
    });
    return apiFetch<FileNode[]>(token, `/api/github/tree?${query.toString()}`);
  },

  bootstrap: async (token: string, payload: BootstrapRequest): Promise<{ success: boolean }> => {
    return apiFetch<{ success: boolean }>(token, '/api/github/bootstrap', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  listAppRepos: async (token: string): Promise<AppRepo[]> => {
    return apiFetch<AppRepo[]>(token, '/api/github/app-repos');
  },

  createAppRepo: async (
    token: string,
    payload: { name?: string; private?: boolean; description?: string }
  ): Promise<AppRepo> => {
    return apiFetch<AppRepo>(token, '/api/github/app-repos/create', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
