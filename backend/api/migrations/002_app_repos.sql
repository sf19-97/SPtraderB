-- App-managed GitHub repositories (kumquant)
CREATE TABLE IF NOT EXISTS app_repos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    github_repo_id BIGINT NOT NULL,
    name VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    default_branch VARCHAR(255) NOT NULL,
    root_path VARCHAR(255) DEFAULT 'build_center',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_repos_owner_full_name
    ON app_repos(owner_user_id, full_name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_repos_github_repo_id
    ON app_repos(github_repo_id);
