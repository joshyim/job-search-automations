# job_search_automations personas

jobSeeker = person "Job Seeker" {
    description "Primary user directing the automated job search, adjusting the scoring rubric, and reviewing candidates."
}

aiHarness = person "AI Harness" {
    description "Agent harness (Claude Code, GitHub Copilot, Codex, etc.) executing search skills, scheduled routines, crawls, and assessments."
    tags "AI Harness"
}
