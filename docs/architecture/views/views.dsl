# views
systemLandscape "job_search_automations_landscape" "Landscape" {
    include *
}

systemContext job_search_automations "System_Context" {
    include *
    include companyDiscoveryPlatforms
}

container job_search_automations "System_Components" {
    include *
}

container job_search_automations "AI_Harness_Automations" "AI Harness automation routines interacting with system containers and external systems" {
    include aiHarness
    include jobSearchDBMCP
    include crawlerEngine
    include companyDiscoveryPlatforms
    include atsPlatforms
}
