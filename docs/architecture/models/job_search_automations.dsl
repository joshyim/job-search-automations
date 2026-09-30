# software systems
job_search_automations = softwareSystem "Job Search Automations" {
    description "Job Search Automation plugin with dual-mode MCP server, Web UI Dashboard, and automated crawling and scoring pipelines."

    # frontend
    jobSearchUI = container "Job Search UI" {
        description "Local single-page dashboard to manage preferences, adjust scoring rubrics, and review candidates visually."
        technology "HTML, Vanilla CSS, JavaScript, Express"
        tags "Web Browser"
    }

    # backend
    jobSearchDBMCP = container "Job Search DB MCP Server" {
        description "Dual-mode stdio MCP server providing data access and tools for companies, jobs, rubrics, and evaluations."
        technology "Node.js, Model Context Protocol (MCP)"
    }

    crawlerEngine = container "Job Board Crawler Engine" {
        description "Lightweight crawler and scraper for ATS endpoints (Greenhouse, Lever, Ashby, Workday) and company career sites."
        technology "Node.js, Cheerio"
    }

    group "Persistent Data" {
        sqliteDB = container "Local SQLite DataStore" {
            description "Local embedded SQLite database storing companies, crawl queue, candidate evaluations, and scoring rubric."
            technology "SQLite"
            tags "Database"
        }
    }
}

# External systems
atsPlatforms = softwareSystem "ATS Platforms & Job Boards" {
    description "Third-party ATS providers (Greenhouse, Lever, Ashby, Workday) and career pages hosting job postings."
    tags "external app"
}

companyDiscoveryPlatforms = softwareSystem "Company Discovery Platforms" {
    description "Discovery sources (Y Combinator, BuiltIn, Wellfound, LinkedIn) used for finding target hiring companies."
    tags "external app"
}

neonPostgres = softwareSystem "Neon PostgreSQL (Optional)" {
    description "Optional remote serverless PostgreSQL database used when running in cloud mode."
    tags "external app"
}
