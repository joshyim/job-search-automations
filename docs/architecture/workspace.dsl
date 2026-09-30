workspace job_search_automations "Job Search Automations" {

    model {
        !include ./models/job_search_automations.dsl
        !include ./models/job_search_automations_personas.dsl
        !include ./models/job_search_automations_relations.dsl
    }

    views {
        !include ./views/views.dsl

        styles {
            !include ./styles/style.dsl
        }

        properties {
            "structurizr.sort" "type"
        }
    }
}
