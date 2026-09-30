# job_search_automations relationships

## Persona to Frontend
jobSeeker -> jobSearchUI "Views candidates and configures scoring rubric [HTTP]"
jobSeeker -> aiHarness "Directs search parameters, targets, and triggers search routines"

## System-level Scheduled Jobs (for Landscape and Context views)
aiHarness -> companyDiscoveryPlatforms "1. Daily Company Search (8:00 PM): Discovers target hiring companies [HTTPS]"
aiHarness -> job_search_automations "2. Daily Title Search (9:00 PM): Discovers target role patterns and keywords [MCP]"
aiHarness -> job_search_automations "3. Daily Job Crawl (6:00 AM): Triggers automated scraping of career sites & ATS [MCP]"
aiHarness -> job_search_automations "4. Daily Job Evaluation (7:00 AM): Evaluates postings against resume & scoring rubric [MCP]"

## Container-level Scheduled Jobs (for Container and Automation views)
aiHarness -> jobSearchDBMCP "2. Daily Title Search (9:00 PM): Discovers target role patterns and keywords [MCP]"
aiHarness -> crawlerEngine "3. Daily Job Crawl (6:00 AM): Triggers automated scraping of career sites & ATS [CLI]"
aiHarness -> jobSearchDBMCP "4. Daily Job Evaluation (7:00 AM): Evaluates postings against resume & scoring rubric [MCP]"

## Frontend to DataStore
jobSearchUI -> sqliteDB "Reads pipeline activity, candidate evaluations, and configuration [SQLite]"

## Backend to External & DataStore
crawlerEngine -> atsPlatforms "Scrapes and queries job openings [HTTPS]"
crawlerEngine -> jobSearchDBMCP "Pushes discovered postings to crawl queue [MCP]"
jobSearchDBMCP -> sqliteDB "Reads and writes workspace data in local mode [SQLite]"
jobSearchDBMCP -> neonPostgres "Syncs and persists workspace data in cloud mode (optional) [PostgreSQL]"
